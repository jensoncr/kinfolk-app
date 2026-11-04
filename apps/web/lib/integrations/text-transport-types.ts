export type TextTransportProvider = "linq" | "sendblue";

export type TextOutboundPart =
  | { type: "text"; value: string }
  | { type: "media"; url: string }
  | { type: "link"; value: string };

export type TextSendMessageArgs = {
  chatId?: string | null;
  idempotencyKey: string;
  parts: TextOutboundPart[];
  to: string;
};

export type TextSendMessageResult = {
  chatId: string | null;
  deliveryStatus: string | null;
  messageId: string | null;
  partRefs?: Array<{
    mediaUrl?: string | null;
    messageId: string | null;
    partIndex: number | null;
    service: string | null;
  }>;
  partMessages?: Array<{
    deliveryStatus: string | null;
    mediaUrl?: string | null;
    messageId: string | null;
    service: string | null;
  }>;
  service: string | null;
};

export type TextChatParticipant = {
  handle: string;
  isMe: boolean | null;
  service: string | null;
};

export type TextChatContext = {
  isGroup: boolean | null;
  ownerHandle: string | null;
  participants: TextChatParticipant[];
};

export type TextInboundMessage = {
  body: string;
  chat: TextChatContext | null;
  chatId: string;
  eventId: string;
  from: string;
  media: Array<Record<string, string | number | boolean | null>>;
  messageId: string;
  provider: TextTransportProvider;
  raw: Record<string, unknown>;
  receivedAt: string;
  service: string | null;
  to: string;
  traceId: string | null;
};

export type TextReactionEvent = {
  chatId: string;
  eventId: string;
  from: string;
  messageId: string;
  partIndex: number | null;
  provider: TextTransportProvider;
  raw: Record<string, unknown>;
  reactionType: string;
  removed: boolean;
  traceId: string | null;
};

export type TextDeliveryEvent = {
  deliveryStatus: string | null;
  eventId: string;
  messageId: string;
  provider: TextTransportProvider;
  raw: Record<string, unknown>;
  traceId: string | null;
};

export type TextWebhookRecord = {
  eventId: string;
  eventType: string;
  provider: TextTransportProvider;
  raw: Record<string, unknown>;
  traceId: string | null;
};

export type ParsedTextWebhook = {
  delivery?: TextDeliveryEvent | null;
  event: TextWebhookRecord;
  inbound?: TextInboundMessage | null;
  reaction?: TextReactionEvent | null;
};

export type TextWebhookVerificationFailureReason =
  | "invalid_payload"
  | "invalid_signature"
  | "invalid_timestamp"
  | "missing_headers"
  | "missing_secret"
  | "signature_mismatch"
  | "stale_timestamp";

export type TextWebhookVerification =
  | { ok: true }
  | {
      ok: false;
      reason: TextWebhookVerificationFailureReason;
    };
