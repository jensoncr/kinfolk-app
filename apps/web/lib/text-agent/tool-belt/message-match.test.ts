import { describe, expect, it, vi } from "vitest";
import { messageRoommateMatchTool } from "./message-match";
import type { HousingAgentToolContext } from "./types";

const storeMocks = vi.hoisted(() => ({
  recordMatchIntentAndOpenForUser: vi.fn(),
  sendChatMessageForUser: vi.fn(),
}));

vi.mock("../../chat/store", () => ({
  recordMatchIntentAndOpenForUser: storeMocks.recordMatchIntentAndOpenForUser,
  sendChatMessageForUser: storeMocks.sendChatMessageForUser,
}));

function makeContext({
  edge = { id: "edge-1", status: "active" },
  allowWrites = true,
}: {
  edge?: { id: string; status: string } | null;
  allowWrites?: boolean;
} = {}): HousingAgentToolContext {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve({ data: edge, error: null }));
  return {
    allowWrites,
    runId: "run-1",
    supabase: { from: vi.fn(() => query) } as never,
    threadId: "thread-1",
    userId: "user-1",
  };
}

describe("message_roommate_match", () => {
  it("records intent and reports NOT delivered when the match has not opted in", async () => {
    vi.clearAllMocks();
    storeMocks.recordMatchIntentAndOpenForUser.mockResolvedValueOnce({
      status: "pending",
    });

    const result = await messageRoommateMatchTool.run(makeContext(), {
      body: "hey! I think we'd get along as roommates",
      matchUserId: "user-2",
    });

    expect(result.ok).toBe(true);
    expect(result.data.delivered).toBe(false);
    expect(result.data.status).toBe("pending");
    expect(result.data.messageStoredForOpen).toBe(true);
    expect(result.summary).toContain("NOTHING was delivered yet");
    // The body rides on the intent so it delivers when the chat opens.
    expect(storeMocks.recordMatchIntentAndOpenForUser).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "edge-1",
      { introMessage: "hey! I think we'd get along as roommates" },
    );
  });

  it("reports delivered when mutual intent opens the room", async () => {
    vi.clearAllMocks();
    storeMocks.recordMatchIntentAndOpenForUser.mockResolvedValueOnce({
      roomId: "room-1",
      status: "opened",
    });

    const result = await messageRoommateMatchTool.run(makeContext(), {
      body: "hey!",
      matchUserId: "user-2",
    });

    expect(result.ok).toBe(true);
    expect(result.data.delivered).toBe(true);
    expect(result.data.roomId).toBe("room-1");
    // Delivery happens inside recordMatchIntentAndOpenForUser (stored intro),
    // so the tool must not double-send.
    expect(storeMocks.sendChatMessageForUser).not.toHaveBeenCalled();
  });

  it("fails cleanly when no active match edge exists", async () => {
    vi.clearAllMocks();

    const result = await messageRoommateMatchTool.run(makeContext({ edge: null }), {
      body: "hey!",
      matchUserId: "user-2",
    });

    expect(result.ok).toBe(false);
    expect(result.data.delivered).toBe(false);
    expect(storeMocks.recordMatchIntentAndOpenForUser).not.toHaveBeenCalled();
  });

  it("previews without recording intent when writes are disabled", async () => {
    vi.clearAllMocks();

    const result = await messageRoommateMatchTool.run(
      makeContext({ allowWrites: false }),
      { body: "hey!", matchUserId: "user-2" },
    );

    expect(result.ok).toBe(true);
    expect(result.data.previewOnly).toBe(true);
    expect(result.data.delivered).toBe(false);
    expect(storeMocks.recordMatchIntentAndOpenForUser).not.toHaveBeenCalled();
  });

  it("rejects messaging yourself", async () => {
    vi.clearAllMocks();

    const result = await messageRoommateMatchTool.run(makeContext(), {
      body: "hey!",
      matchUserId: "user-1",
    });

    expect(result.ok).toBe(false);
  });
});
