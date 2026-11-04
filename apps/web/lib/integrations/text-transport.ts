import "server-only";

import {
  getLinqFromNumber,
  getLinqWebhookSigningSecret,
  isLinqTextAgentEnabled,
  sendLinqMessage,
  sendLinqText,
  startLinqTyping,
} from "@/lib/integrations/linq/client";
import {
  getLinqInboundMessage,
  getLinqReactionEvent,
  parseLinqWebhookPayload,
  verifyLinqWebhookSignature,
} from "@/lib/integrations/linq/webhooks";
import {
  getSendblueFromNumber,
  getSendblueWebhookSigningSecret,
  isSendblueTextAgentEnabled,
  sendSendblueMessage,
  sendSendblueText,
  startSendblueTyping,
} from "@/lib/integrations/sendblue/client";
import {
  parseSendblueTextWebhook,
  verifySendblueWebhookSecret,
} from "@/lib/integrations/sendblue/webhooks";
import type {
  ParsedTextWebhook,
  TextDeliveryEvent,
  TextSendMessageArgs,
  TextSendMessageResult,
  TextTransportProvider,
  TextWebhookVerificationFailureReason,
  TextWebhookVerification,
} from "@/lib/integrations/text-transport-types";

export type {
  ParsedTextWebhook,
  TextDeliveryEvent,
  TextInboundMessage,
  TextReactionEvent,
  TextSendMessageArgs,
  TextSendMessageResult,
  TextTransportProvider,
  TextWebhookRecord,
  TextWebhookVerification,
} from "@/lib/integrations/text-transport-types";
import { firstConfiguredEnvValue } from "@/lib/shared/env";

export function getActiveTextTransportProvider(): TextTransportProvider {
  // Sendblue is the live transport; an environment missing the var must not
  // silently route texts through the retired Linq path.
  return normalizeTextTransportProvider(
    firstConfiguredEnvValue(
      process.env.KINFOLK_TEXT_TRANSPORT,
      process.env.KINFOLK_SMS_TRANSPORT,
      "sendblue",
    ),
  );
}

function normalizeTextTransportProvider(
  provider: string | null | undefined,
): TextTransportProvider {
  return provider?.trim().toLowerCase() === "linq" ? "linq" : "sendblue";
}


export function getTextTransportDisplayName(provider: TextTransportProvider) {
  return provider === "sendblue" ? "Sendblue" : "Linq";
}

export function getTextTransportFromNumber(
  provider = getActiveTextTransportProvider(),
) {
  return provider === "sendblue"
    ? getSendblueFromNumber()
    : getLinqFromNumber();
}

export function isTextAgentEnabled(
  provider = getActiveTextTransportProvider(),
) {
  return provider === "sendblue"
    ? isSendblueTextAgentEnabled()
    : isLinqTextAgentEnabled();
}

export async function startTextTyping({
  chatId,
  provider,
  to,
}: {
  chatId?: string | null;
  provider: TextTransportProvider;
  to?: string | null;
}) {
  if (isTextTransportDryRunEnabled(to)) {
    return;
  }

  if (provider === "sendblue") {
    await startSendblueTyping({ chatId, to });
    return;
  }

  await startLinqTyping(chatId);
}

export async function sendTextMessage({
  provider,
  ...args
}: TextSendMessageArgs & {
  provider: TextTransportProvider;
}): Promise<TextSendMessageResult> {
  if (isTextTransportDryRunEnabled(args.to)) {
    return buildDryRunTextSendResult({ provider, ...args });
  }

  return provider === "sendblue"
    ? sendSendblueMessage(args)
    : sendLinqMessage(args);
}

export async function sendTextText({
  body,
  chatId,
  idempotencyKey,
  provider,
  to,
}: {
  body: string;
  chatId?: string | null;
  idempotencyKey: string;
  provider: TextTransportProvider;
  to: string;
}): Promise<TextSendMessageResult> {
  if (isTextTransportDryRunEnabled(to)) {
    return buildDryRunTextSendResult({
      chatId,
      idempotencyKey,
      parts: [{ type: "text", value: body }],
      provider,
      to,
    });
  }

  return provider === "sendblue"
    ? sendSendblueText({ body, chatId, idempotencyKey, to })
    : sendLinqText({ body, chatId, idempotencyKey, to });
}

