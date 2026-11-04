import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeE164, normalizePhoneE164 } from "../../shared/phone";
import { normalizeTapbackReaction } from "../tapback-reactions";
import type { TextChatContext, TextChatParticipant } from "../text-transport-types";

type LinqWebhookEventType =
  | "message.sent"
  | "message.received"
  | "message.read"
  | "message.delivered"
  | "message.edited"
  | "message.failed"
  | "reaction.added"
  | "reaction.removed"
  | "participant.added"
  | "participant.removed"
  | "chat.created"
  | "chat.group_name_updated"
  | "chat.group_icon_updated"
  | "chat.group_name_update_failed"
  | "chat.group_icon_update_failed"
  | "chat.typing_indicator.started"
  | "chat.typing_indicator.stopped"
  | "phone_number.status_updated"
  | string;

type LinqTextPart = {
  type: "text";
  value: string;
};

type LinqMediaPart = {
  type: "media" | "link";
  value?: string;
  url?: string;
  [key: string]: unknown;
};

type LinqMessageData = {
  id?: string;
  chat?: {
    id?: string;
    owner_handle?: LinqHandle | null;
    [key: string]: unknown;
  };
  direction?: "inbound" | "outbound" | string;
  parts?: Array<LinqTextPart | LinqMediaPart>;
  sender_handle?: LinqHandle;
  service?: string;
  delivered_at?: string | null;
  idempotency_key?: string | null;
  read_at?: string | null;
  sent_at?: string | null;
  [key: string]: unknown;
};

type LinqHandle = {
  handle?: string;
  is_me?: boolean | null;
  service?: string;
  [key: string]: unknown;
};

export type LinqWebhookPayload = {
  api_version?: string;
  created_at?: string;
  data?: LinqMessageData | Record<string, unknown>;
  event_id?: string;
  event_type?: LinqWebhookEventType;
  partner_id?: string;
  trace_id?: string;
  webhook_version?: string;
  [key: string]: unknown;
};

export type LinqInboundMessage = {
  body: string;
  chat: TextChatContext;
  chatId: string;
  eventId: string;
  from: string;
  media: Array<Record<string, string | number | boolean | null>>;
  messageId: string;
  raw: LinqWebhookPayload;
  receivedAt: string;
  service: string | null;
  to: string;
  traceId: string | null;
};

export type LinqReactionEvent = {
  chatId: string;
  eventId: string;
  from: string;
  messageId: string;
  partIndex: number | null;
  raw: LinqWebhookPayload;
  reactionType: string;
  removed: boolean;
  traceId: string | null;
};

export function computeLinqWebhookSignature({
  payload,
  secret,
  timestamp,
}: {
  payload: string;
  secret: string;
  timestamp: string;
}) {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

export function verifyLinqWebhookSignature({
  nowMs = Date.now(),
  payload,
  secret,
  signature,
  timestamp,
  toleranceSeconds = 300,
}: {
  nowMs?: number;
  payload: string;
  secret: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  toleranceSeconds?: number;
}) {
  const resolvedSecret = secret.trim();
  if (!resolvedSecret) {
    return { ok: false as const, reason: "missing_secret" };
  }

  if (!timestamp || !signature) {
    return { ok: false as const, reason: "missing_headers" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false as const, reason: "invalid_timestamp" };
  }

  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) {
    return { ok: false as const, reason: "stale_timestamp" };
  }

  const expected = computeLinqWebhookSignature({
    payload,
    secret: resolvedSecret,
    timestamp,
  });
  const provided = signature.replace(/^sha256=/i, "").trim();

  if (!/^[a-f0-9]+$/i.test(provided) || provided.length !== expected.length) {
    return { ok: false as const, reason: "invalid_signature" };
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return { ok: false as const, reason: "signature_mismatch" };
  }

  return { ok: true as const };
}

export function parseLinqWebhookPayload(rawBody: string): LinqWebhookPayload {
  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Webhook payload must be a JSON object.");
  }
  return parsed as LinqWebhookPayload;
}

function extractTextFromLinqParts(parts: LinqMessageData["parts"]) {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .flatMap((part) => {
      if (part?.type !== "text" || typeof part.value !== "string") return [];
      const value = part.value.trim();
      return value ? [value] : [];
    })
    .join("\n")
    .trim();
}

