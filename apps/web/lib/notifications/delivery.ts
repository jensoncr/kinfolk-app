import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSmsRecipient } from "@/lib/integrations/continue-on-phone";
import {
  getActiveTextTransportProvider,
  getTextTransportFromNumber,
  isTextAgentEnabled,
  sendTextMessage,
  type TextTransportProvider,
} from "@/lib/integrations/text-transport";
import type { TextOutboundPart } from "@/lib/integrations/text-transport-types";
import { isPrivateOrLocalHostname } from "@/lib/shared/public-url";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];
type MatchNotificationRow = TableRow<"match_notifications">;

// ---------------------------------------------------------------------------
// The shared consent chain + delivery tail for proactive text notifications.
//
// Every notification kind runs the same gates in the same order — prefs
// opt-in, verified phone, transport, idempotency (with crash repair), quiet
// hours, daily cap — then the same delivery tail: reserve the idempotency row,
// send the text, upsert the thread, record the outbound message, mark sent.
// Kind-specific senders (match-notifications.ts, chat-message-notifications.ts)
// own only their subject loading and message bodies.
// ---------------------------------------------------------------------------

export type MatchNotificationKind =
  | "apartment_match"
  | "roommate_match"
  | "group_ready"
  | "profile_question";

export type MatchNotificationSendResult = {
  sent: boolean;
  notificationId?: string;
  skipped?: string;
};

/** The prefs fields the consent chain reads; a synthesized default when no row exists. */
export type MatchNotificationPrefs = Pick<
  TableRow<"match_notification_prefs">,
  | "apartment_matches_enabled"
  | "roommate_matches_enabled"
  | "group_ready_enabled"
  | "profile_questions_enabled"
  | "quiet_hours_start"
  | "quiet_hours_end"
  | "timezone"
  | "daily_send_cap"
>;

// Conservative fallback when no prefs row exists for the user: everything OFF.
const DEFAULT_PREFS: MatchNotificationPrefs = {
  apartment_matches_enabled: false,
  roommate_matches_enabled: false,
  group_ready_enabled: false,
  profile_questions_enabled: false,
  quiet_hours_start: 21,
  quiet_hours_end: 9,
  // SF-first product: a prefs-less user is far more likely Pacific than
  // Eastern, and an Eastern default blocks their whole local evening.
  timezone: "America/Los_Angeles",
  daily_send_cap: 3,
};

export const MATCH_NOTIFICATION_TEXT_LIMITS = {
  address: 96,
  neighborhood: 64,
} as const;
const DEFAULT_KINFOLK_BASE_URL = "https://usekinfolk.com";

// ---------------------------------------------------------------------------
// Pure helpers (no supabase — unit-testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Returns true when `nowUtc` falls inside the quiet window [start, end).
 * Handles the wrapping case where start > end (e.g. 21 → 9 spanning midnight).
 */
export function isWithinQuietHours({
  nowUtc,
  timezone,
  quietHoursStart,
  quietHoursEnd,
}: {
  nowUtc: Date;
  timezone: string;
  quietHoursStart: number;
  quietHoursEnd: number;
}): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeQuietHoursTimezone(timezone),
    hour: "numeric",
    hour12: false,
  });
  const localHourStr = fmt.format(nowUtc);
  // "hour: numeric, hour12: false" can produce "24" for midnight in some locales.
  const localHour = parseInt(localHourStr, 10) % 24;

  if (quietHoursStart <= quietHoursEnd) {
    // Non-wrapping window, e.g. [10, 18): normal daytime block.
    return localHour >= quietHoursStart && localHour < quietHoursEnd;
  }

  // Wrapping window: e.g. [21, 9) — inside when hour >= 21 OR hour < 9.
  return localHour >= quietHoursStart || localHour < quietHoursEnd;
}

function normalizeQuietHoursTimezone(timezone: string) {
  const normalized = timezone.trim();
  if (!normalized) {
    return DEFAULT_PREFS.timezone;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    return normalized;
  } catch {
    return DEFAULT_PREFS.timezone;
  }
}

