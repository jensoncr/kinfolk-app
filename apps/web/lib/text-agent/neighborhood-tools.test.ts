import { describe, expect, it } from "vitest";
import { formatRestaurantAreaSignalReply } from "./area-signals";
import {
  rankNeighborhoodProfiles,
  validateSanFranciscoNeighborhoodValues,
} from "./neighborhoods";
import type { AreaSignalPlace, AreaSignalSummary } from "../apartments/area-signals";

describe("text agent neighborhood tools", () => {
  it("keeps Tenderloin out of normal best-neighborhood recommendations when viable alternatives exist", () => {
    const recommendations = rankNeighborhoodProfiles(
      [
        neighborhoodProfile("Tenderloin", {
          listingCount: 39,
          medianRent: 1995,
          rentMin: 1475,
        }),
        neighborhoodProfile("Pacific Heights", {
          listingCount: 24,
          medianRent: 4263,
          rentMin: 2000,
        }),
        neighborhoodProfile("Dogpatch", {
          listingCount: 6,
          medianRent: 3740,
          rentMin: 3541,
        }),
        neighborhoodProfile("Inner Richmond", {
          listingCount: 5,
          medianRent: 3995,
          rentMin: 3850,
        }),
      ],
      {
        budgetMax: 4000,
        market: "san-francisco-ca",
        preferredNeighborhoods: ["Pacific Heights", "Dogpatch", "Richmond"],
      },
      {
        excludeKnownNeighborhoods: false,
        kind: "neighborhood_recommendation",
        source: "direct_request",
        tags: [],
      },
    );

    expect(
      recommendations.slice(0, 3).map((entry) => entry.displayName),
    ).toEqual(["Pacific Heights", "Dogpatch", "Inner Richmond"]);
  });

  it("uses neighborhood character instead of local POI inventory counts for generic recommendations", () => {
    const recommendations = rankNeighborhoodProfiles(
      [
        neighborhoodProfile("Lower Nob Hill", {
          listingCount: 32,
          medianRent: 2250,
          rentMin: 1800,
          poiSummary: {
            grocery: [],
            park: [],
            restaurant: [
              { distance: 0.2, name: "Liholiho Yacht Club" },
              { distance: 0.3, name: "Mensho Tokyo" },
            ],
            transit: [
              { distance: 0.1, name: "Powell Street Station" },
              { distance: 0.4, name: "California St & Taylor St" },
            ],
          },
        }),
      ],
      {
        budgetMax: null,
        market: "san-francisco-ca",
        preferredNeighborhoods: [],
      },
      {
        excludeKnownNeighborhoods: false,
        kind: "neighborhood_recommendation",
        source: "direct_request",
        tags: [],
      },
    );

    expect(recommendations[0]?.reasons).toEqual([
      "median rent around $2,250",
      "central, restaurant-heavy, apartment-dense, and more urban",
    ]);
    expect(recommendations[0]?.reasons.join(" ")).not.toMatch(
      /nearby dining\/transit points|local profile/i,
    );
  });

  it("uses named nearby examples when a user asks for dining or transit fit", () => {
    const recommendations = rankNeighborhoodProfiles(
      [
        neighborhoodProfile("Mission District", {
          listingCount: 30,
          medianRent: 3695,
          rentMin: 2400,
          poiSummary: {
            grocery: [],
            park: [],
            restaurant: [
              { distance: 0.2, name: "Foreign Cinema" },
              { distance: 0.1, name: "Tartine Bakery" },
            ],
            transit: [
              { distance: 0.3, name: "16th St Mission BART" },
              { distance: 0.6, name: "24th St Mission BART" },
            ],
          },
        }),
      ],
      {
        budgetMax: null,
        market: "san-francisco-ca",
        preferredNeighborhoods: [],
      },
      {
        excludeKnownNeighborhoods: false,
        kind: "neighborhood_recommendation",
        source: "direct_request",
        tags: ["restaurants", "commute"],
      },
    );

    expect(recommendations[0]?.reasons).toEqual([
      "dining nearby: Tartine Bakery (0.1 mi), Foreign Cinema (0.2 mi)",
      "transit nearby: 16th St Mission BART (0.3 mi), 24th St Mission BART (0.6 mi)",
    ]);
  });

  it("does not promote bars as coffee work spot evidence", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantAreaSignalSummary([
        {
          address: "2496 3rd St, San Francisco, CA",
          distanceMiles: 0.12,
          name: "Dogpatch Saloon",
          primaryType: "bar",
          rating: 4.4,
          types: ["bar", "point_of_interest", "establishment"],
          userRatingCount: 200,
        },
        {
          address: "2535 3rd St, San Francisco, CA",
          distanceMiles: 0.18,
          name: "Daily Driver",
          primaryType: "cafe",
          rating: 4.3,
          types: ["cafe", "bakery", "food", "point_of_interest"],
          userRatingCount: 500,
        },
        {
          address: "701 Pennsylvania Ave, San Francisco, CA",
          distanceMiles: 0.4,
          name: "La Stazione Coffee & Wine Bar",
          primaryType: "cafe",
          rating: 4.6,
          types: ["cafe", "food", "point_of_interest"],
          userRatingCount: 100,
        },
      ]),
      null,
      undefined,
      { requestKind: "coffee_work" },
    );

    expect(reply).toContain("coffee/cafe signals");
    expect(reply).toContain("Daily Driver");
    expect(reply).toContain("La Stazione");
    expect(reply).toContain("verify seating and laptop-friendliness");
    expect(reply).not.toContain("Dogpatch Saloon");
    expect(reply).not.toContain("cafe/bar");
  });

  it("fails closed when coffee work spot evidence only contains bars", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantAreaSignalSummary([
        {
          address: "2496 3rd St, San Francisco, CA",
          distanceMiles: 0.12,
          name: "Dogpatch Saloon",
          primaryType: "bar",
          rating: 4.4,
          types: ["bar", "food", "point_of_interest"],
          userRatingCount: 200,
        },
      ]),
      null,
      undefined,
      { requestKind: "coffee_work" },
    );

    expect(reply).toContain(
      "do not have a grounded cafe or coffee-work signal",
    );
    expect(reply).not.toContain("Dogpatch Saloon");
  });

  it("does not use Tenderloin as filler when at least one viable non-caution option exists", () => {
    const recommendations = rankNeighborhoodProfiles(
      [
        neighborhoodProfile("Tenderloin", {
          listingCount: 39,
          medianRent: 1995,
          rentMin: 1475,
        }),
        neighborhoodProfile("Dogpatch", {
          listingCount: 6,
          medianRent: 3740,
          rentMin: 3541,
        }),
      ],
      {
        budgetMax: 4000,
        market: "san-francisco-ca",
        preferredNeighborhoods: ["Dogpatch"],
      },
      {
        excludeKnownNeighborhoods: false,
        kind: "neighborhood_recommendation",
        source: "direct_request",
        tags: [],
      },
    );

    expect(recommendations.map((entry) => entry.displayName)).toEqual([
      "Dogpatch",
    ]);
  });

  it("allows Tenderloin as a budget-first fallback when non-caution areas do not fit", () => {
    const recommendations = rankNeighborhoodProfiles(
      [
        neighborhoodProfile("Tenderloin", {
          listingCount: 39,
          medianRent: 1995,
          rentMin: 1475,
        }),
        neighborhoodProfile("Pacific Heights", {
          listingCount: 24,
          medianRent: 4263,
          rentMin: 2000,
        }),
      ],
      {
        budgetMax: 1500,
        market: "san-francisco-ca",
        preferredNeighborhoods: [],
      },
      {
        excludeKnownNeighborhoods: false,
        kind: "neighborhood_recommendation",
        source: "direct_request",
        tags: ["budget"],
      },
    );

    expect(recommendations[0]?.displayName).toBe("Tenderloin");
    expect(recommendations[0]?.reasons).toContain(
      "only consider if budget is the overriding constraint",
    );
  });

  it("validates San Francisco neighborhoods before saving", () => {
    const result = validateSanFranciscoNeighborhoodValues([
      "San Francisco",
      "Dog Patch",
      "Potrero Hill",
      "Pacific Heights in SF",
      "Oakland",
      "SOMA",
    ]);

    expect(result.accepted).toEqual([
      "Dogpatch",
      "Potrero Hill",
      "Pacific Heights",
      "SoMa",
    ]);
    expect(result.rejected).toEqual(["San Francisco", "Oakland"]);

    expect(
      validateSanFranciscoNeighborhoodValues([
        "I don't know, tell me more about what neighborhoods I should live in",
      ]),
    ).toMatchObject({
      accepted: [],
    });
  });
});

