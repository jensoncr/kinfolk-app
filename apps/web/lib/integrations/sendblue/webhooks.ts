import { createHash, timingSafeEqual } from "node:crypto";
import { normalizePhoneE164 } from "../../shared/phone";
import { normalizeTapbackReaction } from "../tapback-reactions";
import type {
  ParsedTextWebhook,
  TextDeliveryEvent,
  TextInboundMessage,
  TextReactionEvent,
  TextWebhookRecord,
  TextWebhookVerification,
} from "@/lib/integrations/text-transport-types";

export type SendblueWebhookPayload = Record<string, unknown>;

export function verifySendblueWebhookSecret({
  headers,
  secret,
}: {
  headers: Headers;
  secret: string;
}): TextWebhookVerification {
  const expected = secret.trim();
  if (!expected) {
    return { ok: false, reason: "missing_secret" };
  }

  const provided =
    readSendblueString(headers.get("sb-signing-secret")) ??
    readSendblueString(headers.get("x-sendblue-signing-secret")) ??
    readSendblueString(headers.get("x-sendblue-webhook-secret")) ??
    readSendblueString(headers.get("sb-webhook-secret")) ??
    readSendblueString(headers.get("sendblue-secret")) ??
    readSendblueString(headers.get("x-sendblue-secret")) ??
    readBearerToken(headers.get("authorization"));

  if (!provided) {
    return { ok: false, reason: "missing_headers" };
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true };
}

function parseSendblueWebhookPayload(rawBody: string): SendblueWebhookPayload {
  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Webhook payload must be a JSON object.");
  }
  return parsed as SendblueWebhookPayload;
}

export function parseSendblueTextWebhook(rawBody: string): ParsedTextWebhook {
  const payload = parseSendblueWebhookPayload(rawBody);
  const event = getSendblueWebhookRecord(payload);

  return {
    delivery: getSendblueDeliveryEvent(payload, event),
    event,
    inbound: getSendblueInboundMessage(payload, event),
    reaction: getSendblueReactionEvent(payload, event),
  };
}

export function getSendblueInboundMessage(
  payload: SendblueWebhookPayload,
  event = getSendblueWebhookRecord(payload),
): TextInboundMessage | null {
  if (readSendblueBoolean(payload.is_outbound) !== false || isSendblueReactionPayload(payload)) {
    return null;
  }

  const messageId = readSendblueString(payload.message_handle);
  const from = normalizePhoneE164(
    readSendblueString(payload.from_number) ??
      readSendblueString(payload.number) ??
      "",
  );
  const to = normalizePhoneE164(
    readSendblueString(payload.sendblue_number) ??
      readSendblueString(payload.to_number) ??
      "",
  );

  if (!messageId || !from || !to) {
    return null;
  }

  const body = readSendblueString(payload.content) ?? "";
  const media = getSendblueMedia(payload);
  if (!body && media.length === 0) {
    return null;
  }
  if (isLegacySendblueTextualTapback(body)) {
    return null;
  }

  return {
    body,
    chat: {
      isGroup: Boolean(readSendblueString(payload.group_id)),
      ownerHandle: to,
      participants: [],
    },
    chatId: buildSendblueChatId({
      contact: from,
      groupId: readSendblueString(payload.group_id),
      line: to,
    }),
    eventId: event.eventId,
    from,
    media,
    messageId,
    provider: "sendblue",
    raw: payload,
    receivedAt:
      readSendblueTimestamp(payload.date_sent) ??
      readSendblueTimestamp(payload.date_updated) ??
      new Date().toISOString(),
    service: readSendblueString(payload.service),
    to,
    traceId: event.traceId,
  };
}

function isLegacySendblueTextualTapback(body: string) {
  return /^(?:liked|loved|disliked|emphasized|laughed at|questioned)\s+(?:an?|the)\s+(?:image|photo|picture|attachment|message)$/i.test(
    body.trim(),
  );
}

