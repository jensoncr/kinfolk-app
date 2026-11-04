import { describe, expect, it } from "vitest";
import {
  countSavedAreaOverlap,
  countSavedListingOverlap,
  normalizeAreaLabel,
  savedListingFitBonus,
  savedTasteCompatBonus,
} from "./saved-place-taste";

describe("normalizeAreaLabel", () => {
  it("lowercases and trims", () => {
    expect(normalizeAreaLabel("  Mission ")).toBe("mission");
    expect(normalizeAreaLabel("The Castro")).toBe("the castro");
  });
});

describe("countSavedAreaOverlap", () => {
  it("returns 0 when either array is empty", () => {
    expect(countSavedAreaOverlap([], ["Mission"])).toBe(0);
    expect(countSavedAreaOverlap(["Mission"], [])).toBe(0);
    expect(countSavedAreaOverlap([], [])).toBe(0);
  });

  it("counts case-insensitive area label matches", () => {
    expect(countSavedAreaOverlap(["Mission"], ["  mission "])).toBe(1);
    expect(countSavedAreaOverlap(["Mission", "Castro"], ["castro", "Noe Valley"])).toBe(1);
    expect(countSavedAreaOverlap(["Mission", "Castro"], ["castro", "mission"])).toBe(2);
  });

  it("returns 0 when no overlap", () => {
    expect(countSavedAreaOverlap(["Noe Valley"], ["Castro"])).toBe(0);
  });
});

describe("countSavedListingOverlap", () => {
  it("returns 0 when either array is empty", () => {
    expect(countSavedListingOverlap([], ["abc-123"])).toBe(0);
    expect(countSavedListingOverlap(["abc-123"], [])).toBe(0);
  });

  it("counts exact-match listing IDs", () => {
    expect(countSavedListingOverlap(["abc-123", "def-456"], ["abc-123"])).toBe(1);
    expect(countSavedListingOverlap(["abc-123", "def-456"], ["abc-123", "def-456"])).toBe(2);
  });

  it("returns 0 when no overlap", () => {
    expect(countSavedListingOverlap(["abc-123"], ["def-456"])).toBe(0);
  });
});

describe("savedTasteCompatBonus", () => {
  it("returns EXACTLY 0 when both counts are 0 — sparsity regression", () => {
    // This is the load-bearing regression: absent signal must be an exact no-op.
    expect(savedTasteCompatBonus({ sharedAreaCount: 0, sharedListingCount: 0 })).toBe(0);
  });

  it("returns a positive value when there is area overlap", () => {
    expect(savedTasteCompatBonus({ sharedAreaCount: 1, sharedListingCount: 0 })).toBeGreaterThan(0);
  });

  it("returns a positive value when there is listing overlap", () => {
    expect(savedTasteCompatBonus({ sharedAreaCount: 0, sharedListingCount: 1 })).toBeGreaterThan(0);
  });

  it("is monotonically increasing with overlap count", () => {
    const one = savedTasteCompatBonus({ sharedAreaCount: 1, sharedListingCount: 0 });
    const two = savedTasteCompatBonus({ sharedAreaCount: 2, sharedListingCount: 0 });
    expect(two).toBeGreaterThanOrEqual(one);
  });

  it("never exceeds the CAP (0.12)", () => {
    const CAP = 0.12;
    // Many shared areas + listings — should still be capped
    expect(savedTasteCompatBonus({ sharedAreaCount: 10, sharedListingCount: 10 })).toBeLessThanOrEqual(CAP);
    expect(savedTasteCompatBonus({ sharedAreaCount: 1, sharedListingCount: 1 })).toBeLessThanOrEqual(CAP);
  });

  it("listings weight more than areas", () => {
    const areaOnly = savedTasteCompatBonus({ sharedAreaCount: 1, sharedListingCount: 0 });
    const listingOnly = savedTasteCompatBonus({ sharedAreaCount: 0, sharedListingCount: 1 });
    expect(listingOnly).toBeGreaterThan(areaOnly);
  });
});

describe("savedListingFitBonus", () => {
  it("returns +8 when the listing ID is in the saved list", () => {
    expect(
      savedListingFitBonus({
        listingId: "abc-123",
        listingNeighborhood: "Castro",
        savedAreaLabels: [],
        savedListingIds: ["abc-123"],
      }),
    ).toBe(8);
  });

  it("returns +5 when only the neighbourhood matches a saved area (case-insensitive)", () => {
    expect(
      savedListingFitBonus({
        listingId: "abc-123",
        listingNeighborhood: "Mission",
        savedAreaLabels: ["  mission "],
        savedListingIds: [],
      }),
    ).toBe(5);
  });

  it("listing-saved bonus takes precedence over neighbourhood match", () => {
    expect(
      savedListingFitBonus({
        listingId: "abc-123",
        listingNeighborhood: "Mission",
        savedAreaLabels: ["mission"],
        savedListingIds: ["abc-123"],
      }),
    ).toBe(8);
  });

  it("returns 0 when neither listing nor neighbourhood matches", () => {
    expect(
      savedListingFitBonus({
        listingId: "abc-123",
        listingNeighborhood: "Noe Valley",
        savedAreaLabels: ["Castro"],
        savedListingIds: ["def-456"],
      }),
    ).toBe(0);
  });

  it("returns 0 when saved lists are empty", () => {
    expect(
      savedListingFitBonus({
        listingId: "abc-123",
        listingNeighborhood: "Mission",
        savedAreaLabels: [],
        savedListingIds: [],
      }),
    ).toBe(0);
  });
});