function neighborhoodProfile(
  displayName: string,
  {
    listingCount,
    medianRent,
    poiSummary,
    rentMin,
  }: {
    listingCount: number;
    medianRent: number;
    poiSummary?: Parameters<
      typeof rankNeighborhoodProfiles
    >[0][number]["poi_summary"];
    rentMin: number;
  },
): Parameters<typeof rankNeighborhoodProfiles>[0][number] {
  return {
    bedroom_distribution: {},
    common_amenities: [],
    created_at: "2026-05-23T00:00:00.000Z",
    display_name: displayName,
    id: `profile-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    latitude: null,
    longitude: null,
    listing_count: listingCount,
    market: "san-francisco-ca",
    median_rent: medianRent,
    name: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    poi_summary: poiSummary ?? {
      grocery: [],
      park: [],
      restaurant: [],
      transit: [],
    },
    poi_enriched_at: null,
    rent_max: medianRent + 1000,
    rent_min: rentMin,
    stats_computed_at: "2026-05-23T00:00:00.000Z",
    updated_at: "2026-05-23T00:00:00.000Z",
  };
}

function restaurantAreaSignalSummary(
  places: AreaSignalPlace[],
): AreaSignalSummary {
  return {
    credentials: {
      dataSf: "skipped",
      googlePlaces: "ok",
      howLoud: "skipped",
      mapbox: "skipped",
    },
    generatedAt: "2026-06-06T00:00:00.000Z",
    purpose: "restaurants",
    restaurants: {
      googlePlaces: {
        places,
        status: "ok",
      },
      mapbox: {
        places: [],
        status: "skipped",
      },
    },
    status: "ok",
    target: {
      label: "Dogpatch",
      lat: 37.7608797,
      lng: -122.3893176,
      neighborhood: "Dogpatch",
      radiusMeters: 800,
    },
  };
}