export function getSendblueDeliveryEvent(
  payload: SendblueWebhookPayload,
  event = getSendblueWebhookRecord(payload),
): TextDeliveryEvent | null {
  if (readSendblueBoolean(payload.is_outbound) !== true) {
    return null;
  }

  const messageId = readSendblueString(payload.message_handle);
  if (!messageId) {
    return null;
  }

  const deliveryStatus = readSendblueToken(payload.status);
  if (!deliveryStatus) {
    return null;
  }

  return {
    deliveryStatus,
    eventId: event.eventId,
    messageId,
    provider: "sendblue",
    raw: payload,
    traceId: event.traceId,
  };
}

export function getSendblueReactionEvent(
  payload: SendblueWebhookPayload,
  event = getSendblueWebhookRecord(payload),
): TextReactionEvent | null {
  const reactionType = readSendblueReactionType(payload);
  if (!reactionType) {
    return null;
  }

  const messageId = readSendblueReactionTargetMessageId(payload);
  if (!messageId) {
    return null;
  }

  const from = normalizePhoneE164(
    readSendblueString(payload.from_number) ??
      readSendblueString(payload.number) ??
      "",
  );
  const line = normalizePhoneE164(
    readSendblueString(payload.sendblue_number) ??
      readSendblueString(payload.to_number) ??
      "",
  );
  const groupId = readSendblueString(payload.group_id);
  const chatId =
    readSendblueString(payload.chat_id) ??
    (from && (line || groupId)
      ? buildSendblueChatId({
          contact: from,
          groupId,
          line,
        })
      : "");

  if (!chatId || !from) {
    return null;
  }

  return {
    chatId,
    eventId: event.eventId,
    from,
    messageId,
    partIndex: readSendblueNumber(
      payload.part_index ?? payload.partIndex ?? payload.reaction_part_index,
    ),
    provider: "sendblue",
    raw: payload,
    reactionType,
    removed: isSendblueReactionRemoved(payload),
    traceId: event.traceId,
  };
}

export function getSendblueWebhookRecord(
  payload: SendblueWebhookPayload,
): TextWebhookRecord {
  const eventType = getSendblueEventType(payload);
  return {
    eventId: buildSendblueEventId(payload, eventType),
    eventType,
    provider: "sendblue",
    raw: payload,
    traceId: readSendblueString(payload.trace_id),
  };
}

export function buildSendblueChatId({
  contact,
  groupId,
  line,
}: {
  contact: string;
  groupId?: string | null;
  line: string;
}) {
  if (groupId) {
    return `sendblue_group:${groupId}`;
  }

  return `sendblue:${line}:${contact}`;
}

export function readSendblueString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSendblueTimestamp(value: unknown) {
  const timestamp = readSendblueString(value);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function readSendblueBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  return null;
}

function getSendblueEventType(payload: SendblueWebhookPayload) {
  if (isSendblueReactionPayload(payload)) {
    return isSendblueReactionRemoved(payload)
      ? "reaction.removed"
      : "reaction.added";
  }

  if (readSendblueBoolean(payload.is_typing) !== null) {
    return "typing_indicator";
  }

  const isOutbound = readSendblueBoolean(payload.is_outbound);
  if (isOutbound === true) {
    return "outbound";
  }

  if (isOutbound === false) {
    return "receive";
  }

  return readSendblueToken(payload.event_type) ?? "unknown";
}

function buildSendblueEventId(
  payload: SendblueWebhookPayload,
  eventType: string,
) {
  const explicitEventId =
    readSendblueString(payload.event_id) ??
    readSendblueString(payload.eventId) ??
    readSendblueString(payload.id);
  if (explicitEventId) {
    return explicitEventId;
  }

  const messageHandle = readSendblueString(payload.message_handle);
  if (eventType.startsWith("reaction.")) {
    return [
      eventType,
      readSendblueReactionTargetMessageId(payload) ?? messageHandle,
      readSendblueReactionType(payload),
      readSendblueNumber(payload.part_index ?? payload.partIndex),
      readSendblueString(payload.date_updated) ??
        readSendblueString(payload.date_sent),
    ]
      .filter((value) => value != null && value !== "")
      .join(":");
  }

  if (messageHandle && eventType === "receive") {
    return `receive:${messageHandle}`;
  }

  if (messageHandle) {
    return [
      eventType,
      messageHandle,
      readSendblueToken(payload.status),
      readSendblueString(payload.date_updated),
    ]
      .filter(Boolean)
      .join(":");
  }

  const stablePayloadHash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
  return `${eventType}:${stablePayloadHash}`;
}

