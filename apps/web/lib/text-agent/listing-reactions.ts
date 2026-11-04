import "server-only";
import { parseListingCardSnapshot } from "@/lib/apartments/listing-card";
import { getTextTransportFromNumber, readTextProviderForRow, sendTextMessage } from "@/lib/integrations/text-transport";
import type { SupabaseServiceClient, TableRow } from "@/lib/text-agent/store-types";
import type { TextReactionEvent } from "@/lib/integrations/text-transport";
import { buildListingDetailWebUrl, formatListingLikeFollowUpText } from "@/lib/text-agent/listing-format";
import { isPhoneOptedOut } from "@/lib/text-agent/phone-verification";
import { getKinfolkBaseUrl } from "@/lib/text-agent/store-shared";

// A 'sending' claim older than this is an orphan from a crashed attempt, not
// an active concurrent sender — a retry may take it over.
const staleListingFollowUpClaimMs = 90_000;

export async function processListingRecommendationReaction(
  supabase: SupabaseServiceClient,
  reaction: TextReactionEvent,
) {
  const recommendationsResult = await supabase
    .from("text_listing_recommendations")
    .select("*")
    .eq("outbound_message_id", reaction.messageId);

  if (recommendationsResult.error) {
    throw recommendationsResult.error;
  }

  const rows = recommendationsResult.data ?? [];
  if (rows.length === 0) {
    return { handled: false };
  }

  // A tapback can target one part of a multi-part provider message. When the
  // provider includes a part index, require it to match the stamped card rank
  // even if there is only one listing row, otherwise a reaction to the text
  // intro can be misread as listing feedback.
  let recommendation: TableRow<"text_listing_recommendations"> | undefined;
  if (reaction.partIndex != null) {
    const targetRank = reaction.partIndex + 1;
    recommendation = rows.find((row) => row.rank === targetRank);
  } else if (rows.length === 1) {
    recommendation = rows[0];
  }

  if (!recommendation) {
    // Whole-carousel reaction with no part index — can't tell which listing.
    return { handled: false };
  }

  return processResolvedListingRecommendationReaction(
    supabase,
    recommendation,
    reaction,
  );
}

