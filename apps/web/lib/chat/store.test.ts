import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  hasServerSupabaseConfig: () => true,
  supabaseUrl: "https://project.supabase.co",
}));
vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));
// sendChatMessageToRoom fires this off detached; a real call would race the
// queued supabase mocks of whichever test runs next.
vi.mock("@/lib/notifications/chat-message-notifications", () => ({
  sendChatMessageTextNotifications: vi.fn(async () => ({
    notified: [],
    skipped: {},
  })),
}));

import {
  ChatError,
  getChatRoomForUser,
  markChatRoomReadForCurrentUser,
  PhoneVerificationRequiredError,
  recordMatchIntentAndOpen,
  sendChatMessageForCurrentUser,
  sendChatMessageForUser,
  setChatRoomNotificationsForCurrentUser,
} from "./store";

type QueryResult = { data?: unknown; error?: unknown; count?: number };

/** A chainable Supabase query stub that resolves to `result` at any terminal. */
function makeQuery(result: QueryResult) {
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (value: QueryResult) => void, reject?: (reason: unknown) => void) => void;
  } = {};
  for (const method of [
    "select",
    "eq",
    "is",
    "in",
    "not",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "or",
    "order",
    "limit",
    "update",
    "insert",
    "delete",
    "upsert",
    "maybeSingle",
    "single",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

/** from() pops queued [table, query] pairs in order and asserts the access order. */
function fromQueue(entries: Array<[string, ReturnType<typeof makeQuery>]>) {
  const queue = [...entries];
  return {
    from: vi.fn((table: string) => {
      const entry = queue.shift();
      if (!entry) throw new Error(`Unexpected Supabase table access: ${table}`);
      expect(table).toBe(entry[0]);
      return entry[1];
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureCurrentKinfolkUser.mockResolvedValue({
    identity: null,
    user: { id: "user-1", display_name: "Avery Stone" },
  });
});

describe("sendChatMessageForCurrentUser", () => {
  it("returns a generic 404 for a room the user is not an active member of", async () => {
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: null })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(sendChatMessageForCurrentUser("room-1", "hi")).rejects.toMatchObject({
      status: 404,
    });
    // Never reached the insert.
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it("rejects sends into a frozen room with 403", async () => {
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "frozen", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(sendChatMessageForCurrentUser("room-1", "hi")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("writes a manual message and marks the sender read on the happy path", async () => {
    const insertQuery = makeQuery({
      data: { id: "msg-1", body: "saturday works", created_at: "2026-06-23T17:00:00Z" },
    });
    const readUpdate = makeQuery({ error: null });
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["chat_messages", insertQuery],
      ["chat_room_members", readUpdate],
      ["kinfolk_users", makeQuery({ data: [{ id: "user-1", display_name: "Avery Stone" }] })],
      ["kinfolk_user_photos", makeQuery({ data: [] })],
      ["linkedin_enrichment_jobs", makeQuery({ data: [] })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const message = await sendChatMessageForCurrentUser("room-1", "  saturday works  ");

    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        room_id: "room-1",
        sender_user_id: "user-1",
        body: "saturday works",
        sent_via: "manual",
      }),
    );
    expect(readUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_read_at: expect.any(String) }),
    );
    expect(message).toMatchObject({ id: "msg-1", isMine: true, sentVia: "manual" });
  });

  it("can write an agent-sent chat message with provenance links", async () => {
    const insertQuery = makeQuery({
      data: {
        body: "Tour Saturday at 2 works for me.",
        created_at: "2026-06-23T17:00:00Z",
        id: "msg-2",
        sent_via: "kinfolk_agent",
      },
    });
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["chat_messages", insertQuery],
      ["chat_room_members", makeQuery({ error: null })],
      ["kinfolk_users", makeQuery({ data: [{ id: "user-1", display_name: "Avery Stone" }] })],
      ["kinfolk_user_photos", makeQuery({ data: [] })],
      ["linkedin_enrichment_jobs", makeQuery({ data: [] })],
    ]);
    const message = await sendChatMessageForUser(
      supabase as never,
      "user-1",
      "room-1",
      "Tour Saturday at 2 works for me.",
      {
        agentRunId: "run-1",
        sentVia: "kinfolk_agent",
        sourceTextMessageId: "text-msg-1",
      },
    );

    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_run_id: "run-1",
        room_id: "room-1",
        sender_user_id: "user-1",
        sent_via: "kinfolk_agent",
        source_text_message_id: "text-msg-1",
      }),
    );
    expect(message).toMatchObject({ sentVia: "kinfolk_agent" });
  });

  it("rejects an empty message before touching the database insert", async () => {
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(sendChatMessageForCurrentUser("room-1", "   ")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("throws a 401 ChatError when signed out, before any DB access", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({ identity: null, user: null });
    const supabase = fromQueue([]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const error = await sendChatMessageForCurrentUser("room-1", "hi").catch((e) => e);
    expect(error).toBeInstanceOf(ChatError);
    expect(error.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("getChatRoomForUser", () => {
  it("returns unreadCount even when the newest message is mine", async () => {
    const unreadQuery = makeQuery({ count: 1, error: null });
    const supabase = fromQueue([
      [
        "chat_rooms",
        makeQuery({
          data: {
            apartment_group_id: null,
            compatibility_edge_id: null,
            created_at: "2026-06-23T17:00:00Z",
            id: "room-1",
            room_type: "match_dm",
            status: "active",
          },
        }),
      ],
      [
        "chat_room_members",
        makeQuery({
          data: {
            history_visible_from: "2026-06-23T17:00:00Z",
            id: "member-1",
            last_read_at: "2026-06-23T17:05:00Z",
            status: "active",
            text_notifications_enabled: false,
          },
        }),
      ],
      [
        "chat_messages",
        // Newest first, as the descending page query returns them; the store
        // re-sorts ascending for display.
        makeQuery({
          data: [
            {
              body: "Saturday works.",
              created_at: "2026-06-23T17:15:00Z",
              id: "msg-mine",
              sender_user_id: "user-1",
              sent_via: "kinfolk_agent",
            },
            {
              body: "Can you tour Saturday?",
              created_at: "2026-06-23T17:10:00Z",
              id: "msg-peer",
              sender_user_id: "peer-1",
              sent_via: "manual",
            },
          ],
        }),
      ],
      ["chat_messages", unreadQuery],
      [
        "chat_room_members",
        makeQuery({
          data: [{ user_id: "user-1" }, { user_id: "peer-1" }],
        }),
      ],
      [
        "kinfolk_users",
        makeQuery({
          data: [
            { id: "user-1", display_name: "Avery Stone" },
            { id: "peer-1", display_name: "Priya Shah" },
          ],
        }),
      ],
      ["kinfolk_user_photos", makeQuery({ data: [] })],
      [
        "linkedin_enrichment_jobs",
        makeQuery({
          data: [
            {
              user_id: "peer-1",
              idempotency_key: "linkedin:peer-1:provider",
              image_url: "https://img.clerk.test/current.jpg",
              updated_at: "2026-07-28T12:00:00.000Z",
            },
            {
              user_id: "peer-1",
              idempotency_key: "linkedin:peer-1:manual-url",
              image_url:
                "https://project.supabase.co/storage/v1/object/public/profile-photos/peer-1/linkedin-profile.jpg",
              updated_at: "2026-07-27T12:00:00.000Z",
            },
          ],
        }),
      ],
    ]);

    const room = await getChatRoomForUser(supabase as never, "room-1", "user-1");

    expect(room).toMatchObject({
      id: "room-1",
      messages: [
        { id: "msg-peer", isMine: false },
        { id: "msg-mine", isMine: true, sentVia: "kinfolk_agent" },
      ],
      unreadCount: 1,
      participants: [
        {
          imageUrl:
            "https://project.supabase.co/storage/v1/object/public/profile-photos/peer-1/linkedin-profile.jpg",
        },
      ],
    });
    expect(unreadQuery.or).toHaveBeenCalledWith(
      "sender_user_id.is.null,sender_user_id.neq.user-1",
    );
    expect(unreadQuery.gt).toHaveBeenCalledWith("created_at", "2026-06-23T17:05:00Z");
  });
});

describe("markChatRoomReadForCurrentUser", () => {
  it("returns 404 for a non-member", async () => {
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: null })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(markChatRoomReadForCurrentUser("room-1")).rejects.toMatchObject({ status: 404 });
  });

  it("returns 404 for a removed apartment-group member whose chat row is still active", async () => {
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "apartment_group", status: "active", apartment_group_id: "grp-1" } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["apartment_roommate_group_memberships", makeQuery({ data: null })], // no longer in the group
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(markChatRoomReadForCurrentUser("room-1")).rejects.toMatchObject({ status: 404 });
  });

  it("updates last_read_at for a member", async () => {
    const update = makeQuery({ error: null });
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["chat_room_members", update],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(markChatRoomReadForCurrentUser("room-1")).resolves.toEqual({ ok: true });
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_read_at: expect.any(String) }),
    );
  });
});

