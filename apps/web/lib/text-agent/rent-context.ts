// Rent context for one listing. The default source is internal comps: the
// median advertised rent for the same bedroom count among nearby active
// listings, from our own apartment_listings table — no external calls. When
// that sample is too thin, or the user explicitly questions the price,
// resolveListingRentContext upgrades to a RentCast AVM estimate (third-party
// authority), gated hard because the free tier is 50 calls/month. Leaf module:
// relative/type-only imports so vitest can load it without the @/ alias.
import {
  fetchRentCastRentEstimate,
  isRentCastConfigured,
} from "../apartments/rentcast";
import type { RentCastComp, RentCastRentEstimate } from "../apartments/rentcast";
import type { Json } from "../supabase/types";
import type { SupabaseServiceClient } from "./store-types";

export type InternalListingRentContext = {
  deltaPct: number | null;
  medianRent: number;
  sampleSize: number;
  scope: "nearby" | "neighborhood";
  source: "internal";
};

export type RentCastListingRentContext = {
  compCount: number;
  comps: RentCastComp[];
  deltaPct: number | null;
  rentEstimate: number;
  rentRangeHigh: number | null;
  rentRangeLow: number | null;
  source: "rentcast";
};

export type ListingRentContext =
  | InternalListingRentContext
  | RentCastListingRentContext;

export type RentContextListing = {
  bedrooms: number | null;
  effective_monthly_rent: number | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
  monthly_rent: number | null;
  neighborhood: string | null;
};

export type RentContextSubjectListing = RentContextListing & {
  address_line?: string | null;
  bathrooms?: number | null;
  city?: string | null;
  postal_code?: string | null;
  square_feet?: number | null;
  state?: string | null;
};

// ~0.75mi box around the listing. ~69 mi per degree of latitude, ~54.6 mi per
// degree of longitude at SF's latitude (same constants as the near-place
// search in listing-recommendations.ts).
const NEARBY_RADIUS_MILES = 0.75;
const NEARBY_DELTA_LAT = NEARBY_RADIUS_MILES / 69;
const NEARBY_DELTA_LNG = NEARBY_RADIUS_MILES / 54.6;
// Below this many comps the median is noise, not signal.
const MIN_SAMPLE_SIZE = 5;
// Only comps the scrapers have confirmed recently still count as the market.
const RECENT_SEEN_DAYS = 14;
const SAMPLE_FETCH_LIMIT = 400;
// Within this band of the median we call it "right at market".
const AT_MARKET_BAND_PCT = 3;
// RentCast budget discipline (free tier = 50 calls/month, every call is
// precious). A fetch happens only when the internal sample is too thin or the
// caller passes an explicit priceCheck intent, and only after a persistent
// cache miss: responses live on the listing row in
// provider_detail_payload.rentcast with a fetched_at stamp. Hits are good for
// 14 days. A miss (RentCast had nothing, or the call failed) is cached for 1
// day on the first miss, then backs off exponentially up to 14 days — so one
// transient failure doesn't mute the listing for two weeks, but a listing
// RentCast can never price isn't refetched daily forever (which would burn the
// budget on a never-priceable address).
//
// The budget itself is an ATOMIC per-call counter (the shared
// hit_text_agent_rate_limit RPC), not a count of listing rows with a fetched_at
// stamp this month. The old row-count undercounted: refetching the same listing
// overwrote its single cache entry in place, so N daily calls against one
// listing still counted as 1 and could blow past the 50-call cap. A per-user/day
// quota sits in front of the global monthly budget so a single user can't drain
// the shared allowance for everyone.
const RENTCAST_HIT_TTL_DAYS = 14;
const RENTCAST_MISS_TTL_DAYS = 1;
const RENTCAST_MISS_TTL_CAP_DAYS = 14;
const RENTCAST_MONTHLY_CALL_BUDGET = 40;
const RENTCAST_USER_DAILY_CALL_BUDGET = 5;

