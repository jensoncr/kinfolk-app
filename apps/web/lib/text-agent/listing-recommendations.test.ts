import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatGeocodeFailureGuidance,
  loadCompatibleListingCards,
  searchCompatibleListingCards,
} from "./listing-recommendations";
import type { ListingRequestContext } from "@/lib/apartments/listing-request-context";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/apartments/listing-fallback-rent", () => ({
  fallbackBudgetQueryMax: (budgetMax: number | null) => budgetMax,
  fallbackPerPersonRentForListing: (listing: {
    effective_monthly_rent: number | null;
    monthly_rent: number | null;
  }) => ({
    householdSize: 1,
    rent: listing.effective_monthly_rent ?? listing.monthly_rent,
  }),
}));

vi.mock("@/lib/apartments/listing-request-context", () => ({
  bestRequestedTransitMatch: () => null,
  evaluateListingProximityConstraints: (
    listing: { latitude?: number | null; longitude?: number | null },
    constraints: Array<{
      resolvedTarget?: { latitude: number; longitude: number } | null;
      target: { type: string };
    }>,
  ) => {
    const place = constraints.find(
      (constraint) => constraint.target.type === "place",
    );
    if (
      !place?.resolvedTarget ||
      listing.latitude == null ||
      listing.longitude == null
    ) {
      return { evidence: [], hardPass: true, preferredDistance: null };
    }
    const latMiles = (listing.latitude - place.resolvedTarget.latitude) * 69;
    const lngMiles = (listing.longitude - place.resolvedTarget.longitude) * 54.6;
    return {
      evidence: [],
      hardPass: true,
      preferredDistance: Math.sqrt(latMiles ** 2 + lngMiles ** 2),
    };
  },
  matchesRequestedBedrooms: () => true,
  matchesRequestedBudget: (
    rent: number | null,
    context: { budgetMax: number | null },
  ) => context.budgetMax == null || rent == null || rent <= context.budgetMax,
  matchesRequestedTransitTargets: () => true,
  mergeListingRequestContextWithSavedPreferences: (
    requestContext: ListingRequestContext,
  ) => requestContext,
}));

vi.mock("@/lib/text-agent/listing-delivery", () => ({
  fetchListingPhotoRows: async () => [],
  fetchSentListingRecommendationRows: async () => [],
}));

vi.mock("@/lib/text-agent/listing-format", () => ({
  buildListingCardEvidence: ({ baseEvidence }: { baseEvidence: string[] }) =>
    baseEvidence,
  compareListingRecommendationCandidates: (
    left: { card: { fitScore: number }; proximityDistance: number | null },
    right: { card: { fitScore: number }; proximityDistance: number | null },
  ) =>
    (left.proximityDistance ?? Number.POSITIVE_INFINITY) -
      (right.proximityDistance ?? Number.POSITIVE_INFINITY) ||
    right.card.fitScore - left.card.fitScore,
  formatListingMustHaveEvidence: () => [],
  formatListingTransitTargetEvidence: () => [],
  formatMissingListingMustHaveEvidence: () => [],
  isExcludedListingNeighborhood: () => false,
  listingBudgetRentForRecommendation: (
    listing: { effective_monthly_rent: number | null; monthly_rent: number | null },
    match: {
      effective_per_person_rent?: number | null;
      per_person_rent?: number | null;
    },
  ) =>
    match.effective_per_person_rent ??
    match.per_person_rent ??
    listing.effective_monthly_rent ??
    listing.monthly_rent,
  listingMatchesAvoidTerms: () => false,
  listingMatchesRequestedArea: (
    listing: { city?: string | null; neighborhood?: string | null },
    requested: string,
  ) =>
    (listing.neighborhood ?? listing.city ?? "").toLowerCase() ===
    requested.toLowerCase(),
  matchesRequestedMustHaves: () => true,
  readPositiveListingNumber: (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null,
  readRecommendationEvidence: () => [],
  readRecommendedHouseholdSize: (value: {
    recommended_household_size?: number | null;
  }) => value.recommended_household_size ?? null,
  scoreListingFeatureFit: () => ({
    matched: [],
    missing: [],
    score: 0,
    strict: true,
  }),
  scoreRequestedTransitDistance: () => 0,
}));

vi.mock("@/lib/text-agent/store-shared", () => ({
  escapePostgrestFilterValue: (value: string) => `"${value}"`,
  formatCurrency: (value: number) => `$${Math.round(value).toLocaleString()}`,
}));

vi.mock("@/lib/text-agent/neighborhoods", () => ({
  resolveTextAgentApartmentMarket: (value?: string) =>
    value?.trim() || "san-francisco-ca",
  sanFranciscoTextAgentMarket: "san-francisco-ca",
}));

type StubResult = { data?: unknown; error?: unknown };

type StubCall = { args: unknown[]; method: string; table: string };

function createSupabaseStub(plan: Record<string, StubResult[]>) {
  const calls: StubCall[] = [];
  const client = {
    from(table: string) {
      const queue = plan[table] ?? [];
      const result =
        queue.length > 0 ? queue.shift()! : { data: null, error: null };
      const query: Record<string, unknown> = {};
      for (const method of [
        "eq",
        "gte",
        "in",
        "limit",
        "lte",
        "maybeSingle",
        "or",
        "order",
        "select",
      ]) {
        query[method] = (...args: unknown[]) => {
          calls.push({ args, method, table });
          return query;
        };
      }
      query.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: result.data ?? null,
          error: result.error ?? null,
        }).then(resolve, reject);
      return query;
    },
  };
  return { calls, client: client as never };
}

