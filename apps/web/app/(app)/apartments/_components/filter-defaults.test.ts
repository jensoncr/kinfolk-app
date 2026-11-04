import { describe, expect, it } from "vitest";
import type { ApartmentListing, ApartmentSearchSnapshot } from "@/lib/apartments/types";
import {
  apartmentFilterDefaultsFromProfile,
  budgetRangeFromProfile,
  maxRoommatesForListings,
  roommatesFromProfile,
} from "./filter-defaults";

type ActiveProfile = ApartmentSearchSnapshot["activeProfile"];

const baseProfile: ActiveProfile = {
  budgetMin: 0,
  budgetMax: 0,
  dealbreakers: [],
  householdSizeMin: 0,
  householdSizeMax: 0,
  moveInEnd: "",
  moveInStart: "",
  mustHaves: [],
  neighborhoods: [],
  pets: "",
};

function listing(partial: Partial<ApartmentListing>): ApartmentListing {
  return {
    id: "listing",
    source: "test",
    sourceUrl: null,
    listingStatus: "active",
    providerMarket: "san-francisco-ca",
    address: "1 Market St",
    unit: null,
    city: "San Francisco",
    state: "CA",
    postalCode: null,
    neighborhood: "SoMa",
    latitude: 37.78,
    longitude: -122.41,
    monthlyRent: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    availableAt: null,
    description: "",
    amenities: [],
    leaseTerms: [],
    noFee: false,
    concessionMonths: 0,
    concessionLeaseMonths: 0,
    concessionNote: null,
    effectiveMonthlyRent: null,
    availableUnitCount: 0,
    unitRentMin: null,
    unitRentMax: null,
    unitEffectiveRentMin: null,
    unitEffectiveRentMax: null,
    photoUrl: null,
    floorPlanMonthlyRent: null,
    floorPlanTypeCount: 0,
    floorPlanBedroomMin: null,
    floorPlanBedroomMax: null,
    fitScore: 0,
    roommateSplitLimit: 0,
    householdSize: 1,
    perPersonRent: null,
    effectivePerPersonRent: null,
    splitBreakdown: [],
    evidence: [],
    tradeoffs: [],
    formingGroups: [],
    photoUrls: [],
    enriched: null,
    ...partial,
  };
}

describe("apartment filter profile defaults", () => {
  it("turns saved profile budget into an active budget range", () => {
    expect(budgetRangeFromProfile({ ...baseProfile, budgetMax: 3000 })).toEqual({
      min: null,
      max: 3000,
    });
    expect(budgetRangeFromProfile({ ...baseProfile, budgetMin: 1800, budgetMax: 3200 })).toEqual({
      min: 1800,
      max: 3200,
    });
  });

  it("derives the split default from profile roommate max without owning the option limit", () => {
    expect(roommatesFromProfile({ ...baseProfile, householdSizeMax: 2 }, 5)).toBe(1);
    expect(roommatesFromProfile({ ...baseProfile, householdSizeMax: 6 }, 3)).toBe(3);
    expect(roommatesFromProfile({ ...baseProfile, householdSizeMax: 0 }, 3)).toBeNull();
  });

  it("bases the roommate override ceiling on available listing bedrooms", () => {
    expect(
      maxRoommatesForListings([
        listing({ bedrooms: 2, roommateSplitLimit: 1 }),
        listing({ bedrooms: 3, roommateSplitLimit: 2 }),
        listing({ floorPlanBedroomMax: 5, roommateSplitLimit: 4 }),
      ]),
    ).toBe(4);
    expect(maxRoommatesForListings([listing({ roommateSplitLimit: 4 })])).toBe(4);
  });

  it("builds budget and roommate defaults together for initial map state", () => {
    expect(
      apartmentFilterDefaultsFromProfile(
        { ...baseProfile, budgetMax: 3000, householdSizeMax: 2 },
        [listing({ floorPlanBedroomMax: 5, roommateSplitLimit: 4 })],
      ),
    ).toEqual({
      budgetRange: { min: null, max: 3000 },
      roommates: 1,
    });
  });
});
