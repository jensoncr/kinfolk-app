import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getActiveTextTransportProvider,
  isTextAgentEnabled,
  sendTextMessage,
} from "@/lib/integrations/text-transport";
import {
  countSentNotificationsSince,
  findNotificationThread,
  findVerifiedOptedInPhoneForUser,
  getKinfolkAppUrl,
  isOverDailyCap,
  isWithinQuietHours,
  loadMatchNotificationPrefs,
  localMidnightOf,
  recordOutboundTextMessage,
} from "@/lib/notifications/delivery";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;

// At most one text per room per recipient inside this window — chat messages
// arrive in bursts and each one must not become its own SMS.
const CHAT_NOTIFY_THROTTLE_MS = 30 * 60 * 1000;

const CHAT_PREVIEW_LIMIT = 80;

export type ChatMessageNotificationResult = {
  notified: string[];
  skipped: Record<string, string>;
};

function previewOf(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= CHAT_PREVIEW_LIMIT) return collapsed;
  return `${collapsed.slice(0, CHAT_PREVIEW_LIMIT - 1)}…`;
}

function firstNameOf(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "Your match";
  return trimmed.split(/\s+/)[0];
}

/**
 * Text the OTHER members of a Kinfolk chat room about a new in-app message.
 *
 * Consent chain, all required per recipient:
 *  1. Room-level `text_notifications_enabled` — explicit per-room opt-in,
 *     default FALSE (set from the in-app chat header toggle).
 *  2. A verified phone whose sms_consent_state is opted_in.
 *  3. Quiet hours from match_notification_prefs (defaults when no row).
 *  4. Per-room throttle: one text per 30 minutes, and never twice for the
 *     same message (last_notified_message_id / last_text_notified_at).
 *
 * Unlike the match-notification kinds this dedupes on chat_room_members
 * stamps, not match_notifications rows. Best-effort by design: callers
 * fire-and-forget; a notification failure must never fail the chat send.
 */