function getSendblueMedia(payload: SendblueWebhookPayload) {
  return collectSendblueMediaUrls([
    payload.media_url,
    payload.mediaUrl,
    payload.media_urls,
    payload.mediaUrls,
    payload.attachment_url,
    payload.attachmentUrl,
    payload.attachment_urls,
    payload.attachmentUrls,
    payload.media,
    payload.attachments,
  ]).map((url) => ({
    type: "media",
    url,
  }));
}

function collectSendblueMediaUrls(values: unknown[]) {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    collectSendblueMediaUrl(value, urls, seen);
  }
  return urls;
}

function collectSendblueMediaUrl(
  value: unknown,
  urls: string[],
  seen: Set<string>,
) {
  const direct = readSendblueString(value);
  if (direct) {
    if (!seen.has(direct)) {
      seen.add(direct);
      urls.push(direct);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSendblueMediaUrl(item, urls, seen);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "url",
    "media_url",
    "mediaUrl",
    "value",
    "content_url",
    "contentUrl",
    "download_url",
    "downloadUrl",
  ]) {
    collectSendblueMediaUrl(record[key], urls, seen);
  }
}

function isSendblueReactionPayload(payload: SendblueWebhookPayload) {
  const explicitEventType = readSendblueToken(payload.event_type);
  const messageType = readSendblueToken(payload.message_type);
  const hasExplicitReactionField = Boolean(readSendblueReactionType(payload));

  return Boolean(
    hasExplicitReactionField &&
      (explicitEventType?.includes("reaction") ||
        explicitEventType?.includes("tapback") ||
        messageType === "reaction" ||
        messageType === "tapback" ||
        payload.target_message_handle ||
        payload.target_message_id ||
        payload.reacted_to_message_handle ||
        payload.reacted_to_message_id ||
        payload.reaction_message_handle),
  );
}

function readSendblueReactionType(payload: SendblueWebhookPayload) {
  const raw =
    readSendblueString(payload.reaction_type) ??
    readSendblueString(payload.reaction) ??
    readSendblueString(payload.tapback_type) ??
    readSendblueString(payload.tapback) ??
    readSendblueString(payload.reactionType);
  if (!raw) {
    return null;
  }

  return normalizeTapbackReaction(raw);
}

function readSendblueReactionTargetMessageId(payload: SendblueWebhookPayload) {
  return (
    readSendblueString(payload.target_message_handle) ??
    readSendblueString(payload.target_message_id) ??
    readSendblueString(payload.reacted_to_message_handle) ??
    readSendblueString(payload.reacted_to_message_id) ??
    readSendblueString(payload.reaction_message_handle) ??
    readSendblueString(payload.message_id) ??
    readSendblueString(payload.message_handle)
  );
}

function isSendblueReactionRemoved(payload: SendblueWebhookPayload) {
  const explicitEventType = readSendblueToken(payload.event_type);
  const action = readSendblueToken(payload.action);
  const status = readSendblueToken(payload.status);

  return Boolean(
    readSendblueBoolean(payload.removed) === true ||
      readSendblueBoolean(payload.is_removed) === true ||
      readSendblueBoolean(payload.reaction_removed) === true ||
      explicitEventType?.includes("removed") ||
      explicitEventType?.includes("deleted") ||
      action === "removed" ||
      action === "delete" ||
      status === "removed",
  );
}

function readSendblueNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function readSendblueToken(value: unknown) {
  return readSendblueString(value)?.toLowerCase() ?? null;
}

function readBearerToken(value: string | null) {
  const header = readSendblueString(value);
  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}
