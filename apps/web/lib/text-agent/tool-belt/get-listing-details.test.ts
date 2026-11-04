import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getListingDetailsTool,
  resolveReferencedListingLocation,
} from "./get-listing-details";

vi.mock("server-only", () => ({}));

const loadTextThreadAgentMemoryMock = vi.fn(async () => ({
  rollingSummary: "",
  sentListingCards: [] as Record<string, unknown>[],
}));
vi.mock("../thread-data", () => ({
  loadTextThreadAgentMemory: () => loadTextThreadAgentMemoryMock(),
}));
vi.mock("../store-shared", () => ({
  getKinfolkPublicMediaBaseUrl: () => "",
}));
const buildListingCardUrlMock = vi.fn<(...args: unknown[]) => string>(() => "");
vi.mock("../../apartments/listing-card", () => ({
  buildListingCardUrl: (...args: unknown[]) => buildListingCardUrlMock(...args),
}));
// DataSF building signals are an external lookup; default to "nothing found"
// so the tests drive nonzero cases explicitly.
const fetchBuildingQualitySignalsMock = vi.fn<
  (...args: unknown[]) => Promise<unknown>
>(async () => null);
vi.mock("../../apartments/area-signals", () => ({
  fetchBuildingQualitySignals: (...args: unknown[]) =>
    fetchBuildingQualitySignalsMock(...args),
}));
const resolveListingRentContextMock = vi.fn<
  (...args: unknown[]) => Promise<unknown>
>(async () => null);
const describeListingRentContextMock = vi.fn<(...args: unknown[]) => string>(
  () => "about 7% above the typical 1bd nearby",
);
vi.mock("../rent-context", () => ({
  describeListingRentContext: (...args: unknown[]) =>
    describeListingRentContextMock(...args),
  resolveListingRentContext: (...args: unknown[]) =>
    resolveListingRentContextMock(...args),
}));

function makeSupabase({
  listings = [] as Record<string, unknown>[],
  recommendations = [] as Record<string, unknown>[],
} = {}) {
  return {
    from: (table: string) => {
      const rows =
        table === "apartment_listings"
          ? listings
          : table === "text_listing_recommendations"
            ? recommendations
            : [];
      const filters: Array<
        | { column: string; kind: "eq"; value: unknown }
        | { column: string; kind: "ilike"; value: string }
      > = [];
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit"]) {
        chain[method] = () => chain;
      }
      chain.eq = (column: string, value: unknown) => {
        filters.push({ column, kind: "eq", value });
        return chain;
      };
      chain.ilike = (column: string, value: string) => {
        filters.push({ column, kind: "ilike", value });
        return chain;
      };
      chain.maybeSingle = async () => ({
        data:
          rows.find((row) =>
            filters.every((filter) => rowMatchesFilter(row, filter)),
          ) ?? null,
        error: null,
      });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: rows.filter((row) =>
            filters.every((filter) => rowMatchesFilter(row, filter)),
          ),
          error: null,
        }).then(resolve, reject);
      return chain;
    },
  } as never;
}

function rowMatchesFilter(
  row: Record<string, unknown>,
  filter:
    | { column: string; kind: "eq"; value: unknown }
    | { column: string; kind: "ilike"; value: string },
) {
  if (!(filter.column in row)) return true;
  if (filter.kind === "eq") return row[filter.column] === filter.value;
  const value = String(row[filter.column] ?? "").toLowerCase();
  const pattern = filter.value
    .replace(/^%|%$/gu, "")
    .replace(/\\([%_\\])/gu, "$1")
    .toLowerCase();
  return value.includes(pattern);
}

function fakeRecommendationRow(overrides: Record<string, unknown> = {}) {
  return {
    card_snapshot: { address: "2525 Larkin St" },
    created_at: "2026-06-11T01:00:00.000Z",
    id: "rec-1",
    listing_id: "listing-1",
    outbound_idempotency_key: "kinfolk:run-1:agent_search:listing-1",
    rank: 1,
    ...overrides,
  };
}

function fakeListingRow(overrides: Record<string, unknown> = {}) {
  return {
    address_line: "2525 Larkin St",
    amenities: ["Dishwasher", "Roof deck"],
    available_at: "2026-08-01",
    bathrooms: 1,
    bedrooms: 1,
    city: "San Francisco",
    concession_lease_months: 0,
    concession_months: 0,
    concession_note: null,
    description: "Bright Russian Hill one-bedroom with bay views.",
    effective_monthly_rent: 4495,
    id: "listing-1",
    inactive_at: null,
    last_seen_at: new Date().toISOString(),
    latitude: 37.7989,
    lease_terms: ["12 months"],
    longitude: -122.4214,
    listing_status: "active",
    monthly_rent: 4495,
    neighborhood: "Russian Hill",
    no_fee: false,
    poi_summary: null,
    property_type: "apartment",
    source_url: "https://example.com/listing-1",
    square_feet: 700,
    unit: null,
    ...overrides,
  };
}