const emptyContext: ListingRequestContext = {
  avoidTerms: [],
  bedroomsMax: null,
  bedroomsMin: null,
  budgetMax: null,
  budgetMin: null,
  excludedNeighborhoods: [],
  householdSize: null,
  mustHaves: [],
  neighborhoods: [],
  proximityConstraints: [],
  transitTargets: [],
};

function placeConstraint(name: string): ListingRequestContext["proximityConstraints"][number] {
  return {
    hardness: "preference",
    kind: "proximity",
    polarity: "prefer",
    target: { area: null, name, type: "place" },
    threshold: { label: "near", maxMiles: 0.6 },
  };
}

function buildListing(overrides: Record<string, unknown> = {}) {
  return {
    address_line: "123 Valencia St",
    amenities: [],
    available_at: null,
    bathrooms: 1,
    bedrooms: 2,
    city: "San Francisco",
    description: "",
    effective_monthly_rent: null,
    id: "listing-1",
    latitude: 37.76,
    listing_status: "active",
    longitude: -122.42,
    monthly_rent: 3200,
    neighborhood: "Mission",
    poi_summary: null,
    source_url: null,
    state: "CA",
    ...overrides,
  };
}

function buildMatchRow(listingId: string, fitScore: number) {
  return {
    effective_per_person_rent: null,
    evidence: [],
    fit_score: fitScore,
    listing_id: listingId,
    per_person_rent: 1800,
    recommended_household_size: 2,
    status: "suggested",
    tradeoffs: null,
  };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
  vi.stubEnv("GCP_API_KEY", "");
  vi.stubEnv("MAPBOX_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchCompatibleListingCards geocode honesty", () => {
  it("surfaces the failed place and falls back to the neighborhood search", async () => {
    const { client } = createSupabaseStub({
      apartment_listing_matches: [{ data: [] }],
      apartment_listings: [{ data: [buildListing()] }],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }, { data: null }],
    });

    const result = await searchCompatibleListingCards(client, {
      limit: 5,
      requestContext: {
        ...emptyContext,
        neighborhoods: ["Mission"],
        proximityConstraints: [placeConstraint("Blue Bottle")],
      },
      userId: "user-1",
    });

    expect(result.geocodeFailedPlaces).toEqual(["Blue Bottle"]);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].id).toBe("listing-1");
    expect(result.cards[0].fit_source).toBe("heuristic");
  });

  it("dead-ends with the failure instead of citywide listings when the place was the only area", async () => {
    const { calls, client } = createSupabaseStub({
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }],
    });

    const result = await searchCompatibleListingCards(client, {
      limit: 5,
      requestContext: {
        ...emptyContext,
        proximityConstraints: [placeConstraint("Blue Bottle")],
      },
      userId: "user-1",
    });

    expect(result).toEqual({ cards: [], geocodeFailedPlaces: ["Blue Bottle"] });
    expect(
      calls.filter((call) => call.table === "apartment_listings"),
    ).toHaveLength(0);
    expect(
      calls.filter((call) => call.table === "apartment_listing_matches"),
    ).toHaveLength(0);
  });

  it("formats distinct phrasing guidance for the failed lookup", () => {
    expect(
      formatGeocodeFailureGuidance({ cardCount: 0, geocodeFailedPlaces: [] }),
    ).toBeNull();
    expect(
      formatGeocodeFailureGuidance({
        cardCount: 0,
        geocodeFailedPlaces: ["Blue Bottle"],
      }),
    ).toMatch(/place lookup failed[\s\S]*neighborhood/i);
    expect(
      formatGeocodeFailureGuidance({
        cardCount: 0,
        geocodeFailedPlaces: ["Blue Bottle"],
      }),
    ).toMatch(/do NOT suggest relaxing budget/);
    expect(
      formatGeocodeFailureGuidance({
        cardCount: 2,
        geocodeFailedPlaces: ["Blue Bottle"],
      }),
    ).toMatch(/area matches/i);
  });
});

