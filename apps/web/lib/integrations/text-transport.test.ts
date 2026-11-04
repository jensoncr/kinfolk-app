import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActiveTextTransportProvider,
  parseTextWebhookPayload,
  sendTextMessage,
  sendTextText,
} from "./text-transport";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("text transport", () => {
  it("uses the first nonblank transport env and normalizes provider casing", () => {
    vi.stubEnv("KINFOLK_TEXT_TRANSPORT", "   ");
    vi.stubEnv("KINFOLK_SMS_TRANSPORT", " SendBlue ");

    expect(getActiveTextTransportProvider()).toBe("sendblue");

    vi.stubEnv("KINFOLK_TEXT_TRANSPORT", " LINQ ");
    vi.stubEnv("KINFOLK_SMS_TRANSPORT", "sendblue");

    expect(getActiveTextTransportProvider()).toBe("linq");
  });

  it("honors padded dry-run flags without contacting a carrier", async () => {
    vi.stubEnv("KINFOLK_TEXT_TRANSPORT_DRY_RUN", " TRUE ");
    vi.stubEnv("LINQ_API_KEY", "");
    vi.stubEnv("LINQ_API_V3_API_KEY", "");

    await expect(
      sendTextText({
        body: "hello",
        idempotencyKey: "text-transport-dry-run",
        provider: "linq",
        to: "+14155550142",
      }),
    ).resolves.toMatchObject({
      deliveryStatus: "dry_run",
      messageId: "dry-run:text-transport-dry-run",
      service: "dry_run",
    });
  });

  it("dry-runs formatted reserved test numbers before carrier normalization", async () => {
    vi.stubEnv("KINFOLK_TEXT_TRANSPORT_DRY_RUN", "");
    vi.stubEnv("LINQ_API_KEY", "");
    vi.stubEnv("LINQ_API_V3_API_KEY", "");
    vi.stubEnv("SENDBLUE_API_KEY", "");
    vi.stubEnv("SENDBLUE_API_SECRET", "");

    await expect(
      sendTextMessage({
        idempotencyKey: "formatted-reserved-number",
        parts: [{ type: "text", value: "hello" }],
        provider: "sendblue",
        to: "+1 (317) 555-0100",
      }),
    ).resolves.toMatchObject({
      deliveryStatus: "dry_run",
      messageId: "dry-run:formatted-reserved-number",
      service: "dry_run",
    });
  });

  it("normalizes only Linq message lifecycle webhooks as delivery events", () => {
    expect(
      parseTextWebhookPayload({
        provider: "linq",
        rawBody: JSON.stringify({
          data: { id: "linq-message-1" },
          event_id: "evt-delivered",
          event_type: "message.delivered",
          trace_id: "trace-delivered",
        }),
      }).delivery,
    ).toMatchObject({
      deliveryStatus: "delivered",
      eventId: "evt-delivered",
      messageId: "linq-message-1",
      provider: "linq",
      traceId: "trace-delivered",
    });

    const chatCreated = parseTextWebhookPayload({
      provider: "linq",
      rawBody: JSON.stringify({
        data: { id: "chat-1" },
        event_id: "evt-chat-created",
        event_type: "chat.created",
      }),
    });

    expect(chatCreated.event).toMatchObject({
      eventId: "evt-chat-created",
      eventType: "chat.created",
      provider: "linq",
    });
    expect(chatCreated.delivery).toBeNull();
  });

  it("normalizes padded Linq delivery event types before routing", () => {
    const parsed = parseTextWebhookPayload({
      provider: "linq",
      rawBody: JSON.stringify({
        data: { id: "linq-message-delivery" },
        event_id: " evt-delivery-case ",
        event_type: " Message.Delivered ",
        trace_id: " trace-delivery-case ",
      }),
    });

    expect(parsed.event).toMatchObject({
      eventId: "evt-delivery-case",
      eventType: "message.delivered",
      provider: "linq",
    });
    expect(parsed.delivery).toMatchObject({
      deliveryStatus: "delivered",
      eventId: "evt-delivery-case",
      messageId: "linq-message-delivery",
      provider: "linq",
      traceId: "trace-delivery-case",
    });
  });

  it("normalizes padded Linq delivery message ids before updates", () => {
    const parsed = parseTextWebhookPayload({
      provider: "linq",
      rawBody: JSON.stringify({
        data: { id: " linq-message-padded " },
        event_id: "evt-delivery-padded-message",
        event_type: "message.delivered",
      }),
    });

    expect(parsed.delivery).toMatchObject({
      deliveryStatus: "delivered",
      messageId: "linq-message-padded",
      provider: "linq",
    });
  });

  it("normalizes padded Linq inbound direction before message parsing", () => {
    const parsed = parseTextWebhookPayload({
      provider: "linq",
      rawBody: JSON.stringify({
        created_at: "2026-05-16T20:00:00.000Z",
        data: {
          chat: {
            id: "chat-direction",
            owner_handle: { handle: "+14155550186" },
          },
          direction: " INBOUND ",
          id: "msg-direction",
          parts: [{ type: "text", value: "hello from Linq" }],
          sender_handle: { handle: "+14155550142" },
        },
        event_id: "evt-direction",
        event_type: "message.received",
      }),
    });

    expect(parsed.inbound).toMatchObject({
      body: "hello from Linq",
      chatId: "chat-direction",
      eventId: "evt-direction",
      from: "+14155550142",
      messageId: "msg-direction",
      provider: "linq",
      to: "+14155550186",
    });
  });

  it("rejects blank Linq event ids before webhook storage", () => {
    const parsed = parseTextWebhookPayload({
      provider: "linq",
      rawBody: JSON.stringify({
        data: { id: "linq-message-no-event-id" },
        event_id: "   ",
        event_type: "message.delivered",
      }),
    });

    expect(parsed.event).toMatchObject({
      eventId: "",
      eventType: "message.delivered",
      provider: "linq",
    });
    expect(parsed.delivery).toBeNull();
  });
});
