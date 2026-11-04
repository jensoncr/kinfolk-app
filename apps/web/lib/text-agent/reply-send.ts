import "server-only";
import { getTextTransportFromNumber, readTextProviderForRow, sendTextMessage, sendTextText, startTextTyping } from "@/lib/integrations/text-transport";
import { parseListingCardSnapshot } from "@/lib/apartments/listing-card";
import { notifyFounder } from "@/lib/shared/alerts";
import type { SupabaseServiceClient, TableRow, TextAgentReply } from "@/lib/text-agent/store-types";
import type { TextSendMessageResult, TextTransportProvider } from "@/lib/integrations/text-transport";
import type { Json } from "@/lib/supabase/types";
import { getKinfolkContactCardUrl, getReviewUrl } from "@/lib/text-agent/store-shared";
import { textAgentReviewReplyCopy } from "./copy";

// iMessage bubbles read best short. 1600 chars per bubble is a generous safety
// net for pathological model output, not a target — the prompt already keeps
// replies tight, and trimming happens at a sentence boundary, never mid-thought.
const textReplyPartMaxChars = 1600;

// A reply splits on blank lines into at most this many paced bubbles, so a
// match rundown lands the way a person would text it instead of one wall.
const textReplyMaxParts = 3;

// A blank-line block shorter than this rides with its neighbor instead of
// getting its own bubble (closers like "Want me to pull one up?").
const textReplyTinyPartChars = 40;

const textReplyPartPacingMs = 900;
// A 'sending' claim older than this is an orphan from a crashed attempt, not
// an active concurrent sender — a retry may take it over.
const staleOutboundClaimMs = 90_000;

const textReplyMediaLimitWithBody = 5;

const textTypingHeartbeatIntervalMs = 4500;

export function startTextTypingHeartbeat({
  chatId,
  provider,
  singlePingOnly = false,
  to,
}: {
  chatId?: string | null;
  provider: TextTransportProvider;
  singlePingOnly?: boolean;
  to?: string | null;
}) {
  let stopped = false;
  const sendTyping = () => {
    if (stopped) {
      return;
    }

    startTextTyping({ chatId, provider, to }).catch((error) => {
      console.warn("[text-agent] Typing indicator failed.", {
        error: error instanceof Error ? error.message : String(error),
        hasChatId: Boolean(chatId),
        hasRecipient: Boolean(to),
        provider,
      });
    });
  };

  sendTyping();

  if (singlePingOnly) {
    return () => {
      stopped = true;
    };
  }

  const timer = setInterval(sendTyping, textTypingHeartbeatIntervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// iMessage renders plain text, not Markdown. A model that emits "**bold**" or
// "* bullet" leaves the user staring at literal asterisks, so strip the common
// Markdown markers down to clean text before sending.
function stripMarkdownForSms(body: string) {
  return body
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[*+-]\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/\*\*/g, "");
}

function formatSmsReplyBody(body: string) {
  return stripMarkdownForSms(body)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .reduce<string[]>((lines, line) => {
      if (!line && lines.at(-1) === "") return lines;
      lines.push(line);
      return lines;
    }, [])
    .join("\n")
    .trim();
}

// Blank lines are the model's bubble boundaries — the prompt mandates them
// between rundown items. Splitting only there means a bubble never breaks
// mid-sentence; tiny fragments merge so a stray closer doesn't bubble alone.
function splitReplyIntoParts(body: string) {
  if (!body) {
    return [];
  }

  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const merged = blocks.reduce<string[]>((parts, block) => {
    const last = parts.at(-1);
    if (
      last != null &&
      (block.length < textReplyTinyPartChars ||
        last.length < textReplyTinyPartChars)
    ) {
      parts[parts.length - 1] = `${last}\n\n${block}`;
    } else {
      parts.push(block);
    }
    return parts;
  }, []);

  while (merged.length > textReplyMaxParts) {
    let mergeAt = 0;
    let mergedLength = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < merged.length; index += 1) {
      const combined = merged[index].length + merged[index + 1].length;
      if (combined < mergedLength) {
        mergedLength = combined;
        mergeAt = index;
      }
    }
    merged.splice(mergeAt, 2, `${merged[mergeAt]}\n\n${merged[mergeAt + 1]}`);
  }

  return merged.map(trimReplyPartAtSentenceBoundary);
}

