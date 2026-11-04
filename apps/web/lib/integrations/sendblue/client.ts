import "server-only";

import { firstConfiguredEnvValue } from "@/lib/shared/env";
import { normalizePublicHttpsOrigin, parsePublicHttpsUrl } from "@/lib/shared/public-url";
import { normalizeE164 } from "../../shared/phone";
import {
  buildSendblueChatId,
  readSendblueString,
} from "./webhooks";
import type {
  TextOutboundPart,
  TextSendMessageArgs,
  TextSendMessageResult,
} from "../text-transport-types";

type SendblueMessageResponse = {
  media_url?: string | null;
  message_handle?: string | null;
  message_type?: string | null;
  status?: string | null;
  service?: string | null;
  [key: string]: unknown;
};
type SendblueSequentialPartMessage = NonNullable<
  TextSendMessageResult["partMessages"]
>[number];

class SendblueApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message);
    this.name = "SendblueApiError";
  }
}

export function getSendblueFromNumber() {
  return normalizeE164(
    firstConfiguredEnvValue(
      process.env.SENDBLUE_FROM_NUMBER,
      process.env.KINFOLK_IMESSAGE_NUMBER,
      process.env.KINFOLK_SMS_NUMBER,
    ),
  );
}

export function isSendblueTextAgentEnabled() {
  return (
    process.env.KINFOLK_SMS_AGENT_ENABLED?.trim().toLowerCase() !== "false" &&
    Boolean(getSendblueFromNumber()) &&
    Boolean(getSendblueApiKey()) &&
    Boolean(getSendblueApiSecret())
  );
}

export function getSendblueWebhookSigningSecret() {
  return firstConfiguredEnvValue(
    process.env.SENDBLUE_WEBHOOK_SIGNING_SECRET,
    process.env.SENDBLUE_WEBHOOK_SECRET,
  );
}

