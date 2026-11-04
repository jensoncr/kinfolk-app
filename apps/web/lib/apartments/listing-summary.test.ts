import { describe, expect, it } from "vitest";
import { toListingSummary } from "./listing-summary";
import type { ApartmentListing } from "./types";

/** Minimal ApartmentListing factory for tests. */
function listing(partial: Partial<ApartmentListing> = {}): ApartmentListing {
  return {
    id: "test-id",
    source: "test",
    sourceUrl: null,
    listingStatus: "available",
    providerMarket: "sf",
    address: "123 Main St",
    unit: null,
    city: "San Francisco",
    state: "CA",
    postalCode: "94105",
    neighborhood: "SoMa",
    latitude: 37.78,
    longitude: -122.4,
    monthlyRent: 3000,
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 800,
    availableAt: null,
    description: "",
    amenities: [],
    leaseTerms: [],
    noFee: false,
    concessionMonths: 0,
    concessionLeaseMonths: 0,
    concessionNote: null,
    effectiveMonthlyRent: 3000,
    availableUnitCount: 1,
    unitRentMin: 3000,
    unitRentMax: 3000,
    unitEffectiveRentMin: 3000,
    unitEffectiveRentMax: 3000,
    photoUrl: "https://example.com/photo.jpg",
    floorPlanMonthlyRent: null,
    floorPlanTypeCount: 0,
    floorPlanBedroomMin: null,
    floorPlanBedroomMax: null,
    fitScore: 80,
    roommateSplitLimit: 2,
    householdSize: 2,
    perPersonRent: 1500,
    effectivePerPersonRent: 1500,
    splitBreakdown: [{ name: "Alice", amount: 1500 }, { name: "Bob", amount: 1500 }],
    evidence: [{ label: "Great commute", detail: "10 min walk to BART" }],
    tradeoffs: [{ label: "Noisy street", detail: "Mission St traffic" }],
    formingGroups: [],
    photoUrls: ["https://example.com/photo.jpg"],
    enriched: null,
    ...partial,
  };
}

describe("toListingSummary", () => {
  it("drops evidence, tradeoffs, and splitBreakdown", () => {
    const full = listing();
    const summary = toListingSummary(full);

    expect(summary.evidence).toEqual([]);
    expect(summary.tradeoffs).toEqual([]);
    expect(summary.splitBreakdown).toEqual([]);
  });

  it("preserves core marker fields", () => {
    const full = listing({ id: "abc123", latitude: 37.78, longitude: -122.4, fitScore: 90 });
    const summary = toListingSummary(full);

    expect(summary.id).toBe("abc123");
    expect(summary.latitude).toBe(37.78);
    expect(summary.longitude).toBe(-122.4);
    expect(summary.fitScore).toBe(90);
  });

  it("preserves card display fields", () => {
    const full = listing({
      address: "123 Main St",
      neighborhood: "SoMa",
      photoUrl: "https://example.com/photo.jpg",
      photoUrls: ["https://example.com/photo.jpg"],
      formingGroups: [],
    });
    const summary = toListingSummary(full);

    expect(summary.address).toBe("123 Main St");
    expect(summary.neighborhood).toBe("SoMa");
    expect(summary.photoUrl).toBe("https://example.com/photo.jpg");
    expect(summary.photoUrls).toEqual(["https://example.com/photo.jpg"]);
    expect(summary.formingGroups).toEqual([]);
  });

  it("returns empty arrays even when source listing had non-empty rich arrays", () => {
    const full = listing({
      evidence: [{ label: "A", detail: "B" }, { label: "C", detail: "D" }],
      tradeoffs: [{ label: "X", detail: "Y" }],
      splitBreakdown: [{ name: "Alice", amount: 1500 }],
    });
    const summary = toListingSummary(full);

    // Guards against a future refactor accidentally re-adding them to the snapshot
    expect(summary.evidence).toHaveLength(0);
    expect(summary.tradeoffs).toHaveLength(0);
    expect(summary.splitBreakdown).toHaveLength(0);
  });

  it("does not mutate the original listing", () => {
    const full = listing();
    toListingSummary(full);

    expect(full.evidence).toHaveLength(1);
    expect(full.tradeoffs).toHaveLength(1);
    expect(full.splitBreakdown).toHaveLength(2);
  });
});
