import { describe, expect, it } from "vitest";
import type { TextProfileFact } from "@/lib/text-agent";
import { buildTextAgentConversationState } from "./state";

describe("text agent conversation state", () => {
  it("derives foundation and roommate readiness from app-owned facts", () => {
    const state = buildTextAgentConversationState({
      facts: [
        fact("neighborhoods", ["Hayes Valley", "Lower Haight"]),
        fact("budget", { min: 2800, max: 3800 }),
        fact("move_in_window", { start: "2026-07-01", end: "2026-08-01" }),
        fact("group_size_flexibility", "Open to roommates"),
        fact("sleep_schedule", "early-ish"),
        fact("work_from_home", "hybrid"),
        fact("noise_tolerance", "quiet weeknights"),
      ],
      lastIntent: "profile_update",
      nextIntakeStep: null,
    });

    expect(state.foundation_readiness).toEqual({
      budget: true,
      move_in: true,
      neighborhoods: true,
      roommate_openness: true,
    });
    expect(state.roommate_readiness).toEqual({
      compatibility_answer_count: 3,
      open_to_roommates: true,
      ready_for_roommate_cards: true,
    });
  });

  it("keeps solo users out of roommate-card readiness", () => {
    const state = buildTextAgentConversationState({
      facts: [
        fact("household_size", { min: 1, max: 1 }),
        fact("sleep_schedule", "late"),
        fact("work_from_home", "mostly home"),
        fact("cleanliness", "very clean"),
      ],
      lastIntent: "roommate_conversation",
      nextIntakeStep: null,
    });

    expect(state.active_mode).toBe("roommate_search");
    expect(state.roommate_readiness).toMatchObject({
      compatibility_answer_count: 3,
      open_to_roommates: false,
      ready_for_roommate_cards: false,
    });
  });
});

function fact(
  factKey: string,
  value: TextProfileFact["value"],
): TextProfileFact {
  return {
    assertion_type: "explicit",
    confidence: 1,
    dimension: "feasibility",
    evidence: String(value),
    fact_key: factKey,
    importance: 1,
    matching_eligible: true,
    sensitivity_level: "standard",
    value,
  };
}
