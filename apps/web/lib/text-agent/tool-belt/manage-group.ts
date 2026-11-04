import { readString } from "./args";
import type { HousingAgentTool } from "./types";

const groupActionValues = new Set([
  "approve",
  "decline",
  "leave",
  "request_join",
  "start",
]);

export const manageGroupTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Note a group-membership ask (start, join, approve, decline, leave). Kinfolk cannot change group membership over text — membership moves on the web — so use this to acknowledge the ask, then point them at the listing on usekinfolk.com/apartments where starting and joining groups live.",
      name: "manage_group",
      parameters: {
        additionalProperties: false,
        properties: {
          action: {
            enum: ["start", "request_join", "approve", "decline", "leave"],
            type: "string",
          },
          groupId: { type: "string" },
          targetUserId: { type: "string" },
        },
        required: ["action"],
        type: "object",
      },
    },
    type: "function",
  },
  async run(_context, args) {
    const requestedAction = readString(args.action);
    const action =
      requestedAction && groupActionValues.has(requestedAction)
        ? requestedAction
        : "start";

    return {
      data: {
        action,
        groupId: readString(args.groupId),
        previewRequired: true,
        targetUserId: readString(args.targetUserId),
      },
      ok: true,
      summary:
        "Group membership moves on the web for now, not over text. Send them to the listing on usekinfolk.com/apartments to start or join a group; never claim the change happened from this thread.",
      toolName: "manage_group",
    };
  },
};