export async function sendChatMessageTextNotifications(
  supabase: SupabaseServiceClient,
  {
    messageId,
    nowUtc: nowUtcOverride,
    roomId,
    senderUserId,
  }: {
    messageId: string;
    nowUtc?: Date;
    roomId: string;
    senderUserId: string;
  },
): Promise<ChatMessageNotificationResult> {
  const result: ChatMessageNotificationResult = { notified: [], skipped: {} };

  const provider = getActiveTextTransportProvider();
  if (!isTextAgentEnabled(provider)) {
    result.skipped["*"] = "transport_disabled";
    return result;
  }

  const [messageResult, membersResult] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("id,body,room_id,sender_user_id,created_at")
      .eq("id", messageId)
      .eq("room_id", roomId)
      .maybeSingle(),
    supabase
      .from("chat_room_members")
      .select(
        "id,user_id,status,text_notifications_enabled,last_text_notified_at,last_notified_message_id",
      )
      .eq("room_id", roomId)
      .eq("status", "active"),
  ]);
  if (messageResult.error) throw messageResult.error;
  if (membersResult.error) throw membersResult.error;
  const message = messageResult.data;
  if (!message) {
    result.skipped["*"] = "message_not_found";
    return result;
  }

  const recipients = (membersResult.data ?? []).filter(
    (member) => member.user_id !== senderUserId,
  );
  if (recipients.length === 0) {
    return result;
  }

  const senderResult = await supabase
    .from("kinfolk_users")
    .select("display_name")
    .eq("id", senderUserId)
    .maybeSingle();
  if (senderResult.error) throw senderResult.error;
  const senderFirstName = firstNameOf(senderResult.data?.display_name);
  const now = nowUtcOverride ?? new Date();

  for (const member of recipients) {
    // One recipient's failure must not starve the rest of the room.
    try {
      if (!member.text_notifications_enabled) {
        result.skipped[member.user_id] = "room_notifications_off";
        continue;
      }
      if (member.last_notified_message_id === messageId) {
        result.skipped[member.user_id] = "already_notified";
        continue;
      }
      const lastNotifiedMs = member.last_text_notified_at
        ? Date.parse(member.last_text_notified_at)
        : Number.NaN;
      if (
        Number.isFinite(lastNotifiedMs) &&
        now.getTime() - lastNotifiedMs < CHAT_NOTIFY_THROTTLE_MS
      ) {
        result.skipped[member.user_id] = "throttled";
        continue;
      }

      const phone = await findVerifiedOptedInPhoneForUser(supabase, member.user_id);
      if (!phone) {
        result.skipped[member.user_id] = "no_verified_phone";
        continue;
      }

      const prefs = await loadMatchNotificationPrefs(supabase, member.user_id);
      if (
        isWithinQuietHours({
          nowUtc: now,
          timezone: prefs.timezone,
          quietHoursStart: prefs.quiet_hours_start,
          quietHoursEnd: prefs.quiet_hours_end,
        })
      ) {
        result.skipped[member.user_id] = "quiet_hours";
        continue;
      }

      // Chat pings share the recipient's daily text budget with the match
      // kinds — a user in N rooms must not receive N× the cap.
      const midnight = localMidnightOf(now, prefs.timezone);
      const sentTodayCount =
        (await countSentNotificationsSince(supabase, {
          since: midnight,
          userId: member.user_id,
        })) + (await countChatTextsSentSince(supabase, {
          since: midnight,
          userId: member.user_id,
        }));
      if (isOverDailyCap({ sentTodayCount, dailySendCap: prefs.daily_send_cap })) {
        result.skipped[member.user_id] = "daily_cap";
        continue;
      }

      // Claim the dedupe stamp BEFORE sending: two near-simultaneous messages
      // both pass the in-memory throttle read above, so the stamp update is
      // the race arbiter. The .or() guards re-check both dedupe conditions
      // against current DB state (NULL-safe — PostgREST neq excludes nulls).
      const claim = await supabase
        .from("chat_room_members")
        .update({
          last_notified_message_id: messageId,
          last_text_notified_at: now.toISOString(),
        })
        .eq("id", member.id)
        .or(`last_notified_message_id.is.null,last_notified_message_id.neq.${messageId}`)
        .or(
          `last_text_notified_at.is.null,last_text_notified_at.lt.${new Date(
            now.getTime() - CHAT_NOTIFY_THROTTLE_MS,
          ).toISOString()}`,
        )
        .select("id");
      if (claim.error) throw claim.error;
      if ((claim.data ?? []).length === 0) {
        result.skipped[member.user_id] = "already_notified";
        continue;
      }

      const thread = await findNotificationThread(supabase, {
        phoneNumber: phone.phone_e164,
        provider,
        userId: member.user_id,
      });

      const idempotencyKey = `kinfolk:chat-message-notification:${messageId}:${member.user_id}`;
      const body = [
        `${senderFirstName} messaged you on Kinfolk: “${previewOf(message.body)}”`,
        `Reply here: ${getKinfolkAppUrl("/chats")}`,
      ].join(" ");

      const response = await sendTextMessage({
        chatId: thread?.provider_chat_id,
        idempotencyKey,
        parts: [{ type: "text", value: body }],
        provider,
        to: phone.phone_e164,
      });

      await recordOutboundTextMessage(supabase, {
        body,
        idempotencyKey,
        media: [],
        phone,
        provider,
        providerChatId: response.chatId ?? thread?.provider_chat_id ?? "",
        rawPayload: {
          chat_message_id: messageId,
          chat_room_id: roomId,
          idempotency_key: idempotencyKey,
          message_kind: "chat_message_notification",
          user_id: member.user_id,
        },
        response,
        threadId: thread?.id ?? null,
        userId: member.user_id,
      });

      result.notified.push(member.user_id);
    } catch (error) {
      console.error("[chat-notifications] recipient send failed", {
        error: error instanceof Error ? error.message : String(error),
        roomId,
        userId: member.user_id,
      });
      result.skipped[member.user_id] = "error";
    }
  }

  return result;
}

/** Today's already-sent chat pings for a user, by idempotency-key prefix. */
async function countChatTextsSentSince(
  supabase: SupabaseServiceClient,
  { since, userId }: { since: Date; userId: string },
) {
  const result = await supabase
    .from("text_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("direction", "outbound")
    .like("outbound_idempotency_key", "kinfolk:chat-message-notification:%")
    .gte("received_at", since.toISOString());
  if (result.error) throw result.error;
  return result.count ?? 0;
}
