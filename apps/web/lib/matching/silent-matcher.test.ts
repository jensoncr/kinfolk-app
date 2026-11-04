import { beforeEach, describe, expect, it, vi } from "vitest";

// Must mock server-only before importing the module under test.
vi.mock("server-only", () => ({}));

// Mock ensureCompatibilityEdgesForPairs — the only scoring/persist side-effect.
// (scoreCompatibility is called inside enrichment-store; we don't call it directly.)
// Use vi.hoisted so the variable is available inside the vi.mock factory (which
// is hoisted to the top of the file before other imports are resolved).
const { mockEnsureEdges } = vi.hoisted(() => ({
  mockEnsureEdges: vi.fn(),
}));
vi.mock("@/lib/profiles/enrichment-store", () => ({
  ensureCompatibilityEdgesForPairs: mockEnsureEdges,
}));

import {
  buildCandidatePairs,
  filterEligiblePlans,
  horizonBandsOverlap,
  normalizeCity,
  runSilentMatcherSweep,
  sharedNormalizedCities,
  type EligiblePlan,
} from "./silent-matcher";

// ---------------------------------------------------------------------------
// Helper to build a complete living_plans row
// ---------------------------------------------------------------------------
function planRow(overrides: Partial<{
  user_id: string;
  future_cities: string[];
  move_horizon: string | null;
  relocation_flexibility: string | null;
  intent_confirmed_at: string | null;
  silent_matcher_enabled: boolean;
}> = {}) {
  return {
    user_id: "user-default",
    future_cities: ["New York"],
    move_horizon: "lt_3mo",
    relocation_flexibility: "flexible",
    intent_confirmed_at: "2026-01-01T00:00:00Z",
    silent_matcher_enabled: true,
    ...overrides,
  };
}

