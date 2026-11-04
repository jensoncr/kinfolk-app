import { describe, expect, it } from "vitest";
import {
  loadLivingPlanPromptSummary,
  summarizeLivingPlanForPrompt,
  type LivingPlanContextRow,
} from "./living-plan-context";
import type { SupabaseServiceClient } from "./store-types";

const FULL_ROW: LivingPlanContextRow = {
  future_cities: ["Austin, TX", "New York, NY"],
  move_horizon: "3_6mo",
  relocation_flexibility: "flexible",
  intent_note: "Budget around $1,800 each, ideally with two friends.",
  intent_confirmed_at: "2026-07-01T00:00:00Z",
};

describe("summarizeLivingPlanForPrompt", () => {
  it("joins cities, timing, readiness, and note", () => {
    expect(summarizeLivingPlanForPrompt(FULL_ROW)).toBe(
      'thinking about Austin, TX, New York, NY; timing in 3–6 months; flexible timing; their note: "Budget around $1,800 each, ideally with two friends."',
    );
  });

  it("returns empty for a missing row", () => {
    expect(summarizeLivingPlanForPrompt(null)).toBe("");
  });

  it("returns empty for an unconfirmed default row", () => {
    expect(
      summarizeLivingPlanForPrompt({ ...FULL_ROW, intent_confirmed_at: null }),
    ).toBe("");
  });

  it("skips empty fields and unknown enum values", () => {
    expect(
      summarizeLivingPlanForPrompt({
        future_cities: ["  ", "Denver, CO"],
        move_horizon: "someday",
        relocation_flexibility: null,
        intent_note: "   ",
        intent_confirmed_at: "2026-07-01T00:00:00Z",
      }),
    ).toBe("thinking about Denver, CO");
  });

  it("truncates long notes", () => {
    const summary = summarizeLivingPlanForPrompt({
      ...FULL_ROW,
      intent_note: "x".repeat(600),
    });
    expect(summary).toContain(`"${"x".repeat(240)}"`);
  });
});

describe("loadLivingPlanPromptSummary", () => {
  function stubClient(result: { data: LivingPlanContextRow | null; error: unknown }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => result,
          }),
        }),
      }),
    } as unknown as SupabaseServiceClient;
  }

  it("summarizes the loaded row", async () => {
    const summary = await loadLivingPlanPromptSummary(
      stubClient({ data: FULL_ROW, error: null }),
      "user-1",
    );
    expect(summary).toContain("thinking about Austin, TX");
  });

  it("throws on query error so the caller falls back", async () => {
    await expect(
      loadLivingPlanPromptSummary(
        stubClient({ data: null, error: new Error("boom") }),
        "user-1",
      ),
    ).rejects.toThrow("boom");
  });
});