describe("searchCompatibleListingCards fit_source", () => {
  it("tags engine-scored matches as engine", async () => {
    const { client } = createSupabaseStub({
      apartment_listing_matches: [{ data: [buildMatchRow("listing-1", 88)] }],
      apartment_listing_photos: [{ data: [] }],
      apartment_listings: [{ data: [buildListing()] }],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }],
      text_listing_recommendations: [{ data: [] }],
    });

    const result = await searchCompatibleListingCards(client, {
      limit: 5,
      requestContext: emptyContext,
      userId: "user-1",
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].fitScore).toBe(88);
    expect(result.cards[0].fit_source).toBe("engine");
    expect(result.geocodeFailedPlaces).toEqual([]);
  });

  it("falls back to the default listing market when apartment market config is blank", async () => {
    vi.stubEnv("KINFOLK_APARTMENT_MARKET", "   ");
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: [] }],
      apartment_listings: [{ data: [buildListing()] }],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }, { data: null }],
    });

    const result = await searchCompatibleListingCards(client, {
      limit: 5,
      requestContext: emptyContext,
      userId: "user-1",
    });

    expect(result.cards).toHaveLength(1);
    expect(
      calls.some(
        (call) =>
          call.table === "apartment_listings" &&
          call.method === "eq" &&
          call.args[0] === "provider_market" &&
          call.args[1] === "san-francisco-ca",
      ),
    ).toBe(true);
  });
});

describe("searchCompatibleListingCards availableBy", () => {
  it("drops engine matches that become available after the requested date", async () => {
    const { client } = createSupabaseStub({
      apartment_listing_matches: [
        {
          data: [
            buildMatchRow("listing-1", 90),
            buildMatchRow("listing-2", 80),
          ],
        },
      ],
      apartment_listing_photos: [{ data: [] }],
      apartment_listings: [
        {
          data: [
            buildListing({ available_at: "2026-09-15", id: "listing-1" }),
            buildListing({ available_at: "2026-07-01", id: "listing-2" }),
          ],
        },
      ],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }],
      text_listing_recommendations: [{ data: [] }],
    });

    const result = await searchCompatibleListingCards(client, {
      availableBy: "2026-08-01",
      limit: 5,
      requestContext: emptyContext,
      userId: "user-1",
    });

    expect(result.cards.map((card) => card.id)).toEqual(["listing-2"]);
  });

  it("pushes the availability filter into the fallback query and filters rows", async () => {
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: [] }],
      apartment_listings: [
        {
          data: [
            buildListing({ available_at: "2026-10-01", id: "listing-late" }),
            buildListing({ available_at: null, id: "listing-now" }),
          ],
        },
      ],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }, { data: null }],
    });

    const cards = await loadCompatibleListingCards(client, {
      availableBy: "2026-08-01",
      limit: 5,
      requestContext: { ...emptyContext, neighborhoods: ["Mission"] },
      userId: "user-1",
    });

    expect(cards.map((card) => card.id)).toEqual(["listing-now"]);
    expect(
      calls.some(
        (call) =>
          call.table === "apartment_listings" &&
          call.method === "or" &&
          call.args[0] === "available_at.is.null,available_at.lte.2026-08-01",
      ),
    ).toBe(true);
  });
});

