import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { respondToApartmentGroupJoinRequest } from "@/lib/apartments/group-actions";
import { normalizeSmsRecipient } from "@/lib/integrations/continue-on-phone";
import {
  buildGroupJoinProfileCardUrl,
  type GroupJoinProfileCardSnapshot,
} from "@/lib/profiles/profile-card";
import { hitTextAgentRateLimit } from "@/lib/text-agent/rate-limit";
import { getKinfolkPublicMediaBaseUrl } from "@/lib/text-agent/store-shared";
import {
  getActiveTextTransportProvider,
  getTextTransportFromNumber,
  isTextAgentEnabled,
  readTextProviderForRow,
  sendTextMessage,
  type TextReactionEvent,
  type TextTransportProvider,
} from "@/lib/integrations/text-transport";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];
type GroupJoinNotificationRow = TableRow<"text_group_join_notifications">;

// The membership-scoped idempotency key does NOT stop a requester from cycling
// request_join → leave → request_join: each loop mints a new membershipId /
// requested_at, so the key changes and a fresh SMS is sent. These two budgets
// cap that amplification independently of the key.
//
// Cooldown: a single creator isn't re-paged about the same requester+group more
// than once per window (defeats the same-pair cycling attack directly).
const groupJoinNotificationCooldownMs = 6 * 60 * 60 * 1000;
// Backstop: total join pages to one creator per hour, across all requesters and
// groups (defeats distinct-account / distinct-group amplification too).
const maxGroupJoinNotificationsPerRecipientHour = 6;

const groupJoinCardFieldLimits = {
  about: 140,
  factValue: 72,
  groupLabel: 72,
  groupNeighborhood: 56,
  headline: 72,
  imageUrl: 384,
  requestedAt: 32,
  requesterName: 72,
  requesterUserId: 72,
} as const;

