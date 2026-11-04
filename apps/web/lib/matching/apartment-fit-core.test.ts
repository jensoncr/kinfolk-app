import { describe, expect, it } from "vitest";
import {
  apartmentFitBreakdown,
  apartmentFitScore,
  clampFit,
  perPersonRent,
  recommendedHouseholdSizeCore,
  withinBudget,
  type FitInputs,
  FIT_CLAMP_MAX,
  FIT_CLAMP_MIN,
} from "./apartment-fit-core";

describe("recommendedHouseholdSizeCore", () => {
  it("caps at bedrooms when householdSizeMax exceeds bedrooms (2bd, max 5 → 2)", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: 5, bedrooms: 2 })).toBe(2);
  });

  it("caps at 4 even for large bedroom counts (5bd, max 5 → 4, the product 4-person cap)", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: 5, bedrooms: 5 })).toBe(4);
  });

  it("returns 1 for 0 bedrooms (studio)", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: 3, bedrooms: 0 })).toBe(1);
  });

  it("returns 1 for null bedrooms", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: 3, bedrooms: null })).toBe(1);
  });

  it("returns 1 when householdSizeMax is 0", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: 0, bedrooms: 3 })).toBe(1);
  });

  it("returns 1 when householdSizeMax is null", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: null, bedrooms: 3 })).toBe(1);
  });

  it("exact bedroom count: 3bd max 3 → 3", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: 3, bedrooms: 3 })).toBe(3);
  });

  it("floors fractional bedrooms (2.7bd, max 4 → 2)", () => {
    expect(recommendedHouseholdSizeCore({ householdSizeMax: 4, bedrooms: 2.7 })).toBe(2);
  });
});

describe("perPersonRent", () => {
  it("evenly divides rent (3000 / 2 = 1500)", () => {
    expect(perPersonRent(3000, 2)).toBe(1500);
  });

  it("rounds — does NOT ceil (3001 / 2 = 1500.5 → rounds to 1501)", () => {
    // Math.round(1500.5) === 1501; Math.ceil(1500.5) === 1501 — same here.
    expect(perPersonRent(3001, 2)).toBe(1501);
  });

  it("rounds half-up correctly: 2999 / 2 = 1499.5 → 1500 (NOT ceil which would also be 1500)", () => {
    // round(1499.5) === 1500; ceil(1499.5) === 1500 — same, but documents intent.
    expect(perPersonRent(2999, 2)).toBe(1500);
  });

  it("round vs ceil diverge: 3001 / 3 = 1000.333… → round=1000, ceil=1001", () => {
    // Canonical choice is Math.round, not Math.ceil.
    expect(perPersonRent(3001, 3)).toBe(1000);
  });

  it("solo household: 2500 / 1 = 2500", () => {
    expect(perPersonRent(2500, 1)).toBe(2500);
  });
});

describe("withinBudget", () => {
  it("returns true when effectivePerPersonRent equals budgetMax", () => {
    expect(withinBudget(3000, null, 3000)).toBe(true);
  });

  it("returns true when effectivePerPersonRent is at budgetMax + 150 (inclusive tolerance)", () => {
    expect(withinBudget(3150, null, 3000)).toBe(true);
  });

  it("returns false when effectivePerPersonRent exceeds budgetMax + 150 by even $1", () => {
    expect(withinBudget(3151, null, 3000)).toBe(false);
  });

  it("returns false when effectivePerPersonRent is below budgetMin", () => {
    expect(withinBudget(800, 1000, null)).toBe(false);
  });

  it("returns true when effectivePerPersonRent equals budgetMin", () => {
    expect(withinBudget(1000, 1000, null)).toBe(true);
  });

  it("returns true when both bounds are null (no budget set)", () => {
    expect(withinBudget(5000, null, null)).toBe(true);
  });

  it("returns true within a full range", () => {
    expect(withinBudget(2000, 1000, 3000)).toBe(true);
  });
});