describe("searchCompatibleListingCards near-place bounding box", () => {
  it("falls back to alternate Google place keys when the primary key is blank", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "   ");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "maps-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      return {
        json: async () => ({
          places: [
            {
              displayName: { text: "Saint Frank Coffee" },
              location: { latitude: 37.7763, longitude: -122.4233 },
            },
          ],
        }),
        ok: true,
        requestHeaders: init?.headers,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { client } = createSupabaseStub({
      apartment_listing_matches: [{ data: [] }],
      apartment_listings: [{ data: [buildListing()] }],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }, { data: null }],
    });

    const result = await searchCompatibleListingCards(client, {
      limit: 5,
      requestContext: {
        ...emptyContext,
        proximityConstraints: [placeConstraint("Saint Frank Coffee")],
      },
      userId: "user-1",
    });

    expect(result.geocodeFailedPlaces).toEqual([]);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect((requestInit?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe(
      "maps-key",
    );
  });

  it("falls back to the public Mapbox token when the server token is blank", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "   ");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "public-mapbox-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("access_token")).toBe("public-mapbox-token");
      return {
        json: async () => ({
          features: [
            {
              center: [-122.4233, 37.7763],
              place_name: "Saint Frank Coffee, San Francisco, CA",
              text: "Saint Frank Coffee",
            },
          ],
        }),
        ok: true,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { client } = createSupabaseStub({
      apartment_listing_matches: [{ data: [] }],
      apartment_listings: [{ data: [buildListing()] }],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }, { data: null }],
    });

    const result = await searchCompatibleListingCards(client, {
      limit: 5,
      requestContext: {
        ...emptyContext,
        proximityConstraints: [placeConstraint("Saint Frank Coffee")],
      },
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.geocodeFailedPlaces).toEqual([]);
  });

  it("fetches the full 1.5mi keep radius and keeps listings inside it", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        places: [
          {
            displayName: { text: "Saint Frank Coffee" },
            location: { latitude: 37.7763, longitude: -122.4233 },
          },
        ],
      }),
      ok: true,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: [] }],
      apartment_listings: [
        {
          data: [
            buildListing({
              id: "listing-far",
              latitude: 37.7763 + 1.6 / 69,
              longitude: -122.4233,
            }),
            buildListing({
              id: "listing-near",
              latitude: 37.7763 + 1.4 / 69,
              longitude: -122.4233,
            }),
          ],
        },
      ],
      housing_preferences: [{ data: null }],
      matching_profiles: [{ data: null }, { data: null }],
    });

    const result = await searchCompatibleListingCards(client, {
      limit: 5,
      requestContext: {
        ...emptyContext,
        proximityConstraints: [placeConstraint("Saint Frank Coffee")],
      },
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.geocodeFailedPlaces).toEqual([]);
    expect(result.cards.map((card) => card.id)).toEqual(["listing-near"]);

    const gteLatitude = calls.find(
      (call) => call.method === "gte" && call.args[0] === "latitude",
    );
    const lteLatitude = calls.find(
      (call) => call.method === "lte" && call.args[0] === "latitude",
    );
    const gteLongitude = calls.find(
      (call) => call.method === "gte" && call.args[0] === "longitude",
    );
    const lteLongitude = calls.find(
      (call) => call.method === "lte" && call.args[0] === "longitude",
    );
    expect(gteLatitude?.args[1]).toBeCloseTo(37.7763 - 1.5 / 69, 6);
    expect(lteLatitude?.args[1]).toBeCloseTo(37.7763 + 1.5 / 69, 6);
    expect(gteLongitude?.args[1]).toBeCloseTo(-122.4233 - 1.5 / 54.6, 6);
    expect(lteLongitude?.args[1]).toBeCloseTo(-122.4233 + 1.5 / 54.6, 6);
  });
});