describe("setChatRoomNotificationsForCurrentUser", () => {
  it("blocks a removed apartment-group member from re-enabling notifications", async () => {
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "apartment_group", status: "active", apartment_group_id: "grp-1" } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["apartment_roommate_group_memberships", makeQuery({ data: null })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(
      setChatRoomNotificationsForCurrentUser("room-1", true),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("persists the toggle for an active member", async () => {
    const update = makeQuery({ error: null });
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["user_phone_numbers", makeQuery({ data: { id: "phone-1" } })],
      ["chat_room_members", update],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(setChatRoomNotificationsForCurrentUser("room-1", true)).resolves.toEqual({
      enabled: true,
    });
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ text_notifications_enabled: true }),
    );
  });

  it("requires an opted-in verified phone before enabling notifications", async () => {
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["user_phone_numbers", makeQuery({ data: null })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    const promise = setChatRoomNotificationsForCurrentUser("room-1", true);
    await expect(promise).rejects.toBeInstanceOf(PhoneVerificationRequiredError);
    await expect(promise).rejects.toBeInstanceOf(ChatError);
    await expect(promise).rejects.toMatchObject({
      name: "PhoneVerificationRequiredError",
      status: 400,
      message: "Verify your phone in Settings before turning on text notifications.",
    });
    expect(supabase.from).toHaveBeenCalledTimes(3);
  });

  it("lets a user disable notifications without a phone", async () => {
    const update = makeQuery({ error: null });
    const supabase = fromQueue([
      ["chat_rooms", makeQuery({ data: { id: "room-1", room_type: "match_dm", status: "active", apartment_group_id: null } })],
      ["chat_room_members", makeQuery({ data: { id: "m1", status: "active" } })],
      ["chat_room_members", update],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(setChatRoomNotificationsForCurrentUser("room-1", false)).resolves.toEqual({
      enabled: false,
    });
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ text_notifications_enabled: false }),
    );
  });
});

