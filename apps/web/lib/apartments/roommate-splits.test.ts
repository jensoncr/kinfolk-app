// Covers the per-person rent arithmetic; the matching-engine budget gate
// (lib/matching/apartment-listing-matches.ts scoreApartmentListingForProfile,
// perPerson = ceil(rent/householdSize)) is NOT exported and needs a DB —
// its math shape is mirrored here. Gap noted in plan 005.

import { describe, expect, it } from "vitest";
import {
  clampRoommateSplitSize,
  householdSizeForRoommates,
  propertyMarkerRentForDisplay,
} from "./roommate-splits";
import type { ApartmentListing } from "./types";

function makeListing(over: Partial<ApartmentListing>): ApartmentListing {
  return {
    floorPlanTypeCount: 0,
    floorPlanMonthlyRent: null,
    effectiveMonthlyRent: null,
    monthlyRent: null,
    roommateSplitLimit: 0,
    householdSize: 1,
    ...over,
  } as ApartmentListing;
}

describe("clampRoommateSplitSize", () => {
  it("studio (0-bed) clamps any request to 1", () => {
    expect(clampRoommateSplitSize(3, 0)).toBe(1);
  });

  it("1-bed clamps a request of 2 to 1", () => {
    expect(clampRoommateSplitSize(2, 1)).toBe(1);
  });

  it("3-bed: in-range request passes through", () => {
    expect(clampRoommateSplitSize(2, 3)).toBe(2);
  });

  it("3-bed: request above limit is clamped to limit", () => {
    expect(clampRoommateSplitSize(9, 3)).toBe(3);
  });

  it("3-bed: null request defaults to limit", () => {
    expect(clampRoommateSplitSize(null, 3)).toBe(3);
  });
});

describe("householdSizeForRoommates", () => {
  it("roommateSplitLimit 0 ignores override and returns householdSize", () => {
    const listing = makeListing({ roommateSplitLimit: 0, householdSize: 1 });
    expect(householdSizeForRoommates(listing, 2)).toBe(1);
  });

  it("roommateSplitLimit 3 with override 2 returns roommates+1", () => {
    const listing = makeListing({ roommateSplitLimit: 3, householdSize: 1 });
    expect(householdSizeForRoommates(listing, 2)).toBe(3);
  });

  it("roommateSplitLimit 3 with override 9 clamps to limit and returns limit+1", () => {
    const listing = makeListing({ roommateSplitLimit: 3, householdSize: 1 });
    expect(householdSizeForRoommates(listing, 9)).toBe(4);
  });

  it("no override returns Math.max(1, householdSize)", () => {
    const listing = makeListing({ roommateSplitLimit: 3, householdSize: 2 });
    expect(householdSizeForRoommates(listing, undefined)).toBe(2);
  });
});

describe("propertyMarkerRentForDisplay", () => {
  it("non-floor-plan: returns effectiveMonthlyRent when set", () => {
    const listing = makeListing({ effectiveMonthlyRent: 3000 });
    expect(propertyMarkerRentForDisplay(listing)).toBe(3000);
  });

  it("non-floor-plan: falls back to monthlyRent when effectiveMonthlyRent is null", () => {
    const listing = makeListing({ effectiveMonthlyRent: null, monthlyRent: 3000 });
    expect(propertyMarkerRentForDisplay(listing)).toBe(3000);
  });

  it("floor-plan: uses floorPlanMonthlyRent", () => {
    const listing = makeListing({ floorPlanTypeCount: 1, floorPlanMonthlyRent: 4500 });
    expect(propertyMarkerRentForDisplay(listing)).toBe(4500);
  });

  it("split by roommates: divides total by (roommates+1) and rounds", () => {
    const listing = makeListing({
      effectiveMonthlyRent: 3000,
      roommateSplitLimit: 2,
    });
    // override=2 -> roommates=2 -> total/(2+1) = 1000
    expect(propertyMarkerRentForDisplay(listing, 2)).toBe(1000);
  });

  it("override above roommateSplitLimit: clamps roommates to limit", () => {
    const listing = makeListing({
      effectiveMonthlyRent: 3000,
      roommateSplitLimit: 2,
    });
    // override=9, limit=2 -> roommates clamped to 2 -> 3000/3 = 1000
    expect(propertyMarkerRentForDisplay(listing, 9)).toBe(1000);
  });
});
