import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTopEdgeScores: vi.fn(),
  persistIncrementalTextProfileFactsNow: vi.fn(),
}));

vi.mock("../profile-persistence", () => ({
  persistIncrementalTextProfileFactsNow:
    mocks.persistIncrementalTextProfileFactsNow,
}));

vi.mock("./score-motion", async () => {
  const actual =
    await vi.importActual<typeof import("./score-motion")>("./score-motion");
  return { ...actual, loadTopEdgeScores: mocks.loadTopEdgeScores };
});

import { updatePrefsTool } from "./update-prefs";
import type { HousingAgentToolContext } from "./types";

const budgetFact = {
  evidence: "$3000 max",
  fact_key: "budget_max",
  value: 3000,
};

function context(
  overrides: Partial<HousingAgentToolContext> = {},
): HousingAgentToolContext {
  return {
    allowWrites: true,
    body: "$3000 max",
    message: { id: "message-1" } as never,
    supabase: {} as never,
    thread: { id: "thread-1" } as never,
    threadId: "thread-1",
    userId: "user-1",
    ...overrides,
  };
}

describe("update_prefs score motion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistIncrementalTextProfileFactsNow.mockResolvedValue({
      failedFacts: [],
      failureMessage: null,
      persistedFacts: [budgetFact],
      skippedSensitiveFacts: [],
    });
    mocks.loadTopEdgeScores
      .mockResolvedValueOnce([
        { name: "Jack", otherUserId: "u-jack", score: 54 },
      ])
      .mockResolvedValueOnce([
        { name: "Jack", otherUserId: "u-jack", score: 60 },
      ]);
  });

  it("narrates real movement when intake is done", async () => {
    const result = await updatePrefsTool.run(context(), {
      facts: [budgetFact],
    });

    expect(result.data.scoreMotion).toMatchObject({ after: 60, name: "Jack" });
    expect(result.summary).toContain("Score motion worth narrating");
  });

  // The live failure: mid-onboarding, "$3000 max" came back as "that moved Jack
  // up to 60% — he's your top match now", while the intake gate was telling the
  // same turn not to mention matches at all. Suppressing at the source leaves
  // the model nothing to narrate, so the two instructions cannot conflict.
  it("saves the fact but reports no motion while intake is active", async () => {
    const result = await updatePrefsTool.run(
      context({ suppressScoreMotion: true }),
      { facts: [budgetFact] },
    );

    expect(mocks.persistIncrementalTextProfileFactsNow).toHaveBeenCalledTimes(1);
    expect(mocks.loadTopEdgeScores).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.data.scoreMotion).toBeNull();
    expect(result.summary).toContain("Saved 1 preference");
    expect(result.summary).not.toContain("Score motion");
  });
});