export async function computeListingRentContext(
  supabase: SupabaseServiceClient,
  listing: RentContextListing,
): Promise<InternalListingRentContext | null> {
  if (listing.bedrooms == null) {
    return null;
  }

  const subjectRent = listing.effective_monthly_rent ?? listing.monthly_rent;
  const lastSeenCutoff = new Date(
    Date.now() - RECENT_SEEN_DAYS * 86_400_000,
  ).toISOString();

  if (listing.latitude != null && listing.longitude != null) {
    const nearby = await supabase
      .from("apartment_listings")
      .select("effective_monthly_rent,monthly_rent")
      .eq("listing_status", "active")
      .eq("bedrooms", listing.bedrooms)
      .neq("id", listing.id)
      .gte("last_seen_at", lastSeenCutoff)
      .gte("latitude", listing.latitude - NEARBY_DELTA_LAT)
      .lte("latitude", listing.latitude + NEARBY_DELTA_LAT)
      .gte("longitude", listing.longitude - NEARBY_DELTA_LNG)
      .lte("longitude", listing.longitude + NEARBY_DELTA_LNG)
      .limit(SAMPLE_FETCH_LIMIT);
    if (nearby.error) throw nearby.error;

    const rents = readCompRents(nearby.data ?? []);
    if (rents.length >= MIN_SAMPLE_SIZE) {
      return buildRentContext("nearby", rents, subjectRent);
    }
  }

  if (listing.neighborhood?.trim()) {
    const neighborhood = await supabase
      .from("apartment_listings")
      .select("effective_monthly_rent,monthly_rent")
      .eq("listing_status", "active")
      .eq("bedrooms", listing.bedrooms)
      .neq("id", listing.id)
      .gte("last_seen_at", lastSeenCutoff)
      .ilike("neighborhood", listing.neighborhood.trim())
      .limit(SAMPLE_FETCH_LIMIT);
    if (neighborhood.error) throw neighborhood.error;

    const rents = readCompRents(neighborhood.data ?? []);
    if (rents.length >= MIN_SAMPLE_SIZE) {
      return buildRentContext("neighborhood", rents, subjectRent);
    }
  }

  return null;
}

// Internal comps first; RentCast only when the internal sample came back null
// (none, or below the minimum sample size) or the user explicitly questioned
// the price. Cache and budget failures degrade to the internal answer — this
// never throws into the tool.
export async function resolveListingRentContext(
  supabase: SupabaseServiceClient,
  listing: RentContextSubjectListing,
  {
    priceCheck = false,
    userId = null,
  }: { priceCheck?: boolean; userId?: string | null } = {},
): Promise<ListingRentContext | null> {
  const internal = await computeListingRentContext(supabase, listing);
  if (internal && !priceCheck) {
    return internal;
  }
  if (!isRentCastConfigured()) {
    return internal;
  }

  try {
    const estimate = await loadRentCastEstimate(supabase, listing, userId);
    if (!estimate) {
      return internal;
    }
    return buildRentCastContext(
      estimate,
      listing.effective_monthly_rent ?? listing.monthly_rent,
    );
  } catch (error) {
    console.error("[rent-context] RentCast estimate lookup failed", error);
    return internal;
  }
}

async function loadRentCastEstimate(
  supabase: SupabaseServiceClient,
  listing: RentContextSubjectListing,
  userId: string | null,
): Promise<RentCastRentEstimate | null> {
  const payloadResult = await supabase
    .from("apartment_listings")
    .select("provider_detail_payload")
    .eq("id", listing.id)
    .maybeSingle();
  if (payloadResult.error) throw payloadResult.error;

  const payload = readPayloadRecord(
    payloadResult.data?.provider_detail_payload,
  );
  const cached = readRentCastCacheEntry(payload.rentcast);
  if (cached && isFreshRentCastCacheEntry(cached)) {
    return cached.estimate;
  }

  // Reserve a paid call against the per-user/day and global monthly budgets
  // before spending it. Both are atomic per-call counters, so refetching one
  // listing repeatedly can no longer slip under a row-count guard.
  if (!(await reserveRentCastCall(supabase, userId))) {
    return null;
  }

  let estimate: RentCastRentEstimate | null;
  try {
    estimate = await fetchRentCastRentEstimate({
      address: buildRentCastSubjectAddress(listing),
      bathrooms: listing.bathrooms ?? null,
      bedrooms: listing.bedrooms,
      latitude: listing.latitude,
      longitude: listing.longitude,
      squareFootage: listing.square_feet ?? null,
    });
  } catch (error) {
    // Quota/outage (RentCastUnavailableError): the reserved call is spent,
    // but a transient failure must NOT be cached as "no estimate" — the miss
    // backoff would suppress retries for a listing that may price fine.
    console.warn("[rent-context] RentCast unavailable; not caching a miss", {
      error: error instanceof Error ? error.message : String(error),
      listingId: listing.id,
    });
    return cached?.estimate ?? null;
  }

  // On a miss, escalate the backoff counter so a never-priceable listing isn't
  // refetched every day. A hit clears it (the entry carries no miss_count).
  const rentcastEntry = estimate
    ? { estimate, fetched_at: new Date().toISOString() }
    : {
        estimate: null,
        fetched_at: new Date().toISOString(),
        miss_count: (cached?.missCount ?? 0) + 1,
      };
  await cacheRentCastEntry(supabase, listing.id, rentcastEntry as unknown as Json, payload);

  return estimate;
}

