import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { listingMatchesFeatureMustHave } from "@/lib/apartments/listing-query-features";
import { matchesRequestedNeighborhood } from "@/lib/apartments/listing-request-context";
import { formatCurrency } from "@/lib/shared/currency";
import { clampInteger } from "@/lib/shared/numbers";
import {
  confirmedMustHavesEvidence,
  neighborhoodInterestEvidence,
  unconfirmedMustHavesTradeoff,
} from "@/lib/apartments/fit-evidence";
import { VISIBLE_APARTMENT_MATCH_STATUSES } from "@/lib/matching/match-status";
import {
  apartmentFitScore,
  recommendedHouseholdSizeCore,
  perPersonRent as corePerPersonRent,
  withinBudget,
} from "@/lib/matching/apartment-fit-core";
import { savedListingFitBonus } from "@/lib/matching/saved-place-taste";
import { loadSavedPlacesForUsers, type UserSavedPlaces } from "@/lib/plan/saved-places-reader";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

type ListingForMatch = Pick<
  TableRow<"apartment_listings">,
  | "id"
  | "address_line"
  | "amenities"
  | "bedrooms"
  | "city"
  | "description"
  | "effective_monthly_rent"
  | "listing_status"
  | "monthly_rent"
  | "neighborhood"
  | "poi_summary"
  | "provider_market"
  | "rent_max"
  | "rent_min"
>;

type EvidencePoint = {
  detail: string;
  label: string;
};

const defaultMarket = "san-francisco-ca";
const apartmentMatchWriteLimit = 80;
const defaultApartmentMatchCandidateScanLimit = 1000;
const visibleApartmentMatchStatuses = new Set<string>(VISIBLE_APARTMENT_MATCH_STATUSES);

