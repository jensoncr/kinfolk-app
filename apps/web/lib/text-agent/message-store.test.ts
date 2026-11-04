import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/text-transport", () => ({
  getTextTransportDisplayName: (p: string) => p,
}));

import {
  findInboundMessageByProviderMessageId,
  hasNonFailedTextAgentRunForMessage,
  recordInboundMessage,
  recordWebhookEvent,
  updateMessageDeliveryFromWebhook,
} from "./message-store";

const event = {
  eventId: "evt-1",
  eventType: "receive",
  provider: "sendblue",
  raw: {},
  traceId: null,
} as Parameters<typeof recordWebhookEvent>[1];

/**
 * Builds a minimal Supabase fluent-builder fake.
 *
 * The fake supports three call shapes used by recordWebhookEvent:
 *   - .from(table).insert(row)             → awaitable → { error }
 *   - .from(table).select(cols).eq().eq().maybeSingle() → { data, error }
 *   - .from(table).update(row).eq().eq()   → awaitable → { error }
 *
 * Pass `insertError`, `existingData`, `existingError`, and `updateError` to
 * control each call's outcome independently. Track whether update was called
 * via the returned `updateCalled` ref.
 */
function makeSupabase({
  insertError = null,
  existingData = null as { status: string; updated_at: string } | null,
  existingError = null,
  updateError = null,
}: {
  insertError?: { code: string } | null;
  existingData?: { status: string; updated_at: string } | null;
  existingError?: unknown;
  updateError?: unknown;
}) {
  let updateCalled = false;

  const builder = {
    _terminal: null as unknown,
    insert: (row: unknown) => {
      void row;
      builder._terminal = Promise.resolve({ error: insertError });
      return builder;
    },
    select: (cols: string) => {
      void cols;
      return builder;
    },
    update: (row: unknown) => {
      void row;
      updateCalled = true;
      builder._terminal = Promise.resolve({ error: updateError });
      return builder;
    },
    eq: (col: string, val: unknown) => {
      void col;
      void val;
      return builder;
    },
    maybeSingle: () =>
      Promise.resolve({ data: existingData, error: existingError }),
    then: (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => (builder._terminal as Promise<unknown>).then(onFulfilled, onRejected),
  };

  const client = {
    from: (table: string) => {
      void table;
      return builder;
    },
    _wasUpdateCalled: () => updateCalled,
  };

  return client;
}

describe("recordWebhookEvent dedupe contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fresh insert → { duplicate: false }", async () => {
    const client = makeSupabase({ insertError: null });
    const result = await recordWebhookEvent(client as unknown as Parameters<typeof recordWebhookEvent>[0], event);
    expect(result).toEqual({ duplicate: false });
    expect(client._wasUpdateCalled()).toBe(false);
  });

  it("23505 + status 'processed' → { duplicate: true }; update not called", async () => {
    const client = makeSupabase({
      insertError: { code: "23505" },
      existingData: { status: "processed", updated_at: new Date().toISOString() },
    });
    const result = await recordWebhookEvent(client as unknown as Parameters<typeof recordWebhookEvent>[0], event);
    expect(result).toEqual({ duplicate: true });
    expect(client._wasUpdateCalled()).toBe(false);
  });

  it("23505 + STALE 'processing' (10 min old) → re-claims, { duplicate: false }; update called", async () => {
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const client = makeSupabase({
      insertError: { code: "23505" },
      existingData: { status: "processing", updated_at: staleTimestamp },
      updateError: null,
    });
    const result = await recordWebhookEvent(client as unknown as Parameters<typeof recordWebhookEvent>[0], event);
    expect(result).toEqual({ duplicate: false });
    expect(client._wasUpdateCalled()).toBe(true);
  });

  it("23505 + FRESH 'processing' (now) → { duplicate: true }; update not called", async () => {
    const client = makeSupabase({
      insertError: { code: "23505" },
      existingData: { status: "processing", updated_at: new Date().toISOString() },
    });
    const result = await recordWebhookEvent(client as unknown as Parameters<typeof recordWebhookEvent>[0], event);
    expect(result).toEqual({ duplicate: true });
    expect(client._wasUpdateCalled()).toBe(false);
  });
});

