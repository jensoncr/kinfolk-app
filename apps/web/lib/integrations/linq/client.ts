import "server-only";

import LinqAPIV3 from "@linqapp/sdk";
import { firstConfiguredEnvValue } from "@/lib/shared/env";
import { normalizeE164 } from "../../shared/phone";

type SendLinqTextArgs = {
  body: string;
  chatId?: string | null;
  idempotencyKey: string;
  to: string;
};

type LinqSendPart =
  | { type: "text"; value: string }
  | { type: "media"; url: string }
  | { type: "link"; value: string };

type SendLinqMessageArgs = {
  chatId?: string | null;
  idempotencyKey: string;
  parts: LinqSendPart[];
  to: string;
};

export function getLinqFromNumber() {
  return normalizeE164(
    firstConfiguredEnvValue(
      process.env.LINQ_FROM_NUMBER,
      process.env.KINFOLK_SMS_NUMBER,
    ),
  );
}

export function isLinqTextAgentEnabled() {
  return (
    process.env.KINFOLK_SMS_AGENT_ENABLED?.trim().toLowerCase() !== "false" &&
    Boolean(getLinqFromNumber())
  );
}

export function getLinqWebhookSigningSecret() {
  return firstConfiguredEnvValue(process.env.LINQ_WEBHOOK_SIGNING_SECRET);
}

export async function startLinqTyping(chatId?: string | null) {
  const apiKey = readLinqApiKey();

  if (!apiKey || !chatId) {
    return;
  }

  const client = new LinqAPIV3({ apiKey });
  await client.chats.typing.start(chatId);
}

export async function sendLinqText({
  body,
  chatId,
  idempotencyKey,
  to,
}: SendLinqTextArgs) {
  return sendLinqMessage({
    chatId,
    idempotencyKey,
    parts: [{ type: "text", value: body }],
    to,
  });
}

export async function sendLinqMessage({
  chatId,
  idempotencyKey,
  parts,
  to,
}: SendLinqMessageArgs) {
  const from = getLinqFromNumber();
  const apiKey = readLinqApiKey();

  if (!apiKey) {
    throw new Error("Missing LINQ_API_KEY.");
  }

  if (!from) {
    throw new Error("Missing LINQ_FROM_NUMBER.");
  }

  const client = new LinqAPIV3({ apiKey });
  const message = {
    parts,
    idempotency_key: idempotencyKey,
  };

  if (chatId) {
    const response = await client.chats.messages.send(
      chatId,
      { message },
      { idempotencyKey },
    );
    const service =
      response.message.service ?? response.message.preferred_service ?? null;
    return {
      chatId: response.chat_id,
      deliveryStatus: response.message.delivery_status,
      messageId: response.message.id,
      partRefs: buildLinqPartRefs(parts, response.message.id, service),
      service,
    };
  }

  const response = await client.chats.create(
    {
      from,
      message,
      to: [to],
    },
    { idempotencyKey },
  );

  return {
    chatId: response.chat.id,
    deliveryStatus: response.chat.message.delivery_status,
    messageId: response.chat.message.id,
    partRefs: buildLinqPartRefs(
      parts,
      response.chat.message.id,
      response.chat.service,
    ),
    service: response.chat.service,
  };
}

function buildLinqPartRefs(
  parts: LinqSendPart[],
  messageId: string | null,
  service: string | null,
) {
  return parts.map((part, index) => ({
    mediaUrl: part.type === "media" ? part.url : null,
    messageId,
    partIndex: index,
    service,
  }));
}

function readLinqApiKey() {
  return firstConfiguredEnvValue(
    process.env.LINQ_API_KEY,
    process.env.LINQ_API_V3_API_KEY,
  );
}
