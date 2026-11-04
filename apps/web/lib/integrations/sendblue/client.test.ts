import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const env = {
  NEXT_PUBLIC_KINFOLK_BASE_URL: "https://kinfolk.example.com",
  SENDBLUE_API_BASE_URL: "https://api.sendblue.test",
  SENDBLUE_API_KEY: "key",
  SENDBLUE_API_SECRET: "secret",
  SENDBLUE_FROM_NUMBER: "+14155550147",
};

async function loadClient() {
  vi.resetModules();
  return import("./client");
}

function mockJsonResponse(body: Record<string, unknown>, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: init.status ?? 200,
  });
}

async function sendTextAndReadPayload(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  const fetchMock = vi.fn(async () =>
    mockJsonResponse({ message_handle: "text_msg_1", status: "QUEUED" }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { sendSendblueMessage } = await loadClient();

  await sendSendblueMessage({
    idempotencyKey: "sendblue-text-1",
    parts: [{ type: "text", value: "Hello" }],
    to: "+14155550142",
  });

  const calls = fetchMock.mock.calls as unknown as Array<
    [string, RequestInit]
  >;
  return JSON.parse(String(calls[0]?.[1]?.body)) as Record<string, unknown>;
}

describe("Sendblue client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("honors padded false SMS agent enablement config", async () => {
    vi.stubEnv("SENDBLUE_API_KEY", "key");
    vi.stubEnv("SENDBLUE_API_SECRET", "secret");
    vi.stubEnv("SENDBLUE_FROM_NUMBER", "+14155550147");
    vi.stubEnv("KINFOLK_SMS_AGENT_ENABLED", " FALSE ");
    const { isSendblueTextAgentEnabled } = await loadClient();

    expect(isSendblueTextAgentEnabled()).toBe(false);

    vi.stubEnv("KINFOLK_SMS_AGENT_ENABLED", " true ");

    expect(isSendblueTextAgentEnabled()).toBe(true);
  });

  it("sends typing indicators through Sendblue", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { startSendblueTyping } = await loadClient();

    await startSendblueTyping({ to: "+14155550142" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls[0]?.[0]).toBe(
      "https://api.sendblue.test/api/send-typing-indicator",
    );
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      from_number: "+14155550147",
      number: "+14155550142",
    });
  });

  it("uses the carousel endpoint for media-only multi-card messages", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({
        message_handle: "carousel_msg_123",
        message_type: "carousel",
        status: "QUEUED",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    const result = await sendSendblueMessage({
      idempotencyKey: "listing-carousel-1",
      parts: [
        { type: "media", url: "https://cards.example.com/1.png" },
        { type: "media", url: "https://cards.example.com/2.png" },
      ],
      to: "+14155550142",
    });

    expect(result).toMatchObject({
      deliveryStatus: "queued",
      messageId: "carousel_msg_123",
    });
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.[0]).toBe(
      "https://api.sendblue.test/api/send-carousel",
    );
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      from_number: "+14155550147",
      media_urls: [
        "https://cards.example.com/1.png",
        "https://cards.example.com/2.png",
      ],
      metadata: {
        idempotency_key: "listing-carousel-1",
        message_kind: "kinfolk_media_carousel",
      },
      number: "+14155550142",
      status_callback: "https://kinfolk.example.com/api/webhooks/sendblue",
    });
  });

  it("sends a contact card as media without text content", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({ message_handle: "contact_card_1", status: "QUEUED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    const result = await sendSendblueMessage({
      idempotencyKey: "contact-card-1",
      parts: [
        {
          type: "media",
          url: "https://kinfolk.example.com/api/kinfolk/contact-card.vcf",
        },
      ],
      to: "+14155550142",
    });

    expect(result).toMatchObject({
      deliveryStatus: "queued",
      messageId: "contact_card_1",
    });
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.[0]).toBe(
      "https://api.sendblue.test/api/send-message",
    );
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      from_number: "+14155550147",
      media_url: "https://kinfolk.example.com/api/kinfolk/contact-card.vcf",
      metadata: { idempotency_key: "contact-card-1" },
      number: "+14155550142",
      status_callback: "https://kinfolk.example.com/api/webhooks/sendblue",
    });
  });

  it("normalizes a safe app base URL before adding the status callback", async () => {
    const payload = await sendTextAndReadPayload({
      NEXT_PUBLIC_KINFOLK_BASE_URL: " https://kinfolk.example.com/app/// ",
    });

    expect(payload.status_callback).toBe(
      "https://kinfolk.example.com/api/webhooks/sendblue",
    );
  });

  it("uses a safe explicit status callback URL before the app base", async () => {
    const payload = await sendTextAndReadPayload({
      NEXT_PUBLIC_KINFOLK_BASE_URL: "https://10.0.0.5",
      SENDBLUE_STATUS_CALLBACK_URL:
        " https://hooks.example.com/sendblue/custom?token=abc#drop ",
    });

    expect(payload.status_callback).toBe(
      "https://hooks.example.com/sendblue/custom?token=abc",
    );
  });

  it.each<[string, Record<string, string>]>([
    [
      "non-HTTPS app base",
      { NEXT_PUBLIC_KINFOLK_BASE_URL: "http://kinfolk.example.com" },
    ],
    [
      "private app base",
      { NEXT_PUBLIC_KINFOLK_BASE_URL: "https://10.0.0.5" },
    ],
    [
      "IPv6 loopback app base",
      { NEXT_PUBLIC_KINFOLK_BASE_URL: "https://[::1]:3000/app" },
    ],
    [
      "credentialed app base",
      {
        NEXT_PUBLIC_KINFOLK_BASE_URL:
          "https://user:pass@kinfolk.example.com/app",
      },
    ],
    [
      "malformed app base",
      { NEXT_PUBLIC_KINFOLK_BASE_URL: "not a url" },
    ],
    [
      "non-HTTPS explicit callback",
      {
        SENDBLUE_STATUS_CALLBACK_URL:
          "http://kinfolk.example.com/api/webhooks/sendblue",
      },
    ],
    [
      "localhost explicit callback",
      {
        SENDBLUE_STATUS_CALLBACK_URL:
          "https://localhost:3000/api/webhooks/sendblue",
      },
    ],
    [
      "credentialed explicit callback",
      {
        SENDBLUE_STATUS_CALLBACK_URL:
          "https://user:pass@kinfolk.example.com/api/webhooks/sendblue",
      },
    ],
    [
      "private explicit callback",
      {
        SENDBLUE_STATUS_CALLBACK_URL:
          "https://192.168.1.20/api/webhooks/sendblue",
      },
    ],
    [
      "IPv4-mapped private explicit callback",
      {
        SENDBLUE_STATUS_CALLBACK_URL:
          "https://[::ffff:192.168.1.20]/api/webhooks/sendblue",
      },
    ],
    [
      "malformed explicit callback",
      { SENDBLUE_STATUS_CALLBACK_URL: "javascript:alert(1)" },
    ],
  ])("omits unsafe status callback URLs from outbound payloads: %s", async (_, overrides) => {
    const payload = await sendTextAndReadPayload(overrides);

    expect(payload).not.toHaveProperty("status_callback");
  });

  it("uses fallback credentials and sender env values when primary values are blank", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");
    vi.stubEnv("SENDBLUE_API_BASE_URL", "https://api.sendblue.test");
    vi.stubEnv("SENDBLUE_API_KEY_ID", "   ");
    vi.stubEnv("SENDBLUE_API_KEY", " fallback-key ");
    vi.stubEnv("SENDBLUE_API_SECRET_KEY", "   ");
    vi.stubEnv("SENDBLUE_API_SECRET", " fallback-secret ");
    vi.stubEnv("SENDBLUE_FROM_NUMBER", "   ");
    vi.stubEnv("KINFOLK_IMESSAGE_NUMBER", "   ");
    vi.stubEnv("KINFOLK_SMS_NUMBER", "+14155550147");
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({ message_handle: "fallback_text_1", status: "QUEUED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    await sendSendblueMessage({
      idempotencyKey: "sendblue-fallback-1",
      parts: [{ type: "text", value: "Fallback text" }],
      to: "+14155550142",
    });

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls[0]?.[0]).toBe("https://api.sendblue.test/api/send-message");
    expect(calls[0]?.[1]?.headers).toMatchObject({
      "sb-api-key-id": "fallback-key",
      "sb-api-secret-key": "fallback-secret",
    });
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      content: "Fallback text",
      from_number: "+14155550147",
      metadata: { idempotency_key: "sendblue-fallback-1" },
      number: "+14155550142",
      status_callback: "https://kinfolk.example.com/api/webhooks/sendblue",
    });
  });

  it("uses the default API base URL when the configured base URL is blank", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");
    vi.stubEnv("SENDBLUE_API_BASE_URL", "   ");
    vi.stubEnv("SENDBLUE_API_KEY", "key");
    vi.stubEnv("SENDBLUE_API_SECRET", "secret");
    vi.stubEnv("SENDBLUE_FROM_NUMBER", "+14155550147");
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({ message_handle: "default_base_1", status: "QUEUED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    await sendSendblueMessage({
      idempotencyKey: "sendblue-default-base-1",
      parts: [{ type: "text", value: "Default base" }],
      to: "+14155550142",
    });

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls[0]?.[0]).toBe("https://api.sendblue.co/api/send-message");
  });

  it("trims the configured API base URL before sending", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");
    vi.stubEnv("SENDBLUE_API_BASE_URL", " https://api.sendblue.test/ ");
    vi.stubEnv("SENDBLUE_API_KEY", "key");
    vi.stubEnv("SENDBLUE_API_SECRET", "secret");
    vi.stubEnv("SENDBLUE_FROM_NUMBER", "+14155550147");
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({ message_handle: "trimmed_base_1", status: "QUEUED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    await sendSendblueMessage({
      idempotencyKey: "sendblue-trimmed-base-1",
      parts: [{ type: "text", value: "Trimmed base" }],
      to: "+14155550142",
    });

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls[0]?.[0]).toBe("https://api.sendblue.test/api/send-message");
  });

  it("uses fallback webhook secrets when the primary secret is blank", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "   ");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", " fallback-secret ");
    const { getSendblueWebhookSigningSecret } = await loadClient();

    expect(getSendblueWebhookSigningSecret()).toBe("fallback-secret");
  });

  it("splits text plus multi-card media into text and carousel sends", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({ message_handle: "mixed_text_1", status: "QUEUED" }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ message_handle: "mixed_carousel_1", status: "QUEUED" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    await sendSendblueMessage({
      idempotencyKey: "roommate-summary-1",
      parts: [
        { type: "text", value: "Top roommates:\n1. Jack - 55%" },
        { type: "media", url: "https://cards.example.com/1.png" },
        { type: "media", url: "https://cards.example.com/2.png" },
      ],
      to: "+14155550142",
    });

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]?.[0]).toBe("https://api.sendblue.test/api/send-message");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      content: "Top roommates:\n1. Jack - 55%",
      from_number: "+14155550147",
      metadata: { idempotency_key: "roommate-summary-1" },
      number: "+14155550142",
      status_callback: "https://kinfolk.example.com/api/webhooks/sendblue",
    });
    expect(calls[1]?.[0]).toBe("https://api.sendblue.test/api/send-carousel");
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({
      from_number: "+14155550147",
      media_urls: [
        "https://cards.example.com/1.png",
        "https://cards.example.com/2.png",
      ],
      number: "+14155550142",
    });
  });

  it("falls back to sequential media sends when the line cannot carousel", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(
          {
            message: "Carousel messaging is only available on V2 lines",
            status: "ERROR",
          },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ message_handle: "card_msg_1", status: "QUEUED" }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ message_handle: "card_msg_2", status: "QUEUED" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    const result = await sendSendblueMessage({
      idempotencyKey: "listing-carousel-2",
      parts: [
        { type: "media", url: "https://cards.example.com/1.png" },
        { type: "media", url: "https://cards.example.com/2.png" },
      ],
      to: "+14155550142",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls[0]?.[0]).toBe(
      "https://api.sendblue.test/api/send-carousel",
    );
    expect(calls[1]?.[0]).toBe(
      "https://api.sendblue.test/api/send-message",
    );
    expect(calls[2]?.[0]).toBe(
      "https://api.sendblue.test/api/send-message",
    );
    expect(result).toMatchObject({
      messageId: "card_msg_1",
      partMessages: [
        {
          deliveryStatus: "queued",
          mediaUrl: "https://cards.example.com/1.png",
          messageId: "card_msg_1",
        },
        {
          deliveryStatus: "queued",
          mediaUrl: "https://cards.example.com/2.png",
          messageId: "card_msg_2",
        },
      ],
    });
  });

  it("honors a padded disabled carousel fallback flag", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("SENDBLUE_CAROUSEL_FALLBACK", " false ");
    const fetchMock = vi.fn(async () =>
      mockJsonResponse(
        {
          message: "Carousel messaging is only available on V2 lines",
          status: "ERROR",
        },
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSendblueMessage } = await loadClient();

    await expect(
      sendSendblueMessage({
        idempotencyKey: "listing-carousel-disabled-1",
        parts: [
          { type: "media", url: "https://cards.example.com/1.png" },
          { type: "media", url: "https://cards.example.com/2.png" },
        ],
        to: "+14155550142",
      }),
    ).rejects.toThrow("Carousel messaging is only available on V2 lines");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
