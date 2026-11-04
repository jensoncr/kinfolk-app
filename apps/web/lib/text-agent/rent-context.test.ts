import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeListingRentContext,
  describeListingRentContext,
  resolveListingRentContext,
} from "./rent-context";
import type { RentCastListingRentContext } from "./rent-context";

const fetchRentCastRentEstimateMock = vi.fn<
  (...args: unknown[]) => Promise<unknown>
>(async () => null);
const isRentCastConfiguredMock = vi.fn(() => false);
vi.mock("../apartments/rentcast", () => ({
  fetchRentCastRentEstimate: (...args: unknown[]) =>
    fetchRentCastRentEstimateMock(...args),
  isRentCastConfigured: () => isRentCastConfiguredMock(),
}));

beforeEach(() => {
  fetchRentCastRentEstimateMock.mockReset();
  fetchRentCastRentEstimateMock.mockResolvedValue(null);
  isRentCastConfiguredMock.mockReset();
  isRentCastConfiguredMock.mockReturnValue(false);
});

type CompRow = {
  effective_monthly_rent: number | null;
  monthly_rent: number | null;
};

type RecordedQuery = { calls: Array<[string, ...unknown[]]> };

// Sequential chainable stub: the first from() resolves the first batch
// (nearby box), the second resolves the second batch (neighborhood widen).
function makeSupabase(batches: CompRow[][]) {
  const queries: RecordedQuery[] = [];
  let queryIndex = 0;
  const client = {
    from: () => {
      const rows = batches[queryIndex] ?? [];
      queryIndex += 1;
      const recorded: RecordedQuery = { calls: [] };
      queries.push(recorded);
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "neq",
        "gte",
        "lte",
        "ilike",
        "limit",
      ]) {
        chain[method] = (...args: unknown[]) => {
          recorded.calls.push([method, ...args]);
          return chain;
        };
      }
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return chain;
    },
  };
  return { client: client as never, queries };
}

function rents(values: number[]): CompRow[] {
  return values.map((value) => ({
    effective_monthly_rent: value,
    monthly_rent: value,
  }));
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    bedrooms: 2,
    effective_monthly_rent: 4495,
    id: "listing-1",
    latitude: 37.7599,
    longitude: -122.4148,
    monthly_rent: 4495,
    neighborhood: "Mission",
    ...overrides,
  } as Parameters<typeof computeListingRentContext>[1];
}

describe("computeListingRentContext", () => {
  it("computes the nearby median when at least 5 comps sit in the 0.75mi box", async () => {
    const { client, queries } = makeSupabase([
      rents([4000, 4100, 4200, 4300, 4400]),
    ]);

    const context = await computeListingRentContext(client, listing());

    expect(context).toEqual({
      deltaPct: 7,
      medianRent: 4200,
      sampleSize: 5,
      scope: "nearby",
      source: "internal",
    });
    const methods = queries[0].calls.map(([method]) => method);
    expect(methods).toContain("gte");
    expect(queries[0].calls).toContainEqual(["eq", "bedrooms", 2]);
    expect(queries[0].calls).toContainEqual(["neq", "id", "listing-1"]);
  });

  it("widens to the neighborhood when the box is too thin", async () => {
    const { client, queries } = makeSupabase([
      rents([4000, 4100]),
      rents([3800, 3900, 4000, 4100, 4200, 4300]),
    ]);

    const context = await computeListingRentContext(client, listing());

    expect(context).toMatchObject({
      medianRent: 4050,
      sampleSize: 6,
      scope: "neighborhood",
    });
    expect(queries[1].calls).toContainEqual(["ilike", "neighborhood", "Mission"]);
  });

  it("returns null when both scopes are under the minimum sample size", async () => {
    const { client } = makeSupabase([rents([4000]), rents([4100, 4200])]);

    expect(await computeListingRentContext(client, listing())).toBe(null);
  });

  it("returns null without querying when the bedroom count is unknown", async () => {
    const { client, queries } = makeSupabase([rents([1, 2, 3, 4, 5])]);

    expect(
      await computeListingRentContext(client, listing({ bedrooms: null })),
    ).toBe(null);
    expect(queries).toHaveLength(0);
  });

  it("skips the box and goes straight to the neighborhood without coordinates", async () => {
    const { client, queries } = makeSupabase([
      rents([4300, 4400, 4500, 4600, 4700]),
    ]);

    const context = await computeListingRentContext(
      client,
      listing({ latitude: null, longitude: null }),
    );

    expect(context).toMatchObject({ scope: "neighborhood" });
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toContainEqual(["ilike", "neighborhood", "Mission"]);
  });

  it("ignores rows without a usable rent", async () => {
    const { client } = makeSupabase([
      [
        ...rents([4000, 4100, 4200, 4300]),
        { effective_monthly_rent: null, monthly_rent: null },
      ],
      rents([3900, 4000, 4100, 4200, 4300]),
    ]);

    const context = await computeListingRentContext(client, listing());

    expect(context).toMatchObject({ sampleSize: 5, scope: "neighborhood" });
  });
});