export async function sendGroupJoinRequestNotification(
  supabase: SupabaseServiceClient,
  {
    groupId,
    membershipId,
    requesterUserId,
  }: {
    groupId: string;
    membershipId: string;
    requesterUserId: string;
  },
) {
  const membership = await loadPendingMembership(supabase, {
    groupId,
    membershipId,
    requesterUserId,
  });
  if (!membership) {
    return { sent: false, skipped: "not_pending" as const };
  }

  const snapshot = await buildGroupJoinProfileCardSnapshot(supabase, {
    groupId,
    requestedAt: membership.requested_at,
    requesterUserId,
  });
  if (!snapshot.recipientUserId) {
    return { sent: false, skipped: "no_group_creator" as const };
  }

  const phone = await findVerifiedOptedInPhoneForUser(
    supabase,
    snapshot.recipientUserId,
  );
  if (!phone) {
    return { sent: false, skipped: "no_verified_phone" as const };
  }

  const baseUrl = getKinfolkPublicMediaBaseUrl();
  if (!baseUrl) {
    return { sent: false, skipped: "missing_base_url" as const };
  }

  const provider = getActiveTextTransportProvider();
  if (!isTextAgentEnabled(provider)) {
    return { sent: false, skipped: "transport_disabled" as const };
  }

  // Per-(group, requester, recipient) cooldown: skip if we already sent this
  // creator a page about this requester+group within the window. The cycling
  // attack mints a new membership row each loop, but this triple is stable.
  const cooldownStart = new Date(
    Date.now() - groupJoinNotificationCooldownMs,
  ).toISOString();
  const recentForPair = await supabase
    .from("text_group_join_notifications")
    .select("id")
    .eq("recipient_user_id", snapshot.recipientUserId)
    .eq("requester_user_id", requesterUserId)
    .eq("group_id", groupId)
    .eq("status", "sent")
    .gte("created_at", cooldownStart)
    .limit(1)
    .maybeSingle();
  if (recentForPair.error) {
    throw recentForPair.error;
  }
  if (recentForPair.data) {
    return { sent: false, skipped: "recently_notified" as const };
  }

  // Per-recipient hourly backstop so one creator can't be blasted by many
  // distinct requesters/groups even when each pair is under its own cooldown.
  const recipientBudget = await hitTextAgentRateLimit(supabase, {
    bucketKey: snapshot.recipientUserId,
    bucketType: "group_join_recipient_hour",
    limit: maxGroupJoinNotificationsPerRecipientHour,
    window: "hour",
  });
  if (!recipientBudget.allowed) {
    return { sent: false, skipped: "rate_limited" as const };
  }

  const idempotencyKey = buildGroupJoinNotificationIdempotencyKey({
    membershipId,
    requestedAt: membership.requested_at,
  });
  const existing = await supabase
    .from("text_group_join_notifications")
    .select("*")
    .eq("recipient_user_id", snapshot.recipientUserId)
    .eq("membership_id", membershipId)
    .eq("outbound_idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }
  if (existing.data?.outbound_message_id) {
    return { sent: false, skipped: "already_sent" as const };
  }

  const notification = existing.data
    ? await refreshNotificationSnapshot(supabase, existing.data.id, snapshot.card)
    : await insertNotification(supabase, {
        groupId,
        idempotencyKey,
        membershipId,
        recipientUserId: snapshot.recipientUserId,
        requesterUserId,
        snapshot: snapshot.card,
      });
  if (!notification) {
    return { sent: false, skipped: "already_reserved" as const };
  }
  const cardUrl = buildGroupJoinProfileCardUrl({
    baseUrl,
    notificationId: notification.id,
  });
  const body = formatGroupJoinNotificationText(snapshot.card);
  const existingThread = await findNotificationThread(supabase, {
    phoneNumber: phone.phone_e164,
    provider,
    userId: snapshot.recipientUserId,
  });
  const response = await sendTextMessage({
    chatId: existingThread?.provider_chat_id,
    idempotencyKey,
    parts: [
      { type: "text", value: body },
      { type: "media", url: cardUrl },
    ],
    provider,
    to: phone.phone_e164,
  });
  if (!response.messageId) {
    throw new Error("Text transport did not return a join notification message id.");
  }

  const thread = await upsertNotificationThread(supabase, {
    chatId: response.chatId,
    existingThread,
    phoneNumber: phone.phone_e164,
    phoneNumberId: phone.id,
    provider,
    userId: snapshot.recipientUserId,
  });
  const mediaPart = { type: "media" as const, url: cardUrl };
  const insertMessage = await supabase.from("text_messages").insert({
    body,
    delivery_status: response.deliveryStatus,
    direction: "outbound",
    from_phone_e164: getTextTransportFromNumber(provider),
    media: [mediaPart] as Json,
    outbound_idempotency_key: idempotencyKey,
    phone_number_id: phone.id,
    provider,
    provider_chat_id: response.chatId ?? thread.provider_chat_id,
    provider_message_id: response.messageId,
    raw_payload: {
      group_id: groupId,
      idempotency_key: idempotencyKey,
      membership_id: membershipId,
      message_kind: "group_join_request_profile_card",
      notification_id: notification.id,
      requester_user_id: requesterUserId,
    } as Json,
    received_at: new Date().toISOString(),
    service: response.service,
    thread_id: thread.id,
    to_phone_e164: phone.phone_e164,
    user_id: snapshot.recipientUserId,
  });
  if (insertMessage.error && insertMessage.error.code !== "23505") {
    throw insertMessage.error;
  }

  const updateNotification = await supabase
    .from("text_group_join_notifications")
    .update({
      outbound_message_id: response.messageId,
      status: "sent",
      thread_id: thread.id,
    })
    .eq("id", notification.id);
  if (updateNotification.error) {
    throw updateNotification.error;
  }

  return { notificationId: notification.id, sent: true };
}

export async function processGroupJoinRequestReaction(
  supabase: SupabaseServiceClient,
  reaction: TextReactionEvent,
) {
  const notificationResult = await supabase
    .from("text_group_join_notifications")
    .select("*")
    .eq("outbound_message_id", reaction.messageId)
    .maybeSingle();

  if (notificationResult.error) {
    throw notificationResult.error;
  }
  const notification = notificationResult.data;
  if (!notification) {
    return { handled: false };
  }

  if (notification.thread_id) {
    const verified = await verifyReactionThread(supabase, {
      reaction,
      threadId: notification.thread_id,
    });
    if (!verified) {
      return { handled: false };
    }
  }

  const isLike =
    reaction.reactionType === "like" || reaction.reactionType === "love";
  const isDislike = reaction.reactionType === "dislike";
  const feedbackValue = reaction.removed
    ? 0
    : isDislike
      ? -1
      : isLike
        ? 1
        : 0;
  let status: TableRow<"text_group_join_notifications">["status"] =
    reaction.removed ? notification.status : isLike ? "accepted" : isDislike ? "declined" : "reacted";

  if (!reaction.removed && (isLike || isDislike)) {
    const responseStatus = await respondToApartmentGroupJoinRequest(supabase, {
      actorUserId: notification.recipient_user_id,
      approve: isLike,
      groupId: notification.group_id,
      targetUserId: notification.requester_user_id,
    });
    if (isLike) {
      status =
        responseStatus === "accepted" || responseStatus === "already_accepted"
          ? "accepted"
          : "reacted";
    } else {
      status = responseStatus === "declined" ? "declined" : "reacted";
    }
  }

  const update = await supabase
    .from("text_group_join_notifications")
    .update({
      feedback_value: feedbackValue,
      reaction_event_id: reaction.eventId,
      reaction_type: reaction.removed ? null : reaction.reactionType,
      reacted_at: reaction.removed ? null : new Date().toISOString(),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", notification.id);
  if (update.error) {
    throw update.error;
  }

  return { handled: true };
}

async function loadPendingMembership(
  supabase: SupabaseServiceClient,
  {
    groupId,
    membershipId,
    requesterUserId,
  }: {
    groupId: string;
    membershipId: string;
    requesterUserId: string;
  },
) {
  const result = await supabase
    .from("apartment_roommate_group_memberships")
    .select("id,requested_at,status")
    .eq("id", membershipId)
    .eq("group_id", groupId)
    .eq("user_id", requesterUserId)
    .eq("status", "requested")
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function buildGroupJoinProfileCardSnapshot(
  supabase: SupabaseServiceClient,
  {
    groupId,
    requestedAt,
    requesterUserId,
  }: {
    groupId: string;
    requestedAt: string;
    requesterUserId: string;
  },
): Promise<{
  card: GroupJoinProfileCardSnapshot;
  recipientUserId: string | null;
}> {
  const groupResult = await supabase
    .from("apartment_roommate_groups")
    .select("id,listing_id,floor_plan_name,target_unit_name,bedrooms,max_size,created_by_user_id")
    .eq("id", groupId)
    .single();
  if (groupResult.error) throw groupResult.error;
  const group = groupResult.data;

  if (!group.created_by_user_id || group.created_by_user_id === requesterUserId) {
    return {
      card: fallbackGroupJoinProfileCardSnapshot(requesterUserId),
      recipientUserId: null,
    };
  }

  const [profile, photo, listing, edge, profileFacts] = await Promise.all([
    loadUserProfile(supabase, requesterUserId),
    loadPrimaryUserPhoto(supabase, requesterUserId),
    loadListingContext(supabase, group.listing_id),
    loadCompatibilityScore(supabase, {
      requesterUserId,
      viewerUserId: group.created_by_user_id,
    }),
    loadProfileFacts(supabase, requesterUserId),
  ]);
  const name = profile?.display_name?.trim() || "Someone";
  const bedrooms = normalizeGroupJoinCardText(
    formatBedroomLabel(group.bedrooms, group.floor_plan_name),
    20,
  );
  const address = normalizeGroupJoinCardText(
    listing?.address ?? group.target_unit_name ?? "a Kinfolk group",
    groupJoinCardFieldLimits.groupLabel,
  );
  const headline =
    normalizeGroupJoinCardText(
      headlineFromUser(profile),
      groupJoinCardFieldLimits.headline,
    ) || "Roommate request";
  const facts = buildProfileFacts(profile, headline);
  const groupLabel = normalizeGroupJoinCardText(
    [bedrooms, address || "a Kinfolk group"].filter(Boolean).join(" - "),
    groupJoinCardFieldLimits.groupLabel,
  );

  return {
    card: {
      about:
        normalizeNullableGroupJoinCardText(
          profile?.about_text,
          groupJoinCardFieldLimits.about,
        ) ??
        normalizeNullableGroupJoinCardText(
          profileFactAbout(profileFacts),
          groupJoinCardFieldLimits.about,
        ),
      facts,
      fitScore: edge?.score == null ? null : Math.round(edge.score),
      groupLabel: groupLabel || "Kinfolk group",
      groupNeighborhood: normalizeGroupJoinCardText(
        listing?.neighborhood,
        groupJoinCardFieldLimits.groupNeighborhood,
      ),
      headline,
      imageUrl: normalizeNullableGroupJoinCardText(
        photo,
        groupJoinCardFieldLimits.imageUrl,
      ),
      requestedAt:
        normalizeGroupJoinCardText(
          requestedAt,
          groupJoinCardFieldLimits.requestedAt,
        ) || new Date().toISOString(),
      requesterInitials: initialsFor(name),
      requesterName:
        normalizeGroupJoinCardText(
          name,
          groupJoinCardFieldLimits.requesterName,
        ) || "Someone",
      requesterUserId:
        normalizeGroupJoinCardText(
          requesterUserId,
          groupJoinCardFieldLimits.requesterUserId,
        ) || requesterUserId,
    },
    recipientUserId: group.created_by_user_id,
  };
}

function fallbackGroupJoinProfileCardSnapshot(
  requesterUserId: string,
): GroupJoinProfileCardSnapshot {
  return {
    about: null,
    facts: [],
    fitScore: null,
    groupLabel: "Kinfolk group",
    groupNeighborhood: "",
    headline: "Roommate request",
    imageUrl: null,
    requestedAt: new Date().toISOString(),
    requesterInitials: "K",
    requesterName: "Someone",
    requesterUserId,
  };
}

async function loadUserProfile(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("kinfolk_users")
    .select(
      "id,display_name,occupation_title,occupation_company,about_text,education_school,education_degree,education_major,education_year,hometown",
    )
    .eq("id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function loadPrimaryUserPhoto(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("kinfolk_user_photos")
    .select("public_url,is_primary,position")
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.public_url ?? null;
}

type ProfileFactLite = {
  fact_key: string;
  normalized_value: string;
};

async function loadProfileFacts(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<ProfileFactLite[]> {
  const result = await supabase
    .from("profile_facts")
    .select("fact_key,normalized_value")
    .eq("user_id", userId)
    .eq("sensitivity_level", "standard")
    .eq("matching_eligible", true)
    .in("user_review_state", ["approved", "edited"])
    .order("importance", { ascending: false })
    .order("confidence", { ascending: false })
    .limit(12);
  if (result.error) throw result.error;

  return (result.data ?? []).flatMap((fact) => {
    const value = cleanProfileFactValue(fact.normalized_value);
    return value ? [{ fact_key: fact.fact_key, normalized_value: value }] : [];
  });
}

function profileFactAbout(facts: ProfileFactLite[]) {
  return firstProfileFactValue(facts, [
    "community_orientation",
    "independence_level",
    "privacy_orientation",
    "rent_tradeoff",
    "social_energy",
  ]);
}

function firstProfileFactValue(facts: ProfileFactLite[], keys: string[]) {
  const keySet = new Set(keys);
  return facts.find((fact) => keySet.has(fact.fact_key))?.normalized_value ?? null;
}

function cleanProfileFactValue(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower.startsWith("unknown") || lower.includes("no reliable evidence")) {
    return null;
  }
  return normalized.replace(/[.]+$/g, "");
}

async function loadListingContext(
  supabase: SupabaseServiceClient,
  listingId: string,
) {
  const result = await supabase
    .from("apartment_listings")
    .select("address_line,neighborhood,city")
    .eq("id", listingId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  return {
    address: result.data.address_line,
    neighborhood: result.data.neighborhood ?? result.data.city ?? "",
  };
}

async function loadCompatibilityScore(
  supabase: SupabaseServiceClient,
  {
    requesterUserId,
    viewerUserId,
  }: {
    requesterUserId: string;
    viewerUserId: string;
  },
) {
  const result = await supabase
    .from("compatibility_edges")
    .select("score")
    .or(
      `and(user_a_id.eq.${viewerUserId},user_b_id.eq.${requesterUserId}),and(user_a_id.eq.${requesterUserId},user_b_id.eq.${viewerUserId})`,
    )
    .eq("status", "active")
    .order("score", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function findVerifiedOptedInPhoneForUser(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("user_phone_numbers")
    .select("*")
    .eq("user_id", userId)
    .not("verified_at", "is", null)
    .eq("sms_consent_state", "opted_in")
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function findNotificationThread(
  supabase: SupabaseServiceClient,
  {
    phoneNumber,
    provider,
    userId,
  }: {
    phoneNumber: string;
    provider: TextTransportProvider;
    userId: string;
  },
) {
  const result = await supabase
    .from("text_threads")
    .select("*")
    .eq("provider", provider)
    .eq("user_id", userId)
    .eq("to_phone_e164", normalizeSmsRecipient(phoneNumber))
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function upsertNotificationThread(
  supabase: SupabaseServiceClient,
  {
    chatId,
    existingThread,
    phoneNumber,
    phoneNumberId,
    provider,
    userId,
  }: {
    chatId: string | null;
    existingThread: TableRow<"text_threads"> | null;
    phoneNumber: string;
    phoneNumberId: string;
    provider: TextTransportProvider;
    userId: string;
  },
) {
  const normalizedPhone = normalizeSmsRecipient(phoneNumber);
  const from = getTextTransportFromNumber(provider);
  if (!chatId && !existingThread?.provider_chat_id) {
    throw new Error("Text transport did not return a notification chat id.");
  }

  const resolvedChatId = chatId ?? existingThread?.provider_chat_id ?? "";
  const byChat = await supabase
    .from("text_threads")
    .select("*")
    .eq("provider", provider)
    .eq("provider_chat_id", resolvedChatId)
    .maybeSingle();
  if (byChat.error) throw byChat.error;

  const thread = byChat.data ?? existingThread;
  if (thread) {
    if (thread.user_id && thread.user_id !== userId) {
      throw new Error("Text thread is already linked to a different Kinfolk user.");
    }

    const updated = await supabase
      .from("text_threads")
      .update({
        from_phone_e164: from,
        last_message_at: new Date().toISOString(),
        phone_number_id: phoneNumberId,
        provider_chat_id: resolvedChatId,
        status: "active",
        to_phone_e164: normalizedPhone,
        user_id: userId,
      })
      .eq("id", thread.id)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    return updated.data;
  }

  const inserted = await supabase
    .from("text_threads")
    .insert({
      from_phone_e164: from,
      last_message_at: new Date().toISOString(),
      phone_number_id: phoneNumberId,
      provider,
      provider_chat_id: resolvedChatId,
      status: "active",
      to_phone_e164: normalizedPhone,
      user_id: userId,
    })
    .select("*")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function verifyReactionThread(
  supabase: SupabaseServiceClient,
  {
    reaction,
    threadId,
  }: {
    reaction: TextReactionEvent;
    threadId: string;
  },
) {
  const threadResult = await supabase
    .from("text_threads")
    .select("provider,provider_chat_id,to_phone_e164")
    .eq("id", threadId)
    .single();
  if (threadResult.error) throw threadResult.error;

  const thread = threadResult.data;
  return (
    readTextProviderForRow(thread.provider) === reaction.provider &&
    thread.provider_chat_id === reaction.chatId &&
    thread.to_phone_e164 === reaction.from
  );
}

async function insertNotification(
  supabase: SupabaseServiceClient,
  {
    groupId,
    idempotencyKey,
    membershipId,
    recipientUserId,
    requesterUserId,
    snapshot,
  }: {
    groupId: string;
    idempotencyKey: string;
    membershipId: string;
    recipientUserId: string;
    requesterUserId: string;
    snapshot: GroupJoinProfileCardSnapshot;
  },
): Promise<GroupJoinNotificationRow | null> {
  const result = await supabase
    .from("text_group_join_notifications")
    .insert({
      card_snapshot: snapshot as unknown as Json,
      group_id: groupId,
      membership_id: membershipId,
      outbound_idempotency_key: idempotencyKey,
      recipient_user_id: recipientUserId,
      requester_user_id: requesterUserId,
      status: "failed",
    })
    .select("*")
    .single();
  if (result.error?.code === "23505") {
    return null;
  }
  if (result.error) throw result.error;
  return result.data;
}

async function refreshNotificationSnapshot(
  supabase: SupabaseServiceClient,
  notificationId: string,
  snapshot: GroupJoinProfileCardSnapshot,
) {
  const result = await supabase
    .from("text_group_join_notifications")
    .update({
      card_snapshot: snapshot as unknown as Json,
      status: "failed",
    })
    .eq("id", notificationId)
    .select("*")
    .single();
  if (result.error) throw result.error;
  return result.data;
}

function formatGroupJoinNotificationText(
  snapshot: GroupJoinProfileCardSnapshot,
) {
  const requesterName =
    normalizeGroupJoinCardText(
      snapshot.requesterName,
      groupJoinCardFieldLimits.requesterName,
    ) || "Someone";
  const groupLabel =
    normalizeGroupJoinCardText(
      snapshot.groupLabel,
      groupJoinCardFieldLimits.groupLabel,
    ) || "Kinfolk group";

  return [
    `${requesterName} wants to join your ${groupLabel} group.`,
    "Tap thumbs up to accept or thumbs down to decline.",
  ].join("\n");
}

function buildProfileFacts(
  profile: Awaited<ReturnType<typeof loadUserProfile>>,
  headline: string,
) {
  const facts: GroupJoinProfileCardSnapshot["facts"] = [];
  if (headline && headline !== "Roommate request") {
    facts.push({ label: "Career", value: headline });
  }
  const education = profile ? formatEducation(profile) : null;
  const educationValue = normalizeGroupJoinCardText(
    education,
    groupJoinCardFieldLimits.factValue,
  );
  if (educationValue) {
    facts.push({ label: "Education", value: educationValue });
  }
  const hometown = normalizeGroupJoinCardText(
    profile?.hometown,
    groupJoinCardFieldLimits.factValue,
  );
  if (hometown) {
    facts.push({ label: "From", value: hometown });
  }
  return facts.slice(0, 4);
}

function headlineFromUser(
  user:
    | Pick<
        TableRow<"kinfolk_users">,
        "occupation_company" | "occupation_title"
      >
    | null,
): string {
  if (!user) return "Roommate request";
  const parts = [user.occupation_title, user.occupation_company]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join(" - ") || "Roommate request";
}

function formatEducation(
  profile: Pick<
    TableRow<"kinfolk_users">,
    "education_degree" | "education_major" | "education_school" | "education_year"
  >,
) {
  const degree = [profile.education_degree, profile.education_major]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const parts = [profile.education_school?.trim(), degree, profile.education_year?.trim()]
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" - ") : null;
}

function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "K";
}

function normalizeNullableGroupJoinCardText(
  value: string | null | undefined,
  maxLength: number,
) {
  const normalized = normalizeGroupJoinCardText(value, maxLength);
  return normalized || null;
}

function normalizeGroupJoinCardText(
  value: string | null | undefined,
  maxLength: number,
) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function formatBedroomLabel(
  bedrooms: number | null,
  fallback: string,
): string {
  if (bedrooms == null) {
    return fallback;
  }

  return `${Number.isInteger(bedrooms) ? bedrooms : bedrooms.toFixed(1)}BR`;
}

function buildGroupJoinNotificationIdempotencyKey({
  membershipId,
  requestedAt,
}: {
  membershipId: string;
  requestedAt: string;
}) {
  const requestedAtMs = Date.parse(requestedAt);
  const suffix = Number.isFinite(requestedAtMs) ? requestedAtMs : requestedAt;
  return `kinfolk:group-join:${membershipId}:${suffix}`;
}