export async function startSendblueTyping({
  to,
}: {
  chatId?: string | null;
  to?: string | null;
}) {
  const apiKey = getSendblueApiKey();
  const apiSecret = getSendblueApiSecret();
  const from = getSendblueFromNumber();
  const recipient = normalizeE164(to ?? "");

  if (!apiKey || !apiSecret || !from || !recipient) {
    return;
  }

  const response = await fetch(
    `${getSendblueApiBaseUrl()}/api/send-typing-indicator`,
    {
      body: JSON.stringify({
        from_number: from,
        number: recipient,
      }),
      headers: buildSendblueHeaders(apiKey, apiSecret),
      method: "POST",
      signal: AbortSignal.timeout(SENDBLUE_TYPING_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Sendblue typing indicator failed with status ${response.status}${
        detail ? `: ${detail.slice(0, 200)}` : ""
      }.`,
    );
  }
}

export async function sendSendblueText({
  body,
  chatId,
  idempotencyKey,
  to,
}: {
  body: string;
  chatId?: string | null;
  idempotencyKey: string;
  to: string;
}) {
  return sendSendblueMessage({
    chatId,
    idempotencyKey,
    parts: [{ type: "text", value: body }],
    to,
  });
}

const SENDBLUE_REQUEST_TIMEOUT_MS = 15_000;
const SENDBLUE_TYPING_TIMEOUT_MS = 5_000;

export async function sendSendblueMessage({
  chatId,
  idempotencyKey,
  parts,
  to,
}: TextSendMessageArgs): Promise<TextSendMessageResult> {
  const apiKey = getSendblueApiKey();
  const apiSecret = getSendblueApiSecret();
  const from = getSendblueFromNumber();
  const recipient = normalizeE164(to);

  if (!apiKey) {
    throw new Error("Missing SENDBLUE_API_KEY.");
  }

  if (!apiSecret) {
    throw new Error("Missing SENDBLUE_API_SECRET.");
  }

  if (!from) {
    throw new Error("Missing SENDBLUE_FROM_NUMBER.");
  }

  if (!recipient) {
    throw new Error("Missing Sendblue recipient phone number.");
  }

  const statusCallback = getSendblueStatusCallbackUrl();
  const chatIdValue = chatId ?? buildSendblueChatId({ contact: recipient, line: from });
  const mediaUrls = readSendblueMediaUrls(parts);
  const hasNonMediaParts = parts.some((part) => part.type !== "media");

  if (hasNonMediaParts && mediaUrls.length > 1) {
    const textPayload = buildSendblueMessagePayload({
      from,
      parts: parts.filter((part) => part.type !== "media"),
      to: recipient,
    });
    const textJson = await postSendblueMessage({
      apiKey,
      apiSecret,
      endpoint: "/api/send-message",
      payload: {
        ...textPayload,
        metadata: { idempotency_key: idempotencyKey },
        ...(statusCallback ? { status_callback: statusCallback } : {}),
      },
    });
    // The text bubble is already delivered past this point: throwing on a
    // media failure would make the caller's retry re-send it as a duplicate.
    // Degrade to text-only instead.
    let mediaResult: Awaited<ReturnType<typeof sendSendblueMediaMessages>> | null =
      null;
    try {
      mediaResult = await sendSendblueMediaMessages({
        apiKey,
        apiSecret,
        chatId: chatIdValue,
        from,
        idempotencyKey,
        mediaUrls,
        statusCallback,
        to: recipient,
      });
    } catch (error) {
      console.error("[sendblue] media send failed after text delivered", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      ...formatSendblueMessageResult({ chatId: chatIdValue, json: textJson }),
      ...(mediaResult
        ? {
            partRefs:
              mediaResult.partRefs ??
              buildSendblueSequentialPartRefs(mediaResult.partMessages),
            partMessages: mediaResult.partMessages,
          }
        : {}),
    };
  }

  const carouselPayload = buildSendblueCarouselPayload({
    from,
    idempotencyKey,
    parts,
    statusCallback,
    to: recipient,
  });

  if (carouselPayload) {
    try {
      const carousel = await postSendblueMessage({
        apiKey,
        apiSecret,
        endpoint: "/api/send-carousel",
        payload: carouselPayload,
      });
      return withSendblueCarouselPartRefs(
        formatSendblueMessageResult({
          chatId: chatIdValue,
          json: carousel,
        }),
        carouselPayload.media_urls,
      );
    } catch (error) {
      if (!shouldFallbackFromCarousel(error)) {
        throw error;
      }

      return sendSendblueSequentialMediaMessages({
        apiKey,
        apiSecret,
        chatId: chatIdValue,
        from,
        mediaUrls: carouselPayload.media_urls,
        statusCallback,
        to: recipient,
      });
    }
  }

  const payload = buildSendblueMessagePayload({
    from,
    parts,
    to: recipient,
  });
  const json = await postSendblueMessage({
    apiKey,
    apiSecret,
    endpoint: "/api/send-message",
    payload: {
      ...payload,
      // Rides along like the carousel path's metadata: no provider-side
      // dedupe, but it makes duplicates correlatable end to end.
      metadata: { idempotency_key: idempotencyKey },
      ...(statusCallback ? { status_callback: statusCallback } : {}),
    },
  });

  return formatSendblueMessageResult({
    chatId: chatIdValue,
    json,
  });
}

function buildSendblueMessagePayload({
  from,
  parts,
  to,
}: {
  from: string;
  parts: TextOutboundPart[];
  to: string;
}) {
  const text = parts
    .flatMap((part) => {
      if (part.type === "text") {
        const value = part.value.trim();
        return value ? [value] : [];
      }
      if (part.type === "link") {
        const value = part.value.trim();
        return value ? [value] : [];
      }
      return [];
    })
    .join("\n")
    .trim();
  const mediaUrls = readSendblueMediaUrls(parts);
  const content = text;

  if (!content && !mediaUrls[0]) {
    throw new Error("Sendblue messages require text content or media.");
  }

  return {
    ...(content ? { content } : {}),
    from_number: from,
    ...(mediaUrls[0] ? { media_url: mediaUrls[0] } : {}),
    number: to,
  };
}

function readSendblueMediaUrls(parts: TextOutboundPart[]) {
  return parts.flatMap((part) => {
    if (part.type !== "media") {
      return [];
    }
    const url = part.url.trim();
    return url ? [url] : [];
  });
}

async function sendSendblueMediaMessages({
  apiKey,
  apiSecret,
  chatId,
  from,
  idempotencyKey,
  mediaUrls,
  statusCallback,
  to,
}: {
  apiKey: string;
  apiSecret: string;
  chatId: string;
  from: string;
  idempotencyKey: string;
  mediaUrls: string[];
  statusCallback: string;
  to: string;
}) {
  const mediaParts = mediaUrls.map((url) => ({ type: "media" as const, url }));
  const carouselPayload = buildSendblueCarouselPayload({
    from,
    idempotencyKey,
    parts: mediaParts,
    statusCallback,
    to,
  });

  if (carouselPayload) {
    try {
      const carousel = await postSendblueMessage({
        apiKey,
        apiSecret,
        endpoint: "/api/send-carousel",
        payload: carouselPayload,
      });
      return withSendblueCarouselPartRefs(
        formatSendblueMessageResult({ chatId, json: carousel }),
        carouselPayload.media_urls,
      );
    } catch (error) {
      if (!shouldFallbackFromCarousel(error)) {
        throw error;
      }
    }
  }

  return sendSendblueSequentialMediaMessages({
    apiKey,
    apiSecret,
    chatId,
    from,
    mediaUrls,
    statusCallback,
    to,
  });
}

function buildSendblueCarouselPayload({
  from,
  idempotencyKey,
  parts,
  statusCallback,
  to,
}: {
  from: string;
  idempotencyKey: string;
  parts: TextOutboundPart[];
  statusCallback: string;
  to: string;
}) {
  const mediaUrls = readSendblueMediaUrls(parts);
  const hasNonMediaParts = parts.some((part) => part.type !== "media");
  const canCarousel =
    !hasNonMediaParts &&
    mediaUrls.length >= 2 &&
    mediaUrls.length <= 20 &&
    mediaUrls.every((url) => /^https:\/\//i.test(url));

  if (!canCarousel) {
    return null;
  }

  return {
    from_number: from,
    media_urls: mediaUrls,
    metadata: {
      idempotency_key: idempotencyKey,
      message_kind: "kinfolk_media_carousel",
    },
    number: to,
    ...(statusCallback ? { status_callback: statusCallback } : {}),
  };
}

async function sendSendblueSequentialMediaMessages({
  apiKey,
  apiSecret,
  chatId,
  from,
  mediaUrls,
  statusCallback,
  to,
}: {
  apiKey: string;
  apiSecret: string;
  chatId: string;
  from: string;
  mediaUrls: string[];
  statusCallback: string;
  to: string;
}): Promise<TextSendMessageResult> {
  const sendMediaParts = async (
    remaining: string[],
    partMessages: SendblueSequentialPartMessage[] = [],
  ): Promise<SendblueSequentialPartMessage[]> => {
    const mediaUrl = remaining[0];
    if (!mediaUrl) return partMessages;

    const json = await postSendblueMessage({
      apiKey,
      apiSecret,
      endpoint: "/api/send-message",
      payload: {
        from_number: from,
        media_url: mediaUrl,
        number: to,
        ...(statusCallback ? { status_callback: statusCallback } : {}),
      },
    });
    partMessages.push({
      deliveryStatus: normalizeSendblueStatus(json.status),
      mediaUrl,
      messageId: readSendblueString(json.message_handle),
      service: readSendblueString(json.service),
    });
    return sendMediaParts(remaining.slice(1), partMessages);
  };

  const partMessages = await sendMediaParts(mediaUrls);

  const first = partMessages[0] ?? null;
  return {
    chatId,
    deliveryStatus: first?.deliveryStatus ?? null,
    messageId: first?.messageId ?? null,
    partRefs: buildSendblueSequentialPartRefs(partMessages),
    partMessages,
    service: first?.service ?? null,
  };
}

async function postSendblueMessage({
  apiKey,
  apiSecret,
  endpoint,
  payload,
}: {
  apiKey: string;
  apiSecret: string;
  endpoint: string;
  payload: Record<string, unknown>;
}) {
  // A hung Sendblue API must not stall the live reply path for undici's
  // ~300s default — fail fast and let the queue's retry machinery own it.
  const response = await fetch(`${getSendblueApiBaseUrl()}${endpoint}`, {
    body: JSON.stringify(payload),
    headers: buildSendblueHeaders(apiKey, apiSecret),
    method: "POST",
    signal: AbortSignal.timeout(SENDBLUE_REQUEST_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => ({}))) as SendblueMessageResponse;

  if (!response.ok) {
    const detail =
      readSendblueString(json.error_message) ??
      readSendblueString(json.message) ??
      `status ${response.status}`;
    throw new SendblueApiError(
      `Sendblue ${endpoint} failed: ${detail}`,
      response.status,
      detail,
    );
  }

  return json;
}

function formatSendblueMessageResult({
  chatId,
  json,
}: {
  chatId: string;
  json: SendblueMessageResponse;
}): TextSendMessageResult {
  return {
    chatId,
    deliveryStatus: normalizeSendblueStatus(json.status),
    messageId: readSendblueString(json.message_handle),
    service: readSendblueString(json.service),
  };
}

function withSendblueCarouselPartRefs(
  result: TextSendMessageResult,
  mediaUrls: string[],
) {
  if (mediaUrls.length === 0) {
    return result;
  }

  return {
    ...result,
    partRefs: mediaUrls.map((mediaUrl, index) => ({
      mediaUrl,
      messageId: result.messageId,
      partIndex: index,
      service: result.service,
    })),
  };
}

function buildSendblueSequentialPartRefs(
  partMessages: NonNullable<TextSendMessageResult["partMessages"]> | undefined,
) {
  return (partMessages ?? []).map((partMessage) => ({
    mediaUrl: partMessage.mediaUrl,
    messageId: partMessage.messageId,
    partIndex: null,
    service: partMessage.service,
  }));
}

function shouldFallbackFromCarousel(error: unknown) {
  if (
    process.env.SENDBLUE_CAROUSEL_FALLBACK?.trim().toLowerCase() === "false"
  ) {
    return false;
  }

  return (
    error instanceof SendblueApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    /carousel|v2|mac mini|media_urls|media urls|line/i.test(error.detail)
  );
}

function getSendblueApiKey() {
  return firstConfiguredEnvValue(
    process.env.SENDBLUE_API_KEY_ID,
    process.env.SENDBLUE_API_KEY,
  );
}

function getSendblueApiSecret() {
  return firstConfiguredEnvValue(
    process.env.SENDBLUE_API_SECRET_KEY,
    process.env.SENDBLUE_API_SECRET,
  );
}

function getSendblueApiBaseUrl() {
  return (
    firstConfiguredEnvValue(process.env.SENDBLUE_API_BASE_URL) ||
    "https://api.sendblue.co"
  ).replace(/\/+$/, "");
}

function getSendblueStatusCallbackUrl() {
  const explicit = firstConfiguredEnvValue(process.env.SENDBLUE_STATUS_CALLBACK_URL);
  if (explicit) {
    return normalizeProviderCallbackUrl(explicit);
  }

  const baseUrl = firstConfiguredEnvValue(process.env.NEXT_PUBLIC_KINFOLK_BASE_URL);
  const origin = normalizeProviderCallbackOrigin(baseUrl);
  return origin ? `${origin}/api/webhooks/sendblue` : "";
}

function normalizeProviderCallbackUrl(value: string) {
  const url = parsePublicHttpsUrl(value);
  if (!url) {
    return "";
  }

  url.hash = "";
  return url.toString();
}

function normalizeProviderCallbackOrigin(value: string) {
  return normalizePublicHttpsOrigin(value) ?? "";
}

function buildSendblueHeaders(apiKey: string, apiSecret: string) {
  return {
    "Content-Type": "application/json",
    "sb-api-key-id": apiKey,
    "sb-api-secret-key": apiSecret,
  };
}

function normalizeSendblueStatus(status: unknown) {
  return typeof status === "string" && status.trim()
    ? status.trim().toLowerCase()
    : null;
}
