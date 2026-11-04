import { textAgentAllowedFactKeys } from "..";
import type { TextProfileFact } from "..";
import type { LiveTextProfileFactsPersistenceResult } from "../profile-persistence";
import { readToolFacts } from "./pref-fact-parsing";
import {
  describeScoreMotion,
  loadTopEdgeScores,
  scoreMotionSummary,
  type ScoreMotion,
} from "./score-motion";
import type { HousingAgentTool } from "./types";

const canonicalFactKeys = [...textAgentAllowedFactKeys];

export const updatePrefsTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Save user-submitted housing or roommate preference facts using Kinfolk canonical fact keys. If writes are not allowed, preview the validated facts without persisting them.",
      name: "update_prefs",
      parameters: {
        additionalProperties: false,
        properties: {
          facts: {
            items: {
              additionalProperties: true,
              properties: {
                evidence: { type: "string" },
                fact_key: {
                  description:
                    "Canonical Kinfolk fact key. Use budget_max for a one-sided hard rent cap, budget_preferred_max for a target/ideal cap below a stretch budget, neighborhoods for SF areas, move_in_window for move timing, household_size for numeric roommate openness, and group_size_flexibility for open-ended roommate flexibility.",
                  enum: canonicalFactKeys,
                  type: "string",
                },
                value: {},
              },
              required: ["fact_key", "value", "evidence"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["facts"],
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const facts = readToolFacts(args.facts);
    const skippedCount = Array.isArray(args.facts)
      ? args.facts.length - facts.length
      : 0;

    // Live write path: persist through Kinfolk's normal incremental path (which
    // also refreshes matching state) and wait for it, so the agent only ever
    // confirms in its own voice what actually reached the profile.
    if (context.allowWrites && context.message && context.thread && facts.length > 0) {
      const { persistIncrementalTextProfileFactsNow } = await import(
        "../profile-persistence"
      );
      // Snapshot the leaderboard before the save so the reply can narrate real
      // score motion ("that nudged Jack up to 84%") — the feedback half of the
      // give-a-fact → see-it-matter loop. Best-effort on both sides. Skipped
      // entirely mid-intake: the payoff only lands once the profile is real,
      // and narrating it during onboarding is the premature match talk the
      // intake gate exists to prevent.
      const edgesBefore = context.suppressScoreMotion
        ? null
        : await loadTopEdgeScores(context).catch(() => null);
      const persistence = await persistIncrementalTextProfileFactsNow(
        context.supabase,
        {
          body: context.body ?? "",
          facts,
          message: context.message,
          metadata: { extractor: "kinfolk_tool", model: null },
          sourceLabel: "Housing agent text update",
          thread: context.thread,
          userId: context.userId,
        },
      );

      let scoreMotion: ScoreMotion | null = null;
      if (edgesBefore && persistence.persistedFacts.length > 0) {
        const edgesAfter = await loadTopEdgeScores(context).catch(() => null);
        if (edgesAfter) {
          scoreMotion = describeScoreMotion(edgesBefore, edgesAfter);
        }
      }

      return {
        data: {
          failed: factPreviews(persistence.failedFacts),
          failureReason: persistence.failureMessage,
          persisted: factPreviews(persistence.persistedFacts),
          previewOnly: false,
          scoreMotion,
          skippedCount,
          skippedSensitive: factPreviews(persistence.skippedSensitiveFacts),
        },
        ok: persistence.failedFacts.length === 0,
        summary: [liveWriteSummary(persistence), scoreMotionSummary(scoreMotion)]
          .filter(Boolean)
          .join(" "),
        toolName: "update_prefs",
      };
    }

    return {
      data: {
        deferredForApproval: context.allowWrites ? [] : facts,
        persisted: [],
        previewOnly: !context.allowWrites,
        skippedCount,
      },
      ok: facts.length > 0,
      summary:
        facts.length > 0
          ? `Prepared ${facts.length} profile fact${facts.length === 1 ? "" : "s"} for Kinfolk's normal persistence path.`
          : "No valid Kinfolk profile facts were provided.",
      toolName: "update_prefs",
    };
  },
};

function factPreviews(facts: TextProfileFact[]) {
  return facts.map((fact) => ({ fact_key: fact.fact_key, value: fact.value }));
}

function liveWriteSummary(persistence: LiveTextProfileFactsPersistenceResult) {
  const parts: string[] = [];

  if (persistence.persistedFacts.length > 0) {
    parts.push(
      `Saved ${persistence.persistedFacts.length} preference${persistence.persistedFacts.length === 1 ? "" : "s"} to the user's profile.`,
    );
  }

  if (persistence.skippedSensitiveFacts.length > 0) {
    parts.push(
      `Kept ${factKeyList(persistence.skippedSensitiveFacts)} off their matching profile because it is sensitive - acknowledge it stays private, but do not claim it was saved.`,
    );
  }

  if (persistence.failedFacts.length > 0) {
    parts.push(
      `Failed to persist ${factKeyList(persistence.failedFacts)}${persistence.failureMessage ? ` (${persistence.failureMessage})` : ""} - the save did not go through, so tell the user that instead of confirming it.`,
    );
  }

  return parts.join(" ");
}

function factKeyList(facts: TextProfileFact[]) {
  return facts.map((fact) => fact.fact_key).join(", ");
}
