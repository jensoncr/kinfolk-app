import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  enforceApiUserRateLimit: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  getChatRoomsForCurrentUser: vi.fn(),
  getChatRoomForCurrentUser: vi.fn(),
  sendChatMessageForUser: vi.fn(),
  markChatRoomReadForCurrentUser: vi.fn(),
  setChatRoomNotificationsForCurrentUser: vi.fn(),
  recordMatchIntentAndOpen: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/chat/store", async () => {
  const { ApiError } = await import("@/lib/shared/api-error");
  class ChatError extends ApiError {
    constructor(message: string, status: number) {
      super(message, status);
      this.name = "ChatError";
    }
  }
  return {
    ChatError,
    getChatRoomsForCurrentUser: mocks.getChatRoomsForCurrentUser,
    getChatRoomForCurrentUser: mocks.getChatRoomForCurrentUser,
    sendChatMessageForUser: mocks.sendChatMessageForUser,
    markChatRoomReadForCurrentUser: mocks.markChatRoomReadForCurrentUser,
    setChatRoomNotificationsForCurrentUser:
      mocks.setChatRoomNotificationsForCurrentUser,
    recordMatchIntentAndOpen: mocks.recordMatchIntentAndOpen,
  };
});

import { ChatError } from "@/lib/chat/store";
import { GET as listChats } from "./route";
import { GET as getMessages, POST as postMessage } from "./[roomId]/messages/route";
import { POST as postNotifications } from "./[roomId]/notifications/route";
import { POST as postRead } from "./[roomId]/read/route";
import { POST as postMatchIntent } from "./match-intent/route";

function jsonRequest(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
function rawRequest(url: string, raw: string): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  }) as unknown as NextRequest;
}
function ctx(roomId: string) {
  return { params: Promise.resolve({ roomId }) };
}
async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceApiUserRateLimit.mockResolvedValue(null);
  mocks.ensureCurrentKinfolkUser.mockResolvedValue({ user: { id: "user-1" } });
});

describe("GET /api/chats", () => {
  it("returns the rooms snapshot", async () => {
    mocks.getChatRoomsForCurrentUser.mockResolvedValue({ status: "connected", rooms: [] });
    const response = await listChats();
    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ status: "connected", rooms: [] });
  });

  it("returns redacted JSON when the room list fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Could not load chats: service-role-token");
    mocks.getChatRoomsForCurrentUser.mockRejectedValue(error);

    const response = await listChats();

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({ error: "Unable to load your chats." });
    expect(JSON.stringify(json)).not.toContain("service-role-token");
    expect(consoleError).toHaveBeenCalledWith("[chats] list failed", { error });
    consoleError.mockRestore();
  });
});

describe("GET /api/chats/[roomId]/messages", () => {
  it("returns a generic 404 when the viewer cannot access the room", async () => {
    mocks.getChatRoomForCurrentUser.mockResolvedValue(null);
    const response = await getMessages(new Request("http://test/x"), ctx("room-1"));
    expect(response.status).toBe(404);
    expect(mocks.getChatRoomForCurrentUser).toHaveBeenCalledWith("room-1");
  });

  it("returns the room detail when authorized", async () => {
    mocks.getChatRoomForCurrentUser.mockResolvedValue({ id: "room-1", messages: [] });
    const response = await getMessages(new Request("http://test/x"), ctx("room-1"));
    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ room: { id: "room-1", messages: [] } });
  });

  it("returns redacted JSON when room detail loading fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Could not load room: service-role-token");
    mocks.getChatRoomForCurrentUser.mockRejectedValue(error);

    const response = await getMessages(new Request("http://test/x"), ctx("room-1"));

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({ error: "Unable to load this chat." });
    expect(JSON.stringify(json)).not.toContain("service-role-token");
    expect(consoleError).toHaveBeenCalledWith("[chats] room load failed", {
      error,
      roomId: "room-1",
    });
    consoleError.mockRestore();
  });
});

