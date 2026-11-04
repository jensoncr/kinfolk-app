import { readPositiveLimit } from "./args";
import {
  isEarlyReadRoommateMatch,
  isViableRoommateMatch,
} from "../../matching/roommate-match-viability";
import type { HousingAgentTool } from "./types";

export const getMatchesTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Read the user's current roommate matches and pending group requests.",
      name: "get_matches",
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description:
              "Maximum roommate matches to return. Default 3 — only go higher when the user explicitly asks for more.",
            type: "number",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const [
      { getMatchesSnapshotForUserId },
      { buildRoommateProfileCardUrl },
      { buildRoommateMatchProfileCardSnapshot },
      { getKinfolkPublicMediaBaseUrl },
    ] = await Promise.all([
      import("../../matching/matches"),
      import("../../profiles/profile-card"),
      import("../roommate-cards"),
      import("../store-shared"),
    ]);
    const limit = readPositiveLimit(args.limit, 3, 10);
    const snapshot = await getMatchesSnapshotForUserId(
      context.userId,
      context.supabase,
    );

    if (snapshot.status !== "connected") {
      return {
        data: { detail: snapshot.detail, status: snapshot.status },
        ok: false,
        summary: snapshot.detail,
        toolName: "get_matches",
      };
    }

    const viableRoommates = snapshot.roommates.filter(isViableRoommateMatch);
    const topRoommates = viableRoommates.slice(0, limit);
    // The engine's confidence meta rides along with every score: without it
    // the model can only present "67%" as certainty, which is exactly the
    // zero-signal-profile overclaim seen live. earlyRead is the same
    // threshold the web matches pane uses for its range badge.
    const roommates = topRoommates.map((roommate) => ({
      coverage: roommate.coverage,
      earlyRead: isEarlyReadRoommateMatch(roommate),
      evidence: roommate.evidence.slice(0, 3),
      name: roommate.name,
      risks: roommate.risks.slice(0, 3),
      score: roommate.score,
      scoreRange:
        roommate.scoreLow != null && roommate.scoreHigh != null
          ? `${roommate.scoreLow}-${roommate.scoreHigh}`
          : null,
      userId: roommate.userId,
    }));

    const baseUrl = getKinfolkPublicMediaBaseUrl();
    const media = baseUrl
      ? topRoommates.map((roommate) => ({
          label: roommate.name,
          url: buildRoommateProfileCardUrl({
            baseUrl,
            snapshot: buildRoommateMatchProfileCardSnapshot(roommate),
          }),
        }))
      : [];

    const gatedCount = snapshot.roommates.length - viableRoommates.length;

    let summary: string;
    if (roommates.length > 0) {
      summary = `Found ${roommates.length} roommate match${roommates.length === 1 ? "" : "es"}.`;
      if (roommates.every((roommate) => roommate.earlyRead)) {
        summary +=
          " All of these are EARLY READS: the scores rest on thin two-sided data (see scoreRange). Present them as rough first cuts that will move, never as confident percentages, and only give reasons the evidence list actually contains.";
      }
    } else if (gatedCount > 0) {
      summary = `No roommate lines up on your hard constraints yet (budget, move-in dates, or age). ${gatedCount} nearby ${gatedCount === 1 ? "person is" : "people are"} close on lifestyle but blocked on those — widen the budget or dates to surface them.`;
    } else {
      summary = "No roommate matches are ready yet.";
    }

    return {
      data: {
        gatedCount,
        pendingRequestCount: snapshot.requests.length,
        roommates,
      },
      media,
      ok: true,
      summary,
      toolName: "get_matches",
    };
  },
};