/** Returns true when the user has hit or exceeded their daily send cap. */
export function isOverDailyCap({
  sentTodayCount,
  dailySendCap,
}: {
  sentTodayCount: number;
  dailySendCap: number;
}): boolean {
  return sentTodayCount >= dailySendCap;
}

export function normalizeRequiredMatchNotificationId(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeMatchNotificationText(
  value: string | null | undefined,
  fallback: string,
  maxLength: number,
) {
  const normalized = value?.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return normalized || fallback;
}

/**
 * The UTC instant of "midnight today" in the recipient's timezone. The daily
 * cap must reset when the RECIPIENT's day does — a UTC-midnight window lets a
 * Pacific user receive up to 2× the cap inside one local day (the cap "day"
 * would reset at 4-5pm local). Falls back like quiet hours on bad timezones.
 */
export function localMidnightOf(now: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeQuietHoursTimezone(timezone),
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const elapsedMs =
    ((Number(parts.hour) % 24) * 3600 +
      Number(parts.minute) * 60 +
      Number(parts.second)) *
    1000;
  return new Date(now.getTime() - elapsedMs - now.getMilliseconds());
}

// ---------------------------------------------------------------------------
// Kinfolk app URLs (provider-safe: never a private/localhost link in a text)
// ---------------------------------------------------------------------------

export function getKinfolkMatchesUrl() {
  return getKinfolkAppUrl("/me/matches");
}

export function getKinfolkListingUrl(listingId: string | null | undefined) {
  const normalizedListingId = listingId?.trim();
  if (!normalizedListingId) {
    return getKinfolkMatchesUrl();
  }

  return getKinfolkAppUrl(
    `/apartments?listing=${encodeURIComponent(normalizedListingId)}`,
  );
}

export function getKinfolkAppUrl(path: string) {
  const value = process.env.NEXT_PUBLIC_KINFOLK_BASE_URL?.trim();
  const baseUrl = value || DEFAULT_KINFOLK_BASE_URL;

  try {
    const url = new URL(path, baseUrl);
    return isProviderSafeHttpUrl(url, { requireHttps: true })
      ? url.toString()
      : new URL(path, DEFAULT_KINFOLK_BASE_URL).toString();
  } catch {
    return new URL(path, DEFAULT_KINFOLK_BASE_URL).toString();
  }
}

function isProviderSafeHttpUrl(
  url: URL,
  { requireHttps = false }: { requireHttps?: boolean } = {},
) {
  if (requireHttps ? url.protocol !== "https:" : !/^https?:$/.test(url.protocol)) {
    return false;
  }
  return !isPrivateOrLocalHostname(url.hostname);
}

// ---------------------------------------------------------------------------
// Prefs / phone / cap loaders
// ---------------------------------------------------------------------------

export async function loadMatchNotificationPrefs(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<MatchNotificationPrefs> {
  const prefsResult = await supabase
    .from("match_notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (prefsResult.error) throw prefsResult.error;
  return prefsResult.data ?? DEFAULT_PREFS;
}

export async function findVerifiedOptedInPhoneForUser(
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

export async function countSentNotificationsSince(
  supabase: SupabaseServiceClient,
  {
    kind,
    since,
    userId,
  }: {
    kind?: MatchNotificationKind;
    since: Date;
    userId: string;
  },
) {
  let query = supabase
    .from("match_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", userId)
    .eq("status", "sent")
    .not("outbound_message_id", "is", null)
    .gte("created_at", since.toISOString());
  if (kind) {
    query = query.eq("kind", kind);
  }
  const result = await query;
  if (result.error) throw result.error;
  return result.count ?? 0;
}

// ---------------------------------------------------------------------------
// Consent-chain gate runner
// ---------------------------------------------------------------------------

export type MatchNotificationGatePass = {
  existingNotification: MatchNotificationRow | null;
  now: Date;
  phone: TableRow<"user_phone_numbers">;
  prefs: MatchNotificationPrefs;
  provider: TextTransportProvider;
};

/**
 * Runs the gates every notification kind shares, in the canonical order:
 *
 *   1. prefs opt-in (default OFF — TCPA-conservative)
 *   2. verified, explicitly opted-in phone
 *   3. transport enabled
 *   4. idempotency — an already-sent notification short-circuits immediately
 *      (before quiet hours / caps), and a reservation whose outbound message
 *      was recorded but never stamped is repaired to sent
 *   5. quiet hours
 *   6. daily send cap
 *
 * Returns the loaded gate context on pass, or `{ skipped }` with the reason.
 */
export async function runMatchNotificationGates(
  supabase: SupabaseServiceClient,
  {
    idempotencyKey,
    kind,
    nowUtc,
    prefsEnabled,
    userId,
  }: {
    idempotencyKey: string;
    kind: MatchNotificationKind;
    nowUtc?: Date;
    prefsEnabled: (prefs: MatchNotificationPrefs) => boolean;
    userId: string;
  },
): Promise<MatchNotificationGatePass | { skipped: string }> {
  const prefs = await loadMatchNotificationPrefs(supabase, userId);
  if (!prefsEnabled(prefs)) {
    return { skipped: "disabled_by_user" };
  }

  const phone = await findVerifiedOptedInPhoneForUser(supabase, userId);
  if (!phone) {
    return { skipped: "no_verified_phone" };
  }

  const provider = getActiveTextTransportProvider();
  if (!isTextAgentEnabled(provider)) {
    return { skipped: "transport_disabled" };
  }

  const existingNotification = await findExistingMatchNotification(supabase, {
    idempotencyKey,
    kind,
    userId,
  });
  if (existingNotification?.outbound_message_id) {
    return { skipped: "already_sent" };
  }
  if (existingNotification) {
    const repaired = await repairNotificationFromRecordedOutbound(supabase, {
      idempotencyKey,
      notificationId: existingNotification.id,
      provider,
    });
    if (repaired) {
      return { skipped: "already_sent" };
    }
  }

  const now = nowUtc ?? new Date();
  if (
    isWithinQuietHours({
      nowUtc: now,
      timezone: prefs.timezone,
      quietHoursStart: prefs.quiet_hours_start,
      quietHoursEnd: prefs.quiet_hours_end,
    })
  ) {
    return { skipped: "quiet_hours" };
  }

  const sentTodayCount = await countSentNotificationsSince(supabase, {
    since: localMidnightOf(now, prefs.timezone),
    userId,
  });
  if (isOverDailyCap({ sentTodayCount, dailySendCap: prefs.daily_send_cap })) {
    return { skipped: "daily_cap" };
  }

  return { existingNotification, now, phone, prefs, provider };
}

// ---------------------------------------------------------------------------
// Delivery tail
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<MatchNotificationKind, string> = {
  apartment_match: "an apartment-match",
  roommate_match: "a roommate-match",
  group_ready: "a group-ready",
  profile_question: "a profile-question",
};

/**
 * Shared delivery tail for every notification kind: reserve the idempotency
 * row in match_notifications, send the text, upsert the notification thread,
 * record the outbound message, and mark the notification sent. Race-safe:
 * a concurrent send collapses onto one reserved row (23505) and repairs it.
 */
export async function deliverMatchNotificationText(
  supabase: SupabaseServiceClient,
  {
    existingNotification,
    idempotencyKey,
    kind,
    messageKind,
    messageParts,
    onDelivered,
    phone,
    provider,
    rawPayloadExtra,
    subjectId,
    userId,
  }: {
    existingNotification: MatchNotificationRow | null;
    idempotencyKey: string;
    kind: MatchNotificationKind;
    messageKind: string;
    messageParts: TextOutboundPart[];
    onDelivered?: (delivery: {
      notificationId: string;
      threadId: string;
    }) => Promise<void>;
    phone: TableRow<"user_phone_numbers">;
    provider: TextTransportProvider;
    rawPayloadExtra: Record<string, string>;
    subjectId: string;
    userId: string;
  },
): Promise<MatchNotificationSendResult> {
  const existingThread = await findNotificationThread(supabase, {
    phoneNumber: phone.phone_e164,
    provider,
    userId,
  });

  const notificationInsert = existingNotification
    ? existingNotification
    : await insertMatchNotification(supabase, {
        idempotencyKey,
        kind,
        recipientUserId: userId,
        subjectId,
      });
  if (!notificationInsert) {
    // A racing worker reserved the row first; treat its outcome as ours.
    const racedNotification = await findExistingMatchNotification(supabase, {
      idempotencyKey,
      kind,
      userId,
    });
    if (racedNotification?.outbound_message_id) {
      return { sent: false, skipped: "already_sent" };
    }
    if (racedNotification) {
      const repaired = await repairNotificationFromRecordedOutbound(supabase, {
        idempotencyKey,
        notificationId: racedNotification.id,
        provider,
      });
      if (repaired) {
        return { sent: false, skipped: "already_sent" };
      }
    }
    return { sent: false, skipped: "already_reserved" };
  }

  const body = messageParts.find((part) => part.type === "text")?.value ?? "";
  const response = await sendTextMessage({
    chatId: existingThread?.provider_chat_id,
    idempotencyKey,
    parts: messageParts,
    provider,
    to: phone.phone_e164,
  });

  if (!response.messageId) {
    throw new Error(
      `Text transport did not return ${KIND_LABELS[kind]} notification message id.`,
    );
  }

  const thread = await upsertNotificationThread(supabase, {
    chatId: response.chatId,
    existingThread,
    phoneNumber: phone.phone_e164,
    phoneNumberId: phone.id,
    provider,
    userId,
  });

  await recordOutboundTextMessage(supabase, {
    body,
    idempotencyKey,
    media: messageParts.filter((part) => part.type === "media"),
    phone,
    provider,
    providerChatId: response.chatId ?? thread.provider_chat_id,
    rawPayload: {
      ...rawPayloadExtra,
      idempotency_key: idempotencyKey,
      message_kind: messageKind,
      notification_id: notificationInsert.id,
      user_id: userId,
    },
    response,
    threadId: thread.id,
    userId,
  });

  await onDelivered?.({
    notificationId: notificationInsert.id,
    threadId: thread.id,
  });

  const updateNotification = await supabase
    .from("match_notifications")
    .update({
      outbound_message_id: response.messageId,
      status: "sent",
      thread_id: thread.id,
    })
    .eq("id", notificationInsert.id);
  if (updateNotification.error) throw updateNotification.error;

  return { notificationId: notificationInsert.id, sent: true };
}

/**
 * Persist an outbound notification text into text_messages. A duplicate
 * (23505 on the idempotency key) is fine — the message already exists.
 */
export async function recordOutboundTextMessage(
  supabase: SupabaseServiceClient,
  {
    body,
    idempotencyKey,
    media,
    phone,
    provider,
    providerChatId,
    rawPayload,
    response,
    threadId,
    userId,
  }: {
    body: string;
    idempotencyKey: string;
    media: TextOutboundPart[];
    phone: TableRow<"user_phone_numbers">;
    provider: TextTransportProvider;
    providerChatId: string | null;
    rawPayload: Record<string, string>;
    response: Awaited<ReturnType<typeof sendTextMessage>>;
    threadId: string | null;
    userId: string;
  },
) {
  const insertMessage = await supabase.from("text_messages").insert({
    body,
    delivery_status: response.deliveryStatus,
    direction: "outbound",
    from_phone_e164: getTextTransportFromNumber(provider),
    media: media as unknown as Json,
    outbound_idempotency_key: idempotencyKey,
    phone_number_id: phone.id,
    provider,
    provider_chat_id: providerChatId,
    provider_message_id: response.messageId,
    raw_payload: rawPayload as Json,
    received_at: new Date().toISOString(),
    service: response.service,
    thread_id: threadId,
    to_phone_e164: phone.phone_e164,
    user_id: userId,
  });
  if (insertMessage.error && insertMessage.error.code !== "23505") {
    throw insertMessage.error;
  }
}

// ---------------------------------------------------------------------------
// match_notifications idempotency rows
// ---------------------------------------------------------------------------

async function findExistingMatchNotification(
  supabase: SupabaseServiceClient,
  {
    idempotencyKey,
    kind,
    userId,
  }: {
    idempotencyKey: string;
    kind: MatchNotificationKind;
    userId: string;
  },
) {
  const result = await supabase
    .from("match_notifications")
    .select("*")
    .eq("recipient_user_id", userId)
    .eq("kind", kind)
    .eq("outbound_idempotency_key", idempotencyKey)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

/**
 * Crash repair: a reservation exists but was never stamped sent, while
 * text_messages already recorded the provider message (the process died
 * between send and stamp). Stamp the row sent so the text is never re-sent.
 * Returns true when a recorded outbound was found (repaired or best-effort).
 */
async function repairNotificationFromRecordedOutbound(
  supabase: SupabaseServiceClient,
  {
    idempotencyKey,
    notificationId,
    provider,
  }: {
    idempotencyKey: string;
    notificationId: string;
    provider: TextTransportProvider;
  },
): Promise<boolean> {
  const recordedOutbound = await findRecordedOutboundNotificationMessage(
    supabase,
    { idempotencyKey, provider },
  );
  if (!recordedOutbound?.provider_message_id) {
    return false;
  }

  const repair = await supabase
    .from("match_notifications")
    .update({
      outbound_message_id: recordedOutbound.provider_message_id,
      status: "sent",
      ...(recordedOutbound.thread_id
        ? { thread_id: recordedOutbound.thread_id }
        : {}),
    })
    .eq("id", notificationId);
  if (repair.error) {
    console.error(
      "[match-notifications] Failed to repair sent notification row.",
      {
        error: repair.error.message,
        idempotencyKey,
        notificationId,
      },
    );
  }
  return true;
}

async function findRecordedOutboundNotificationMessage(
  supabase: SupabaseServiceClient,
  {
    idempotencyKey,
    provider,
  }: {
    idempotencyKey: string;
    provider: TextTransportProvider;
  },
) {
  const result = await supabase
    .from("text_messages")
    .select("provider_message_id,thread_id")
    .eq("provider", provider)
    .eq("outbound_idempotency_key", idempotencyKey)
    .not("provider_message_id", "is", null)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function insertMatchNotification(
  supabase: SupabaseServiceClient,
  {
    idempotencyKey,
    kind,
    recipientUserId,
    subjectId,
  }: {
    idempotencyKey: string;
    kind: MatchNotificationKind;
    recipientUserId: string;
    subjectId: string;
  },
): Promise<MatchNotificationRow | null> {
  const result = await supabase
    .from("match_notifications")
    .insert({
      kind,
      outbound_idempotency_key: idempotencyKey,
      recipient_user_id: recipientUserId,
      subject_id: subjectId,
      // The current schema has no pending status; reserve the idempotency row
      // in a non-sent state until the text provider returns a message id.
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

// ---------------------------------------------------------------------------
// Notification text threads
// ---------------------------------------------------------------------------

export async function findNotificationThread(
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
  if (byChat.data) return byChat.data;

  const upserted = await supabase
    .from("text_threads")
    .upsert(
      {
        from_phone_e164: from,
        provider,
        provider_chat_id: resolvedChatId,
        to_phone_e164: normalizedPhone,
        user_id: userId,
        phone_number_id: phoneNumberId,
      },
      { onConflict: "provider,provider_chat_id" },
    )
    .select("*")
    .single();
  if (upserted.error) throw upserted.error;
  return upserted.data;
}