const recentBatch = [
  fakeRecommendationRow({
    card_snapshot: { address: "742 Green St" },
    id: "rec-2",
    listing_id: "listing-2",
    outbound_idempotency_key: "kinfolk:run-1:agent_search:listing-2",
    rank: 2,
  }),
  fakeRecommendationRow({
    card_snapshot: { address: "19 Vandewater St" },
    id: "rec-3",
    listing_id: "listing-3",
    outbound_idempotency_key: "kinfolk:run-1:agent_search:listing-3",
    rank: 3,
  }),
  fakeRecommendationRow(),
];

describe("get_listing_details", () => {
  beforeEach(() => {
    buildListingCardUrlMock.mockClear();
  });

  it("resolves 'the second one' by rank within the latest sent batch", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "what's the deal with the second one?",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "742 Green St",
              id: "listing-2",
            }),
          ],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { ordinal: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      address: "742 Green St",
      recommendationId: "rec-2",
    });
  });

  it("does not attach listing-card media when no public media base is available", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "show me the second one",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "742 Green St",
              id: "listing-2",
            }),
          ],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { ordinal: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.media).toHaveLength(0);
    expect(buildListingCardUrlMock).not.toHaveBeenCalled();
  });

  it("answers honestly when the listing never states a pet policy", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "does the first one allow dogs?",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              available_at: null,
              lease_terms: null,
              square_feet: null,
            }),
          ],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      address: "2525 Larkin St",
      parking: null,
      petPolicy: null,
    });
    expect(result.data.notStated).toEqual(
      expect.arrayContaining(["a pet policy", "square footage", "an availability date"]),
    );
    expect(result.summary).toContain("does not state");
    expect(result.summary).toContain("the source link");
    expect(result.summary).toContain("never guess");
  });

  it("quotes the listing's own pet wording when it exists", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              amenities: ["Dishwasher", "Cats OK"],
            }),
          ],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ petPolicy: "Cats OK" });
    expect(result.data.notStated).not.toContain("a pet policy");
  });

  it("prefers the thread memory's last sent cards for ordinal order", async () => {
    loadTextThreadAgentMemoryMock.mockResolvedValueOnce({
      rollingSummary: "",
      sentListingCards: [
        {
          address: "19 Vandewater St",
          listingId: "listing-3",
          ordinal: 1,
          recommendationId: "rec-3",
        },
        {
          // recommendationId no longer matches a stored row; the defensive
          // listing-id match should still resolve it.
          address: "2525 Larkin St",
          listingId: "listing-1",
          ordinal: 2,
          recommendationId: "rec-stale",
        },
      ],
    });

    const result = await getListingDetailsTool.run(
      {
        body: "tell me about the second one",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      address: "2525 Larkin St",
      recommendationId: "rec-1",
    });
  });

  it("asks which listing they mean when the reference is ambiguous", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "tell me about it",
        supabase: makeSupabase({ recommendations: recentBatch }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Ask which one");
    expect(result.data.recentlyShown).toEqual([
      "2525 Larkin St",
      "742 Green St",
      "19 Vandewater St",
    ]);
  });

  it("resolves an explicit address from the active catalog without a sent card", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "tell me more about 8 Cypress St Unit 8",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "8 Cypress St",
              id: "listing-cypress",
              monthly_rent: 3200,
              unit: "Unit 8",
            }),
          ],
          recommendations: [],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "8 Cypress St Unit 8" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      address: "8 Cypress St Unit 8",
      recommendationId: null,
    });
    expect(result.summary).toContain("Stored details for 8 Cypress St Unit 8");
  });

  it("resolves a street whose name starts with a unit keyword (Aptos)", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "tell me more about 100 Aptos Ave",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "100 Aptos Ave",
              id: "listing-aptos",
              monthly_rent: 4100,
              unit: null,
            }),
          ],
          recommendations: [],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "100 Aptos Ave" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      address: "100 Aptos Ave",
      recommendationId: null,
    });
  });

  it("uses the named unit to resolve a multi-unit building", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "tell me more about 8 Cypress St Unit 8",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "8 Cypress St",
              id: "cypress-3",
              monthly_rent: 3200,
              unit: "Unit 3",
            }),
            fakeListingRow({
              address_line: "8 Cypress St",
              id: "cypress-8",
              monthly_rent: 4800,
              unit: "Unit 8",
            }),
          ],
          recommendations: [],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "8 Cypress St Unit 8" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      address: "8 Cypress St Unit 8",
      monthlyRent: 4800,
    });
  });

  it("asks which unit when a multi-unit building is named without a unit", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "tell me more about 8 Cypress St",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "8 Cypress St",
              id: "cypress-3",
              unit: "Unit 3",
            }),
            fakeListingRow({
              address_line: "8 Cypress St",
              id: "cypress-8",
              unit: "Unit 8",
            }),
          ],
          recommendations: [],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "8 Cypress St" },
    );

    expect(result.ok).toBe(false);
  });

  it("resolves a taken-down listing by address with a freshness caveat", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "tell me more about 50 Pine St",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "50 Pine St",
              id: "pine-inactive",
              inactive_at: "2026-06-01T00:00:00.000Z",
              listing_status: "inactive",
              unit: null,
            }),
          ],
          recommendations: [],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "50 Pine St" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ address: "50 Pine St" });
    expect(result.summary).toMatch(/gone inactive/i);
  });

  it("does not resolve a different building with a colliding house-number suffix", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "tell me more about 8 Cypress St",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "18 Cypress St",
              id: "listing-18",
              unit: null,
            }),
          ],
          recommendations: [],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "8 Cypress St" },
    );

    expect(result.ok).toBe(false);
  });

  it("falls back to the card snapshot when the listing record is gone", async () => {
    const result = await getListingDetailsTool.run(
      {
        body: "",
        supabase: makeSupabase({ recommendations: recentBatch }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { recommendationId: "rec-2" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ address: "742 Green St" });
    expect(result.summary).toContain("no longer has a live record");
  });

  it("surfaces nonzero DBI and eviction signals with attribution", async () => {
    fetchBuildingQualitySignalsMock.mockResolvedValueOnce({
      evictionNotices: {
        blockAddress: "2500 BLOCK OF LARKIN STREET",
        mostRecentDate: "2026-02-19",
        noticeCount: 1,
        status: "ok",
        windowMonths: 24,
      },
      openComplaints: {
        categories: [{ count: 2, label: "Housing Inspection Services" }],
        count: 2,
        mostRecentDate: "2026-06-09",
        status: "ok",
      },
      source: "DataSF (DBI complaints; Rent Board eviction notices)",
    });

    const result = await getListingDetailsTool.run(
      {
        body: "anything sketchy about the building?",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin" },
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain(
      "DBI shows 2 open building complaints for this building",
    );
    expect(result.summary).toContain("Housing Inspection Services");
    expect(result.summary).toContain(
      "DataSF shows 1 eviction notice filed on this block in the last 24 months",
    );
    expect(result.data.buildingSignals).toMatchObject({
      openComplaints: { count: 2 },
    });
  });

  it("says nothing about the building when everything comes back zero", async () => {
    fetchBuildingQualitySignalsMock.mockResolvedValueOnce({
      evictionNotices: {
        blockAddress: "2500 BLOCK OF LARKIN STREET",
        mostRecentDate: null,
        noticeCount: 0,
        status: "ok",
        windowMonths: 24,
      },
      openComplaints: {
        categories: [],
        count: 0,
        mostRecentDate: null,
        status: "ok",
      },
      source: "DataSF (DBI complaints; Rent Board eviction notices)",
    });

    const result = await getListingDetailsTool.run(
      {
        body: "",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin" },
    );

    expect(result.ok).toBe(true);
    // No zeros for the model to spin into a "no complaints!" comfort claim.
    expect(result.data.buildingSignals).toBe(null);
    expect(result.summary).not.toContain("DBI");
    expect(result.summary).not.toContain("eviction");
    expect(result.summary).not.toContain("complaint");
  });

  it("adds internal rent comps as shareable rent context", async () => {
    resolveListingRentContextMock.mockResolvedValueOnce({
      deltaPct: 7,
      medianRent: 4200,
      sampleSize: 11,
      scope: "nearby",
      source: "internal",
    });

    const result = await getListingDetailsTool.run(
      {
        body: "tell me more about it",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin" },
    );

    expect(result.ok).toBe(true);
    expect(result.data.rentContext).toEqual({
      deltaPct: 7,
      medianRent: 4200,
      sampleSize: 11,
      scope: "nearby",
      source: "internal",
    });
    expect(result.summary).toContain(
      "Rent context: this one is about 7% above the typical 1bd nearby",
    );
    expect(result.summary).toContain("median $4,200/mo across 11 active listings");
    expect(resolveListingRentContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "listing-1" }),
      { priceCheck: false, userId: "user-1" },
    );
  });

  it("passes the priceCheck intent through and attributes RentCast estimates", async () => {
    const rentcastContext = {
      compCount: 9,
      comps: [
        {
          address: "2520 Larkin St, San Francisco, CA 94109",
          distanceMiles: 0.12,
          rent: 4050,
        },
      ],
      deltaPct: 10,
      rentEstimate: 4100,
      rentRangeHigh: 4400,
      rentRangeLow: 3800,
      source: "rentcast",
    };
    resolveListingRentContextMock
      .mockResolvedValueOnce(rentcastContext)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(rentcastContext);
    describeListingRentContextMock.mockReturnValueOnce(
      "listed about 10% over RentCast's going rate of around $4,100/mo",
    );

    const result = await getListingDetailsTool.run(
      {
        body: "is the larkin one overpriced?",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin", priceCheck: true },
    );

    expect(result.ok).toBe(true);
    expect(resolveListingRentContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "listing-1" }),
      { priceCheck: true, userId: "user-1" },
    );
    expect(result.data.rentContext).toMatchObject({
      rentEstimate: 4100,
      source: "rentcast",
    });
    expect(result.summary).toContain(
      "Rent context: this one is listed about 10% over RentCast's going rate of around $4,100/mo",
    );
    expect(result.summary).toContain(
      "RentCast AVM estimate, range $3,800–$4,400 from 9 comps",
    );
    expect(result.summary).toContain("RentCast named as the source");

    await getListingDetailsTool.run(
      {
        body: "tell me about larkin",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin", priceCheck: " false " },
    );
    expect(resolveListingRentContextMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "listing-1" }),
      { priceCheck: false, userId: "user-1" },
    );

    await getListingDetailsTool.run(
      {
        body: "is the larkin one overpriced?",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin", priceCheck: " TRUE " },
    );
    expect(resolveListingRentContextMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "listing-1" }),
      { priceCheck: true, userId: "user-1" },
    );
  });

  it("never fails the tool when the context lookups blow up", async () => {
    fetchBuildingQualitySignalsMock.mockRejectedValueOnce(
      new Error("socrata down"),
    );
    resolveListingRentContextMock.mockRejectedValueOnce(
      new Error("db hiccup"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await getListingDetailsTool.run(
      {
        body: "",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "2525 Larkin" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      buildingSignals: null,
      rentContext: null,
    });
    consoleError.mockRestore();
  });
});

describe("resolveReferencedListingLocation", () => {
  it("resolves 'the second one' to that listing's coordinates", async () => {
    const located = await resolveReferencedListingLocation(
      {
        body: "how's the commute from the second one?",
        supabase: makeSupabase({
          listings: [
            fakeListingRow({
              address_line: "742 Green St",
              id: "listing-2",
              latitude: 37.7997,
              longitude: -122.4078,
              neighborhood: "North Beach",
            }),
          ],
          recommendations: recentBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { ordinal: 2 },
    );

    expect(located.resolved).toEqual({
      address: "742 Green St",
      lat: 37.7997,
      lng: -122.4078,
      listingId: "listing-2",
      neighborhood: "North Beach",
      recommendationId: "rec-2",
    });
    expect(located.recentlyShown).toEqual([
      "2525 Larkin St",
      "742 Green St",
      "19 Vandewater St",
    ]);
  });

  it("keeps coordinates null when the listing record is gone", async () => {
    const located = await resolveReferencedListingLocation(
      {
        body: "",
        supabase: makeSupabase({ recommendations: recentBatch }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { address: "19 Vandewater" },
    );

    expect(located.resolved).toMatchObject({
      address: "19 Vandewater St",
      lat: null,
      lng: null,
    });
  });

  it("does not fall back to a lone shown listing when told not to", async () => {
    const loneBatch = [recentBatch[2]];

    const withFallback = await resolveReferencedListingLocation(
      {
        body: "how's the commute to fidi?",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: loneBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );
    expect(withFallback.resolved).not.toBe(null);

    const withoutFallback = await resolveReferencedListingLocation(
      {
        body: "how's the commute to fidi?",
        supabase: makeSupabase({
          listings: [fakeListingRow()],
          recommendations: loneBatch,
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { allowLoneRecentFallback: false },
    );
    expect(withoutFallback.resolved).toBe(null);
  });
});