// Helper to build a fake Supabase client whose from("living_plans").select().eq()
// resolves to the given rows.
function makeSupabase(rows: ReturnType<typeof planRow>[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as Parameters<typeof runSilentMatcherSweep>[0];
}

// ---------------------------------------------------------------------------
// Case 6 — Pure helpers (no mocks needed, run first)
// ---------------------------------------------------------------------------

describe("normalizeCity", () => {
  it("lowercases and trims", () => {
    expect(normalizeCity("  New York  ")).toBe("new york");
    expect(normalizeCity("San Francisco")).toBe("san francisco");
    expect(normalizeCity("AUSTIN")).toBe("austin");
  });

  it("does not alter already-normalized strings", () => {
    expect(normalizeCity("boston")).toBe("boston");
  });
});

describe("horizonBandsOverlap", () => {
  it("same band overlaps", () => {
    expect(horizonBandsOverlap("now", "now")).toBe(true);
    expect(horizonBandsOverlap("3_6mo", "3_6mo")).toBe(true);
  });

  it("adjacent bands overlap", () => {
    expect(horizonBandsOverlap("now", "lt_3mo")).toBe(true);
    expect(horizonBandsOverlap("lt_3mo", "3_6mo")).toBe(true);
    expect(horizonBandsOverlap("3_6mo", "6_12mo")).toBe(true);
    expect(horizonBandsOverlap("6_12mo", "1_2yr")).toBe(true);
  });

  it("non-adjacent bands do not overlap", () => {
    expect(horizonBandsOverlap("now", "3_6mo")).toBe(false);
    expect(horizonBandsOverlap("now", "6_12mo")).toBe(false);
    expect(horizonBandsOverlap("now", "1_2yr")).toBe(false);
    expect(horizonBandsOverlap("lt_3mo", "6_12mo")).toBe(false);
    expect(horizonBandsOverlap("lt_3mo", "1_2yr")).toBe(false);
    expect(horizonBandsOverlap("3_6mo", "1_2yr")).toBe(false);
  });

  it("'exploring' overlaps with every horizon", () => {
    for (const h of ["now", "lt_3mo", "3_6mo", "6_12mo", "1_2yr", "exploring"]) {
      expect(horizonBandsOverlap("exploring", h)).toBe(true);
      expect(horizonBandsOverlap(h, "exploring")).toBe(true);
    }
  });
});

describe("sharedNormalizedCities", () => {
  it("returns intersection normalized", () => {
    expect(sharedNormalizedCities(["New York", "Austin"], ["AUSTIN", "Boston"])).toEqual([
      "austin",
    ]);
  });

  it("returns empty when no overlap", () => {
    expect(sharedNormalizedCities(["New York"], ["Austin"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Case 1 — Opt-out users are skipped
// ---------------------------------------------------------------------------

describe("filterEligiblePlans — opt-out users are skipped", () => {
  it("excludes user B (silent_matcher_enabled=false) and includes A and C", () => {
    const rows = [
      planRow({ user_id: "A", future_cities: ["New York"] }),
      planRow({ user_id: "B", future_cities: ["New York"], silent_matcher_enabled: false }),
      planRow({ user_id: "C", future_cities: ["New York"] }),
    ];
    const eligible = filterEligiblePlans(rows);
    const ids = eligible.map((p) => p.userId);
    expect(ids).toContain("A");
    expect(ids).toContain("C");
    expect(ids).not.toContain("B");
  });
});

describe("runSilentMatcherSweep — opt-out users never reach scoring", () => {
  beforeEach(() => {
    mockEnsureEdges.mockReset();
    mockEnsureEdges.mockResolvedValue([{ userAId: "A", userBId: "C", score: 75, reasons: [] }]);
  });

  it("never calls ensureCompatibilityEdgesForPairs with opt-out user B's id", async () => {
    const rows = [
      planRow({ user_id: "A", future_cities: ["New York"] }),
      planRow({ user_id: "B", future_cities: ["New York"], silent_matcher_enabled: false }),
      planRow({ user_id: "C", future_cities: ["New York"] }),
    ];
    await runSilentMatcherSweep(makeSupabase(rows));

    for (const call of mockEnsureEdges.mock.calls) {
      const [, viewerId, candidateIds] = call as [unknown, string, string[]];
      expect(viewerId).not.toBe("B");
      expect(candidateIds).not.toContain("B");
    }
  });
});

// ---------------------------------------------------------------------------
// Case 2 — Field-incomplete users are skipped
// ---------------------------------------------------------------------------

describe("filterEligiblePlans — field-incomplete users are skipped", () => {
  it("excludes plan with intent_confirmed_at = null", () => {
    const eligible = filterEligiblePlans([
      planRow({ user_id: "incomplete", intent_confirmed_at: null }),
      planRow({ user_id: "complete" }),
    ]);
    expect(eligible.map((p) => p.userId)).not.toContain("incomplete");
    expect(eligible.map((p) => p.userId)).toContain("complete");
  });

  it("excludes plan with empty future_cities", () => {
    const eligible = filterEligiblePlans([
      planRow({ user_id: "no-cities", future_cities: [] }),
      planRow({ user_id: "has-cities" }),
    ]);
    expect(eligible.map((p) => p.userId)).not.toContain("no-cities");
    expect(eligible.map((p) => p.userId)).toContain("has-cities");
  });

  it("excludes plan with move_horizon = null", () => {
    const eligible = filterEligiblePlans([
      planRow({ user_id: "no-horizon", move_horizon: null }),
      planRow({ user_id: "has-horizon" }),
    ]);
    expect(eligible.map((p) => p.userId)).not.toContain("no-horizon");
    expect(eligible.map((p) => p.userId)).toContain("has-horizon");
  });
});

describe("runSilentMatcherSweep — incomplete plans never reach scoring", () => {
  beforeEach(() => {
    mockEnsureEdges.mockReset();
    mockEnsureEdges.mockResolvedValue([]);
  });

  it("incomplete user id never appears in any scoring call", async () => {
    const rows = [
      planRow({ user_id: "incomplete", intent_confirmed_at: null }),
      planRow({ user_id: "A" }),
      planRow({ user_id: "B" }),
    ];
    await runSilentMatcherSweep(makeSupabase(rows));

    for (const call of mockEnsureEdges.mock.calls) {
      const [, viewerId, candidateIds] = call as [unknown, string, string[]];
      expect(viewerId).not.toBe("incomplete");
      expect(candidateIds).not.toContain("incomplete");
    }
  });
});

// ---------------------------------------------------------------------------
// Case 3 — relocation_flexibility = 'locked' is skipped; others included
// ---------------------------------------------------------------------------

describe("filterEligiblePlans — locked flexibility is excluded", () => {
  it("excludes 'locked', includes 'some', 'flexible', 'ready'", () => {
    const rows = [
      planRow({ user_id: "locked-user", relocation_flexibility: "locked" }),
      planRow({ user_id: "null-flex", relocation_flexibility: null }),
      planRow({ user_id: "some-user", relocation_flexibility: "some" }),
      planRow({ user_id: "flexible-user", relocation_flexibility: "flexible" }),
      planRow({ user_id: "ready-user", relocation_flexibility: "ready" }),
    ];
    const eligible = filterEligiblePlans(rows);
    const ids = eligible.map((p) => p.userId);
    expect(ids).not.toContain("locked-user");
    expect(ids).not.toContain("null-flex");
    expect(ids).toContain("some-user");
    expect(ids).toContain("flexible-user");
    expect(ids).toContain("ready-user");
  });
});

// ---------------------------------------------------------------------------
// Case 4 — City + horizon gate controls which pairs reach scoring
// ---------------------------------------------------------------------------

describe("buildCandidatePairs — city + horizon gate", () => {
  const eligibleBase = (overrides: Partial<EligiblePlan>): EligiblePlan => ({
    userId: "user",
    futureCities: ["new york"],
    moveHorizon: "lt_3mo",
    relocationFlexibility: "flexible",
    ...overrides,
  });

  it("does NOT pair users who share no normalized city", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "A", futureCities: ["New York"] }),
      eligibleBase({ userId: "B", futureCities: ["Austin"] }),
    ];
    expect(buildCandidatePairs(plans)).toHaveLength(0);
  });

  it("does NOT pair users whose horizons are >1 band apart (now vs 1_2yr)", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "A", moveHorizon: "now" }),
      eligibleBase({ userId: "B", moveHorizon: "1_2yr" }),
    ];
    expect(buildCandidatePairs(plans)).toHaveLength(0);
  });

  it("does NOT pair users whose horizons are 2 bands apart (now vs 3_6mo)", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "A", moveHorizon: "now" }),
      eligibleBase({ userId: "B", moveHorizon: "3_6mo" }),
    ];
    expect(buildCandidatePairs(plans)).toHaveLength(0);
  });

  it("DOES pair users sharing a city with adjacent horizons", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "A", moveHorizon: "lt_3mo" }),
      eligibleBase({ userId: "B", moveHorizon: "3_6mo" }),
    ];
    const pairs = buildCandidatePairs(plans);
    expect(pairs).toHaveLength(1);
    const ids = pairs[0];
    expect(ids).toContain("A");
    expect(ids).toContain("B");
  });

  it("DOES pair 'exploring' user with any horizon", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "A", moveHorizon: "exploring" }),
      eligibleBase({ userId: "B", moveHorizon: "1_2yr" }),
    ];
    const pairs = buildCandidatePairs(plans);
    expect(pairs).toHaveLength(1);
  });

  it("does NOT pair 'exploring' user when they share no city", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "A", moveHorizon: "exploring", futureCities: ["Austin"] }),
      eligibleBase({ userId: "B", moveHorizon: "1_2yr", futureCities: ["Boston"] }),
    ];
    expect(buildCandidatePairs(plans)).toHaveLength(0);
  });

  it("city matching is case-insensitive (normalized)", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "A", futureCities: ["New York"] }),
      eligibleBase({ userId: "B", futureCities: ["new york"] }),
    ];
    expect(buildCandidatePairs(plans)).toHaveLength(1);
  });

  it("produces sorted pair ids (user_a_id < user_b_id)", () => {
    const plans: EligiblePlan[] = [
      eligibleBase({ userId: "zz-user" }),
      eligibleBase({ userId: "aa-user" }),
    ];
    const pairs = buildCandidatePairs(plans);
    expect(pairs[0][0]).toBe("aa-user");
    expect(pairs[0][1]).toBe("zz-user");
  });
});