function extractMediaFromLinqParts(parts: LinqMessageData["parts"]) {
  if (!Array.isArray(parts)) {
    return [];
  }

  const seen = new Set<string>();
  return parts.flatMap((part) => {
    if (part?.type !== "media" && part?.type !== "link") return [];
    const media = {
      attachment_id: readString(part.attachment_id),
      content_type: readString(part.content_type),
      name: readString(part.name),
      size: readNumber(part.size),
      type: part.type,
      url: readString(part.url) ?? readString(part.value),
    };
    const identity = media.url ?? media.attachment_id ?? media.name;
    if (!identity || seen.has(identity)) {
      return [];
    }
    seen.add(identity);
    return [media];
  });
}

export function getLinqInboundMessage(payload: LinqWebhookPayload): LinqInboundMessage | null {
  const eventType = readEventType(payload.event_type);
  const eventId = readString(payload.event_id);
  if (eventType !== "message.received" || !eventId) {
    return null;
  }

  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const message = data as LinqMessageData;
  const chatId = readString(message.chat?.id) ?? "";
  const messageId = readString(message.id) ?? "";
  const from = normalizePhoneE164(readHandle(message.sender_handle));
  const to = normalizePhoneE164(readHandle(message.chat?.owner_handle));
  const body = extractTextFromLinqParts(message.parts);
  const media = extractMediaFromLinqParts(message.parts);
  const chat = getLinqChatContext(message.chat);

  if (
    !chatId ||
    !messageId ||
    !from ||
    !to ||
    readDirection(message.direction) !== "inbound" ||
    (!body && media.length === 0)
  ) {
    return null;
  }

  return {
    body,
    chat,
    chatId,
    eventId,
    from,
    media,
    messageId,
    raw: payload,
    receivedAt: readTimestampString(payload.created_at) ?? new Date().toISOString(),
    service: readString(message.service),
    to,
    traceId: readString(payload.trace_id),
  };
}

export function getLinqReactionEvent(payload: LinqWebhookPayload): LinqReactionEvent | null {
  const eventType = readEventType(payload.event_type);
  const eventId = readString(payload.event_id);
  if (
    (eventType !== "reaction.added" && eventType !== "reaction.removed") ||
    !eventId
  ) {
    return null;
  }

  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const reaction = data as Record<string, unknown>;
  const chat = reaction.chat;
  const chatId =
    chat && typeof chat === "object" && !Array.isArray(chat)
      ? readString((chat as Record<string, unknown>).id)
      : readString(reaction.chat_id);
  const from =
    normalizePhoneE164(readHandle(reaction.sender_handle as LinqHandle | null)) ||
    normalizePhoneE164(readString(reaction.from_phone_number) ?? "");
  const messageId = readString(reaction.message_id);
  const reactionType = readLinqReactionType(reaction.reaction_type);
  const partIndex = readNumber(reaction.part_index);

  if (!chatId || !from || !messageId || !reactionType) {
    return null;
  }

  return {
    chatId,
    eventId,
    from,
    messageId,
    partIndex,
    raw: payload,
    reactionType,
    removed: eventType === "reaction.removed",
    traceId: readString(payload.trace_id),
  };
}

function readHandle(value: LinqHandle | undefined | null) {
  return typeof value?.handle === "string" ? value.handle : "";
}

function getLinqChatContext(chat: LinqMessageData["chat"]): TextChatContext {
  return {
    isGroup: readBoolean(
      chat?.is_group ?? chat?.isGroup ?? chat?.is_group_chat ?? chat?.isGroupChat,
    ),
    ownerHandle: normalizeHandle(readHandle(chat?.owner_handle)),
    participants: readLinqParticipants(
      chat?.participants ?? chat?.participant_handles ?? chat?.handles,
    ),
  };
}

function readLinqParticipants(value: unknown): TextChatParticipant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const participants = value
    .map(readLinqParticipant)
    .filter((participant): participant is TextChatParticipant =>
      Boolean(participant?.handle),
    );
  const seen = new Set<string>();

  return participants.filter((participant) => {
    const key = participant.handle.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readLinqParticipant(value: unknown): TextChatParticipant | null {
  if (typeof value === "string") {
    return {
      handle: normalizeHandle(value),
      isMe: null,
      service: null,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const handle =
    normalizeHandle(readString(record.handle)) ||
    normalizeHandle(readString(record.phone_number)) ||
    normalizeHandle(readString(record.phoneNumber));

  if (!handle) {
    return null;
  }

  return {
    handle,
    isMe: readBoolean(record.is_me ?? record.isMe),
    service: readString(record.service),
  };
}

function normalizeHandle(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return normalizeE164(value) || value.trim();
}

function readBoolean(value: unknown) {
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

function readDirection(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readEventType(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readLinqReactionType(value: unknown) {
  const raw = readString(value);
  return raw ? normalizeTapbackReaction(raw) : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTimestampString(value: unknown) {
  const timestamp = readString(value);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}