async function processResolvedListingRecommendationReaction(
  supabase: SupabaseServiceClient,
  recommendation: TableRow<"text_listing_recommendations">,
  reaction: TextReactionEvent,
) {
  const threadResult = await supabase
    .from("text_threads")
    .select("provider,provider_chat_id,to_phone_e164")
    .eq("id", recommendation.thread_id)
    .eq("user_id", recommendation.user_id)
    .single();

  if (threadResult.error) {
    throw threadResult.error;
  }

  if (
    readTextProviderForRow(threadResult.data.provider) !== reaction.provider ||
    threadResult.data.provider_chat_id !== reaction.chatId ||
    threadResult.data.to_phone_e164 !== reaction.from
  ) {
    return { handled: false };
  }

  const isLike =
    reaction.reactionType === "like" || reaction.reactionType === "love";
  const isDislike = reaction.reactionType === "dislike";
  const feedbackValue = reaction.removed ? 0 : isDislike ? -1 : isLike ? 1 : 0;
  const status = reaction.removed
    ? "sent"
    : isDislike
      ? "passed"
      : isLike
        ? "liked"
        : "reacted";

  const update = await supabase
    .from("text_listing_recommendations")
    .update({
      feedback_value: feedbackValue,
      reaction_event_id: reaction.eventId,
      reaction_part_index: reaction.partIndex,
      reaction_type: reaction.removed ? null : reaction.reactionType,
      reacted_at: reaction.removed ? null : new Date().toISOString(),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recommendation.id)
    .eq("user_id", recommendation.user_id)
    .eq("thread_id", recommendation.thread_id);

  if (update.error) {
    throw update.error;
  }

  const matchStatus = reaction.removed
    ? "suggested"
    : status === "passed"
      ? "passed"
      : status === "liked"
        ? "saved"
        : null;
  if (matchStatus) {
    const matchUpdate = await supabase
      .from("apartment_listing_matches")
      .update({ status: matchStatus })
      .eq("user_id", recommendation.user_id)
      .eq("listing_id", recommendation.listing_id)
      .select("id");

    if (matchUpdate.error) {
      throw matchUpdate.error;
    }

    // A liked listing with no match row (e.g. a near-place text result the
    // engine never scored) still has to land on the web shortlist, or the
    // follow-up's "saved" claim is a lie. Seed a minimal row from the card
    // snapshot the user actually reacted to.
    if (matchStatus === "saved" && (matchUpdate.data ?? []).length === 0) {
      const snapshot = parseListingCardSnapshot(recommendation.card_snapshot);
      const perPersonRent =
        snapshot?.effectivePerPersonRent ??
        snapshot?.perPersonRent ??
        snapshot?.effectiveRent ??
        snapshot?.monthlyRent ??
        0;
      const matchInsert = await supabase.from("apartment_listing_matches").insert({
        effective_per_person_rent:
          snapshot?.effectivePerPersonRent ?? perPersonRent,
        fit_score: snapshot?.fitScore ?? 0,
        listing_id: recommendation.listing_id,
        per_person_rent: snapshot?.perPersonRent ?? perPersonRent,
        recommended_household_size: snapshot?.recommendedHouseholdSize ?? 1,
        status: matchStatus,
        user_id: recommendation.user_id,
      });

      if (matchInsert.error && matchInsert.error.code !== "23505") {
        throw matchInsert.error;
      }
    }
  }

  // Mirror the heart into saved_places, the shared taste spine: web hearts
  // already land there, and roommate compatibility + apartment fit both read
  // it. Without this, SMS-only users contribute zero taste signal.
  await syncListingReactionToSavedPlaces(supabase, {
    listingId: recommendation.listing_id,
    remove: reaction.removed || isDislike,
    save: isLike && !reaction.removed,
    userId: recommendation.user_id,
  });

  if (status === "liked" && !reaction.removed) {
    try {
      await sendListingLikeFollowUp(supabase, recommendation, reaction);
    } catch (error) {
      console.error(
        "[text-agent] Failed to send listing like follow-up.",
        error,
      );
    }
  }

  return { handled: true };
}

async function syncListingReactionToSavedPlaces(
  supabase: SupabaseServiceClient,
  {
    listingId,
    remove,
    save,
    userId,
  }: {
    listingId: string;
    remove: boolean;
    save: boolean;
    userId: string;
  },
) {
  if (save) {
    const insert = await supabase.from("saved_places").insert({
      kind: "listing",
      listing_id: listingId,
      note: "Saved from your text reaction",
      user_id: userId,
    });
    // 23505: already saved (web heart or an earlier reaction) — a no-op.
    if (insert.error && insert.error.code !== "23505") {
      throw insert.error;
    }
    return;
  }

  if (remove) {
    const del = await supabase
      .from("saved_places")
      .delete()
      .eq("user_id", userId)
      .eq("kind", "listing")
      .eq("listing_id", listingId);
    if (del.error) {
      throw del.error;
    }
  }
}

async function sendListingLikeFollowUp(
  supabase: SupabaseServiceClient,
  recommendation: TableRow<"text_listing_recommendations">,
  reaction: TextReactionEvent,
) {
  const idempotencyKey = `kinfolk:reaction:${reaction.eventId}:like-followup`;
  const provider = reaction.provider;
  const threadResult = await supabase
    .from("text_threads")
    .select("*")
    .eq("id", recommendation.thread_id)
    .single();

  if (threadResult.error) {
    throw threadResult.error;
  }

  const thread = threadResult.data;

  // Fail closed on opt-out: tapback reactions take a separate webhook branch
  // that never enters processInboundTextMessage, where opt-out enforcement
  // lives. Without this gate a user who texted STOP would still receive this
  // outbound follow-up — a direct TCPA-consent violation since Kinfolk is the
  // auto-sender.
  if (await isPhoneOptedOut(supabase, thread.to_phone_e164)) {
    return;
  }

  const body = formatListingLikeFollowUpText(
    parseListingCardSnapshot(recommendation.card_snapshot),
    buildListingDetailWebUrl(getKinfolkBaseUrl(), recommendation.listing_id),
  );

  // Insert-first idempotency: the unique outbound key arbitrates racing
  // webhook deliveries before the transport call — the loser must not send.
  const claim = await supabase
    .from("text_messages")
    .insert({
      body,
      delivery_status: "sending",
      direction: "outbound",
      from_phone_e164: getTextTransportFromNumber(provider),
      media: [],
      outbound_idempotency_key: idempotencyKey,
      phone_number_id: thread.phone_number_id,
      provider,
      provider_chat_id: thread.provider_chat_id,
      raw_payload: {
        idempotency_key: idempotencyKey,
        listing_id: recommendation.listing_id,
        message_kind: "listing_like_followup",
        reaction_event_id: reaction.eventId,
      },
      received_at: new Date().toISOString(),
      thread_id: thread.id,
      to_phone_e164: thread.to_phone_e164,
      user_id: recommendation.user_id,
    })
    .select("id")
    .single();

  let claimId: string;
  if (claim.error && claim.error.code === "23505") {
    // Already sent by a racing webhook delivery, or an orphaned claim from a
    // crashed attempt — only the orphan may be taken over.
    const existing = await supabase
      .from("text_messages")
      .select("id, delivery_status, received_at")
      .eq("provider", provider)
      .eq("outbound_idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error) {
      throw existing.error;
    }
    const claimedAtMs = existing.data?.received_at
      ? Date.parse(existing.data.received_at)
      : Number.NaN;
    const claimIsStale =
      Number.isFinite(claimedAtMs) &&
      Date.now() - claimedAtMs >= staleListingFollowUpClaimMs;
    if (
      !existing.data ||
      existing.data.delivery_status !== "sending" ||
      !claimIsStale
    ) {
      return;
    }
    claimId = existing.data.id;
  } else if (claim.error) {
    throw claim.error;
  } else {
    claimId = claim.data.id;
  }

  let response;
  try {
    response = await sendTextMessage({
      chatId: thread.provider_chat_id,
      idempotencyKey,
      parts: [{ type: "text", value: body }],
      provider,
      to: thread.to_phone_e164,
    });
  } catch (error) {
    await supabase.from("text_messages").delete().eq("id", claimId);
    throw error;
  }

  const update = await supabase
    .from("text_messages")
    .update({
      delivery_status: response.deliveryStatus,
      provider_chat_id: response.chatId,
      provider_message_id: response.messageId,
      service: response.service,
    })
    .eq("id", claimId);

  if (update.error) {
    throw update.error;
  }
}