describe("describeListingRentContext", () => {
  it("phrases above/below market deltas with the bedroom label and scope", () => {
    expect(
      describeListingRentContext(
        {
          deltaPct: 8,
          medianRent: 4200,
          sampleSize: 11,
          scope: "nearby",
          source: "internal",
        },
        2,
      ),
    ).toBe("about 8% above the typical 2bd nearby");
    expect(
      describeListingRentContext(
        {
          deltaPct: -12,
          medianRent: 3000,
          sampleSize: 7,
          scope: "neighborhood",
          source: "internal",
        },
        0,
      ),
    ).toBe("about 12% below the typical studio in the neighborhood");
  });

  it("calls small deltas right at market", () => {
    expect(
      describeListingRentContext(
        {
          deltaPct: 2,
          medianRent: 4200,
          sampleSize: 9,
          scope: "nearby",
          source: "internal",
        },
        1,
      ),
    ).toBe("right at market for a 1bd nearby");
  });

  it("falls back to the plain median when the subject rent is unknown", () => {
    expect(
      describeListingRentContext(
        {
          deltaPct: null,
          medianRent: 4200,
          sampleSize: 9,
          scope: "nearby",
          source: "internal",
        },
        2,
      ),
    ).toBe("the typical 2bd nearby runs about $4,200/mo");
  });

  it("attributes RentCast estimates to RentCast with the delta direction", () => {
    expect(
      describeListingRentContext(rentCastContext({ deltaPct: -8 }), 2),
    ).toBe("listed about 8% under RentCast's going rate of around $4,100/mo");
    expect(
      describeListingRentContext(rentCastContext({ deltaPct: 10 }), 1),
    ).toBe("listed about 10% over RentCast's going rate of around $4,100/mo");
  });

  it("calls small RentCast deltas right at the going rate", () => {
    expect(
      describeListingRentContext(rentCastContext({ deltaPct: 2 }), 2),
    ).toBe("right at RentCast's going rate of about $4,100/mo");
  });

  it("quotes the bare RentCast estimate when the subject rent is unknown", () => {
    expect(
      describeListingRentContext(rentCastContext({ deltaPct: null }), 2),
    ).toBe("RentCast puts the going rate for a 2bd like this around $4,100/mo");
  });
});

function rentCastContext(
  overrides: Partial<RentCastListingRentContext> = {},
): RentCastListingRentContext {
  return {
    compCount: 9,
    comps: [],
    deltaPct: -8,
    rentEstimate: 4100,
    rentRangeHigh: 4400,
    rentRangeLow: 3800,
    source: "rentcast",
    ...overrides,
  };
}

type ScriptedResponse = {
  count?: number | null;
  data?: unknown;
  error?: unknown;
};

type ScriptedBudget = { allowed?: boolean; error?: unknown };

