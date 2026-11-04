import { describe, expect, it, vi } from "vitest";
import {
  getSendblueDeliveryEvent,
  getSendblueInboundMessage,
  getSendblueReactionEvent,
  getSendblueWebhookRecord,
  parseSendblueTextWebhook,
  verifySendblueWebhookSecret,
} from "./webhooks";

describe("Sendblue webhook helpers", () => {
  it("verifies the dashboard signing secret header", () => {
    const headers = new Headers({ "sb-signing-secret": "test-secret" });

    expect(
      verifySendblueWebhookSecret({ headers, secret: "test-secret" }),
    ).toEqual({ ok: true });
    expect(
      verifySendblueWebhookSecret({ headers, secret: " test-secret " }),
    ).toEqual({ ok: true });
    expect(
      verifySendblueWebhookSecret({ headers, secret: "wrong-secret" }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
    expect(
      verifySendblueWebhookSecret({ headers, secret: "   " }),
    ).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("normalizes inbound messages", () => {
    const payload = {
      accountEmail: "hello@example.com",
      content: "Hello Kinfolk",
      date_sent: "2026-05-23T20:00:00.000Z",
      date_updated: "2026-05-23T20:00:01.000Z",
      from_number: "+14155550142",
      is_outbound: false,
      media_url: "https://cdn.sendblue.co/media/example.jpg",
      message_handle: "msg_inbound_123",
      message_type: "message",
      number: "+14155550142",
      sendblue_number: "+14155550147",
      service: "iMessage",
      status: "RECEIVED",
      to_number: "+14155550147",
    };

    const parsed = parseSendblueTextWebhook(JSON.stringify(payload));

    expect(parsed.event).toMatchObject({
      eventId: "receive:msg_inbound_123",
      eventType: "receive",
      provider: "sendblue",
    });
    expect(parsed.inbound).toMatchObject({
      body: "Hello Kinfolk",
      chat: {
        isGroup: false,
        ownerHandle: "+14155550147",
        participants: [],
      },
      chatId: "sendblue:+14155550147:+14155550142",
      eventId: "receive:msg_inbound_123",
      from: "+14155550142",
      messageId: "msg_inbound_123",
      provider: "sendblue",
      service: "iMessage",
      to: "+14155550147",
    });
    expect(parsed.inbound?.media).toEqual([
      {
        type: "media",
        url: "https://cdn.sendblue.co/media/example.jpg",
      },
    ]);
  });

  it("ignores legacy textual tapbacks without suppressing normal message bodies", () => {
    const basePayload = {
      from_number: "+14155550142",
      is_outbound: false,
      sendblue_number: "+14155550147",
      status: "RECEIVED",
    };
    const tapback = parseSendblueTextWebhook(
      JSON.stringify({
        ...basePayload,
        content: "Loved an image",
        message_handle: "msg_legacy_tapback",
      }),
    );
    const normalMessage = parseSendblueTextWebhook(
      JSON.stringify({
        ...basePayload,
        content: "I loved an image of the apartment",
        message_handle: "msg_normal_loved_image",
      }),
    );

    expect(tapback.event.eventType).toBe("receive");
    expect(tapback.inbound).toBeNull();
    expect(tapback.reaction).toBeNull();
    expect(normalMessage.inbound?.body).toBe(
      "I loved an image of the apartment",
    );
  });

  it("trims inbound provider timestamps before storage handoff", () => {
    const parsed = parseSendblueTextWebhook(
      JSON.stringify({
        content: "Hello with a padded timestamp",
        date_sent: " 2026-05-23T20:00:00.000Z ",
        date_updated: "2026-05-23T20:00:01.000Z",
        from_number: "+14155550142",
        is_outbound: false,
        message_handle: "msg_inbound_padded_timestamp",
        sendblue_number: "+14155550147",
      }),
    );

    expect(parsed.inbound).toMatchObject({
      messageId: "msg_inbound_padded_timestamp",
      receivedAt: "2026-05-23T20:00:00.000Z",
    });
  });

  it("falls back to processing time for invalid inbound provider timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T21:30:00.000Z"));

    try {
      const parsed = parseSendblueTextWebhook(
        JSON.stringify({
          content: "Hello with an invalid timestamp",
          date_sent: "not-a-date",
          date_updated: "also-not-a-date",
          from_number: "+14155550142",
          is_outbound: false,
          message_handle: "msg_inbound_invalid_timestamp",
          sendblue_number: "+14155550147",
        }),
      );

      expect(parsed.inbound).toMatchObject({
        messageId: "msg_inbound_invalid_timestamp",
        receivedAt: "2026-05-23T21:30:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes string boolean inbound message direction", () => {
    const payload = {
      content: "Hello from a string bool",
      date_sent: "2026-05-23T20:00:00.000Z",
      from_number: "+14155550142",
      is_outbound: " FALSE ",
      message_handle: "msg_inbound_string_bool",
      sendblue_number: "+14155550147",
      service: "SMS",
      status: "RECEIVED",
    };

    const parsed = parseSendblueTextWebhook(JSON.stringify(payload));

    expect(parsed.event).toMatchObject({
      eventId: "receive:msg_inbound_string_bool",
      eventType: "receive",
    });
    expect(parsed.inbound).toMatchObject({
      body: "Hello from a string bool",
      chatId: "sendblue:+14155550147:+14155550142",
      messageId: "msg_inbound_string_bool",
      provider: "sendblue",
    });
    expect(parsed.delivery).toBeNull();
  });

  it("normalizes numeric boolean inbound message direction", () => {
    const payload = {
      content: "Hello from a numeric bool",
      date_sent: "2026-05-23T20:00:00.000Z",
      from_number: "+14155550142",
      is_outbound: 0,
      message_handle: "msg_inbound_numeric_bool",
      sendblue_number: "+14155550147",
      service: "SMS",
      status: "RECEIVED",
    };

    const parsed = parseSendblueTextWebhook(JSON.stringify(payload));

    expect(parsed.event).toMatchObject({
      eventId: "receive:msg_inbound_numeric_bool",
      eventType: "receive",
    });
    expect(parsed.inbound).toMatchObject({
      body: "Hello from a numeric bool",
      chatId: "sendblue:+14155550147:+14155550142",
      messageId: "msg_inbound_numeric_bool",
      provider: "sendblue",
    });
    expect(parsed.delivery).toBeNull();
  });

  it("rejects inbound messages with malformed phone handles", () => {
    const payload = {
      content: "Hello from a short phone",
      date_sent: "2026-05-23T20:00:00.000Z",
      from_number: "123456",
      is_outbound: false,
      message_handle: "msg_short_sender",
      sendblue_number: "+14155550147",
      status: "RECEIVED",
    };

    const parsed = parseSendblueTextWebhook(JSON.stringify(payload));

    expect(parsed.event).toMatchObject({
      eventId: "receive:msg_short_sender",
      eventType: "receive",
    });
    expect(parsed.inbound).toBeNull();
  });

  it("ignores empty inbound messages without text or media", () => {
    const parsed = parseSendblueTextWebhook(
      JSON.stringify({
        content: "   ",
        date_sent: "2026-05-23T20:00:00.000Z",
        from_number: "+14155550142",
        is_outbound: false,
        message_handle: "msg_empty_inbound",
        sendblue_number: "+14155550147",
      }),
    );

    expect(parsed.event).toMatchObject({
      eventId: "receive:msg_empty_inbound",
      eventType: "receive",
    });
    expect(parsed.inbound).toBeNull();
  });

  it("accepts media-only inbound messages", () => {
    const parsed = parseSendblueTextWebhook(
      JSON.stringify({
        content: "   ",
        date_sent: "2026-05-23T20:00:00.000Z",
        from_number: "+14155550142",
        is_outbound: false,
        media_url: "https://cdn.sendblue.co/media/only.jpg",
        message_handle: "msg_media_only",
        sendblue_number: "+14155550147",
      }),
    );

    expect(parsed.inbound).toMatchObject({
      body: "",
      chatId: "sendblue:+14155550147:+14155550142",
      media: [
        {
          type: "media",
          url: "https://cdn.sendblue.co/media/only.jpg",
        },
      ],
      messageId: "msg_media_only",
      provider: "sendblue",
    });
  });

  it("accepts plural and nested media-only inbound message fields", () => {
    const parsed = parseSendblueTextWebhook(
      JSON.stringify({
        attachments: [
          { url: "https://cdn.sendblue.co/media/attachment-one.jpg" },
          { media_url: " https://cdn.sendblue.co/media/attachment-two.jpg " },
        ],
        content: "   ",
        date_sent: "2026-05-23T20:00:00.000Z",
        from_number: "+14155550142",
        is_outbound: false,
        media_url: "https://cdn.sendblue.co/media/attachment-one.jpg",
        media_urls: [
          "https://cdn.sendblue.co/media/plural-one.jpg",
          " ",
          { url: "https://cdn.sendblue.co/media/plural-two.jpg" },
        ],
        message_handle: "msg_media_array_only",
        sendblue_number: "+14155550147",
      }),
    );

    expect(parsed.inbound).toMatchObject({
      body: "",
      chatId: "sendblue:+14155550147:+14155550142",
      messageId: "msg_media_array_only",
      provider: "sendblue",
    });
    expect(parsed.inbound?.media).toEqual([
      {
        type: "media",
        url: "https://cdn.sendblue.co/media/attachment-one.jpg",
      },
      {
        type: "media",
        url: "https://cdn.sendblue.co/media/plural-one.jpg",
      },
      {
        type: "media",
        url: "https://cdn.sendblue.co/media/plural-two.jpg",
      },
      {
        type: "media",
        url: "https://cdn.sendblue.co/media/attachment-two.jpg",
      },
    ]);
  });

  it("normalizes outbound delivery callbacks", () => {
    const payload = {
      content: "Hello back",
      date_updated: "2026-05-23T20:01:00.000Z",
      from_number: "+14155550147",
      is_outbound: true,
      message_handle: "msg_outbound_123",
      number: "+14155550142",
      service: "iMessage",
      status: "DELIVERED",
      to_number: "+14155550142",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(event).toMatchObject({
      eventId:
        "outbound:msg_outbound_123:delivered:2026-05-23T20:01:00.000Z",
      eventType: "outbound",
      provider: "sendblue",
    });
    expect(getSendblueInboundMessage(payload, event)).toBeNull();
    expect(getSendblueDeliveryEvent(payload, event)).toMatchObject({
      deliveryStatus: "delivered",
      messageId: "msg_outbound_123",
      provider: "sendblue",
    });
  });

  it("normalizes string boolean outbound delivery callbacks", () => {
    const payload = {
      date_updated: "2026-05-23T20:01:00.000Z",
      is_outbound: " TRUE ",
      message_handle: "msg_outbound_string_bool",
      status: "DELIVERED",
      to_number: "+14155550142",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(event).toMatchObject({
      eventId:
        "outbound:msg_outbound_string_bool:delivered:2026-05-23T20:01:00.000Z",
      eventType: "outbound",
    });
    expect(getSendblueInboundMessage(payload, event)).toBeNull();
    expect(getSendblueDeliveryEvent(payload, event)).toMatchObject({
      deliveryStatus: "delivered",
      messageId: "msg_outbound_string_bool",
    });
  });

  it("normalizes numeric boolean outbound delivery callbacks", () => {
    const payload = {
      date_updated: "2026-05-23T20:01:00.000Z",
      is_outbound: 1,
      message_handle: "msg_outbound_numeric_bool",
      status: "DELIVERED",
      to_number: "+14155550142",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(event).toMatchObject({
      eventId:
        "outbound:msg_outbound_numeric_bool:delivered:2026-05-23T20:01:00.000Z",
      eventType: "outbound",
    });
    expect(getSendblueInboundMessage(payload, event)).toBeNull();
    expect(getSendblueDeliveryEvent(payload, event)).toMatchObject({
      deliveryStatus: "delivered",
      messageId: "msg_outbound_numeric_bool",
    });
  });

  it("ignores outbound delivery callbacks without a delivery status", () => {
    const payload = {
      date_updated: "2026-05-23T20:01:00.000Z",
      is_outbound: true,
      message_handle: "msg_outbound_blank_status",
      status: "   ",
    };
    const parsed = parseSendblueTextWebhook(JSON.stringify(payload));

    expect(parsed.event).toMatchObject({
      eventId: "outbound:msg_outbound_blank_status:2026-05-23T20:01:00.000Z",
      eventType: "outbound",
    });
    expect(parsed.inbound).toBeNull();
    expect(parsed.delivery).toBeNull();
  });

  it("normalizes synthetic event identity tokens before persistence", () => {
    const deliveryPayload = {
      date_updated: "2026-05-23T20:01:00.000Z",
      is_outbound: " TRUE ",
      message_handle: "msg_outbound_case",
      status: " Delivered ",
    };
    const deliveryEvent = getSendblueWebhookRecord(deliveryPayload);

    expect(deliveryEvent).toMatchObject({
      eventId:
        "outbound:msg_outbound_case:delivered:2026-05-23T20:01:00.000Z",
      eventType: "outbound",
    });
    expect(getSendblueDeliveryEvent(deliveryPayload, deliveryEvent)).toMatchObject({
      deliveryStatus: "delivered",
      messageId: "msg_outbound_case",
    });

    expect(
      getSendblueWebhookRecord({
        event_type: " Custom.Event ",
        message_handle: "msg_custom_event",
        status: " SENT ",
      }),
    ).toMatchObject({
      eventId: "custom.event:msg_custom_event:sent",
      eventType: "custom.event",
    });
  });

  it("normalizes explicit inbound reaction webhooks", () => {
    const payload = {
      date_updated: "2026-05-23T20:02:00.000Z",
      event_id: "evt_reaction_123",
      event_type: "reaction.added",
      from_number: "+14155550142",
      is_outbound: false,
      message_handle: "reaction_msg_123",
      part_index: 2,
      reaction: "thumbs_up",
      sendblue_number: "+14155550147",
      service: "iMessage",
      target_message_handle: "carousel_msg_123",
      to_number: "+14155550147",
    };
    const parsed = parseSendblueTextWebhook(JSON.stringify(payload));

    expect(parsed.event).toMatchObject({
      eventId: "evt_reaction_123",
      eventType: "reaction.added",
      provider: "sendblue",
    });
    expect(parsed.inbound).toBeNull();
    expect(parsed.reaction).toMatchObject({
      chatId: "sendblue:+14155550147:+14155550142",
      eventId: "evt_reaction_123",
      from: "+14155550142",
      messageId: "carousel_msg_123",
      partIndex: 2,
      provider: "sendblue",
      reactionType: "like",
      removed: false,
    });
  });

  it("normalizes explicit removed reaction webhooks", () => {
    const payload = {
      event_type: "tapback.removed",
      from_number: "+14155550142",
      message_handle: "carousel_msg_123",
      reaction_type: "love",
      sendblue_number: "+14155550147",
      status: "REMOVED",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(event.eventType).toBe("reaction.removed");
    expect(getSendblueReactionEvent(payload, event)).toMatchObject({
      messageId: "carousel_msg_123",
      reactionType: "love",
      removed: true,
    });
  });

  it("normalizes string boolean removed reaction flags", () => {
    const payload = {
      event_type: "tapback",
      from_number: "+14155550142",
      is_removed: " TRUE ",
      message_handle: "carousel_msg_123",
      reaction_type: "love",
      sendblue_number: "+14155550147",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(event.eventType).toBe("reaction.removed");
    expect(getSendblueReactionEvent(payload, event)).toMatchObject({
      messageId: "carousel_msg_123",
      reactionType: "love",
      removed: true,
    });
  });

  it("normalizes numeric boolean removed reaction flags", () => {
    const payload = {
      event_type: "tapback",
      from_number: "+14155550142",
      is_removed: 1,
      message_handle: "carousel_msg_123",
      reaction_type: "love",
      sendblue_number: "+14155550147",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(event.eventType).toBe("reaction.removed");
    expect(getSendblueReactionEvent(payload, event)).toMatchObject({
      messageId: "carousel_msg_123",
      reactionType: "love",
      removed: true,
    });
  });

  it("does not treat ordinary inbound messages as reactions", () => {
    const payload = {
      content: "I love this listing",
      from_number: "+14155550142",
      is_outbound: false,
      message_handle: "msg_inbound_456",
      sendblue_number: "+14155550147",
      status: "RECEIVED",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(getSendblueReactionEvent(payload, event)).toBeNull();
  });

  it("rejects reactions with malformed sender phone handles", () => {
    const payload = {
      event_type: "reaction.added",
      from_number: "123456",
      message_handle: "reaction_msg_short_sender",
      reaction_type: "love",
      sendblue_number: "+14155550147",
      target_message_handle: "carousel_msg_123",
    };
    const event = getSendblueWebhookRecord(payload);

    expect(getSendblueReactionEvent(payload, event)).toBeNull();
  });
});