// Persist the rentcast cache entry without clobbering sibling keys of
// provider_detail_payload. Prefers the atomic single-key merge RPC; falls back
// to a whole-column read-modify-write only where that RPC isn't deployed yet, so
// the (already-spent) estimate is still cached either way.
async function cacheRentCastEntry(
  supabase: SupabaseServiceClient,
  listingId: string,
  rentcastEntry: Json,
  payload: { [key: string]: Json | undefined },
) {
  const merge = await supabase.rpc("merge_listing_provider_detail_payload", {
    p_key: "rentcast",
    p_listing_id: listingId,
    p_value: rentcastEntry,
  });
  if (!merge.error) {
    return;
  }

  console.error(
    "[rent-context] atomic payload merge unavailable; falling back to read-modify-write",
    merge.error,
  );
  const nextPayload = { ...payload, rentcast: rentcastEntry } as unknown as Json;
  const update = await supabase
    .from("apartment_listings")
    .update({ provider_detail_payload: nextPayload })
    .eq("id", listingId);
  if (update.error) {
    // The call is already spent — keep the estimate even if caching failed.
    console.error("[rent-context] failed to cache RentCast response", update.error);
  }
}

// Atomically reserve one RentCast call: the per-user/day quota first (so one
// user can't drain the shared allowance), then the global monthly budget. Both
// run through the shared hit_text_agent_rate_limit RPC, which increments and
// limit-checks in a single statement.
async function reserveRentCastCall(
  supabase: SupabaseServiceClient,
  userId: string | null,
): Promise<boolean> {
  const trimmedUserId = userId?.trim();
  if (trimmedUserId) {
    const userAllowed = await hitRentCastBudget(supabase, {
      bucketKey: `user:${trimmedUserId}`,
      bucketType: "rentcast_user_day",
      limit: RENTCAST_USER_DAILY_CALL_BUDGET,
      windowStart: utcWindowStartIso("day"),
    });
    if (!userAllowed) {
      return false;
    }
  }

  return hitRentCastBudget(supabase, {
    bucketKey: "global",
    bucketType: "rentcast_calls_month",
    limit: RENTCAST_MONTHLY_CALL_BUDGET,
    windowStart: utcWindowStartIso("month"),
  });
}

async function hitRentCastBudget(
  supabase: SupabaseServiceClient,
  {
    bucketKey,
    bucketType,
    limit,
    windowStart,
  }: {
    bucketKey: string;
    bucketType: string;
    limit: number;
    windowStart: string;
  },
): Promise<boolean> {
  const result = await supabase.rpc("hit_text_agent_rate_limit", {
    p_bucket_key: bucketKey,
    p_bucket_type: bucketType,
    p_limit: limit,
    p_window_start: windowStart,
  });
  // Fail closed: a budget counter we can't read must not authorize a paid call.
  if (result.error) {
    return false;
  }
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return row?.allowed === true;
}

function utcWindowStartIso(window: "day" | "month") {
  const now = new Date();
  return new Date(
    window === "month"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function buildRentCastSubjectAddress(listing: RentContextSubjectListing) {
  const street = listing.address_line?.trim();
  if (!street) return null;
  const city = listing.city?.trim() || "San Francisco";
  const state = listing.state?.trim() || "CA";
  const zip = listing.postal_code?.trim();
  return `${street}, ${city}, ${state}${zip ? `, ${zip}` : ""}`;
}

function readPayloadRecord(value: Json | null | undefined): {
  [key: string]: Json | undefined;
} {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function readRentCastCacheEntry(value: Json | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const fetchedAtMs = Date.parse(
    typeof value.fetched_at === "string" ? value.fetched_at : "",
  );
  if (!Number.isFinite(fetchedAtMs)) {
    return null;
  }
  return {
    estimate: readCachedRentCastEstimate(value.estimate),
    fetchedAtMs,
    missCount: readPositiveNumber(value.miss_count) ?? 0,
  };
}

function readCachedRentCastEstimate(
  value: Json | undefined,
): RentCastRentEstimate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rentEstimate = readPositiveNumber(value.rentEstimate);
  if (rentEstimate == null) {
    return null;
  }
  return {
    compCount: readPositiveNumber(value.compCount) ?? 0,
    comps: readCachedRentCastComps(value.comps),
    rentEstimate,
    rentRangeHigh: readPositiveNumber(value.rentRangeHigh),
    rentRangeLow: readPositiveNumber(value.rentRangeLow),
  };
}

function readCachedRentCastComps(value: Json | undefined): RentCastComp[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const address =
      typeof entry.address === "string" ? entry.address.trim() : "";
    const rent = readPositiveNumber(entry.rent);
    if (!address || rent == null) {
      return [];
    }
    return [
      { address, distanceMiles: readPositiveNumber(entry.distanceMiles), rent },
    ];
  });
}