function apartmentMatchCandidateScanLimit() {
  const rawValue = process.env.KINFOLK_APARTMENT_MATCH_SCAN_LIMIT?.trim();
  if (!rawValue) {
    return defaultApartmentMatchCandidateScanLimit;
  }

  return clampInteger(
    rawValue,
    defaultApartmentMatchCandidateScanLimit,
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

function apartmentMatchMarket(market: string | undefined) {
  return market?.trim() || defaultMarket;
}

export async function recomputeApartmentListingMatchesForUser(
  supabase: SupabaseServiceClient,
  userId: string,
  {
    limit = apartmentMatchWriteLimit,
    market = process.env.KINFOLK_APARTMENT_MARKET,
  }: {
    limit?: number;
    market?: string;
  } = {},
) {
  const effectiveMarket = apartmentMatchMarket(market);
  const [profileResult, housingResult, factsResult, savedPlacesResult] = await Promise.all([
    supabase
      .from("matching_profiles")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("housing_preferences")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profile_facts")
      .select("fact_key,normalized_value")
      .eq("user_id", userId)
      .in("fact_key", ["noise_tolerance", "work_from_home", "commute"])
      .in("user_review_state", ["approved", "edited"])
      .eq("sensitivity_level", "standard")
      .eq("matching_eligible", true)
      .order("importance", { ascending: false })
      .order("confidence", { ascending: false }),
    loadSavedPlacesForUsers(supabase, [userId]),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (housingResult.error) throw housingResult.error;
  if (factsResult.error) throw factsResult.error;

  const profile = profileResult.data;
  if (!profile) {
    return { skipped: "no_matching_profile" as const, upserted: 0 };
  }

  // Budget-window pre-filter: a plain rent-ascending scan capped at N starves
  // pricier-but-higher-fit listings once the market outgrows the cap — a
  // systematic cheap-listing bias unrelated to the user's actual headroom.
  // The window is an exact superset of what scoring keeps (per-person cap ×
  // the max household split, with the same $150 slack), so it changes which
  // rows are FETCHED, never which are eligible.
  let listingsQuery = supabase
    .from("apartment_listings")
    .select(
      "id,address_line,amenities,bedrooms,city,description,effective_monthly_rent,listing_status,monthly_rent,neighborhood,poi_summary,provider_market,rent_max,rent_min",
    )
    .eq("provider_market", effectiveMarket)
    .eq("listing_status", "active");
  if (profile.budget_max != null) {
    const maxSplit = Math.max(1, Math.min(profile.household_size_max ?? 1, 4));
    const ceiling = Math.round((profile.budget_max + 150) * maxSplit);
    // Mirrors scoring's rent fallback chain (effective ?? monthly ?? rent_min
    // ?? rent_max); fully unpriced listings never score, so dropping them
    // here is behavior-preserving.
    listingsQuery = listingsQuery.or(
      [
        `effective_monthly_rent.lte.${ceiling}`,
        `and(effective_monthly_rent.is.null,monthly_rent.lte.${ceiling})`,
        `and(effective_monthly_rent.is.null,monthly_rent.is.null,rent_min.lte.${ceiling})`,
        `and(effective_monthly_rent.is.null,monthly_rent.is.null,rent_min.is.null,rent_max.lte.${ceiling})`,
      ].join(","),
    );
  }
  const listingsResult = await listingsQuery
    .order("effective_monthly_rent", {
      ascending: true,
      nullsFirst: false,
    })
    .order("monthly_rent", { ascending: true, nullsFirst: false })
    .limit(Math.max(apartmentMatchCandidateScanLimit(), limit * 8, limit));

  if (listingsResult.error) throw listingsResult.error;

  const housing = housingResult.data;
  const behavioralFacts = buildBehavioralFactMap(factsResult.data ?? []);
  const savedPlaces = savedPlacesResult.get(userId) ?? {
    savedAreaLabels: [],
    savedListingIds: [],
  };
  const listingById = new Map(
    (listingsResult.data ?? []).map((listing) => [listing.id, listing]),
  );
  const scored = (listingsResult.data ?? [])
    .flatMap((listing) =>
      scoreApartmentListingForProfile({
        behavioralFacts,
        housing,
        listing,
        profile,
        savedPlaces,
      }),
    )
    .sort((left, right) => right.fit_score - left.fit_score)
    .slice(0, limit);

  if (scored.length === 0) {
    await deleteStaleSuggestedApartmentListingMatches(supabase, userId, profile.id, []);
    await syncApartmentListingMatchesToQueue(supabase, userId, profile.id, [], listingById);
    return { skipped: "no_matching_listings" as const, upserted: 0 };
  }

  const existingResult = await supabase
    .from("apartment_listing_matches")
    .select("listing_id,status")
    .eq("user_id", userId)
    .eq("profile_id", profile.id)
    .in(
      "listing_id",
      scored.map((row) => row.listing_id),
    );

  if (existingResult.error) throw existingResult.error;

  const existingStatus = new Map(
    (existingResult.data ?? []).map((row) => [row.listing_id, row.status]),
  );
  const rows = scored.map((row) => ({
    ...row,
    status: existingStatus.get(row.listing_id) ?? "suggested",
  }));
  const upsert = await supabase
    .from("apartment_listing_matches")
    .upsert(rows, { onConflict: "user_id,profile_id,listing_id" });

  if (upsert.error) throw upsert.error;

  await deleteStaleSuggestedApartmentListingMatches(
    supabase,
    userId,
    profile.id,
    rows.map((row) => row.listing_id),
  );

  await syncApartmentListingMatchesToQueue(supabase, userId, profile.id, rows, listingById);

  return { skipped: null, upserted: rows.length };
}

async function syncApartmentListingMatchesToQueue(
  supabase: SupabaseServiceClient,
  userId: string,
  profileId: string,
  rows: Array<{
    listing_id: string;
    fit_score: number;
    evidence: Json;
    tradeoffs: Json;
    per_person_rent: number;
    effective_per_person_rent: number;
    status: string;
  }>,
  // The recompute already loaded these listings with every column the queue
  // rows need — re-querying them here was pure duplicated load.
  listingById: Map<string, ListingForMatch>,
) {
  // Build the replacement rows BEFORE the delete so the empty-queue window is
  // a single round-trip, not delete + rebuild.
  const queueRows = rows.flatMap((row) => {
    if (!visibleApartmentMatchStatuses.has(row.status)) return [];
    const listing = listingById.get(row.listing_id);
    if (!listing) return [];
    return [
      {
        user_id: userId,
        profile_id: profileId,
        candidate_type: "apartment",
        title: listing.address_line,
        subtitle: listing.neighborhood ?? listing.city ?? "Neighborhood",
        status: queueStatusForApartmentMatch(row.status),
        fit_score: row.fit_score,
        // Whole-unit rent only — falling back to per_person_rent here would
        // present a per-person figure as the unit's rent. Scored listings
        // always priced, so this stays populated in practice.
        monthly_rent: listing.effective_monthly_rent ?? listing.monthly_rent,
        evidence: row.evidence,
        tradeoffs: row.tradeoffs,
        next_action: "Review the match",
      },
    ];
  });

  const deletedQueue = await supabase
    .from("match_queue_items")
    .delete()
    .eq("user_id", userId)
    .eq("candidate_type", "apartment");
  if (deletedQueue.error) {
    throw deletedQueue.error;
  }

  if (queueRows.length === 0) {
    return;
  }

  const insert = await supabase.from("match_queue_items").insert(queueRows);
  if (insert.error) {
    throw insert.error;
  }
}

function queueStatusForApartmentMatch(status: string) {
  if (status === "applied") return "preparing";
  if (status === "saved" || status === "touring") return "approved";
  return "suggested";
}

async function deleteStaleSuggestedApartmentListingMatches(
  supabase: SupabaseServiceClient,
  userId: string,
  profileId: string,
  activeListingIds: string[],
) {
  let query = supabase
    .from("apartment_listing_matches")
    .delete()
    .eq("user_id", userId)
    .eq("profile_id", profileId)
    .eq("status", "suggested");
  if (activeListingIds.length > 0) {
    query = query.not("listing_id", "in", `(${activeListingIds.join(",")})`);
  }
  const result = await query;

  if (result.error) {
    throw result.error;
  }
}

function scoreApartmentListingForProfile({
  behavioralFacts,
  housing,
  listing,
  profile,
  savedPlaces,
}: {
  behavioralFacts: Map<string, string>;
  housing: TableRow<"housing_preferences"> | null;
  listing: ListingForMatch;
  profile: TableRow<"matching_profiles">;
  savedPlaces: UserSavedPlaces;
}) {
  const monthlyRent = positiveRent(listing.monthly_rent ?? listing.rent_min ?? listing.rent_max);
  const effectiveRent = positiveRent(listing.effective_monthly_rent) ?? monthlyRent;
  if (monthlyRent == null || effectiveRent == null) {
    return [];
  }

  const householdSize = recommendedHouseholdSize(profile, listing);
  // 008: Math.ceil → Math.round (canonical core rule). Shifts existing persisted
  // per_person_rent values by at most $1; acknowledged and harmless.
  const perPersonRentValue = corePerPersonRent(monthlyRent, householdSize);
  const effectivePerPersonRent = corePerPersonRent(effectiveRent, householdSize);
  if (!withinBudget(effectivePerPersonRent, profile.budget_min, profile.budget_max)) {
    return [];
  }

  // The exclusion filter only exists when the user STATED neighborhoods, but
  // saved areas (Living Plan / hearts) widen it: a listing in an area the user
  // saved must not be excluded by an older stated list. Saves alone never
  // create a filter — a save is a taste nudge, not a requirement — and the
  // +14 neighborhood bonus below stays stated-preferences-only; saved areas
  // earn the smaller savedPlaceBonus instead.
  const preferredNeighborhoods = housing?.neighborhoods ?? [];
  const acceptableNeighborhoods = [
    ...preferredNeighborhoods,
    ...savedPlaces.savedAreaLabels,
  ];
  if (
    preferredNeighborhoods.length > 0 &&
    !acceptableNeighborhoods.some((neighborhood) =>
      matchesRequestedNeighborhood(listing.neighborhood ?? listing.city, neighborhood),
    )
  ) {
    return [];
  }

  const mustHaves = normalizePreferenceList(housing?.must_haves ?? []);
  const mustHaveSignals = evaluateMustHaveSignals(listing, mustHaves);

  const evidence: EvidencePoint[] = [];
  const tradeoffs: EvidencePoint[] = [];

  // Accumulate evidence/tradeoffs side-effects (unchanged).
  // The numeric score is now produced entirely by apartmentFitScore (core).
  if (profile.budget_max != null) {
    const delta = profile.budget_max - effectivePerPersonRent;
    if (delta >= 0) {
      evidence.push({
        label: "Budget",
        detail: `${formatCurrency(effectivePerPersonRent)}/person fits your ${formatCurrency(profile.budget_max)} cap.`,
      });
    }
  } else if (profile.budget_min != null) {
    evidence.push({
      label: "Budget",
      detail: `${formatCurrency(effectivePerPersonRent)}/person is above your ${formatCurrency(profile.budget_min)} floor.`,
    });
  } else {
    tradeoffs.push({
      label: "Budget",
      detail: "Budget is not confirmed, so this is a softer recommendation.",
    });
  }

  const listingNeighborhood = listing.neighborhood ?? listing.city;
  const neighborhoodMatches =
    preferredNeighborhoods.length > 0 &&
    preferredNeighborhoods.some((neighborhood) =>
      matchesRequestedNeighborhood(listingNeighborhood, neighborhood),
    );
  if (neighborhoodMatches) {
    evidence.push(neighborhoodInterestEvidence(listingNeighborhood));
  }

  if (mustHaveSignals.matched.length > 0) {
    evidence.push(confirmedMustHavesEvidence(mustHaveSignals.matched));
  }

  if (mustHaveSignals.unconfirmed.length > 0) {
    tradeoffs.push(unconfirmedMustHavesTradeoff(mustHaveSignals.unconfirmed));
  }

  if (listing.bedrooms != null && householdSize > 1) {
    evidence.push({
      label: "Roommate split",
      detail: `${householdSize} people keeps the split at ${formatCurrency(effectivePerPersonRent)}/person.`,
    });
  }

  if (
    listing.effective_monthly_rent != null &&
    listing.monthly_rent != null &&
    listing.effective_monthly_rent < listing.monthly_rent
  ) {
    evidence.push({
      label: "Concession",
      detail: `Effective rent is below listed rent of ${formatCurrency(listing.monthly_rent)}.`,
    });
  }

  if (tradeoffs.length === 0) {
    tradeoffs.push({
      label: "Fees",
      detail: "Confirm mandatory fees before applying.",
    });
  }

  // scoreBehavioralListingHints pushes evidence/tradeoffs as a side-effect AND
  // returns a numeric delta; pass that delta to the core as behavioralDelta.
  const behavioralDelta = scoreBehavioralListingHints(listing, behavioralFacts, evidence, tradeoffs);

  const savedPlaceBonus = savedListingFitBonus({
    listingNeighborhood: listingNeighborhood ?? "",
    listingId: listing.id,
    savedAreaLabels: savedPlaces.savedAreaLabels,
    savedListingIds: savedPlaces.savedListingIds,
  });
  if (savedPlaceBonus > 0) {
    evidence.push(
      savedPlaces.savedListingIds.includes(listing.id)
        ? { label: "Saved", detail: "You saved this listing." }
        : {
            label: "Saved area",
            detail: `${listingNeighborhood ?? "This neighborhood"} is an area you saved.`,
          },
    );
  }

  // 008: numeric score now comes from the canonical core — no local literals.
  const fitScore = apartmentFitScore({
    budgetMin: profile.budget_min,
    budgetMax: profile.budget_max,
    effectivePerPersonRent,
    neighborhoodMatches,
    mustHavesMatched: mustHaveSignals.matched.length,
    mustHavesUnconfirmed: mustHaveSignals.unconfirmed.length,
    behavioralDelta,
    savedPlaceBonus,
  });

  return [
    {
      user_id: profile.user_id,
      profile_id: profile.id,
      listing_id: listing.id,
      fit_score: fitScore,
      recommended_household_size: householdSize,
      per_person_rent: perPersonRentValue,
      effective_per_person_rent: effectivePerPersonRent,
      split_strategy: "equal",
      split_breakdown: buildSplitBreakdown(householdSize, effectivePerPersonRent),
      evidence: evidence.slice(0, 5) as unknown as Json,
      tradeoffs: tradeoffs.slice(0, 4) as unknown as Json,
    },
  ];
}

function buildBehavioralFactMap(
  rows: Array<{
    fact_key: string;
    normalized_value: string | null;
  }>,
) {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (map.has(row.fact_key)) continue;
    const value = row.normalized_value?.trim();
    if (!value) continue;
    map.set(row.fact_key, value);
  }
  return map;
}

function scoreBehavioralListingHints(
  listing: Pick<ListingForMatch, "amenities" | "description" | "poi_summary">,
  behavioralFacts: Map<string, string>,
  evidence: EvidencePoint[],
  tradeoffs: EvidencePoint[],
) {
  let delta = 0;
  const listingText = `${(listing.amenities ?? []).join(" ")} ${listing.description ?? ""} ${formatPoiSummary(listing.poi_summary)}`.toLowerCase();

  const noiseTolerance = behavioralFacts.get("noise_tolerance")?.toLowerCase();
  if (
    (noiseTolerance === "very quiet" || noiseTolerance === "quiet") &&
    (/\b(?:nightlife|loud|bars?|club|entertainment district)\b/.test(listingText) ||
      /\bhigh(?:ly)?\s+nightlife\b/.test(listingText))
  ) {
    delta -= 5;
    tradeoffs.push({
      label: "Noise fit",
      detail: "Listing mentions nightlife or loud surroundings, which may clash with your quiet preference.",
    });
  }

  if (behavioralFacts.has("work_from_home")) {
    if (/\b(?:home office|work(?:ing)? from home|desk|quiet workspace|flex room)\b/.test(listingText)) {
      delta += 3;
      evidence.push({
        label: "Work-from-home",
        detail: "Listing mentions a workspace that fits your work-from-home pattern.",
      });
    }
  }

  // Commute × transit: when the user told us they commute somewhere, the
  // structured poi_summary transit distances become a ranking signal — close
  // transit is a small boost, a transit desert is a small tradeoff. This is
  // the P2 wiring; the P3 commute-anchor question will sharpen the input.
  if (behavioralFacts.has("commute")) {
    const transitMiles = nearestTransitDistanceMiles(listing.poi_summary);
    if (transitMiles != null && transitMiles <= 0.5) {
      delta += 3;
      evidence.push({
        label: "Commute",
        detail: `Transit ${transitMiles <= 0.15 ? "at the doorstep" : `${transitMiles.toFixed(1)} mi away`} for your commute.`,
      });
    } else if (transitMiles != null && transitMiles > 1) {
      delta -= 2;
      tradeoffs.push({
        label: "Commute",
        detail: `Nearest transit is ${transitMiles.toFixed(1)} mi away, which may stretch your commute.`,
      });
    }
  }

  return delta;
}

/** Nearest transit stop distance (miles) from the structured poi_summary. */
function nearestTransitDistanceMiles(value: Json | null | undefined): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const transit = (value as Record<string, unknown>).transit;
  if (!Array.isArray(transit)) {
    return null;
  }

  let nearest: number | null = null;
  for (const stop of transit) {
    if (!stop || typeof stop !== "object" || Array.isArray(stop)) continue;
    const distance = (stop as Record<string, unknown>).distance;
    if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) continue;
    if (nearest == null || distance < nearest) {
      nearest = distance;
    }
  }
  return nearest;
}

function normalizePreferenceList(values: string[]) {
  return values.flatMap((value) => {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  });
}

function evaluateMustHaveSignals(
  listing: Pick<ListingForMatch, "amenities" | "description" | "poi_summary">,
  mustHaves: string[],
) {
  const matched: string[] = [];
  const unconfirmed: string[] = [];
  for (const mustHave of mustHaves) {
    if (listingMatchesMustHave(listing, mustHave)) {
      matched.push(mustHave);
    } else {
      unconfirmed.push(mustHave);
    }
  }
  return { matched, unconfirmed };
}

function formatPoiSummary(value: Json | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  return JSON.stringify(value).toLowerCase();
}

function recommendedHouseholdSize(
  profile: TableRow<"matching_profiles">,
  listing: Pick<TableRow<"apartment_listings">, "bedrooms">,
) {
  // Delegates to the canonical core rule (4-person cap, bedroom floor).
  return recommendedHouseholdSizeCore({
    householdSizeMax: profile.household_size_max,
    bedrooms: listing.bedrooms,
  });
}

function listingMatchesMustHave(
  listing: Pick<ListingForMatch, "amenities" | "description" | "poi_summary">,
  mustHave: string,
) {
  // The regex fallbacks for laundry/dishwasher/parking/pets and the token
  // fallback now live inside `listingMatchesFeatureMustHave`, so both the DB
  // path (here) and the snapshot path (match-surface) stay consistent.
  return listingMatchesFeatureMustHave(listing, mustHave);
}

function buildSplitBreakdown(householdSize: number, amount: number) {
  return Array.from({ length: householdSize }, (_, index) => ({
    amount,
    label: index === 0 ? "You" : `Roommate ${index}`,
  })) as unknown as Json;
}

function positiveRent(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
