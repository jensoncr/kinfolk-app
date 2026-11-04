import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLinqWebhookSigningSecret,
  isLinqTextAgentEnabled,
  sendLinqMessage,
  startLinqTyping,
} from "./client";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  sdkConstructor: vi.fn(),
  typingStart: vi.fn(),
}));

vi.mock("@linqapp/sdk", () => ({
  default: vi.fn(function LinqAPIV3(config: unknown) {
    mocks.sdkConstructor(config);
    return {
      chats: {
        create: mocks.create,
        messages: {
          send: mocks.send,
        },
        typing: {
          start: mocks.typingStart,
        },
      },
    };
  }),
}));

const env = {
  LINQ_API_KEY: "linq-key",
  LINQ_FROM_NUMBER: "+14155550147",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Linq client", () => {
  it("honors padded false SMS agent enablement config", () => {
    vi.stubEnv("LINQ_FROM_NUMBER", "+14155550147");
    vi.stubEnv("KINFOLK_SMS_AGENT_ENABLED", " FALSE ");

    expect(isLinqTextAgentEnabled()).toBe(false);

    vi.stubEnv("KINFOLK_SMS_AGENT_ENABLED", " true ");

    expect(isLinqTextAgentEnabled()).toBe(true);
  });

  it("sends text plus card media into an existing chat with stable part refs", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const parts = [
      { type: "text" as const, value: "Top matches:\n1. 681 Florida St" },
      {
        type: "media" as const,
        url: "https://kinfolk.test/api/listing-card/rec-1?expires=1&token=t1",
      },
      {
        type: "media" as const,
        url: "https://kinfolk.test/api/profile-card/notification-1?expires=1&token=t2",
      },
    ];
    mocks.send.mockResolvedValueOnce({
      chat_id: "chat-1",
      message: {
        delivery_status: "queued",
        id: "linq-message-1",
        preferred_service: "iMessage",
        service: null,
      },
    });

    const result = await sendLinqMessage({
      chatId: "chat-1",
      idempotencyKey: "kinfolk:source-1:agent_reply",
      parts,
      to: "+14155550142",
    });

    expect(mocks.sdkConstructor).toHaveBeenCalledWith({ apiKey: "linq-key" });
    expect(mocks.send).toHaveBeenCalledWith(
      "chat-1",
      {
        message: {
          idempotency_key: "kinfolk:source-1:agent_reply",
          parts,
        },
      },
      { idempotencyKey: "kinfolk:source-1:agent_reply" },
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      chatId: "chat-1",
      deliveryStatus: "queued",
      messageId: "linq-message-1",
      partRefs: [
        {
          mediaUrl: null,
          messageId: "linq-message-1",
          partIndex: 0,
          service: "iMessage",
        },
        {
          mediaUrl: "https://kinfolk.test/api/listing-card/rec-1?expires=1&token=t1",
          messageId: "linq-message-1",
          partIndex: 1,
          service: "iMessage",
        },
        {
          mediaUrl: "https://kinfolk.test/api/profile-card/notification-1?expires=1&token=t2",
          messageId: "linq-message-1",
          partIndex: 2,
          service: "iMessage",
        },
      ],
      service: "iMessage",
    });
  });

  it("creates a new chat for first-contact card delivery", async () => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const parts = [
      {
        type: "media" as const,
        url: "https://kinfolk.test/api/roommate-card?expires=1&token=t3",
      },
    ];
    mocks.create.mockResolvedValueOnce({
      chat: {
        id: "chat-new",
        message: {
          delivery_status: "queued",
          id: "linq-message-new",
        },
        service: "SMS",
      },
    });

    const result = await sendLinqMessage({
      idempotencyKey: "kinfolk:first-contact:agent_reply",
      parts,
      to: "+14155550142",
    });

    expect(mocks.create).toHaveBeenCalledWith(
      {
        from: "+14155550147",
        message: {
          idempotency_key: "kinfolk:first-contact:agent_reply",
          parts,
        },
        to: ["+14155550142"],
      },
      { idempotencyKey: "kinfolk:first-contact:agent_reply" },
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result).toEqual({
      chatId: "chat-new",
      deliveryStatus: "queued",
      messageId: "linq-message-new",
      partRefs: [
        {
          mediaUrl: "https://kinfolk.test/api/roommate-card?expires=1&token=t3",
          messageId: "linq-message-new",
          partIndex: 0,
          service: "SMS",
        },
      ],
      service: "SMS",
    });
  });

  it("uses fallback API key and sender env values when primary values are blank", async () => {
    vi.stubEnv("LINQ_API_KEY", "   ");
    vi.stubEnv("LINQ_API_V3_API_KEY", " fallback-linq-key ");
    vi.stubEnv("LINQ_FROM_NUMBER", "   ");
    vi.stubEnv("KINFOLK_SMS_NUMBER", "+14155550147");
    const parts = [{ type: "text" as const, value: "Fallback send" }];
    mocks.create.mockResolvedValueOnce({
      chat: {
        id: "chat-fallback",
        message: {
          delivery_status: "queued",
          id: "linq-message-fallback",
        },
        service: "SMS",
      },
    });

    await sendLinqMessage({
      idempotencyKey: "kinfolk:fallback:agent_reply",
      parts,
      to: "+14155550142",
    });

    expect(mocks.sdkConstructor).toHaveBeenCalledWith({
      apiKey: "fallback-linq-key",
    });
    expect(mocks.create).toHaveBeenCalledWith(
      {
        from: "+14155550147",
        message: {
          idempotency_key: "kinfolk:fallback:agent_reply",
          parts,
        },
        to: ["+14155550142"],
      },
      { idempotencyKey: "kinfolk:fallback:agent_reply" },
    );
  });

  it("uses the fallback API key for typing when the primary key is blank", async () => {
    vi.stubEnv("LINQ_API_KEY", "   ");
    vi.stubEnv("LINQ_API_V3_API_KEY", " fallback-linq-key ");

    await startLinqTyping("chat-typing");

    expect(mocks.sdkConstructor).toHaveBeenCalledWith({
      apiKey: "fallback-linq-key",
    });
    expect(mocks.typingStart).toHaveBeenCalledWith("chat-typing");
  });

  it("trims webhook signing secret config", () => {
    vi.stubEnv("LINQ_WEBHOOK_SIGNING_SECRET", " linq-secret ");

    expect(getLinqWebhookSigningSecret()).toBe("linq-secret");
  });

  it("skips typing when the Linq API key or chat id is missing", async () => {
    vi.stubEnv("LINQ_API_KEY", "linq-key");

    await startLinqTyping(null);

    expect(mocks.typingStart).not.toHaveBeenCalled();
    expect(mocks.sdkConstructor).not.toHaveBeenCalled();
  });
});
