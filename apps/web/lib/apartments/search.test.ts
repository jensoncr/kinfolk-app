import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../supabase/types";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/shared/evidence", () => ({ parseEvidencePoints: vi.fn() }));
vi.mock("@/lib/apartments/persisted-roommate-groups", () => ({
  attachPersistedRoommateGroupsToEnriched: vi.fn(),
  bestPersistedFormingGroupFitScore: vi.fn(),
  buildPersistedFormingGroupsForListing: vi.fn(),
  topReasonLabels: vi.fn(),
}));
vi.mock("@/lib/apartments/floor-plan-pricing", () => ({
  cheapestFloorPlanEffectiveMonthlyRent: vi.fn(),
  cheapestFloorPlanMonthlyRent: vi.fn(),
  displayFloorPlans: vi.fn(),
  floorPlanBedroomRange: vi.fn(),
}));
vi.mock("@/lib/apartments/roommate-splits", () => ({
  canSplitByRoommates: vi.fn(),
  clampRoommateSplitSize: vi.fn(),
  householdSizeLimitFromBedrooms: vi.fn(),
  propertyMarkerRentForDisplay: vi.fn(),
  roommateSplitLimitFromBedrooms: vi.fn(),
}));
vi.mock("@/lib/apartments/rent", () => ({
  calculateEffectiveMonthlyRent: vi.fn(),
}));
vi.mock("@/lib/matching/match-status", () => ({
  VISIBLE_APARTMENT_MATCH_STATUSES: [],
}));
vi.mock("@/lib/profiles/enrichment-store", () => ({
  ensureCompatibilityEdgesForPairs: vi.fn(),
}));
vi.mock("@/lib/supabase/config", () => ({
  hasServerSupabaseConfig: vi.fn(() => false),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/types", () => ({}));
vi.mock("@/lib/apartments/poi-summary", () => ({
  parsePoiSummary: vi.fn(),
}));
vi.mock("@/lib/apartments/types", () => ({}));

import { loadPersistedRoommateGroupContext, splits } from "./search";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("loadPersistedRoommateGroupContext() — viewer-gated member PII (P0)", () => {
  it("returns null for an anonymous viewer without querying the database", async () => {
    // Forming-group member profiles are other users' PII. With no authenticated
    // viewer the loader must short-circuit before touching Supabase — proving an
    // anonymous /apartments request (or the KINFOLK_APARTMENT_USER_ID demo
    // fallback) can never load member identities.
    const from = vi.fn(() => {
      throw new Error("anonymous viewer must not query member PII");
    });
    const supabase = { from } as never;

    await expect(
      loadPersistedRoommateGroupContext(supabase, ["listing-1"], null),
    ).resolves.toBeNull();
    await expect(
      loadPersistedRoommateGroupContext(supabase, ["listing-1"], ""),
    ).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("attempts to load member data once a viewer is authenticated", async () => {
    // Regression guard against over-tightening: an authenticated viewer must
    // pass the gate and reach the DB (the stub throws, which the loader swallows
    // to null) — so member PII loading is conditional on the viewer, not blocked
    // outright.
    const from = vi.fn(() => {
      throw new Error("query attempted");
    });
    const supabase = { from } as never;

    await expect(
      loadPersistedRoommateGroupContext(supabase, ["listing-1"], "user-1"),
    ).resolves.toBeNull();
    expect(from).toHaveBeenCalled();
  });
});

describe("preloadApartmentSearchCatalog()", () => {
  it("treats blank catalog env config as the default market and listing limit", async () => {
    vi.resetModules();
    vi.stubEnv("KINFOLK_APARTMENT_LISTING_LIMIT", " ");
    vi.stubEnv("KINFOLK_APARTMENT_MARKET", " ");

    const listingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    };
    listingQuery.select.mockReturnValue(listingQuery);
    listingQuery.eq.mockReturnValue(listingQuery);
    listingQuery.order.mockReturnValue(listingQuery);
    listingQuery.limit.mockResolvedValue({ data: [], error: null });

    const supabase = { from: vi.fn(() => listingQuery) };
    const { hasServerSupabaseConfig } = await import("@/lib/supabase/config");
    const { createSupabaseServiceClient } = await import(
      "@/lib/supabase/server"
    );
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    const { preloadApartmentSearchCatalog } = await import("./search");

    await preloadApartmentSearchCatalog();

    expect(supabase.from).toHaveBeenCalledWith("apartment_listings");
    expect(listingQuery.eq).toHaveBeenCalledWith(
      "provider_market",
      "san-francisco-ca",
    );
    expect(listingQuery.limit).toHaveBeenCalledWith(1000);
  });
});

describe("getApartmentSearchSnapshot() — freshness honesty", () => {
  // The badge on /apartments reports this timestamp as "listings last
  // refreshed". It must come from the scrape pipeline's last_seen_at, never
  // from the wall clock at query time — the old behavior claimed month-old
  // data was refreshed minutes ago whenever the import cron wasn't running.

  function selfChainingQuery(terminal: {
    limit?: unknown;
    range?: unknown;
  }) {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "in", "order"]) {
      query[method] = vi.fn(() => query);
    }
    query.limit = vi.fn(() => Promise.resolve(terminal.limit));
    query.range = vi.fn(() => Promise.resolve(terminal.range));
    return query;
  }

  async function snapshotForListings(listings: Array<Record<string, unknown>>) {
    vi.resetModules();
    const floorPlanPricing = await import("@/lib/apartments/floor-plan-pricing");
    vi.mocked(floorPlanPricing.displayFloorPlans).mockReturnValue([]);
    vi.mocked(floorPlanPricing.floorPlanBedroomRange).mockReturnValue({
      min: null,
      max: null,
    });
    vi.mocked(floorPlanPricing.cheapestFloorPlanMonthlyRent).mockReturnValue(
      null,
    );
    vi.mocked(
      floorPlanPricing.cheapestFloorPlanEffectiveMonthlyRent,
    ).mockReturnValue(null);
    const roommateSplits = await import("@/lib/apartments/roommate-splits");
    vi.mocked(roommateSplits.canSplitByRoommates).mockReturnValue(false);
    vi.mocked(roommateSplits.propertyMarkerRentForDisplay).mockReturnValue(
      null,
    );
    vi.mocked(roommateSplits.householdSizeLimitFromBedrooms).mockReturnValue(1);
    vi.mocked(roommateSplits.roommateSplitLimitFromBedrooms).mockReturnValue(1);
    const { hasServerSupabaseConfig } = await import("@/lib/supabase/config");
    const { createSupabaseServiceClient } = await import(
      "@/lib/supabase/server"
    );
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    const supabase = {
      from: vi.fn((table: string) =>
        table === "apartment_listings"
          ? selfChainingQuery({ limit: { data: listings, error: null } })
          : selfChainingQuery({ range: { data: [], error: null } }),
      ),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);
    const { getApartmentSearchSnapshot } = await import("./search");
    return getApartmentSearchSnapshot(null);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports null freshness when Supabase is not configured", async () => {
    vi.resetModules();
    const { hasServerSupabaseConfig } = await import("@/lib/supabase/config");
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(false);
    const { getApartmentSearchSnapshot } = await import("./search");
    const snapshot = await getApartmentSearchSnapshot(null);
    expect(snapshot.source.status).toBe("unavailable");
    expect(snapshot.refreshedAt).toBeNull();
    expect(snapshot.refreshStale).toBe(false);
  });

  it("reports null freshness for an empty catalog instead of the wall clock", async () => {
    const snapshot = await snapshotForListings([]);
    expect(snapshot.source.status).toBe("connected");
    expect(snapshot.refreshedAt).toBeNull();
    expect(snapshot.refreshStale).toBe(false);
  });

  it("derives refreshedAt from the median listing last_seen_at and flags stale data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00.000Z"));
    const snapshot = await snapshotForListings([
      { id: "listing-1", last_seen_at: "2026-06-24T04:47:27.000Z" },
      { id: "listing-2", last_seen_at: "2026-06-20T00:00:00.000Z" },
      { id: "listing-3", last_seen_at: null },
    ]);
    expect(snapshot.source.status).toBe("connected");
    // Lower median of the two valid timestamps, rows without one excluded.
    expect(snapshot.refreshedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(snapshot.refreshStale).toBe(true);
  });

  it("does not flag recently scraped data as stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00.000Z"));
    const snapshot = await snapshotForListings([
      { id: "listing-1", last_seen_at: "2026-07-25T09:00:00.000Z" },
    ]);
    expect(snapshot.refreshedAt).toBe("2026-07-25T09:00:00.000Z");
    expect(snapshot.refreshStale).toBe(false);
  });

  it("a few fresh rows cannot mask a mostly-old catalog (partial import)", async () => {
    // The listing import stamps last_seen_at batch-by-batch and only
    // deactivates unseen rows after all batches succeed — a run that dies
    // mid-way leaves fresh rows on top of an old catalog. The median must
    // still read stale where a max would read fresh.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00.000Z"));
    const snapshot = await snapshotForListings([
      { id: "listing-1", last_seen_at: "2026-07-25T09:00:00.000Z" },
      { id: "listing-2", last_seen_at: "2026-06-24T00:00:00.000Z" },
      { id: "listing-3", last_seen_at: "2026-06-24T00:00:00.000Z" },
      { id: "listing-4", last_seen_at: "2026-06-24T00:00:00.000Z" },
      { id: "listing-5", last_seen_at: "2026-06-24T00:00:00.000Z" },
    ]);
    expect(snapshot.refreshedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(snapshot.refreshStale).toBe(true);
  });
});

describe("splits()", () => {
  it("regression — persisted label items round-trip (the core bug)", () => {
    const stored = [
      { amount: 1800, label: "You" },
      { amount: 1800, label: "Roommate 1" },
    ] as unknown as Json;
    const result = splits(stored);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "You", amount: 1800 });
    expect(result[1]).toEqual({ name: "Roommate 1", amount: 1800 });
  });

  it("back-compat — items already keyed name still work", () => {
    const stored = [{ name: "Roommate 1", amount: 1500 }] as unknown as Json;
    const result = splits(stored);
    expect(result).toEqual([{ name: "Roommate 1", amount: 1500 }]);
  });

  it("name wins over label when both are present", () => {
    const stored = [
      { name: "You", label: "Roommate 0", amount: 900 },
    ] as unknown as Json;
    const result = splits(stored);
    expect(result).toEqual([{ name: "You", amount: 900 }]);
  });

  it("malformed items are dropped", () => {
    const stored = [
      { label: "You" },
      { amount: 1800 },
      null,
      "x",
      [],
    ] as unknown as Json;
    expect(splits(stored)).toEqual([]);

    expect(splits({} as unknown as Json)).toEqual([]);
    expect(splits(null as unknown as Json)).toEqual([]);
  });
});
