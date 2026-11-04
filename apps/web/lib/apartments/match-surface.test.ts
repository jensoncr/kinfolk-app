import { describe, expect, it } from "vitest";
import {
  apartmentListingSurfaceFitScore,
  apartmentMatchesFromSearchSnapshot,
} from "./match-surface";
import type {
  ApartmentListing,
  ApartmentSearchSnapshot,
} from "./types";

function listing(partial: Partial<ApartmentListing>): ApartmentListing {
  return {
    id: "listing-1",
    source: "redfin",
    sourceUrl: "https://example.com/listing",
    listingStatus: "active",
    providerMarket: "san-francisco-ca",
    address: "100 Test St",
    unit: null,
    city: "San Francisco",
    state: "CA",
    postalCode: "94107",
    neighborhood: "Dogpatch",
    latitude: 37.76,
    longitude: -122.39,
    monthlyRent: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    availableAt: null,
    description: "Imported rental listing.",
    amenities: [],
    leaseTerms: [],
    noFee: false,
    concessionMonths: 0,
    concessionLeaseMonths: 12,
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

function snapshot(
  listings: ApartmentListing[],
  activeProfile: Partial<ApartmentSearchSnapshot["activeProfile"]> = {},
): ApartmentSearchSnapshot {
  return {
    source: {
      kind: "supabase",
      status: "connected",
      detail: "test",
    },
    refreshedAt: "2026-05-31T00:00:00.000Z",
    refreshStale: false,
    market: "San Francisco",
    listings,
    neighborhoods: [],
    activeProfile: {
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
      ...activeProfile,
    },
  };
}

describe("apartmentMatchesFromSearchSnapshot", () => {
  it("computes a display fit score for split listings without persisted matches", () => {
    const score = apartmentListingSurfaceFitScore({
      listing: listing({
        fitScore: 0,
        monthlyRent: 12000,
        effectiveMonthlyRent: 12000,
        roommateSplitLimit: 3,
        householdSize: 4,
      }),
      profile: snapshot([], { budgetMax: 3000, householdSizeMax: 4 }).activeProfile,
      roommatesOverride: 3,
    });

    expect(score).toBe(77);
  });

  it("keeps a persisted listing fit score on the display path", () => {
    const score = apartmentListingSurfaceFitScore({
      listing: listing({
        fitScore: 81,
        monthlyRent: 12000,
        effectiveMonthlyRent: 12000,
        roommateSplitLimit: 3,
        householdSize: 4,
      }),
      profile: snapshot([], { budgetMax: 3000, householdSizeMax: 4 }).activeProfile,
      roommatesOverride: 3,
    });

    expect(score).toBe(81);
  });

  it("leaves non-budget profiles on the persisted match path", () => {
    expect(apartmentMatchesFromSearchSnapshot(snapshot([]))).toBeUndefined();
  });

  it("includes budget-fit listings using the same roommate split display as the map", () => {
    const matches = apartmentMatchesFromSearchSnapshot(
      snapshot(
        [
          listing({
            id: "split-fit",
            address: "400 Roommate Ave Unit 4",
            unit: "Unit 4",
            bedrooms: 4,
            monthlyRent: 12000,
            effectiveMonthlyRent: 12000,
            roommateSplitLimit: 3,
            householdSize: 4,
          }),
          listing({
            id: "solo-over-budget",
            address: "20 Studio St",
            bedrooms: 0,
            monthlyRent: 3500,
            effectiveMonthlyRent: 3500,
            roommateSplitLimit: 0,
            householdSize: 1,
          }),
        ],
        { budgetMax: 3000, householdSizeMax: 4 },
      ),
    );

    expect(matches?.map((match) => match.id)).toEqual(["split-fit"]);
    expect(matches?.[0]?.title).toBe("400 Roommate Ave Unit 4");
    expect(matches?.[0]?.monthlyRent).toBe(3000);
    expect(matches?.[0]?.rentCaption).toBe("4-way split from $12,000/mo");
  });

  it("keeps persisted listing evidence and fit score when the search snapshot has them", () => {
    const matches = apartmentMatchesFromSearchSnapshot(
      snapshot(
        [
          listing({
            fitScore: 81,
            monthlyRent: 2500,
            effectiveMonthlyRent: 2500,
            evidence: [{ label: "Budget", detail: "Already scored." }],
          }),
        ],
        { budgetMax: 3000 },
      ),
    );

    expect(matches?.[0]?.fitScore).toBe(81);
    expect(matches?.[0]?.evidence).toEqual([{ label: "Budget", detail: "Already scored." }]);
  });

  it("requires saved neighborhoods before surfacing budget-fit listings", () => {
    const matches = apartmentMatchesFromSearchSnapshot(
      snapshot(
        [
          listing({
            id: "mission-fit",
            address: "12 Dolores St",
            neighborhood: "Mission Dolores",
            monthlyRent: 2800,
            effectiveMonthlyRent: 2800,
          }),
          listing({
            id: "wrong-neighborhood",
            address: "20 Dogpatch St",
            neighborhood: "Dogpatch",
            monthlyRent: 2500,
            effectiveMonthlyRent: 2500,
          }),
        ],
        { budgetMax: 3000, neighborhoods: ["Mission"] },
      ),
    );

    expect(matches?.map((match) => match.id)).toEqual(["mission-fit"]);
  });

  it("keeps must-haves soft while enforcing explicit excluded neighborhoods", () => {
    const matches = apartmentMatchesFromSearchSnapshot(
      snapshot(
        [
          listing({
            id: "has-dishwasher",
            amenities: ["Dishwasher", "Laundry in building"],
            monthlyRent: 2600,
            effectiveMonthlyRent: 2600,
            neighborhood: "Dogpatch",
          }),
          listing({
            id: "missing-dishwasher",
            amenities: ["Laundry in building"],
            monthlyRent: 2400,
            effectiveMonthlyRent: 2400,
            neighborhood: "Dogpatch",
          }),
          listing({
            id: "excluded-area",
            amenities: ["Dishwasher"],
            monthlyRent: 2200,
            effectiveMonthlyRent: 2200,
            neighborhood: "SoMa",
          }),
        ],
        {
          budgetMax: 3000,
          dealbreakers: ["avoid SoMa"],
          mustHaves: ["dishwasher"],
        },
      ),
    );

    expect(matches?.map((match) => match.id)).toEqual([
      "has-dishwasher",
      "missing-dishwasher",
    ]);
    expect(matches?.find((match) => match.id === "has-dishwasher")?.evidence).toContainEqual({
      label: "Must-haves",
      detail: "Listing confirms dishwasher.",
    });
    expect(
      matches?.find((match) => match.id === "missing-dishwasher")?.tradeoffs,
    ).toContainEqual({
      label: "Must-haves",
      detail: "Listing data does not confirm dishwasher.",
    });
  });

  it("keeps unconfirmed pet policy soft unless a listing explicitly rejects pets", () => {
    const matches = apartmentMatchesFromSearchSnapshot(
      snapshot(
        [
          listing({
            id: "pet-friendly",
            amenities: ["Pets allowed"],
            monthlyRent: 2400,
            effectiveMonthlyRent: 2400,
          }),
          listing({
            id: "pet-unknown",
            monthlyRent: 2600,
            effectiveMonthlyRent: 2600,
          }),
          listing({
            id: "no-pets",
            description: "No pets allowed.",
            monthlyRent: 2500,
            effectiveMonthlyRent: 2500,
          }),
        ],
        { budgetMax: 3000, pets: "pet friendly" },
      ),
    );

    expect(matches?.map((match) => match.id)).toEqual(["pet-friendly", "pet-unknown"]);
    expect(matches?.find((match) => match.id === "pet-friendly")?.evidence).toContainEqual({
      label: "Pets",
      detail: "Listing mentions pet-friendly rules.",
    });
    expect(matches?.find((match) => match.id === "pet-unknown")?.tradeoffs).toContainEqual({
      label: "Pets",
      detail: "Pet policy is not confirmed in listing data.",
    });
  });

  it("does not hard-filter listings that are available after the saved move-in date", () => {
    const matches = apartmentMatchesFromSearchSnapshot(
      snapshot(
        [
          listing({
            id: "later-availability",
            availableAt: "2026-09-01",
            monthlyRent: 2600,
            effectiveMonthlyRent: 2600,
          }),
        ],
        { budgetMax: 3000, moveInEnd: "2026-07-01" },
      ),
    );

    expect(matches?.map((match) => match.id)).toEqual(["later-availability"]);
    expect(matches?.[0]?.tradeoffs).toContainEqual({
      label: "Move-in",
      detail: "Availability is later than your saved move-in date, so treat timing as flexible.",
    });
  });
});