function trimReplyPartAtSentenceBoundary(part: string) {
  if (part.length <= textReplyPartMaxChars) {
    return part;
  }

  const window = part.slice(0, textReplyPartMaxChars);
  const sentenceEnd = Math.max(
    ...[". ", "! ", "? ", ".\n", "!\n", "?\n"].map((boundary) =>
      window.lastIndexOf(boundary),
    ),
  );
  if (sentenceEnd > textReplyPartMaxChars / 2) {
    return window.slice(0, sentenceEnd + 1).trimEnd();
  }

  const lastSpace = window.lastIndexOf(" ");
  return `${window.slice(0, lastSpace > 0 ? lastSpace : window.length).trimEnd()}…`;
}

function pause(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

type ListingCardRecommendationRef = {
  address: string | null;
  id: string;
  listingId: string;
  mediaUrl: string;
};

function readListingCardRecommendationId(url: string) {
  const match = url.match(/\/api\/listing-card\/([^/?#]+)/i);
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// Resolve listing-card media back to their recommendation rows before sending,
// so the reply can carry a tappable link and the send can stamp the provider
// message ids that make tapbacks resolvable. Best-effort: a lookup failure
// must never block the reply itself.
async function loadListingCardRecommendations(
  supabase: SupabaseServiceClient,
  { mediaUrls, threadId }: { mediaUrls: string[]; threadId: string },
): Promise<ListingCardRecommendationRef[]> {
  const entries = mediaUrls.flatMap((url) => {
    const recommendationId = readListingCardRecommendationId(url);
    return recommendationId ? [{ mediaUrl: url, recommendationId }] : [];
  });
  if (entries.length === 0) {
    return [];
  }

  const result = await supabase
    .from("text_listing_recommendations")
    .select("id,listing_id,card_snapshot")
    .eq("thread_id", threadId)
    .in(
      "id",
      entries.map((entry) => entry.recommendationId),
    );

  if (result.error) {
    console.error(
      "[text-agent] Failed to load listing recommendations for outbound cards.",
      result.error,
    );
    return [];
  }

  const rowsById = new Map((result.data ?? []).map((row) => [row.id, row]));
  return entries.flatMap((entry) => {
    const row = rowsById.get(entry.recommendationId);
    return row
      ? [
          {
            address:
              parseListingCardSnapshot(row.card_snapshot)?.address ?? null,
            id: row.id,
            listingId: row.listing_id,
            mediaUrl: entry.mediaUrl,
          },
        ]
      : [];
  });
}

// Stamp the provider message id (and the carousel position) onto each
// recommendation row so an inbound tapback can be resolved back to its
// listing. Best-effort after a successful delivery: a stamping failure only
// degrades tapbacks, it must not fail (and re-run) an already-sent reply.
async function stampListingRecommendationOutboundIds(
  supabase: SupabaseServiceClient,
  {
    mediaParts,
    recommendations,
    response,
  }: {
    mediaParts: Array<{ type: "media"; url: string }>;
    recommendations: ListingCardRecommendationRef[];
    response: TextSendMessageResult;
  },
) {
  if (recommendations.length === 0) {
    return;
  }

  const refs =
    response.partRefs && response.partRefs.length > 0
      ? response.partRefs
      : mediaParts.map((part, index) => ({
          mediaUrl: part.url,
          messageId: response.messageId,
          partIndex: mediaParts.length > 1 ? index : null,
          service: response.service,
        }));
  const recommendationsByMediaUrl = new Map(
    recommendations.map((recommendation) => [
      recommendation.mediaUrl,
      recommendation,
    ]),
  );

  try {
    await Promise.all(
      refs.flatMap((ref) => {
        const recommendation = ref.mediaUrl
          ? recommendationsByMediaUrl.get(ref.mediaUrl)
          : undefined;
        if (!recommendation || !ref.messageId) {
          return [];
        }
        return [
          supabase
            .from("text_listing_recommendations")
            .update({
              outbound_message_id: ref.messageId,
              // A carousel tapback carries the part index of the tapped
              // photo; resolution maps it to rank, so rank must reflect the
              // position actually sent, not the original scored order.
              ...(ref.partIndex != null ? { rank: ref.partIndex + 1 } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("id", recommendation.id)
            .then((result) => {
              if (result.error) {
                throw result.error;
              }
            }),
        ];
      }),
    );
  } catch (error) {
    console.error(
      "[text-agent] Failed to stamp listing recommendation message ids.",
      error,
    );
  }
}

export async function sendAndRecordReply(
  supabase: SupabaseServiceClient,
  {
    body,
    chatId,
    intent,
    mediaUrls = [],
    phoneNumberId,
    sourceMessageId,
    thread,
    to,
    userId,
  }: {
    body: string;
    chatId: string;
    intent: string;
    mediaUrls?: string[];
    phoneNumberId: string | null;
    sourceMessageId: string;
    thread: TableRow<"text_threads">;
    to: string;
    userId: string | null;
  },
) {
  const idempotencyKeyBase = `kinfolk:${sourceMessageId}:${intent}`;
  const provider = readTextProviderForRow(thread.provider);
  const smsBody = formatSmsReplyBody(body);
  const normalizedMediaUrls = mediaUrls.flatMap((url) => {
    const trimmed = url.trim();
    return trimmed ? [trimmed] : [];
  });
  const effectiveMediaUrls = smsBody
    ? normalizedMediaUrls.slice(0, textReplyMediaLimitWithBody)
    : normalizedMediaUrls;

  // Never deliver an empty iMessage. A blank body with no media is a bug upstream
  // (a tool returned no text); recording/sending it shows the user a blank bubble.
  if (!smsBody && effectiveMediaUrls.length === 0) {
    return;
  }

  const recommendations = await loadListingCardRecommendations(supabase, {
    mediaUrls: effectiveMediaUrls,
    threadId: thread.id,
  });
  const textParts = splitReplyIntoParts(smsBody);
  const mediaParts = effectiveMediaUrls.map((url) => ({
    type: "media" as const,
    url,
  }));

  // The carousel rides with the bubble that names its listings — usually the
  // last one, but never an unrelated trailing thought.
  const mediaAnchorIndex = (() => {
    const addresses = recommendations.flatMap((recommendation) =>
      recommendation.address ? [recommendation.address.toLowerCase()] : [],
    );
    if (addresses.length === 0) {
      return textParts.length - 1;
    }
    for (let index = textParts.length - 1; index >= 0; index -= 1) {
      const haystack = textParts[index].toLowerCase();
      if (addresses.some((address) => haystack.includes(address))) {
        return index;
      }
    }
    return textParts.length - 1;
  })();

  const sends =
    textParts.length > 0
      ? textParts.map((value, index) => ({
          body: value,
          media: index === mediaAnchorIndex ? mediaParts : [],
        }))
      : [{ body: "", media: mediaParts }];
  const from = getTextTransportFromNumber(provider);

  for (let index = 0; index < sends.length; index += 1) {
    const part = sends[index];
    const partKey =
      index === 0 ? idempotencyKeyBase : `${idempotencyKeyBase}:part${index + 1}`;
    if (index > 0) {
      await pause(textReplyPartPacingMs);
    }

    // Insert-first idempotency: the unique outbound key arbitrates racing
    // claimers before any transport call — the loser of this insert must not
    // send. A conflict can also mean a prior attempt already delivered this
    // part (skip it, keep sending the rest) or crashed mid-claim (take the
    // stale row over) — only an actively fresh claim stops the sequence.
    const claimPayload = {
      body: part.body,
      delivery_status: "sending",
      direction: "outbound",
      from_phone_e164: from,
      media: part.media as Json,
      outbound_idempotency_key: partKey,
      phone_number_id: phoneNumberId,
      provider,
      provider_chat_id: chatId || null,
      raw_payload: {
        idempotency_key: partKey,
        media_urls: part.media.map((mediaPart) => mediaPart.url),
        original_media_url_count: mediaUrls.length,
        part_count: sends.length,
        part_index: index,
        reply_idempotency_key: idempotencyKeyBase,
      },
      received_at: new Date().toISOString(),
      thread_id: thread.id,
      to_phone_e164: to,
      user_id: userId,
    } satisfies Partial<TableRow<"text_messages">>;
    const claim = await supabase
      .from("text_messages")
      .insert(claimPayload)
      .select("id")
      .single();

    let claimId: string;
    if (claim.error && claim.error.code === "23505") {
      const existing = await supabase
        .from("text_messages")
        .select("id, delivery_status, received_at")
        .eq("provider", provider)
        .eq("outbound_idempotency_key", partKey)
        .maybeSingle();
      if (existing.error) {
        throw existing.error;
      }
      if (existing.data && existing.data.delivery_status !== "sending") {
        continue;
      }
      const claimedAtMs = existing.data?.received_at
        ? Date.parse(existing.data.received_at)
        : Number.NaN;
      const claimIsStale =
        Number.isFinite(claimedAtMs) &&
        Date.now() - claimedAtMs >= staleOutboundClaimMs;
      if (!existing.data || !claimIsStale) {
        // Another worker holds a FRESH claim on this part. Returning here
        // would report delivery and complete the run — if that worker dies
        // before sending, the reply is silently lost forever. Throwing keeps
        // the run on the retry path, which resolves cleanly once the claim
        // is sent (skipped above) or stale (taken over below).
        throw new Error(
          `Outbound part ${partKey} is freshly claimed by another worker; retrying later.`,
        );
      }
      const staleCutoff = new Date(
        Date.now() - staleOutboundClaimMs,
      ).toISOString();
      const takeover = await supabase
        .from("text_messages")
        .update(claimPayload)
        .eq("id", existing.data.id)
        .eq("delivery_status", "sending")
        .lt("received_at", staleCutoff)
        .select("id")
        .maybeSingle();
      if (takeover.error) {
        throw takeover.error;
      }
      if (!takeover.data) {
        // Lost the takeover race — same reasoning as the fresh-claim case.
        throw new Error(
          `Outbound part ${partKey} takeover lost to another worker; retrying later.`,
        );
      }
      claimId = takeover.data.id;
    } else if (claim.error) {
      throw claim.error;
    } else {
      claimId = claim.data.id;
    }

    let response: TextSendMessageResult;
    try {
      response =
        part.media.length > 0
          ? await sendTextMessage({
              chatId,
              idempotencyKey: partKey,
              parts: part.body
                ? [{ type: "text" as const, value: part.body }, ...part.media]
                : part.media,
              provider,
              to,
            })
          : await sendTextText({
              body: part.body,
              chatId,
              idempotencyKey: partKey,
              provider,
              to,
            });
    } catch (error) {
      // Release the claim so a clean retry can still deliver the reply; the
      // rare failure-after-delivery duplicate beats silently losing the turn.
      const release = await supabase
        .from("text_messages")
        .delete()
        .eq("id", claimId);
      if (release.error) {
        // The claim survives as "sending" until the 90s staleness takeover;
        // log it so a stuck part is diagnosable.
        console.error("[text-agent] failed to release outbound claim", {
          claimId,
          error: release.error.message,
        });
      }
      console.error("[text-agent] outbound send failed", {
        error: error instanceof Error ? error.message : String(error),
        idempotencyKey: partKey,
        provider,
        threadId: thread.id,
      });
      await notifyFounder("text_reply_send_failed", {
        detail: error instanceof Error ? error.message : String(error),
        threadId: thread.id,
      });
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

    if (part.media.length > 0) {
      await stampListingRecommendationOutboundIds(supabase, {
        mediaParts: part.media,
        recommendations,
        response,
      });
    }
  }
}

export async function sendOnboardingContactCard(reply: TextAgentReply) {
  const contactCardUrl = getKinfolkContactCardUrl();
  if (!contactCardUrl) {
    return;
  }

  try {
    await reply("", "contact_card", [contactCardUrl]);
  } catch (error) {
    console.error("[text-agent] Kinfolk contact card send failed.", error);
  }
}

export function buildReviewReply(intent: string) {
  return textAgentReviewReplyCopy({ intent, reviewUrl: getReviewUrl() });
}