// Scripted chainable stub: each from() consumes the next response in order,
// covering comps queries (thenable), the cache read (maybeSingle), and the
// cache write (update + eq, thenable). Budget reservations go through rpc(),
// which consumes budgetResponses in order (defaulting to allowed).
function makeScriptedSupabase(
  responses: ScriptedResponse[],
  budgetResponses: ScriptedBudget[] = [],
) {
  const queries: Array<{
    calls: Array<[string, ...unknown[]]>;
    table: string;
  }> = [];
  const rpcCalls: Array<{ args: unknown; fn: string }> = [];
  let index = 0;
  let budgetIndex = 0;
  const client = {
    from: (table: string) => {
      const response = responses[index] ?? {};
      index += 1;
      const recorded = {
        calls: [] as Array<[string, ...unknown[]]>,
        table,
      };
      queries.push(recorded);
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "neq",
        "gte",
        "lte",
        "ilike",
        "limit",
        "update",
      ]) {
        chain[method] = (...args: unknown[]) => {
          recorded.calls.push([method, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({
        data: response.data ?? null,
        error: response.error ?? null,
      });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          count: response.count ?? null,
          data: response.data ?? null,
          error: response.error ?? null,
        }).then(resolve, reject);
      return chain;
    },
    rpc: async (fn: string, args: unknown) => {
      const budget = budgetResponses[budgetIndex] ?? {};
      budgetIndex += 1;
      rpcCalls.push({ args, fn });
      return {
        data: [{ allowed: budget.allowed ?? true }],
        error: budget.error ?? null,
      };
    },
  };
  return { client: client as never, queries, rpcCalls };
}

// Defaults to a listing the internal comps cannot price: no coordinates and no
// neighborhood, so computeListingRentContext returns null without querying.
function subjectListing(overrides: Record<string, unknown> = {}) {
  return {
    address_line: "2525 Larkin St",
    bathrooms: 1,
    bedrooms: 2,
    city: "San Francisco",
    effective_monthly_rent: 4495,
    id: "listing-1",
    latitude: null,
    longitude: null,
    monthly_rent: 4495,
    neighborhood: null,
    postal_code: "94109",
    square_feet: 700,
    state: "CA",
    ...overrides,
  } as Parameters<typeof resolveListingRentContext>[1];
}

