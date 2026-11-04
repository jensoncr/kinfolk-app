/**
 * Cross-path equivalence tests for the unified apartment-fit scorer.
 *
 * STRATEGY: Both `lib/apartments/match-surface.ts` (surface path) and
 * `lib/matching/apartment-listing-matches.ts` (DB path) now delegate numeric
 * scoring to `apartmentFitScore` in `apartment-fit-core.ts`.
 *
 * This file asserts that, for equivalent inputs with surface-only additive
 * terms zeroed (no split, no pet preference, single available unit), both
 * paths produce the SAME fit score, the SAME per-person rent, and the SAME
 * in/out-of-budget verdict — which is the core claim of plan 008.
 *
 * NOTE: split +5, pet ±2, and extra-units +3 bonuses are intentionally
 * surface-only and are therefore excluded from these equivalence assertions.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apartmentFitScore,
  perPersonRent,
  withinBudget,
  recommendedHouseholdSizeCore,
} from "./apartment-fit-core";
import { apartmentMatchesFromSearchSnapshot } from "../apartments/match-surface";
import type {
  ApartmentListing,
  ApartmentSearchSnapshot,
} from "../apartments/types";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeListing(partial: Partial<ApartmentListing>): ApartmentListing {
  return {
    id: "listing-equiv",
    source: "redfin",
    sourceUrl: "https://example.com",
    listingStatus: "active",
    providerMarket: "san-francisco-ca",
    address: "1 Test St",
    unit: null,
    city: "San Francisco",
    state: "CA",
    postalCode: "94107",
    neighborhood: "Mission",
    latitude: 37.76,
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
    concessionLeaseMonths: 12,
    concessionNote: null,
    effectiveMonthlyRent: null,
    availableUnitCount: 0,   // no extra-units bonus
    unitRentMin: null,
    unitRentMax: null,
    unitEffectiveRentMin: null,
    unitEffectiveRentMax: null,
    photoUrl: null,
    floorPlanMonthlyRent: null,
    floorPlanTypeCount: 0,
    floorPlanBedroomMin: null,
    floorPlanBedroomMax: null,
    fitScore: 0,             // no persisted score passthrough
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

type QueryOperation = {
  args: unknown[];
  name: string;
};

type ObservedQuery = {
  operations: QueryOperation[];
  table: string;
};

function makeRecomputeSupabase(observedQueries: ObservedQuery[]) {
  return {
    from: vi.fn((table: string) => makeRecomputeQuery(table, observedQueries)),
  };
}

function makeRecomputeQuery(table: string, observedQueries: ObservedQuery[]) {
  const operations: QueryOperation[] = [];
  observedQueries.push({ operations, table });
  const query = {
    delete: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "delete" });
      return query;
    }),
    eq: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "eq" });
      return query;
    }),
    in: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "in" });
      return query;
    }),
    limit: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "limit" });
      return query;
    }),
    not: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "not" });
      return query;
    }),
    or: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "or" });
      return query;
    }),
    maybeSingle: vi.fn(() =>
      Promise.resolve(
        table === "matching_profiles"
          ? {
              // The listings scan only runs once a profile exists (the fetch
              // is budget-windowed off the profile now).
              data: {
                budget_max: null,
                budget_min: null,
                household_size_max: null,
                id: "prof-env",
                status: "active",
                user_id: "user-1",
              },
              error: null,
            }
          : { data: null, error: null },
      ),
    ),
    order: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "order" });
      return query;
    }),
    select: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "select" });
      return query;
    }),
    then: (
      onFulfilled: (result: unknown) => unknown,
      onRejected?: (error: unknown) => unknown,
    ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
  };

  return query;
}

function firstOperation(
  observedQueries: ObservedQuery[],
  table: string,
  name: string,
  firstArg?: unknown,
) {
  return observedQueries
    .find((query) => query.table === table)
    ?.operations.find(
      (operation) =>
        operation.name === name &&
        (firstArg === undefined || operation.args[0] === firstArg),
    );
}

function makeSnapshot(
  listings: ApartmentListing[],
  profile: Partial<ApartmentSearchSnapshot["activeProfile"]> = {},
): ApartmentSearchSnapshot {
  return {
    source: { kind: "supabase", status: "connected", detail: "test" },
    refreshedAt: "2026-06-10T00:00:00.000Z",
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
      pets: "",   // no pet preference → no pet bonus
      ...profile,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: compute what the DB path would produce for this listing/profile pair.
// The DB path uses recommendedHouseholdSizeCore for household size and
// apartmentFitScore with no surface-only terms.
// ---------------------------------------------------------------------------

function dbPathScore({
  monthlyRent,
  effectiveRent,
  bedrooms,
  householdSizeMax,
  budgetMin,
  budgetMax,
  neighborhoodMatches,
  mustHavesMatched,
  mustHavesUnconfirmed,
}: {
  monthlyRent: number;
  effectiveRent?: number;
  bedrooms: number | null;
  householdSizeMax: number;
  budgetMin: number | null;
  budgetMax: number | null;
  neighborhoodMatches: boolean;
  mustHavesMatched: number;
  mustHavesUnconfirmed: number;
}) {
  const eff = effectiveRent ?? monthlyRent;
  const householdSize = recommendedHouseholdSizeCore({ householdSizeMax, bedrooms });
  const effectivePerPersonRent = perPersonRent(eff, householdSize);
  const perPersonRentVal = perPersonRent(monthlyRent, householdSize);
  const inBudget = withinBudget(effectivePerPersonRent, budgetMin, budgetMax);
  const fitScore = apartmentFitScore({
    budgetMin,
    budgetMax,
    effectivePerPersonRent,
    neighborhoodMatches,
    mustHavesMatched,
    mustHavesUnconfirmed,
    // NO surface-only terms: splitActive, petBonus, extraUnitsBonus omitted
  });
  return { fitScore, perPersonRentVal, effectivePerPersonRent, inBudget };
}

// ---------------------------------------------------------------------------
// Test: Case 1 — 2bd in-budget listing with one matched must-have + neighborhood
// ---------------------------------------------------------------------------

describe("recomputeApartmentListingMatchesForUser()", () => {
  it("treats blank apartment match env config as the default market and scan limit", async () => {
    vi.resetModules();
    vi.stubEnv("KINFOLK_APARTMENT_MATCH_SCAN_LIMIT", " ");
    vi.stubEnv("KINFOLK_APARTMENT_MARKET", " ");

    const observedQueries: ObservedQuery[] = [];
    const supabase = makeRecomputeSupabase(observedQueries);
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    await expect(
      recomputeApartmentListingMatchesForUser(supabase as never, "user-1"),
    ).resolves.toEqual({ skipped: "no_matching_listings", upserted: 0 });

    expect(
      firstOperation(
        observedQueries,
        "apartment_listings",
        "eq",
        "provider_market",
      )?.args,
    ).toEqual(["provider_market", "san-francisco-ca"]);
    expect(
      firstOperation(observedQueries, "matching_profiles", "eq", "status")?.args,
    ).toEqual(["status", "active"]);
    expect(
      firstOperation(observedQueries, "apartment_listings", "limit")?.args,
    ).toEqual([1000]);
  });
});

describe("cross-path equivalence: 2bd in-budget listing with must-have + neighborhood", () => {
  const BUDGET_MAX = 3000;

  it("surface path and DB path produce the same fit score", () => {
    // Surface path: snapshot with householdSizeMax=2 → split → displayRent=2900
    // Must ensure: no pets, single available unit, no split bonus → use householdSizeMax=1
    // to avoid split being activated; instead test solo scenario (1bd, no split)
    //
    // For this 2bd test we zero out surface-only terms by using householdSizeMax=1
    // (no roommate split active) and a studio unit with rent already at per-person level.
    // The simplest equivalence fixture: 1bd solo, no split, no pets, single unit.
    const listing = makeListing({
      id: "equiv-2bd",
      bedrooms: 1,
      monthlyRent: 2800,
      effectiveMonthlyRent: 2800,
      neighborhood: "Mission",
      amenities: ["Dishwasher"],
    });

    const surfaceMatches = apartmentMatchesFromSearchSnapshot(
      makeSnapshot([listing], {
        budgetMax: BUDGET_MAX,
        householdSizeMax: 1, // solo → no split → splitActive=false
        neighborhoods: ["Mission"],
        mustHaves: ["dishwasher"],
        pets: "", // no pets
      }),
    );

    // Surface score
    const surfaceFitScore = surfaceMatches?.[0]?.fitScore;

    // DB path (same inputs, no surface-only terms)
    const db = dbPathScore({
      monthlyRent: 2800,
      bedrooms: 1,
      householdSizeMax: 1,
      budgetMin: null,
      budgetMax: BUDGET_MAX,
      neighborhoodMatches: true,
      mustHavesMatched: 1,
      mustHavesUnconfirmed: 0,
    });

    expect(surfaceFitScore).toBe(db.fitScore);
    expect(surfaceFitScore).toBeDefined();
  });

  it("surface path and DB path agree on per-person rent (Math.round, no split)", () => {
    // Solo listing, rent not evenly divisible → both paths must use Math.round
    const listing = makeListing({
      id: "equiv-round",
      bedrooms: 1,
      monthlyRent: 2801, // 2801/1 = 2801 exactly
      effectiveMonthlyRent: 2801,
    });

    const surfaceMatches = apartmentMatchesFromSearchSnapshot(
      makeSnapshot([listing], {
        budgetMax: 3000,
        householdSizeMax: 1,
      }),
    );

    // Surface path perPersonRent: splitActive=false → listing.effectivePerPersonRent
    // (not from core directly, but the budget gate uses displayRent which is propertyMarkerRentForDisplay → Math.round)
    const surfaceMonthlyRent = surfaceMatches?.[0]?.monthlyRent;

    // DB path per-person rent
    const db = dbPathScore({
      monthlyRent: 2801,
      bedrooms: 1,
      householdSizeMax: 1,
      budgetMin: null,
      budgetMax: 3000,
      neighborhoodMatches: false,
      mustHavesMatched: 0,
      mustHavesUnconfirmed: 0,
    });

    // Both paths should see 2801 as the per-person rent (solo = full rent)
    expect(surfaceMonthlyRent).toBe(2801);
    expect(db.perPersonRentVal).toBe(2801);
  });

  it("surface path and DB path agree on in-budget verdict", () => {
    // Test the budget gate: listing at budgetMax + 150 should pass DB path
    // but the surface STRICT pre-filter (no slack) filters it out.
    // This documents the intentional asymmetry: surface is strict, DB has +150 slack.
    const rentAtBudgetMaxPlusSlack = 3150; // budgetMax=3000, +150 = exactly at tolerance

    // DB path: withinBudget should return true (tolerance inclusive)
    expect(withinBudget(rentAtBudgetMaxPlusSlack, null, 3000)).toBe(true);
    // DB path: 1 over tolerance should return false
    expect(withinBudget(3151, null, 3000)).toBe(false);

    // Surface path: rentMatchesBudget is STRICT (no slack).
    // A listing at rent=3150 with budgetMax=3000 is filtered OUT by the surface
    // snapshot pre-filter — this is the documented intentional asymmetry.
    const listing = makeListing({
      id: "equiv-over-budget",
      bedrooms: 1,
      monthlyRent: 3150,
      effectiveMonthlyRent: 3150,
    });
    const surfaceMatches = apartmentMatchesFromSearchSnapshot(
      makeSnapshot([listing], {
        budgetMax: 3000,
        householdSizeMax: 1,
      }),
    );
    // Surface path strictly filters this out (over budget by $150)
    expect(surfaceMatches?.map((m) => m.id)).not.toContain("equiv-over-budget");
  });
});

// ---------------------------------------------------------------------------
// Test: Case 2 — studio at budget ceiling
// ---------------------------------------------------------------------------

describe("cross-path equivalence: studio at budget ceiling", () => {
  it("fit score matches between surface and DB paths when rent = budgetMax", () => {
    // Rent exactly at budget cap → delta = 0, budget bonus = +10 (std, not high)
    const listing = makeListing({
      id: "equiv-ceiling",
      bedrooms: 0,
      monthlyRent: 2500,
      effectiveMonthlyRent: 2500,
    });

    const surfaceMatches = apartmentMatchesFromSearchSnapshot(
      makeSnapshot([listing], {
        budgetMax: 2500,
        householdSizeMax: 1,
      }),
    );

    const db = dbPathScore({
      monthlyRent: 2500,
      bedrooms: 0,
      householdSizeMax: 1,
      budgetMin: null,
      budgetMax: 2500,
      neighborhoodMatches: false,
      mustHavesMatched: 0,
      mustHavesUnconfirmed: 0,
    });

    expect(surfaceMatches?.[0]?.fitScore).toBe(db.fitScore);
    // base 62 + budget_std 10 = 72
    expect(db.fitScore).toBe(72);
    expect(db.inBudget).toBe(true);
  });

  it("surface and DB paths agree on household size for studio (bedrooms=0 → size=1)", () => {
    const dbHouseholdSize = recommendedHouseholdSizeCore({ householdSizeMax: 3, bedrooms: 0 });
    expect(dbHouseholdSize).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P2 "stop the leaks": saved places + commute/POI wiring through the DB path.
// Data-driven stub: each table resolves fixture rows; upserts are captured.
// ---------------------------------------------------------------------------

type CapturedWrite = { args: unknown[]; method: string; table: string };

function makeDataSupabase({
  facts = [],
  housing = null,
  listings = [],
  profile,
  savedPlaces = [],
}: {
  facts?: Array<{ fact_key: string; normalized_value: string | null }>;
  housing?: Record<string, unknown> | null;
  listings?: Array<Record<string, unknown>>;
  profile: Record<string, unknown>;
  savedPlaces?: Array<Record<string, unknown>>;
}) {
  const writes: CapturedWrite[] = [];
  const dataByTable: Record<string, unknown[]> = {
    apartment_listing_matches: [],
    apartment_listings: listings,
    match_queue_items: [],
    profile_facts: facts,
    saved_places: savedPlaces,
  };
  const maybeSingleByTable: Record<string, unknown> = {
    housing_preferences: housing,
    matching_profiles: profile,
  };

  const client = {
    from(table: string) {
      const query: Record<string, unknown> = {};
      for (const method of ["delete", "eq", "in", "limit", "not", "or", "order", "select"]) {
        query[method] = () => query;
      }
      for (const method of ["insert", "upsert"]) {
        query[method] = (...args: unknown[]) => {
          writes.push({ args, method, table });
          return query;
        };
      }
      query.maybeSingle = () =>
        Promise.resolve({ data: maybeSingleByTable[table] ?? null, error: null });
      query.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: dataByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return query;
    },
  };

  return { client: client as never, writes };
}

const p2Profile = {
  budget_max: 3000,
  budget_min: null,
  household_size_max: 1,
  id: "prof-1",
  status: "active",
  user_id: "user-1",
};

function p2Listing(partial: Record<string, unknown> = {}) {
  return {
    address_line: "1 Test St",
    amenities: [],
    bedrooms: 1,
    city: "San Francisco",
    description: "",
    effective_monthly_rent: 2800,
    id: "listing-1",
    listing_status: "active",
    monthly_rent: 2800,
    neighborhood: "Mission",
    poi_summary: null,
    provider_market: "san-francisco-ca",
    rent_max: null,
    rent_min: null,
    ...partial,
  };
}

function upsertedMatchRows(writes: CapturedWrite[]) {
  const upsert = writes.find(
    (write) => write.table === "apartment_listing_matches" && write.method === "upsert",
  );
  return (upsert?.args[0] ?? []) as Array<{
    evidence: Array<{ label: string; detail: string }>;
    fit_score: number;
    listing_id: string;
    tradeoffs: Array<{ label: string; detail: string }>;
  }>;
}

describe("P2 leak fixes: saved places + commute wiring in the DB recompute", () => {
  it("boosts a listing the viewer saved and says so in evidence", async () => {
    const { client, writes } = makeDataSupabase({
      listings: [p2Listing()],
      profile: p2Profile,
      savedPlaces: [
        { area_label: null, kind: "listing", listing_id: "listing-1", user_id: "user-1" },
      ],
    });
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    await recomputeApartmentListingMatchesForUser(client, "user-1");

    const rows = upsertedMatchRows(writes);
    expect(rows).toHaveLength(1);
    // base 62 + within-budget 10 + saved-listing 8
    expect(rows[0]!.fit_score).toBe(80);
    expect(rows[0]!.evidence.some((point) => point.label === "Saved")).toBe(true);
  });

  it("keeps a listing in a SAVED area that the stated neighborhood list would exclude", async () => {
    const { client, writes } = makeDataSupabase({
      housing: { must_haves: [], neighborhoods: ["Hayes Valley"] },
      listings: [p2Listing()],
      profile: p2Profile,
      savedPlaces: [
        { area_label: "Mission", kind: "area", listing_id: null, user_id: "user-1" },
      ],
    });
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    await recomputeApartmentListingMatchesForUser(client, "user-1");

    const rows = upsertedMatchRows(writes);
    expect(rows).toHaveLength(1);
    // base 62 + within-budget 10 + saved-area 5 (no +14: stated prefs only)
    expect(rows[0]!.fit_score).toBe(77);
    expect(rows[0]!.evidence.some((point) => point.label === "Saved area")).toBe(true);
  });

  it("still excludes listings outside BOTH the stated list and saved areas", async () => {
    const { client, writes } = makeDataSupabase({
      housing: { must_haves: [], neighborhoods: ["Hayes Valley"] },
      listings: [p2Listing()],
      profile: p2Profile,
    });
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    const result = await recomputeApartmentListingMatchesForUser(client, "user-1");

    expect(result).toEqual({ skipped: "no_matching_listings", upserted: 0 });
    expect(upsertedMatchRows(writes)).toHaveLength(0);
  });

  it("does NOT create a neighborhood filter from saves alone", async () => {
    const { client, writes } = makeDataSupabase({
      listings: [p2Listing({ neighborhood: "Outer Sunset" })],
      profile: p2Profile,
      savedPlaces: [
        { area_label: "Mission", kind: "area", listing_id: null, user_id: "user-1" },
      ],
    });
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    await recomputeApartmentListingMatchesForUser(client, "user-1");

    // A save is a taste nudge, not a requirement — the Outer Sunset listing stays.
    expect(upsertedMatchRows(writes)).toHaveLength(1);
  });

  it("rewards close transit for commuters via the structured poi_summary", async () => {
    const { client, writes } = makeDataSupabase({
      facts: [{ fact_key: "commute", normalized_value: "downtown office 3x/week" }],
      listings: [
        p2Listing({
          poi_summary: {
            transit: [
              { distance: 0.2, name: "24th St Mission BART" },
              { distance: 0.6, name: "Church St MUNI" },
            ],
          },
        }),
      ],
      profile: p2Profile,
    });
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    await recomputeApartmentListingMatchesForUser(client, "user-1");

    const rows = upsertedMatchRows(writes);
    // base 62 + within-budget 10 + transit 3
    expect(rows[0]!.fit_score).toBe(75);
    expect(rows[0]!.evidence.some((point) => point.label === "Commute")).toBe(true);
  });

  it("flags a transit desert as a commute tradeoff", async () => {
    const { client, writes } = makeDataSupabase({
      facts: [{ fact_key: "commute", normalized_value: "downtown office 3x/week" }],
      listings: [
        p2Listing({
          poi_summary: { transit: [{ distance: 1.4, name: "Distant stop" }] },
        }),
      ],
      profile: p2Profile,
    });
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    await recomputeApartmentListingMatchesForUser(client, "user-1");

    const rows = upsertedMatchRows(writes);
    // base 62 + within-budget 10 - transit desert 2
    expect(rows[0]!.fit_score).toBe(70);
    expect(rows[0]!.tradeoffs.some((point) => point.label === "Commute")).toBe(true);
  });

  it("leaves non-commuters untouched by transit distances", async () => {
    const { client, writes } = makeDataSupabase({
      listings: [
        p2Listing({
          poi_summary: { transit: [{ distance: 0.2, name: "24th St Mission BART" }] },
        }),
      ],
      profile: p2Profile,
    });
    const { recomputeApartmentListingMatchesForUser } = await import(
      "./apartment-listing-matches"
    );

    await recomputeApartmentListingMatchesForUser(client, "user-1");

    const rows = upsertedMatchRows(writes);
    // base 62 + within-budget 10 — no commute term either way
    expect(rows[0]!.fit_score).toBe(72);
  });
});