function isTextTransportDryRunEnabled(to?: string | null) {
  return (
    process.env.KINFOLK_TEXT_TRANSPORT_DRY_RUN?.trim().toLowerCase() ===
      "true" ||
    isReservedTestPhoneNumber(to)
  );
}

function isReservedTestPhoneNumber(to?: string | null) {
  const digits = to?.replace(/\D/g, "") ?? "";
  const domesticDigits =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^\d{3}55501\d{2}$/.test(domesticDigits);
}

function buildDryRunTextSendResult({
  chatId,
  idempotencyKey,
  parts,
  provider,
  to,
}: TextSendMessageArgs & {
  provider: TextTransportProvider;
}) {
  const resolvedChatId = chatId || `dry-run:${provider}:${to}`;
  const result: TextSendMessageResult = {
    chatId: resolvedChatId,
    deliveryStatus: "dry_run",
    messageId: `dry-run:${idempotencyKey}`,
    service: "dry_run",
  };
  const mediaParts = parts.filter((part) => part.type === "media");

  if (mediaParts.length > 0) {
    result.partMessages = mediaParts.map((part, index) => ({
      deliveryStatus: "dry_run",
      mediaUrl: part.url,
      messageId: `dry-run:${idempotencyKey}:media:${index + 1}`,
      service: "dry_run",
    }));
    result.partRefs = result.partMessages.map((partMessage, index) => ({
      mediaUrl: partMessage.mediaUrl,
      messageId: partMessage.messageId,
      partIndex: index,
      service: partMessage.service,
    }));
  }

  return result;
}

export function verifyTextWebhook({
  headers,
  provider,
  rawBody,
}: {
  headers: Headers;
  provider: TextTransportProvider;
  rawBody: string;
}): TextWebhookVerification {
  if (provider === "sendblue") {
    return verifySendblueWebhookSecret({
      headers,
      secret: getSendblueWebhookSigningSecret(),
    });
  }

  const verification = verifyLinqWebhookSignature({
    payload: rawBody,
    secret: getLinqWebhookSigningSecret(),
    signature: headers.get("x-webhook-signature"),
    timestamp: headers.get("x-webhook-timestamp"),
  });

  if (verification.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: verification.reason as TextWebhookVerificationFailureReason,
  };
}

export function parseTextWebhookPayload({
  provider,
  rawBody,
}: {
  provider: TextTransportProvider;
  rawBody: string;
}): ParsedTextWebhook {
  if (provider === "sendblue") {
    return parseSendblueTextWebhook(rawBody);
  }

  const payload = parseLinqWebhookPayload(rawBody);
  const eventType = readLinqEventType(payload.event_type) || "unknown";
  const event = {
    eventId: readLinqWebhookString(payload.event_id) ?? "",
    eventType,
    provider,
    raw: payload,
    traceId: readLinqWebhookString(payload.trace_id),
  };
  const inbound = getLinqInboundMessage(payload);
  const reaction = getLinqReactionEvent(payload);

  return {
    delivery: getLinqDeliveryEvent(payload),
    event,
    inbound: inbound
      ? {
          ...inbound,
          provider,
          raw: inbound.raw,
        }
      : null,
    reaction: reaction
      ? {
          ...reaction,
          provider,
          raw: reaction.raw,
        }
      : null,
  };
}

function getLinqDeliveryEvent(
  payload: ReturnType<typeof parseLinqWebhookPayload>,
): TextDeliveryEvent | null {
  const eventType = readLinqEventType(payload.event_type);
  const eventId = readLinqWebhookString(payload.event_id);
  if (!isLinqMessageDeliveryEvent(eventType)) {
    return null;
  }
  if (!eventId) {
    return null;
  }

  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const messageId = readLinqWebhookString((data as Record<string, unknown>).id);
  if (!messageId) {
    return null;
  }

  return {
    deliveryStatus: eventType.replace("message.", ""),
    eventId,
    messageId,
    provider: "linq",
    raw: payload,
    traceId: readLinqWebhookString(payload.trace_id),
  };
}

function isLinqMessageDeliveryEvent(eventType: string | null | undefined) {
  return (
    eventType === "message.sent" ||
    eventType === "message.delivered" ||
    eventType === "message.read" ||
    eventType === "message.failed"
  );
}

function readLinqEventType(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readLinqWebhookString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getPhoneVerificationProvider() {
  return getActiveTextTransportProvider();
}

export function readTextProviderForRow(provider: string | null | undefined) {
  return normalizeTextTransportProvider(provider);
}
