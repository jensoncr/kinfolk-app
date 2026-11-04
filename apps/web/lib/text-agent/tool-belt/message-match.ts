import { readString } from "./args";
import type { HousingAgentTool } from "./types";

/**
 * message_roommate_match — the agent-side twin of the web "Message" button on
 * a roommate match.
 *
 * Kinfolk match DMs are MUTUAL-consent: a chat room between two matches opens
 * only after both people have expressed intent (approved_intro). This tool
 * records the sender's intent and, when the intent is already mutual, opens
 * the DM and delivers the message. When the other person hasn't opted in yet
 * it returns delivered:false — the agent must relay that honestly ("I let
 * them know you're interested; the chat opens when they're in too") and must
 * NEVER claim the message was sent.
 */
export const messageRoommateMatchTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Express interest in a roommate match and message them when possible. Records the user's intro intent for the match (mutual-consent model). If the match already opted in too, the Kinfolk chat opens and the message body is delivered; otherwise NO message is sent yet — the result says delivered=false and you must tell the user the chat opens once the match accepts. Use the match's userId from get_matches.",
      name: "message_roommate_match",
      parameters: {
        additionalProperties: false,
        properties: {
          body: {
            description:
              "Message to deliver into the Kinfolk chat if it opens. Required even when delivery may be pending.",
            type: "string",
          },
          matchUserId: {
            description: "The roommate match's userId from get_matches.",
            type: "string",
          },
        },
        required: ["matchUserId", "body"],
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const matchUserId = readString(args.matchUserId);
    const body = readString(args.body);
    if (!matchUserId || !body) {
      return {
        data: { delivered: false },
        ok: false,
        summary: "A match userId and a non-empty message body are required.",
        toolName: "message_roommate_match",
      };
    }
    if (matchUserId === context.userId) {
      return {
        data: { delivered: false },
        ok: false,
        summary: "That userId is the sender, not a match.",
        toolName: "message_roommate_match",
      };
    }

    const [userAId, userBId] = [context.userId, matchUserId].sort();
    const edgeResult = await context.supabase
      .from("compatibility_edges")
      .select("id, status")
      .eq("user_a_id", userAId)
      .eq("user_b_id", userBId)
      .eq("status", "active")
      .maybeSingle();
    if (edgeResult.error) throw edgeResult.error;
    if (!edgeResult.data) {
      return {
        data: { delivered: false },
        ok: false,
        summary:
          "No active Kinfolk match exists with that person, so no intro can be sent.",
        toolName: "message_roommate_match",
      };
    }

    if (!context.allowWrites) {
      return {
        data: { body, delivered: false, previewOnly: true },
        ok: true,
        summary:
          "Preview only; writes are disabled for this turn. No intent was recorded and no message was sent.",
        toolName: "message_roommate_match",
      };
    }

    const { recordMatchIntentAndOpenForUser } = await import("../../chat/store");
    const intent = await recordMatchIntentAndOpenForUser(
      context.supabase,
      context.userId,
      edgeResult.data.id,
      // Stored on the intent so the exact words deliver when the chat opens.
      { introMessage: body },
    );

    if (intent.status !== "opened") {
      return {
        data: {
          delivered: false,
          intentRecorded: true,
          messageStoredForOpen: true,
          status: "pending",
        },
        ok: true,
        summary:
          "Recorded the user's interest and saved their message. NOTHING was delivered yet — the Kinfolk chat opens once the match accepts, and their saved message is delivered automatically at that moment. Tell the user exactly that.",
        toolName: "message_roommate_match",
      };
    }

    // Room open (mutual): the body was stored on the intent and
    // recordMatchIntentAndOpenForUser delivers stored intros into the room
    // as part of opening, so it is already in the chat.
    return {
      data: {
        delivered: true,
        roomId: intent.roomId,
        status: "delivered",
      },
      ok: true,
      summary:
        "The match had already opted in — the Kinfolk chat is open and the message was delivered as the user (sent via Kinfolk).",
      toolName: "message_roommate_match",
    };
  },
};
