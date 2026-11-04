import type { HousingAgentTool } from "./types";

function readOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "on" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "off" || normalized === "no") {
      return false;
    }
  }
  return null;
}

/**
 * set_notification_prefs — lets the user manage proactive iMessage
 * notifications from the conversation itself ("text me when I get a new
 * roommate match", "stop the apartment alerts").
 *
 * The user texting from their verified phone IS the consent surface, so an
 * explicit ask may enable a kind directly — but only an explicit ask: the
 * soul forbids suggesting or enabling notifications the user didn't request.
 */
export const setNotificationPrefsTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Turn Kinfolk's proactive text notifications on or off for this user. Use ONLY when the user explicitly asks to be texted (or to stop being texted) about a kind: apartment matches, roommate matches, their group filling up, or occasional profile questions. Pass just the kinds the user mentioned.",
      name: "set_notification_prefs",
      parameters: {
        additionalProperties: false,
        properties: {
          apartment_matches: {
            description: "Text the user when a new apartment match lands.",
            type: "boolean",
          },
          group_ready: {
            description: "Text the user when their roommate group fills up.",
            type: "boolean",
          },
          profile_questions: {
            description:
              "Text at most one optional profile-matching question every seven days.",
            type: "boolean",
          },
          roommate_matches: {
            description: "Text the user when a new high-fit roommate match lands.",
            type: "boolean",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const changes: Record<string, boolean> = {};
    const apartment = readOptionalBoolean(args.apartment_matches);
    const roommate = readOptionalBoolean(args.roommate_matches);
    const groupReady = readOptionalBoolean(args.group_ready);
    const profileQuestions = readOptionalBoolean(args.profile_questions);
    if (apartment != null) changes.apartment_matches_enabled = apartment;
    if (roommate != null) changes.roommate_matches_enabled = roommate;
    if (groupReady != null) changes.group_ready_enabled = groupReady;
    if (profileQuestions != null) {
      changes.profile_questions_enabled = profileQuestions;
    }

    if (Object.keys(changes).length === 0) {
      return {
        data: { updated: {} },
        ok: false,
        summary:
          "No notification kind was specified — pass the kinds the user explicitly asked about.",
        toolName: "set_notification_prefs",
      };
    }

    if (!context.allowWrites) {
      return {
        data: { previewOnly: true, updated: changes },
        ok: true,
        summary: "Preview only; writes are disabled for this turn.",
        toolName: "set_notification_prefs",
      };
    }

    const upsert = await context.supabase
      .from("match_notification_prefs")
      .upsert(
        { user_id: context.userId, ...changes },
        { onConflict: "user_id" },
      )
      .select("apartment_matches_enabled,roommate_matches_enabled,group_ready_enabled,profile_questions_enabled")
      .single();
    if (upsert.error) throw upsert.error;

    const state = upsert.data;
    const describe = (label: string, enabled: boolean) =>
      `${label}: ${enabled ? "on" : "off"}`;
    return {
      data: { previewOnly: false, state, updated: changes },
      ok: true,
      summary: `Notification texts updated — ${[
        describe("apartment matches", state.apartment_matches_enabled),
        describe("roommate matches", state.roommate_matches_enabled),
        describe("group ready", state.group_ready_enabled),
        describe("profile questions", state.profile_questions_enabled),
      ].join(", ")}. Quiet hours and daily caps still apply.`,
      toolName: "set_notification_prefs",
    };
  },
};