describe("clampFit", () => {
  it(`clamps below FIT_CLAMP_MIN (${FIT_CLAMP_MIN}) up to min`, () => {
    expect(clampFit(30)).toBe(FIT_CLAMP_MIN);
  });

  it(`clamps above FIT_CLAMP_MAX (${FIT_CLAMP_MAX}) down to max`, () => {
    expect(clampFit(99)).toBe(FIT_CLAMP_MAX);
  });

  it("passes through in-range values unchanged", () => {
    expect(clampFit(75)).toBe(75);
  });
});

describe("apartmentFitScore", () => {
  it("base-only inputs produce clamped base score (62 → 62, within [50,96])", () => {
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: null,
        effectivePerPersonRent: 2000,
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 0,
      }),
    ).toBe(62);
  });

  it("high budget delta (>400) + neighborhood + 1 matched must-have", () => {
    // base 62 + budget_high 16 + neighborhood 14 + must_have_match min(12, 1*4)=4 = 96
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: 3000,
        effectivePerPersonRent: 2000, // delta = 1000 > 400
        neighborhoodMatches: true,
        mustHavesMatched: 1,
        mustHavesUnconfirmed: 0,
      }),
    ).toBe(96);
  });

  it("clamps at FIT_CLAMP_MAX (96) when score would exceed it", () => {
    // base 62 + 16 + 14 + min(12,3*4)=12 = 104 → clamped to 96
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: 5000,
        effectivePerPersonRent: 1000, // delta = 4000 > 400
        neighborhoodMatches: true,
        mustHavesMatched: 3,
        mustHavesUnconfirmed: 0,
      }),
    ).toBe(96);
  });

  it("surface-only terms are off by default", () => {
    // No splitActive, petBonus, extraUnitsBonus — same as base-only
    const withDefaults = apartmentFitScore({
      budgetMin: null,
      budgetMax: null,
      effectivePerPersonRent: 2000,
      neighborhoodMatches: false,
      mustHavesMatched: 0,
      mustHavesUnconfirmed: 0,
    });
    expect(withDefaults).toBe(62);
  });

  it("surface-only terms fire when explicitly set", () => {
    // base 62 + split 5 + pet 2 + extraUnits 3 = 72 (no budget, no neighborhood)
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: null,
        effectivePerPersonRent: 2000,
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 0,
        splitActive: true,
        petBonus: 2,
        extraUnitsBonus: 3,
      }),
    ).toBe(72);
  });

  it("behavioralDelta adjusts score (DB path only)", () => {
    // base 62 + behavioralDelta -5 = 57
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: null,
        effectivePerPersonRent: 2000,
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 0,
        behavioralDelta: -5,
      }),
    ).toBe(57);
  });

  it("budget-bonus boundary: delta === 400 uses BUDGET_BONUS_STD (10), not HIGH (16)", () => {
    // delta = budgetMax - effectivePerPersonRent = 400 → NOT > 400 → +10
    // base 62 + 10 = 72
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: 2400,
        effectivePerPersonRent: 2000, // delta = 400
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 0,
      }),
    ).toBe(72);
  });

  it("budget-bonus boundary: delta === 401 uses BUDGET_BONUS_HIGH (16)", () => {
    // delta = 401 → > 400 → +16
    // base 62 + 16 = 78
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: 2401,
        effectivePerPersonRent: 2000, // delta = 401
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 0,
      }),
    ).toBe(78);
  });

  it("budget-min-only adds +8", () => {
    // base 62 + 8 = 70
    expect(
      apartmentFitScore({
        budgetMin: 1000,
        budgetMax: null,
        effectivePerPersonRent: 2000,
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 0,
      }),
    ).toBe(70);
  });

  it("unconfirmed must-haves subtract using DB caps (min(10, n*3))", () => {
    // base 62 + budget_std 10 − unconfirmed min(10, 4*3)=10 = 62
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: 2200,
        effectivePerPersonRent: 2000, // delta = 200 → std 10
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 4,
      }),
    ).toBe(62);
  });

  it("score below FIT_CLAMP_MIN is clamped to 50", () => {
    // base 62 − min(10, 5*3)=10 − min(10, 5*3)=10 already gone by cap
    // base 62 − 10 (unconf) = 52; additional petBonus -2 = 50; clamped at 50
    expect(
      apartmentFitScore({
        budgetMin: null,
        budgetMax: null,
        effectivePerPersonRent: 2000,
        neighborhoodMatches: false,
        mustHavesMatched: 0,
        mustHavesUnconfirmed: 5, // -10 (cap)
        petBonus: -2,
        behavioralDelta: -5,
      }),
    ).toBe(50); // 62 - 10 - 2 - 5 = 45 → clamped to 50
  });
});