describe("recordMatchIntentAndOpen", () => {
  it("returns 404 when the edge does not involve the viewer", async () => {
    const supabase = fromQueue([
      ["compatibility_edges", makeQuery({ data: { id: "e1", user_a_id: "x", user_b_id: "y" } })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(recordMatchIntentAndOpen("e1")).rejects.toMatchObject({ status: 404 });
  });

  it("stays pending when only the viewer has approved", async () => {
    const supabase = fromQueue([
      ["compatibility_edges", makeQuery({ data: { id: "e1", user_a_id: "user-1", user_b_id: "user-2" } })],
      ["match_feedback_events", makeQuery({ data: null })], // viewer has not approved yet
      ["match_feedback_events", makeQuery({ data: null })], // insert approved_intro
      ["match_feedback_events", makeQuery({ data: { event_type: "approved_intro", created_at: "2026-06-23T17:00:00Z" } })],
      ["match_feedback_events", makeQuery({ data: null })], // other side absent
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(recordMatchIntentAndOpen("e1")).resolves.toEqual({ status: "pending" });
  });

  it("opens (creates) the match DM room on mutual interest", async () => {
    const memberInsertA = makeQuery({ error: null });
    const memberInsertB = makeQuery({ error: null });
    const supabase = fromQueue([
      ["compatibility_edges", makeQuery({ data: { id: "e1", user_a_id: "user-1", user_b_id: "user-2" } })],
      ["match_feedback_events", makeQuery({ data: { id: "fb-self" } })], // viewer already approved
      ["match_feedback_events", makeQuery({ data: { event_type: "approved_intro", created_at: "2026-06-23T17:00:00Z" } })],
      ["match_feedback_events", makeQuery({ data: { event_type: "approved_intro", created_at: "2026-06-23T17:00:01Z" } })],
      ["chat_rooms", makeQuery({ data: null })], // no existing room
      ["chat_rooms", makeQuery({ data: { id: "room-9", created_at: "2026-06-23T17:00:00Z" } })], // insert
      ["chat_room_members", makeQuery({ data: [] })], // no existing members
      ["chat_room_members", memberInsertA],
      ["chat_room_members", memberInsertB],
      ["match_feedback_events", makeQuery({ data: [] })], // no stored intros to deliver
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(recordMatchIntentAndOpen("e1")).resolves.toEqual({
      status: "opened",
      roomId: "room-9",
    });
    expect(memberInsertA.insert).toHaveBeenCalled();
    expect(memberInsertB.insert).toHaveBeenCalled();
  });

  it("does not open a DM when the other person's latest feedback passed after approving", async () => {
    const supabase = fromQueue([
      ["compatibility_edges", makeQuery({ data: { id: "e1", user_a_id: "user-1", user_b_id: "user-2" } })],
      ["match_feedback_events", makeQuery({ data: { id: "fb-self" } })],
      ["match_feedback_events", makeQuery({ data: { event_type: "approved_intro", created_at: "2026-06-23T17:00:00Z" } })],
      ["match_feedback_events", makeQuery({ data: { event_type: "passed", created_at: "2026-06-23T17:05:00Z" } })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(recordMatchIntentAndOpen("e1")).resolves.toEqual({ status: "pending" });
    expect(supabase.from).toHaveBeenCalledTimes(4);
  });

  it("treats a duplicate approved_intro (23505) as success and stays pending", async () => {
    const supabase = fromQueue([
      ["compatibility_edges", makeQuery({ data: { id: "e1", user_a_id: "user-1", user_b_id: "user-2" } })],
      ["match_feedback_events", makeQuery({ data: null })], // viewer not yet approved
      ["match_feedback_events", makeQuery({ error: { code: "23505" } })], // concurrent insert raced
      ["match_feedback_events", makeQuery({ data: { event_type: "approved_intro", created_at: "2026-06-23T17:00:00Z" } })],
      ["match_feedback_events", makeQuery({ data: null })], // other side absent
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(recordMatchIntentAndOpen("e1")).resolves.toEqual({ status: "pending" });
  });

  it("rethrows a non-unique-violation insert error on the approved_intro write", async () => {
    const supabase = fromQueue([
      ["compatibility_edges", makeQuery({ data: { id: "e1", user_a_id: "user-1", user_b_id: "user-2" } })],
      ["match_feedback_events", makeQuery({ data: null })],
      ["match_feedback_events", makeQuery({ error: { code: "23502", message: "boom" } })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(recordMatchIntentAndOpen("e1")).rejects.toMatchObject({ code: "23502" });
  });

  it("opens the room even when a concurrent reconcile already inserted a member (23505)", async () => {
    const supabase = fromQueue([
      ["compatibility_edges", makeQuery({ data: { id: "e1", user_a_id: "user-1", user_b_id: "user-2" } })],
      ["match_feedback_events", makeQuery({ data: { id: "fb-self" } })],
      ["match_feedback_events", makeQuery({ data: { event_type: "approved_intro", created_at: "2026-06-23T17:00:00Z" } })],
      ["match_feedback_events", makeQuery({ data: { event_type: "approved_intro", created_at: "2026-06-23T17:00:01Z" } })],
      ["chat_rooms", makeQuery({ data: null })],
      ["chat_rooms", makeQuery({ data: { id: "room-9", created_at: "2026-06-23T17:00:00Z" } })],
      ["chat_room_members", makeQuery({ data: [] })],
      ["chat_room_members", makeQuery({ error: { code: "23505" } })], // member A insert lost the race
      ["chat_room_members", makeQuery({ error: null })], // member B insert
      ["match_feedback_events", makeQuery({ data: [] })], // no stored intros to deliver
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    await expect(recordMatchIntentAndOpen("e1")).resolves.toEqual({
      status: "opened",
      roomId: "room-9",
    });
  });
});
