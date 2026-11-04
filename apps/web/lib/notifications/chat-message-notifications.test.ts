import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/integrations/text-transport", () => ({
  getActiveTextTransportProvider: vi.fn(() => "linq"),
  getTextTransportFromNumber: vi.fn(() => "+15551234567"),
  isTextAgentEnabled: vi.fn(() => true),
  sendTextMessage: vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => ({
    chatId: "chat-1",
    deliveryStatus: "queued",
    messageId: `msg:${idempotencyKey}`,
    service: "iMessage",
  })),
}));

import { sendTextMessage } from "@/lib/integrations/text-transport";
import { sendChatMessageTextNotifications } from "./chat-message-notifications";

// Default quiet hours are 21–9 America/Los_Angeles; these UTC instants land
// squarely outside / inside that window so the real gate can run.
const OUTSIDE_QUIET_HOURS = new Date("2026-07-06T18:00:00.000Z"); // 11am PT
const INSIDE_QUIET_HOURS = new Date("2026-07-06T06:00:00.000Z"); // 11pm PT

const chatMessageRow = {
  body: "hey! saturday tour works for me",
  created_at: "2026-07-05T18:00:00.000Z",
  id: "msg-1",
  room_id: "room-1",
  sender_user_id: "user-1",
};

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-2",
    last_notified_message_id: null,
    last_text_notified_at: null,
    status: "active",
    text_notifications_enabled: true,
    user_id: "user-2",
    ...overrides,
  };
}

function buildSupabase(
  tables: Record<string, { rows?: Array<Record<string, unknown>> }>,
  writes: Array<{ table: string; method: string; args: unknown[] }> = [],
) {
  return {
    from: (tableName: string) => {
      const rows = tables[tableName]?.rows ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "neq",
        "not",
        "gte",
        "in",
        "is",
        "like",
        "or",
        "order",
        "limit",
      ]) {
        chain[method] = () => chain;
      }
      chain["maybeSingle"] = async () => ({ data: rows[0] ?? null, error: null });
      chain["then"] = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve);
      chain["insert"] = (...args: unknown[]) => {
        writes.push({ args, method: "insert", table: tableName });
        const insertChain: Record<string, unknown> = {};
        insertChain["then"] = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve);
        return insertChain;
      };
      // update() keeps chaining (the CAS claim is .update().eq().or().or().select())
      // and resolves to this table's rows so a claim "wins" by default.
      chain["update"] = (...args: unknown[]) => {
        writes.push({ args, method: "update", table: tableName });
        return chain;
      };
      return chain;
    },
  } as unknown as Parameters<typeof sendChatMessageTextNotifications>[0];
}

const baseTables = {
  chat_messages: { rows: [chatMessageRow] },
  kinfolk_users: { rows: [{ display_name: "Jenson Cripps" }] },
  match_notification_prefs: { rows: [] },
  text_threads: { rows: [{ id: "thread-1", provider_chat_id: "chat-1" }] },
  user_phone_numbers: { rows: [{ id: "phone-2", phone_e164: "+12125550111" }] },
};

describe("sendChatMessageTextNotifications", () => {
  it("skips members who have not enabled room text notifications (default off)", async () => {
    vi.mocked(sendTextMessage).mockClear();
    const supabase = buildSupabase({
      ...baseTables,
      chat_room_members: {
        rows: [memberRow({ text_notifications_enabled: false })],
      },
    });

    const result = await sendChatMessageTextNotifications(supabase, {
      messageId: "msg-1",
      roomId: "room-1",
      senderUserId: "user-1",
    });

    expect(result.notified).toEqual([]);
    expect(result.skipped["user-2"]).toBe("room_notifications_off");
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("texts an opted-in member with a first-name preview and stamps the throttle", async () => {
    vi.mocked(sendTextMessage).mockClear();
    const writes: Array<{ table: string; method: string; args: unknown[] }> = [];
    const supabase = buildSupabase(
      { ...baseTables, chat_room_members: { rows: [memberRow()] } },
      writes,
    );

    const result = await sendChatMessageTextNotifications(supabase, {
      messageId: "msg-1",
      nowUtc: OUTSIDE_QUIET_HOURS,
      roomId: "room-1",
      senderUserId: "user-1",
    });

    expect(result.notified).toEqual(["user-2"]);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTextMessage).mock.calls[0][0] as {
      parts: Array<{ type: string; value?: string }>;
      to: string;
    };
    expect(call.to).toBe("+12125550111");
    expect(call.parts[0]?.value).toContain("Jenson messaged you on Kinfolk");
    expect(call.parts[0]?.value).toContain("saturday tour");
    // Never the sender's full name.
    expect(call.parts[0]?.value).not.toContain("Cripps");

    const stamp = writes.find(
      (write) => write.table === "chat_room_members" && write.method === "update",
    );
    expect(stamp?.args[0]).toMatchObject({ last_notified_message_id: "msg-1" });
  });

  it("never texts twice for the same message and throttles bursts", async () => {
    vi.mocked(sendTextMessage).mockClear();
    const already = buildSupabase({
      ...baseTables,
      chat_room_members: {
        rows: [memberRow({ last_notified_message_id: "msg-1" })],
      },
    });
    const dup = await sendChatMessageTextNotifications(already, {
      messageId: "msg-1",
      roomId: "room-1",
      senderUserId: "user-1",
    });
    expect(dup.skipped["user-2"]).toBe("already_notified");

    const recent = buildSupabase({
      ...baseTables,
      chat_room_members: {
        rows: [
          memberRow({ last_text_notified_at: new Date().toISOString() }),
        ],
      },
    });
    const throttled = await sendChatMessageTextNotifications(recent, {
      messageId: "msg-1",
      roomId: "room-1",
      senderUserId: "user-1",
    });
    expect(throttled.skipped["user-2"]).toBe("throttled");
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("respects quiet hours", async () => {
    vi.mocked(sendTextMessage).mockClear();
    const supabase = buildSupabase({
      ...baseTables,
      chat_room_members: { rows: [memberRow()] },
    });

    const result = await sendChatMessageTextNotifications(supabase, {
      messageId: "msg-1",
      nowUtc: INSIDE_QUIET_HOURS,
      roomId: "room-1",
      senderUserId: "user-1",
    });

    expect(result.skipped["user-2"]).toBe("quiet_hours");
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("never notifies the sender about their own message", async () => {
    vi.mocked(sendTextMessage).mockClear();
    const supabase = buildSupabase({
      ...baseTables,
      chat_room_members: {
        rows: [memberRow({ id: "member-1", user_id: "user-1" })],
      },
    });

    const result = await sendChatMessageTextNotifications(supabase, {
      messageId: "msg-1",
      roomId: "room-1",
      senderUserId: "user-1",
    });

    expect(result.notified).toEqual([]);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