describe("apartmentFitBreakdown", () => {
  const sampleInputs: FitInputs[] = [
    {
      budgetMin: null,
      budgetMax: 3000,
      effectivePerPersonRent: 2000, // delta 1000 → high
      neighborhoodMatches: true,
      mustHavesMatched: 1,
      mustHavesUnconfirmed: 0,
    },
    {
      budgetMin: 1000,
      budgetMax: null,
      effectivePerPersonRent: 2000,
      neighborhoodMatches: false,
      mustHavesMatched: 0,
      mustHavesUnconfirmed: 4,
      splitActive: true,
      petBonus: -2,
      extraUnitsBonus: 3,
    },
    {
      budgetMin: null,
      budgetMax: 1800,
      effectivePerPersonRent: 2200, // over budget
      neighborhoodMatches: false,
      mustHavesMatched: 0,
      mustHavesUnconfirmed: 0,
    },
  ];

  it("rows always sum to raw, and clamp(raw) equals apartmentFitScore", () => {
    for (const inputs of sampleInputs) {
      const breakdown = apartmentFitBreakdown(inputs);
      const sum = breakdown.rows.reduce((acc, row) => acc + row.points, 0);
      expect(sum).toBe(breakdown.raw);
      expect(breakdown.total).toBe(clampFit(Math.round(breakdown.raw)));
      expect(breakdown.total).toBe(apartmentFitScore(inputs));
    }
  });

  it("always opens with the base row and includes budget + neighborhood", () => {
    const breakdown = apartmentFitBreakdown(sampleInputs[0]!);
    expect(breakdown.rows[0]).toEqual({
      key: "base",
      label: "Starting fit",
      points: 62,
    });
    const keys = breakdown.rows.map((row) => row.key);
    expect(keys).toContain("budget");
    expect(keys).toContain("neighborhood");
  });

  it("shows over-budget and outside-neighborhood as evaluated 0-point rows", () => {
    const breakdown = apartmentFitBreakdown(sampleInputs[2]!);
    const budget = breakdown.rows.find((row) => row.key === "budget");
    const neighborhood = breakdown.rows.find((row) => row.key === "neighborhood");
    expect(budget).toEqual({ key: "budget", label: "Over budget", points: 0 });
    expect(neighborhood?.points).toBe(0);
  });

  it("adds a savedPlace row when the saved-place taste bonus applies", () => {
    const base: FitInputs = {
      budgetMin: null,
      budgetMax: 3000,
      effectivePerPersonRent: 2800,
      neighborhoodMatches: false,
      mustHavesMatched: 0,
      mustHavesUnconfirmed: 0,
    };

    const without = apartmentFitScore(base);
    const breakdown = apartmentFitBreakdown({ ...base, savedPlaceBonus: 8 });
    const savedRow = breakdown.rows.find((row) => row.key === "savedPlace");

    expect(savedRow).toEqual({
      key: "savedPlace",
      label: "Matches places you saved",
      points: 8,
    });
    expect(breakdown.total).toBe(without + 8);
  });
});