// ---------------------------------------------------------------------------
// Case 5 — Nothing is sent or revealed
// ---------------------------------------------------------------------------

describe("runSilentMatcherSweep — nothing sent or revealed", () => {
  beforeEach(() => {
    mockEnsureEdges.mockReset();
    mockEnsureEdges.mockResolvedValue([
      { userAId: "A", userBId: "B", score: 80, reasons: [] },
    ]);
  });

  it("returns counts and calls only ensureCompatibilityEdgesForPairs (no other side-effects)", async () => {
    const rows = [
      planRow({ user_id: "A", future_cities: ["New York"] }),
      planRow({ user_id: "B", future_cities: ["New York"] }),
    ];
    const result = await runSilentMatcherSweep(makeSupabase(rows));

    // Returns count shape
    expect(result).toHaveProperty("scannedUsers");
    expect(result).toHaveProperty("pairsConsidered");
    expect(result).toHaveProperty("candidatesWritten");
    expect(result.scannedUsers).toBe(2);
    expect(result.pairsConsidered).toBe(1);

    // Only ensureCompatibilityEdgesForPairs was called — no notify/transport
    expect(mockEnsureEdges).toHaveBeenCalled();
  });

  it("result does not contain any revealed_at or user-facing identity", async () => {
    const rows = [
      planRow({ user_id: "A", future_cities: ["Boston"] }),
      planRow({ user_id: "B", future_cities: ["Boston"] }),
    ];
    const result = await runSilentMatcherSweep(makeSupabase(rows));

    // The return value is counts-only — no user ids, no names, no revealed_at
    const keys = Object.keys(result);
    expect(keys).toEqual(["scannedUsers", "pairsConsidered", "candidatesWritten"]);
  });

  it("when fewer than 2 eligible users exist, returns zeros without calling scorer", async () => {
    const rows = [planRow({ user_id: "solo" })];
    const result = await runSilentMatcherSweep(makeSupabase(rows));
    expect(result.pairsConsidered).toBe(0);
    expect(result.candidatesWritten).toBe(0);
    expect(mockEnsureEdges).not.toHaveBeenCalled();
  });

  it("when DB returns error, returns zero counts without throwing", async () => {
    const failingSupabase = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: new Error("db error") }),
        }),
      }),
    } as unknown as Parameters<typeof runSilentMatcherSweep>[0];

    const result = await runSilentMatcherSweep(failingSupabase);
    expect(result).toEqual({ scannedUsers: 0, pairsConsidered: 0, candidatesWritten: 0 });
    expect(mockEnsureEdges).not.toHaveBeenCalled();
  });
});