function makeInboundMessageSupabase({
  existingData = null as Record<string, unknown> | null,
  existingError = null,
  insertData = null as Record<string, unknown> | null,
  insertError = null,
}: {
  existingData?: Record<string, unknown> | null;
  existingError?: unknown;
  insertData?: Record<string, unknown> | null;
  insertError?: unknown;
}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let singleCount = 0;

  const builder = {
    eq: (col: string, val: unknown) => {
      calls.push({ method: "eq", args: [col, val] });
      return builder;
    },
    insert: (row: unknown) => {
      calls.push({ method: "insert", args: [row] });
      return builder;
    },
    limit: (count: number) => {
      calls.push({ method: "limit", args: [count] });
      return builder;
    },
    maybeSingle: () => {
      calls.push({ method: "maybeSingle", args: [] });
      return Promise.resolve({ data: existingData, error: existingError });
    },
    order: (col: string, options: unknown) => {
      calls.push({ method: "order", args: [col, options] });
      return builder;
    },
    select: (cols: string) => {
      calls.push({ method: "select", args: [cols] });
      return builder;
    },
    single: () => {
      singleCount += 1;
      return Promise.resolve(
        singleCount === 1
          ? { data: insertData, error: insertError }
          : { data: existingData, error: existingError },
      );
    },
  };

  return {
    calls,
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
  };
}

const inboundMessage = {
  body: "Hello Kinfolk",
  chat: null,
  chatId: "sendblue:+14155550147:+14155550142",
  eventId: "receive:msg_inbound_123",
  from: "+14155550142",
  media: [],
  messageId: "msg_inbound_123",
  provider: "sendblue",
  raw: { message_handle: "msg_inbound_123" },
  receivedAt: "2026-05-23T20:00:00.000Z",
  service: "iMessage",
  to: "+14155550147",
  traceId: null,
} as Parameters<typeof recordInboundMessage>[1];

describe("recordInboundMessage", () => {
  it("returns the existing inbound message when the provider event insert is a duplicate", async () => {
    const existingMessage = {
      id: "message-1",
      provider: "sendblue",
      provider_event_id: "receive:msg_inbound_123",
    };
    const client = makeInboundMessageSupabase({
      existingData: existingMessage,
      insertError: { code: "23505" },
    });

    const result = await recordInboundMessage(
      client as unknown as Parameters<typeof recordInboundMessage>[0],
      inboundMessage,
      "thread-1",
      "user-1",
      "phone-1",
    );

    expect(result).toEqual(existingMessage);
    expect(client.calls).toEqual([
      { method: "from", args: ["text_messages"] },
      {
        method: "insert",
        args: [
          expect.objectContaining({
            direction: "inbound",
            provider: "sendblue",
            provider_event_id: "receive:msg_inbound_123",
            provider_message_id: "msg_inbound_123",
            thread_id: "thread-1",
            user_id: "user-1",
          }),
        ],
      },
      { method: "select", args: ["*"] },
      { method: "from", args: ["text_messages"] },
      { method: "select", args: ["*"] },
      { method: "eq", args: ["provider", "sendblue"] },
      { method: "eq", args: ["provider_event_id", "receive:msg_inbound_123"] },
    ]);
  });
});