describe("POST /api/chats/[roomId]/messages", () => {
  it("rejects signed-out sends before parsing or rate limiting", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({ user: null });

    const response = await postMessage(
      rawRequest("https://kinfolk.test/api/chats/room-1/messages", "{oops"),
      ctx("room-1"),
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before sending a message.",
    });
    expect(mocks.sendChatMessageForUser).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response when the sender is over budget", async () => {
    mocks.enforceApiUserRateLimit.mockResolvedValueOnce(
      Response.json({ error: "Too many requests." }, { status: 429 }),
    );

    const response = await postMessage(
      jsonRequest("https://kinfolk.test/api/chats/room-1/messages", { body: "hi" }),
      ctx("room-1"),
    );

    expect(response.status).toBe(429);
    expect(mocks.enforceApiUserRateLimit).toHaveBeenCalledWith({
      userId: "user-1",
      bucketType: "chat_message",
      limit: 60,
      window: "minute",
    });
    expect(mocks.sendChatMessageForUser).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400", async () => {
    const response = await postMessage(rawRequest("http://test/x", "{"), ctx("room-1"));
    expect(response.status).toBe(400);
    expect(mocks.sendChatMessageForUser).not.toHaveBeenCalled();
  });

  it("maps a ChatError to its status (404 for non-members)", async () => {
    mocks.sendChatMessageForUser.mockRejectedValue(new ChatError("Not found.", 404));
    const response = await postMessage(jsonRequest("http://test/x", { body: "hi" }), ctx("room-1"));
    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toEqual({ error: "Not found." });
  });

  it("returns the created message on success", async () => {
    mocks.sendChatMessageForUser.mockResolvedValue({ id: "m1", body: "hi", isMine: true });
    const response = await postMessage(jsonRequest("http://test/x", { body: "hi" }), ctx("room-1"));
    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      message: { id: "m1", body: "hi", isMine: true },
    });
    expect(mocks.sendChatMessageForUser).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      "room-1",
      "hi",
    );
  });

  it("returns redacted JSON when message send fails unexpectedly", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Could not insert chat message: service-role-token");
    mocks.sendChatMessageForUser.mockRejectedValue(error);

    const response = await postMessage(jsonRequest("http://test/x", { body: "hi" }), ctx("room-1"));

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({ error: "Unable to send your message." });
    expect(JSON.stringify(json)).not.toContain("service-role-token");
    expect(consoleError).toHaveBeenCalledWith("[chats] message send failed", {
      error,
      roomId: "room-1",
    });
    consoleError.mockRestore();
  });
});

describe("POST /api/chats/[roomId]/read", () => {
  it("maps ChatError 404 from a non-member", async () => {
    mocks.markChatRoomReadForCurrentUser.mockRejectedValue(new ChatError("Not found.", 404));
    const response = await postRead(new Request("http://test/x", { method: "POST" }), ctx("room-1"));
    expect(response.status).toBe(404);
  });

  it("returns redacted JSON when marking read fails unexpectedly", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Could not update read marker: service-role-token");
    mocks.markChatRoomReadForCurrentUser.mockRejectedValue(error);

    try {
      const response = await postRead(
        new Request("http://test/x", { method: "POST" }),
        ctx("room-1"),
      );
      const json = await readJson(response);

      expect(response.status).toBe(500);
      expect(json).toEqual({ error: "Unable to update this chat." });
      expect(JSON.stringify(json)).not.toContain("service-role-token");
      expect(consoleError).toHaveBeenCalledWith("[chats] read-state update failed", {
        error,
        roomId: "room-1",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("POST /api/chats/[roomId]/notifications", () => {
  it("returns redacted JSON when notification updates fail unexpectedly", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Could not update notifications: service-role-token");
    mocks.setChatRoomNotificationsForCurrentUser.mockRejectedValue(error);

    try {
      const response = await postNotifications(
        jsonRequest("http://test/x", { enabled: true }),
        ctx("room-1"),
      );
      const json = await readJson(response);

      expect(response.status).toBe(500);
      expect(json).toEqual({ error: "Unable to update notifications." });
      expect(JSON.stringify(json)).not.toContain("service-role-token");
      expect(consoleError).toHaveBeenCalledWith(
        "[chats] notification update failed",
        {
          error,
          roomId: "room-1",
        },
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("POST /api/chats/match-intent", () => {
  it("rejects a missing edge id with 400", async () => {
    const response = await postMatchIntent(jsonRequest("http://test/x", {}));
    expect(response.status).toBe(400);
    expect(mocks.recordMatchIntentAndOpen).not.toHaveBeenCalled();
  });

  it("returns the opened room id on mutual interest", async () => {
    mocks.recordMatchIntentAndOpen.mockResolvedValue({ status: "opened", roomId: "room-9" });
    const response = await postMatchIntent(
      jsonRequest("http://test/x", { compatibilityEdgeId: "edge-1" }),
    );
    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ status: "opened", roomId: "room-9" });
    expect(mocks.recordMatchIntentAndOpen).toHaveBeenCalledWith("edge-1");
  });

  it("trims padded compatibility edge ids before opening a chat", async () => {
    mocks.recordMatchIntentAndOpen.mockResolvedValue({ status: "pending" });
    const response = await postMatchIntent(
      jsonRequest("http://test/x", { compatibilityEdgeId: "  edge-1  " }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordMatchIntentAndOpen).toHaveBeenCalledWith("edge-1");
  });

  it("maps a 401 ChatError when signed out", async () => {
    mocks.recordMatchIntentAndOpen.mockRejectedValue(new ChatError("Sign in.", 401));
    const response = await postMatchIntent(
      jsonRequest("http://test/x", { compatibilityEdgeId: "edge-1" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns redacted JSON when match intent fails unexpectedly", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Could not open match chat: service-role-token");
    mocks.recordMatchIntentAndOpen.mockRejectedValue(error);

    try {
      const response = await postMatchIntent(
        jsonRequest("http://test/x", { compatibilityEdgeId: "edge-1" }),
      );
      const json = await readJson(response);

      expect(response.status).toBe(500);
      expect(json).toEqual({ error: "Unable to open this chat." });
      expect(JSON.stringify(json)).not.toContain("service-role-token");
      expect(consoleError).toHaveBeenCalledWith("[chats] match intent failed", {
        error,
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
