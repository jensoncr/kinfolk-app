import { readPositiveLimit, readString } from "./args";
import type { ChatRoomDetail, ChatRoomSummary } from "../../chat/types";
import type { HousingAgentTool } from "./types";

function summarizeRoom(room: ChatRoomSummary) {
  return {
    context: {
      listingLine: room.context.listingLine,
      matchScore: room.context.matchScore,
      priceLine: room.context.priceLine,
    },
    id: room.id,
    lastActivityAt: room.lastActivityAt,
    lastMessagePreview: room.lastMessagePreview,
    participantNames: room.participants.map((participant) => participant.name),
    roomType: room.roomType,
    title: room.title,
    unreadCount: room.unreadCount,
  };
}

function summarizeDetail(room: ChatRoomDetail, limit: number) {
  return {
    canSend: room.canSend,
    context: room.context,
    id: room.id,
    messages: room.messages.slice(-limit).map((message) => ({
      body: message.body,
      createdAt: message.createdAt,
      isMine: message.isMine,
      senderName: message.senderName,
      sentVia: message.sentVia,
    })),
    participantNames: room.participants.map((participant) => participant.name),
    roomType: room.roomType,
    title: room.title,
  };
}

export const listChatsTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "List the user's Kinfolk product chat rooms that are available from the in-app Chats feature. Use this before reading or sending when the user names a roommate, apartment group, or asks what chats they have.",
      name: "list_chats",
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description: "Maximum chat rooms to return.",
            type: "number",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const { getChatRoomsForUser } = await import("../../chat/store");
    const limit = readPositiveLimit(args.limit, 8, 20);
    const snapshot = await getChatRoomsForUser(context.supabase, context.userId);
    if (snapshot.status !== "connected") {
      return {
        data: { rooms: [], status: snapshot.status },
        ok: false,
        summary: "Kinfolk chats are not available for this user right now.",
        toolName: "list_chats",
      };
    }

    const rooms = snapshot.rooms.slice(0, limit).map(summarizeRoom);
    return {
      data: { rooms, status: snapshot.status, totalRoomCount: snapshot.rooms.length },
      ok: true,
      summary:
        rooms.length > 0
          ? `Found ${rooms.length} Kinfolk chat${rooms.length === 1 ? "" : "s"}.`
          : "No Kinfolk chats are open yet.",
      toolName: "list_chats",
    };
  },
};

export const readChatTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Read recent messages from one Kinfolk product chat room. Only messages visible to this user are returned.",
      name: "read_chat",
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description: "Maximum recent messages to return.",
            type: "number",
          },
          roomId: {
            description: "Kinfolk chat room id from list_chats or an in-app chat link.",
            type: "string",
          },
        },
        required: ["roomId"],
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const roomId = readString(args.roomId);
    if (!roomId) {
      return {
        data: { room: null },
        ok: false,
        summary: "No chat room id was provided.",
        toolName: "read_chat",
      };
    }

    const { getChatRoomForUser } = await import("../../chat/store");
    const room = await getChatRoomForUser(context.supabase, roomId, context.userId);
    if (!room) {
      return {
        data: { room: null },
        ok: false,
        summary: "That Kinfolk chat is not available to this user.",
        toolName: "read_chat",
      };
    }

    const limit = readPositiveLimit(args.limit, 20, 50);
    const data = summarizeDetail(room, limit);
    return {
      data: { room: data },
      ok: true,
      summary: `Read ${data.messages.length} recent message${data.messages.length === 1 ? "" : "s"} from ${room.title}.`,
      toolName: "read_chat",
    };
  },
};

export const sendChatMessageTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Send a message into a Kinfolk product chat room on the user's behalf. Use only when the user's iMessage command clearly provides both the target chat and the message to send. The in-app chat marks the message as sent via Kinfolk.",
      name: "send_chat_message",
      parameters: {
        additionalProperties: false,
        properties: {
          body: {
            description: "Exact message body to send into the Kinfolk chat.",
            type: "string",
          },
          roomId: {
            description: "Kinfolk chat room id from list_chats or read_chat.",
            type: "string",
          },
        },
        required: ["roomId", "body"],
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const roomId = readString(args.roomId);
    const body = readString(args.body);
    if (!roomId || !body) {
      return {
        data: { message: null },
        ok: false,
        summary: "A target chat and non-empty message body are required.",
        toolName: "send_chat_message",
      };
    }

    if (!context.allowWrites) {
      return {
        data: { body, previewOnly: true, roomId },
        ok: true,
        summary:
          "Prepared a Kinfolk chat message preview only; writes are disabled for this turn.",
        toolName: "send_chat_message",
      };
    }

    const { sendChatMessageForUser } = await import("../../chat/store");
    const message = await sendChatMessageForUser(
      context.supabase,
      context.userId,
      roomId,
      body,
      {
        agentRunId: context.runId ?? null,
        sentVia: "kinfolk_agent",
        sourceTextMessageId: context.message?.id ?? null,
      },
    );

    return {
      data: {
        message: {
          body: message.body,
          createdAt: message.createdAt,
          id: message.id,
          sentVia: message.sentVia,
        },
        previewOnly: false,
        roomId,
      },
      ok: true,
      summary:
        "Sent the message into the Kinfolk chat. It will appear as the user's message with the sent via Kinfolk marker.",
      toolName: "send_chat_message",
    };
  },
};
