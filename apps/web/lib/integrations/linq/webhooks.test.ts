import { describe, expect, it, vi } from "vitest";
import {
  computeLinqWebhookSignature,
  getLinqInboundMessage,
  getLinqReactionEvent,
  verifyLinqWebhookSignature,
} from "./webhooks";

describe("Linq webhook helpers", () => {
  it("verifies a valid HMAC signature", () => {
    const payload = JSON.stringify({ event_id: "evt_1", event_type: "message.received" });
    const timestamp = "1778880000";
    const signature = computeLinqWebhookSignature({
      payload,
      secret: "secret",
      timestamp,
    });

    expect(
      verifyLinqWebhookSignature({
        nowMs: 1778880000 * 1000,
        payload,
        secret: " secret ",
        signature,
        timestamp,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects stale timestamps and signature mismatches", () => {
    const payload = "{}";
    const timestamp = "1778880000";
    const signature = computeLinqWebhookSignature({
      payload,
      secret: "secret",
      timestamp,
    });

    expect(
      verifyLinqWebhookSignature({
        nowMs: (1778880000 + 301) * 1000,
        payload,
        secret: "secret",
        signature,
        timestamp,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });

    expect(
      verifyLinqWebhookSignature({
        nowMs: 1778880000 * 1000,
        payload,
        secret: "secret",
        signature: "0".repeat(64),
        timestamp,
      }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("normalizes message.received payloads into inbound messages", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_1",
      event_type: "message.received",
      trace_id: "trace_1",
      data: {
        id: "msg_1",
        chat: {
          id: "chat_1",
          is_group: true,
          owner_handle: { handle: "+14155550186" },
          participants: [
            { handle: "+14155550186", is_me: true, service: "iMessage" },
            { handle: "(415) 555-0142", is_me: false, service: "iMessage" },
          ],
        },
        direction: "inbound",
        parts: [
          { type: "text", value: "KIN VERIFY ABC123" },
          { type: "media", url: "https://cdn.example.com/image.jpg", content_type: "image/jpeg" },
        ],
        sender_handle: { handle: "(415) 555-0142" },
        service: "iMessage",
      },
    });

    expect(inbound).toMatchObject({
      body: "KIN VERIFY ABC123",
      chat: {
        isGroup: true,
        ownerHandle: "+14155550186",
        participants: [
          { handle: "+14155550186", isMe: true, service: "iMessage" },
          { handle: "+4155550142", isMe: false, service: "iMessage" },
        ],
      },
      chatId: "chat_1",
      eventId: "evt_1",
      from: "+4155550142",
      media: [
        {
          attachment_id: null,
          content_type: "image/jpeg",
          name: null,
          size: null,
          type: "media",
          url: "https://cdn.example.com/image.jpg",
        },
      ],
      messageId: "msg_1",
      to: "+14155550186",
      traceId: "trace_1",
    });
  });

  it("normalizes string boolean chat metadata from message.received payloads", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_string_bools",
      event_type: "message.received",
      data: {
        id: "msg_string_bools",
        chat: {
          id: "chat_string_bools",
          is_group: " TRUE ",
          owner_handle: { handle: "+14155550186" },
          participants: [
            { handle: "+14155550186", is_me: " true ", service: "iMessage" },
            { handle: "+14155550142", is_me: " FALSE ", service: "SMS" },
          ],
        },
        direction: "inbound",
        parts: [{ type: "text", value: "Can my group see this place?" }],
        sender_handle: { handle: "+14155550142" },
        service: "iMessage",
      },
    });

    expect(inbound?.chat).toEqual({
      isGroup: true,
      ownerHandle: "+14155550186",
      participants: [
        { handle: "+14155550186", isMe: true, service: "iMessage" },
        { handle: "+14155550142", isMe: false, service: "SMS" },
      ],
    });
  });

  it("normalizes numeric boolean chat metadata from message.received payloads", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_numeric_bools",
      event_type: "message.received",
      data: {
        id: "msg_numeric_bools",
        chat: {
          id: "chat_numeric_bools",
          is_group: 1,
          owner_handle: { handle: "+14155550186" },
          participants: [
            { handle: "+14155550186", is_me: "1", service: "iMessage" },
            { handle: "+14155550142", is_me: 0, service: "SMS" },
          ],
        },
        direction: "inbound",
        parts: [{ type: "text", value: "Can numeric bools route?" }],
        sender_handle: { handle: "+14155550142" },
        service: "iMessage",
      },
    });

    expect(inbound?.chat).toEqual({
      isGroup: true,
      ownerHandle: "+14155550186",
      participants: [
        { handle: "+14155550186", isMe: true, service: "iMessage" },
        { handle: "+14155550142", isMe: false, service: "SMS" },
      ],
    });
  });

  it("normalizes padded inbound direction values before accepting messages", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_direction",
      event_type: "message.received",
      data: {
        id: "msg_direction",
        chat: {
          id: "chat_direction",
          owner_handle: { handle: "+14155550186" },
        },
        direction: " INBOUND ",
        parts: [{ type: "text", value: "Still inbound" }],
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(inbound).toMatchObject({
      body: "Still inbound",
      chatId: "chat_direction",
      eventId: "evt_direction",
      from: "+14155550142",
      messageId: "msg_direction",
      to: "+14155550186",
    });
  });

  it("trims Linq inbound created_at before using it as the received timestamp", () => {
    const inbound = getLinqInboundMessage({
      created_at: " 2026-05-16T20:00:00.000Z ",
      event_id: "evt_created_at",
      event_type: "message.received",
      data: {
        id: "msg_created_at",
        chat: {
          id: "chat_created_at",
          owner_handle: { handle: "+14155550186" },
        },
        direction: "inbound",
        parts: [{ type: "text", value: "Timestamp should trim" }],
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(inbound).toMatchObject({
      body: "Timestamp should trim",
      receivedAt: "2026-05-16T20:00:00.000Z",
    });
  });

  it("falls back to processing time for invalid Linq inbound created_at values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T21:30:00.000Z"));

    try {
      const inbound = getLinqInboundMessage({
        created_at: "not-a-date",
        event_id: "evt_invalid_created_at",
        event_type: "message.received",
        data: {
          id: "msg_invalid_created_at",
          chat: {
            id: "chat_invalid_created_at",
            owner_handle: { handle: "+14155550186" },
          },
          direction: "inbound",
          parts: [{ type: "text", value: "Timestamp should fall back" }],
          sender_handle: { handle: "+14155550142" },
        },
      });

      expect(inbound).toMatchObject({
        body: "Timestamp should fall back",
        receivedAt: "2026-05-16T21:30:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes padded event type values before accepting inbound messages", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_event_type",
      event_type: " MESSAGE.RECEIVED ",
      data: {
        id: "msg_event_type",
        chat: {
          id: "chat_event_type",
          owner_handle: { handle: "+14155550186" },
        },
        direction: "inbound",
        parts: [{ type: "text", value: "Event type drift" }],
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(inbound).toMatchObject({
      body: "Event type drift",
      chatId: "chat_event_type",
      eventId: "evt_event_type",
      from: "+14155550142",
      messageId: "msg_event_type",
      to: "+14155550186",
    });
  });

  it("normalizes padded event and trace ids before accepting inbound messages", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: " evt_padded_id ",
      event_type: "message.received",
      trace_id: " trace_padded ",
      data: {
        id: "msg_event_id",
        chat: {
          id: "chat_event_id",
          owner_handle: { handle: "+14155550186" },
        },
        direction: "inbound",
        parts: [{ type: "text", value: "Event id drift" }],
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(inbound).toMatchObject({
      body: "Event id drift",
      eventId: "evt_padded_id",
      traceId: "trace_padded",
    });
  });

  it("normalizes padded chat and message ids before accepting inbound messages", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_nested_ids",
      event_type: "message.received",
      data: {
        id: " msg_nested_id ",
        chat: {
          id: " chat_nested_id ",
          owner_handle: { handle: "+14155550186" },
        },
        direction: "inbound",
        parts: [{ type: "text", value: "Nested id drift" }],
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(inbound).toMatchObject({
      body: "Nested id drift",
      chatId: "chat_nested_id",
      messageId: "msg_nested_id",
    });
  });

  it("rejects blank Linq event ids before accepting inbound messages", () => {
    expect(
      getLinqInboundMessage({
        created_at: "2026-05-16T20:00:00.000Z",
        event_id: "   ",
        event_type: "message.received",
        data: {
          id: "msg_blank_event_id",
          chat: {
            id: "chat_blank_event_id",
            owner_handle: { handle: "+14155550186" },
          },
          direction: "inbound",
          parts: [{ type: "text", value: "Missing event id" }],
          sender_handle: { handle: "+14155550142" },
        },
      }),
    ).toBeNull();
  });

  it("rejects inbound messages with malformed phone handles", () => {
    expect(
      getLinqInboundMessage({
        created_at: "2026-05-16T20:00:00.000Z",
        event_id: "evt_short_sender",
        event_type: "message.received",
        data: {
          id: "msg_short_sender",
          chat: {
            id: "chat_short_sender",
            owner_handle: { handle: "+14155550186" },
          },
          direction: "inbound",
          parts: [{ type: "text", value: "Short sender" }],
          sender_handle: { handle: "123456" },
        },
      }),
    ).toBeNull();
  });

  it("ignores empty inbound messages without text or media", () => {
    expect(
      getLinqInboundMessage({
        created_at: "2026-05-16T20:00:00.000Z",
        event_id: "evt_empty_inbound",
        event_type: "message.received",
        data: {
          id: "msg_empty_inbound",
          chat: {
            id: "chat_empty_inbound",
            owner_handle: { handle: "+14155550186" },
          },
          direction: "inbound",
          parts: [{ type: "text", value: "   " }],
          sender_handle: { handle: "+14155550142" },
        },
      }),
    ).toBeNull();
  });

  it("accepts media-only inbound messages", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_media_only",
      event_type: "message.received",
      data: {
        id: "msg_media_only",
        chat: {
          id: "chat_media_only",
          owner_handle: { handle: "+14155550186" },
        },
        direction: "inbound",
        parts: [{ type: "media", url: "https://cdn.example.com/photo.jpg" }],
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(inbound).toMatchObject({
      body: "",
      chatId: "chat_media_only",
      eventId: "evt_media_only",
      media: [
        {
          type: "media",
          url: "https://cdn.example.com/photo.jpg",
        },
      ],
      messageId: "msg_media_only",
    });
  });

  it("dedupes repeated Linq inbound media parts after trimming URLs", () => {
    const inbound = getLinqInboundMessage({
      created_at: "2026-05-16T20:00:00.000Z",
      event_id: "evt_duplicate_media",
      event_type: "message.received",
      data: {
        id: "msg_duplicate_media",
        chat: {
          id: "chat_duplicate_media",
          owner_handle: { handle: "+14155550186" },
        },
        direction: "inbound",
        parts: [
          { type: "media", url: " https://cdn.example.com/photo.jpg " },
          { type: "link", value: "https://cdn.example.com/photo.jpg" },
          { type: "media", url: "https://cdn.example.com/second.jpg" },
        ],
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(inbound?.media).toEqual([
      {
        attachment_id: null,
        content_type: null,
        name: null,
        size: null,
        type: "media",
        url: "https://cdn.example.com/photo.jpg",
      },
      {
        attachment_id: null,
        content_type: null,
        name: null,
        size: null,
        type: "media",
        url: "https://cdn.example.com/second.jpg",
      },
    ]);
  });

  it("normalizes reaction payloads for listing feedback", () => {
    const reaction = getLinqReactionEvent({
      event_id: "evt_reaction_1",
      event_type: "reaction.added",
      trace_id: "trace_reaction_1",
      data: {
        chat: { id: "chat_1" },
        message_id: "msg_listing_1",
        part_index: " 1 ",
        reaction_type: "like",
        sender_handle: { handle: "+1 (415) 555-0142" },
      },
    });

    expect(reaction).toMatchObject({
      chatId: "chat_1",
      eventId: "evt_reaction_1",
      from: "+14155550142",
      messageId: "msg_listing_1",
      partIndex: 1,
      reactionType: "like",
      removed: false,
      traceId: "trace_reaction_1",
    });
  });

  it("normalizes padded and aliased reaction types before listing feedback", () => {
    const paddedReaction = getLinqReactionEvent({
      event_id: "evt_reaction_padded_type",
      event_type: "reaction.added",
      data: {
        chat: { id: "chat_1" },
        message_id: "msg_listing_1",
        reaction_type: " LIKE ",
        sender_handle: { handle: "+14155550142" },
      },
    });
    const aliasedReaction = getLinqReactionEvent({
      event_id: "evt_reaction_alias_type",
      event_type: "reaction.added",
      data: {
        chat: { id: "chat_1" },
        message_id: "msg_listing_2",
        reaction_type: " thumbs-up ",
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(paddedReaction).toMatchObject({
      messageId: "msg_listing_1",
      reactionType: "like",
    });
    expect(aliasedReaction).toMatchObject({
      messageId: "msg_listing_2",
      reactionType: "like",
    });
  });

  it("rejects unsupported Linq reaction types before listing feedback", () => {
    expect(
      getLinqReactionEvent({
        event_id: "evt_reaction_unsupported_type",
        event_type: "reaction.added",
        data: {
          chat: { id: "chat_1" },
          message_id: "msg_listing_1",
          reaction_type: "sparkles",
          sender_handle: { handle: "+14155550142" },
        },
      }),
    ).toBeNull();
  });

  it("normalizes padded reaction event types before removal routing", () => {
    const reaction = getLinqReactionEvent({
      event_id: "evt_reaction_removed",
      event_type: " Reaction.Removed ",
      data: {
        chat: { id: "chat_1" },
        message_id: "msg_listing_1",
        part_index: "0",
        reaction_type: "like",
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(reaction).toMatchObject({
      chatId: "chat_1",
      eventId: "evt_reaction_removed",
      from: "+14155550142",
      messageId: "msg_listing_1",
      partIndex: 0,
      reactionType: "like",
      removed: true,
    });
  });

  it("normalizes padded reaction event and trace ids before routing", () => {
    const reaction = getLinqReactionEvent({
      event_id: " evt_reaction_padded ",
      event_type: " Reaction.Removed ",
      trace_id: " trace_reaction_padded ",
      data: {
        chat: { id: "chat_1" },
        message_id: "msg_listing_1",
        part_index: "0",
        reaction_type: "like",
        sender_handle: { handle: "+14155550142" },
      },
    });

    expect(reaction).toMatchObject({
      eventId: "evt_reaction_padded",
      traceId: "trace_reaction_padded",
    });
  });

  it("rejects reactions with malformed sender phone handles", () => {
    expect(
      getLinqReactionEvent({
        event_id: "evt_reaction_short_sender",
        event_type: "reaction.added",
        data: {
          chat: { id: "chat_1" },
          message_id: "msg_listing_1",
          reaction_type: "like",
          sender_handle: { handle: "123456" },
        },
      }),
    ).toBeNull();
  });
});