describe("findInboundMessageByProviderMessageId", () => {
  it("looks up the latest inbound message by provider, message id, and chat", async () => {
    const existingMessage = {
      id: "message-1",
      provider: "sendblue",
      provider_chat_id: "sendblue:+14155550147:+14155550142",
      provider_message_id: "msg_inbound_123",
    };
    const client = makeInboundMessageSupabase({
      existingData: existingMessage,
    });

    const result = await findInboundMessageByProviderMessageId(
      client as unknown as Parameters<typeof findInboundMessageByProviderMessageId>[0],
      inboundMessage,
    );

    expect(result).toEqual(existingMessage);
    expect(client.calls).toEqual([
      { method: "from", args: ["text_messages"] },
      { method: "select", args: ["*"] },
      { method: "eq", args: ["provider", "sendblue"] },
      { method: "eq", args: ["provider_message_id", "msg_inbound_123"] },
      {
        method: "eq",
        args: ["provider_chat_id", "sendblue:+14155550147:+14155550142"],
      },
      { method: "eq", args: ["direction", "inbound"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [1] },
      { method: "maybeSingle", args: [] },
    ]);
  });
});

describe("hasNonFailedTextAgentRunForMessage", () => {
  it.each([
    ["queued", true],
    ["running", true],
    ["completed", true],
    ["ignored", true],
    ["failed", false],
  ])("returns %s run duplicate status as %s", async (runStatus, expected) => {
    const client = makeInboundMessageSupabase({
      existingData: { id: "run-1", run_status: runStatus },
    });

    await expect(
      hasNonFailedTextAgentRunForMessage(
        client as unknown as Parameters<typeof hasNonFailedTextAgentRunForMessage>[0],
        "message-1",
      ),
    ).resolves.toBe(expected);

    expect(client.calls).toEqual([
      { method: "from", args: ["text_agent_runs"] },
      { method: "select", args: ["id, run_status"] },
      { method: "eq", args: ["message_id", "message-1"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [1] },
      { method: "maybeSingle", args: [] },
    ]);
  });
});

function makeDeliveryUpdateSupabase({ updateError = null }: { updateError?: unknown } = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const builder = {
    _terminal: null as unknown,
    update: (row: unknown) => {
      calls.push({ method: "update", args: [row] });
      builder._terminal = Promise.resolve({ error: updateError });
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.push({ method: "eq", args: [col, val] });
      return builder;
    },
    then: (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => (builder._terminal as Promise<unknown>).then(onFulfilled, onRejected),
  };

  const client = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
    calls,
  };

  return client;
}

const delivery = {
  deliveryStatus: "delivered",
  eventId: "evt-delivered-1",
  messageId: "provider-msg-1",
  provider: "sendblue",
  raw: { status: "DELIVERED" },
  traceId: null,
} as Parameters<typeof updateMessageDeliveryFromWebhook>[1];

describe("updateMessageDeliveryFromWebhook", () => {
  it("skips empty delivery webhooks", async () => {
    const client = makeDeliveryUpdateSupabase();

    await updateMessageDeliveryFromWebhook(
      client as unknown as Parameters<typeof updateMessageDeliveryFromWebhook>[0],
      null,
    );

    expect(client.calls).toEqual([]);
  });

  it("updates the matching outbound text message delivery fields", async () => {
    const client = makeDeliveryUpdateSupabase();

    await updateMessageDeliveryFromWebhook(
      client as unknown as Parameters<typeof updateMessageDeliveryFromWebhook>[0],
      delivery,
    );

    expect(client.calls).toEqual([
      { method: "from", args: ["text_messages"] },
      {
        method: "update",
        args: [
          {
            delivery_status: "delivered",
            raw_payload: { status: "DELIVERED" },
          },
        ],
      },
      { method: "eq", args: ["provider", "sendblue"] },
      { method: "eq", args: ["provider_message_id", "provider-msg-1"] },
      { method: "eq", args: ["direction", "outbound"] },
    ]);
  });

  it("throws when the delivery status update fails", async () => {
    const updateError = new Error("text_messages update failed");
    const client = makeDeliveryUpdateSupabase({ updateError });

    await expect(
      updateMessageDeliveryFromWebhook(
        client as unknown as Parameters<typeof updateMessageDeliveryFromWebhook>[0],
        delivery,
      ),
    ).rejects.toThrow("text_messages update failed");
  });
});