const rentCastEstimate = {
  compCount: 9,
  comps: [
    {
      address: "2520 Larkin St, San Francisco, CA 94109",
      distanceMiles: 0.12,
      rent: 4050,
    },
  ],
  rentEstimate: 4100,
  rentRangeHigh: 4400,
  rentRangeLow: 3800,
};

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("resolveListingRentContext", () => {
  it("returns the internal context and never reaches for RentCast when comps are healthy", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    const { client, queries } = makeScriptedSupabase([
      { data: rents([4000, 4100, 4200, 4300, 4400]) },
    ]);

    const context = await resolveListingRentContext(
      client,
      subjectListing({ neighborhood: "Mission" }),
    );

    expect(context).toMatchObject({ scope: "neighborhood", source: "internal" });
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
  });

  it("stays internal-only when the key is absent, even on an explicit price check", async () => {
    const thin = makeScriptedSupabase([]);
    expect(
      await resolveListingRentContext(thin.client, subjectListing(), {
        priceCheck: true,
      }),
    ).toBe(null);
    expect(thin.queries).toHaveLength(0);

    const healthy = makeScriptedSupabase([
      { data: rents([4000, 4100, 4200, 4300, 4400]) },
    ]);
    expect(
      await resolveListingRentContext(
        healthy.client,
        subjectListing({ neighborhood: "Mission" }),
        { priceCheck: true },
      ),
    ).toMatchObject({ source: "internal" });
    expect(healthy.queries).toHaveLength(1);
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
  });

  it("fetches, reserves the budget, and atomically merges the cache entry without a whole-column rewrite", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    fetchRentCastRentEstimateMock.mockResolvedValue(rentCastEstimate);
    const { client, queries, rpcCalls } = makeScriptedSupabase([
      { data: { provider_detail_payload: { floorPlans: ["existing"] } } },
    ]);

    const context = await resolveListingRentContext(client, subjectListing());

    expect(context).toEqual({
      ...rentCastEstimate,
      deltaPct: 10,
      source: "rentcast",
    });
    expect(fetchRentCastRentEstimateMock).toHaveBeenCalledWith({
      address: "2525 Larkin St, San Francisco, CA, 94109",
      bathrooms: 1,
      bedrooms: 2,
      latitude: null,
      longitude: null,
      squareFootage: 700,
    });

    // The call was reserved against the atomic global monthly budget.
    expect(rpcCalls[0].fn).toBe("hit_text_agent_rate_limit");
    expect(rpcCalls[0].args).toMatchObject({
      p_bucket_type: "rentcast_calls_month",
      p_limit: 40,
    });

    // The cache write goes through the atomic single-key merge RPC, not a
    // read-modify-write of the whole provider_detail_payload column.
    const mergeCall = rpcCalls.find(
      (call) => call.fn === "merge_listing_provider_detail_payload",
    );
    expect(mergeCall?.args).toMatchObject({
      p_key: "rentcast",
      p_listing_id: "listing-1",
    });
    const merged = mergeCall?.args as {
      p_value: { estimate: unknown; fetched_at: string };
    };
    expect(merged.p_value.estimate).toEqual(rentCastEstimate);
    expect(typeof merged.p_value.fetched_at).toBe("string");
    // No whole-column update was issued (only the cache read used from()).
    expect(
      queries.some((q) => q.calls.some(([method]) => method === "update")),
    ).toBe(false);
  });

  it("falls back to a whole-column write when the atomic merge RPC is unavailable", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    fetchRentCastRentEstimateMock.mockResolvedValue(rentCastEstimate);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client, queries } = makeScriptedSupabase(
      [
        { data: { provider_detail_payload: { floorPlans: ["existing"] } } },
        {},
      ],
      // budget allowed, then the merge RPC errors (e.g. not deployed yet)
      [{ allowed: true }, { error: new Error("function does not exist") }],
    );

    const context = await resolveListingRentContext(client, subjectListing());

    expect(context).toMatchObject({ source: "rentcast" });
    const updateCall = queries[1].calls.find(([method]) => method === "update");
    const updated = (
      updateCall?.[1] as {
        provider_detail_payload: {
          floorPlans: string[];
          rentcast: { estimate: unknown };
        };
      }
    ).provider_detail_payload;
    expect(updated.floorPlans).toEqual(["existing"]);
    expect(updated.rentcast.estimate).toEqual(rentCastEstimate);
    expect(queries[1].calls).toContainEqual(["eq", "id", "listing-1"]);
    consoleError.mockRestore();
  });

  it("pulls RentCast on an explicit price check even when internal comps are healthy", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    fetchRentCastRentEstimateMock.mockResolvedValue(rentCastEstimate);
    const { client } = makeScriptedSupabase([
      { data: rents([4000, 4100, 4200, 4300, 4400]) },
      { data: { provider_detail_payload: {} } },
      {},
    ]);

    const context = await resolveListingRentContext(
      client,
      subjectListing({ neighborhood: "Mission" }),
      { priceCheck: true },
    );

    expect(context).toMatchObject({ rentEstimate: 4100, source: "rentcast" });
    expect(fetchRentCastRentEstimateMock).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh cache hit without spending a call", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    const { client, queries } = makeScriptedSupabase([
      {
        data: {
          provider_detail_payload: {
            rentcast: { estimate: rentCastEstimate, fetched_at: isoDaysAgo(13) },
          },
        },
      },
    ]);

    const context = await resolveListingRentContext(client, subjectListing());

    expect(context).toEqual({
      ...rentCastEstimate,
      deltaPct: 10,
      source: "rentcast",
    });
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
  });

  it("keeps a fresh cached miss quiet without refetching", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    const { client, queries } = makeScriptedSupabase([
      {
        data: {
          provider_detail_payload: {
            rentcast: { estimate: null, fetched_at: isoDaysAgo(0.5) },
          },
        },
      },
    ]);

    expect(await resolveListingRentContext(client, subjectListing())).toBe(
      null,
    );
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
  });

  it("refetches once the cached estimate goes stale", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    fetchRentCastRentEstimateMock.mockResolvedValue(rentCastEstimate);
    const { client } = makeScriptedSupabase([
      {
        data: {
          provider_detail_payload: {
            rentcast: { estimate: rentCastEstimate, fetched_at: isoDaysAgo(15) },
          },
        },
      },
      {},
    ]);

    const context = await resolveListingRentContext(client, subjectListing());

    expect(context).toMatchObject({ source: "rentcast" });
    expect(fetchRentCastRentEstimateMock).toHaveBeenCalledTimes(1);
  });

  it("stops fetching once the monthly call budget is spent", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    const { client, queries, rpcCalls } = makeScriptedSupabase(
      [{ data: { provider_detail_payload: {} } }],
      [{ allowed: false }],
    );

    expect(await resolveListingRentContext(client, subjectListing())).toBe(
      null,
    );
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
    // Cache read only; no fetch, no cache-write.
    expect(queries).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
  });

  it("fails closed when the budget counter itself errors", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    const { client } = makeScriptedSupabase(
      [{ data: { provider_detail_payload: {} } }],
      [{ error: new Error("rate limit rpc down") }],
    );

    expect(await resolveListingRentContext(client, subjectListing())).toBe(
      null,
    );
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
  });

  it("enforces the per-user daily quota before the global budget", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    const { client, rpcCalls } = makeScriptedSupabase(
      [{ data: { provider_detail_payload: {} } }],
      [{ allowed: false }],
    );

    expect(
      await resolveListingRentContext(client, subjectListing(), {
        userId: "user-9",
      }),
    ).toBe(null);
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
    // The per-user bucket is checked first and short-circuits the global one.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({
      p_bucket_key: "user:user-9",
      p_bucket_type: "rentcast_user_day",
      p_limit: 5,
    });
  });

  it("caches the miss with an escalating backoff counter when RentCast comes back empty", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    fetchRentCastRentEstimateMock.mockResolvedValue(null);
    const { client, rpcCalls } = makeScriptedSupabase([
      {
        data: {
          provider_detail_payload: {
            // a prior miss that has aged past its 1-day backoff
            rentcast: {
              estimate: null,
              fetched_at: isoDaysAgo(3),
              miss_count: 1,
            },
          },
        },
      },
    ]);

    expect(await resolveListingRentContext(client, subjectListing())).toBe(
      null,
    );
    const mergeCall = rpcCalls.find(
      (call) => call.fn === "merge_listing_provider_detail_payload",
    );
    const merged = mergeCall?.args as {
      p_value: { estimate: unknown; miss_count: number };
    };
    expect(merged.p_value.estimate).toBe(null);
    expect(merged.p_value.miss_count).toBe(2);
  });

  it("keeps backing-off misses quiet without refetching while still fresh", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    // miss_count 3 → 4-day backoff; a 2-day-old miss is still fresh.
    const { client, queries } = makeScriptedSupabase([
      {
        data: {
          provider_detail_payload: {
            rentcast: {
              estimate: null,
              fetched_at: isoDaysAgo(2),
              miss_count: 3,
            },
          },
        },
      },
    ]);

    expect(await resolveListingRentContext(client, subjectListing())).toBe(
      null,
    );
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
  });

  it("degrades to the internal context when the RentCast path fails", async () => {
    isRentCastConfiguredMock.mockReturnValue(true);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client } = makeScriptedSupabase([
      { data: rents([4000, 4100, 4200, 4300, 4400]) },
      { error: new Error("db down") },
    ]);

    const context = await resolveListingRentContext(
      client,
      subjectListing({ neighborhood: "Mission" }),
      { priceCheck: true },
    );

    expect(context).toMatchObject({ source: "internal" });
    expect(fetchRentCastRentEstimateMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