function isFreshRentCastCacheEntry(cached: {
  estimate: RentCastRentEstimate | null;
  fetchedAtMs: number;
  missCount: number;
}) {
  return Date.now() - cached.fetchedAtMs < rentCastCacheTtlDays(cached) * 86_400_000;
}

// Hits live the full TTL. Misses back off exponentially from 1 day so a listing
// RentCast can never price stops being refetched daily: miss #1 → 1d, #2 → 2d,
// #3 → 4d, … capped at 14 days.
function rentCastCacheTtlDays(cached: {
  estimate: RentCastRentEstimate | null;
  missCount: number;
}) {
  if (cached.estimate) {
    return RENTCAST_HIT_TTL_DAYS;
  }
  const missCount = Math.max(1, cached.missCount);
  const backoffDays = RENTCAST_MISS_TTL_DAYS * 2 ** (missCount - 1);
  return Math.min(backoffDays, RENTCAST_MISS_TTL_CAP_DAYS);
}

function buildRentCastContext(
  estimate: RentCastRentEstimate,
  subjectRent: number | null,
): RentCastListingRentContext {
  const deltaPct =
    subjectRent != null && estimate.rentEstimate > 0
      ? Math.round(
          ((subjectRent - estimate.rentEstimate) / estimate.rentEstimate) * 100,
        )
      : null;

  return { ...estimate, deltaPct, source: "rentcast" };
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// Phrases a rent context for the agent. Internal comps: "about 8% above the
// typical 2bd nearby" / "right at market for a 2bd nearby". RentCast keeps the
// third-party attribution in the phrase itself: "listed about 8% under
// RentCast's going rate of around $4,100/mo".
export function describeListingRentContext(
  context: ListingRentContext,
  bedrooms: number | null,
) {
  const bedroomLabel =
    bedrooms == null ? "unit" : bedrooms === 0 ? "studio" : `${bedrooms}bd`;

  if (context.source === "rentcast") {
    const estimateLabel = `$${context.rentEstimate.toLocaleString()}/mo`;
    if (context.deltaPct == null) {
      return `RentCast puts the going rate for a ${bedroomLabel} like this around ${estimateLabel}`;
    }
    if (Math.abs(context.deltaPct) <= AT_MARKET_BAND_PCT) {
      return `right at RentCast's going rate of about ${estimateLabel}`;
    }
    const direction = context.deltaPct > 0 ? "over" : "under";
    return `listed about ${Math.abs(context.deltaPct)}% ${direction} RentCast's going rate of around ${estimateLabel}`;
  }

  const scopeLabel =
    context.scope === "nearby" ? "nearby" : "in the neighborhood";

  if (context.deltaPct == null) {
    return `the typical ${bedroomLabel} ${scopeLabel} runs about $${context.medianRent.toLocaleString()}/mo`;
  }
  if (Math.abs(context.deltaPct) <= AT_MARKET_BAND_PCT) {
    return `right at market for a ${bedroomLabel} ${scopeLabel}`;
  }
  const direction = context.deltaPct > 0 ? "above" : "below";
  return `about ${Math.abs(context.deltaPct)}% ${direction} the typical ${bedroomLabel} ${scopeLabel}`;
}

function readCompRents(
  rows: Array<{
    effective_monthly_rent: number | null;
    monthly_rent: number | null;
  }>,
) {
  return rows.flatMap((row) => {
    const rent = row.effective_monthly_rent ?? row.monthly_rent;
    return typeof rent === "number" && Number.isFinite(rent) && rent > 0
      ? [rent]
      : [];
  });
}

function buildRentContext(
  scope: "nearby" | "neighborhood",
  rents: number[],
  subjectRent: number | null,
): InternalListingRentContext {
  const medianRent = Math.round(median(rents));
  const deltaPct =
    subjectRent != null && medianRent > 0
      ? Math.round(((subjectRent - medianRent) / medianRent) * 100)
      : null;

  return {
    deltaPct,
    medianRent,
    sampleSize: rents.length,
    scope,
    source: "internal",
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
