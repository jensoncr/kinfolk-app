import "server-only";
import { fallbackBudgetQueryMax, fallbackPerPersonRentForListing } from "@/lib/apartments/listing-fallback-rent";
import {
  bestRequestedTransitMatch,
  evaluateListingProximityConstraints,
  matchesRequestedBedrooms,
  matchesRequestedBudget,
  matchesRequestedTransitTargets,
  mergeListingRequestContextWithSavedPreferences,
  type ListingProximityConstraint,
  type ResolvedListingProximityConstraint,
} from "@/lib/apartments/listing-request-context";
import { fetchListingPhotoRows, fetchSentListingRecommendationRows } from "@/lib/text-agent/listing-delivery";
import { firstConfiguredEnvValue } from "@/lib/shared/env";
import {
  buildListingCardEvidence,
  compareListingRecommendationCandidates,
  formatListingMustHaveEvidence,
  formatListingTransitTargetEvidence,
  formatMissingListingMustHaveEvidence,
  isExcludedListingNeighborhood,
  listingBudgetRentForRecommendation,
  listingMatchesAvoidTerms,
  listingMatchesRequestedArea,
  matchesRequestedMustHaves,
  readPositiveListingNumber,
  readRecommendationEvidence,
  readRecommendedHouseholdSize,
  scoreListingFeatureFit,
  scoreRequestedTransitDistance,
} from "@/lib/text-agent/listing-format";
import { escapePostgrestFilterValue, formatCurrency } from "@/lib/text-agent/store-shared";
import { resolveTextAgentApartmentMarket } from "@/lib/text-agent/neighborhoods";
import { scoreFallbackRent } from "./listing-fallback-rent";
import type { ListingRequestContext } from "@/lib/apartments/listing-request-context";
import type { ListingFeatureFit, ListingRecommendationCandidate, ListingRecommendationCard, SupabaseServiceClient } from "@/lib/text-agent/store-types";

// How far from a named place still counts as "near" it for a "near <place>"
// search. Listings beyond this are not presented as near the place even if they
// are the user's saved-area matches.
const MAX_NEAR_PLACE_MILES = 1.5;

async function resolveListingRequestContextWithSavedPreferences(
  supabase: SupabaseServiceClient,
  {
    includeSavedBudget = true,
    includeSavedMustHaves = true,
    includeSavedNeighborhoods = true,
    ignoreCurrentNeighborhoods = false,
    mergeSavedNeighborhoods = false,
    requestContext,
    userId,
  }: {
    includeSavedBudget?: boolean;
    includeSavedMustHaves?: boolean;
    includeSavedNeighborhoods?: boolean;
    ignoreCurrentNeighborhoods?: boolean;
    mergeSavedNeighborhoods?: boolean;
    requestContext: ListingRequestContext;
    userId: string;
  },
): Promise<ListingRequestContext> {
  const currentRequestContext = ignoreCurrentNeighborhoods
    ? { ...requestContext, neighborhoods: [] }
    : requestContext;
  const [profile, housing] = await Promise.all([
    supabase
      .from("matching_profiles")
      .select("budget_min,budget_max")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("housing_preferences")
      .select("neighborhoods,must_haves")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (profile.error) throw profile.error;
  if (housing.error) throw housing.error;

  const savedNeighborhoods = housing.data?.neighborhoods ?? [];
  const savedMustHaves = housing.data?.must_haves ?? [];

  return mergeListingRequestContextWithSavedPreferences(
    currentRequestContext,
    {
      budgetMax: profile.data?.budget_max ?? null,
      budgetMin: profile.data?.budget_min ?? null,
      mustHaves: savedMustHaves,
      neighborhoods: savedNeighborhoods,
    },
    {
      includeSavedBudget,
      includeSavedMustHaves,
      includeSavedNeighborhoods,
      mergeSavedNeighborhoods,
    },
  );
}

export type CompatibleListingSearchOptions = {
  allowPartialMustHaves?: boolean;
  allowUnmatchedPartialMustHaves?: boolean;
  availableBy?: string | null;
  includeSavedBudget?: boolean;
  includeSavedMustHaves?: boolean;
  includeSavedNeighborhoods?: boolean;
  ignoreCurrentNeighborhoods?: boolean;
  mergeSavedNeighborhoods?: boolean;
  limit: number;
  requestContext: ListingRequestContext;
  userId: string;
};

export type CompatibleListingSearchResult = {
  cards: ListingRecommendationCard[];
  // Named places the user asked to search near that no geocoder could locate.
  // Distinct from "no listings matched": the caller should fall back to a
  // neighborhood search when one is available and otherwise tell the user the
  // place lookup failed — not advise relaxing budget or beds.
  geocodeFailedPlaces: string[];
};

export async function loadCompatibleListingCards(
  supabase: SupabaseServiceClient,
  options: CompatibleListingSearchOptions,
): Promise<ListingRecommendationCard[]> {
  return (await searchCompatibleListingCards(supabase, options)).cards;
}

export async function searchCompatibleListingCards(
  supabase: SupabaseServiceClient,
  {
    allowPartialMustHaves = false,
    allowUnmatchedPartialMustHaves = false,
    availableBy = null,
    includeSavedBudget = true,
    includeSavedMustHaves = true,
    includeSavedNeighborhoods = true,
    ignoreCurrentNeighborhoods = false,
    mergeSavedNeighborhoods = false,
    limit,
    requestContext,
    userId,
  }: CompatibleListingSearchOptions,
): Promise<CompatibleListingSearchResult> {
  const resolvedRequestContext = await resolveListingRequestContextWithSavedPreferences(
    supabase,
    {
      includeSavedBudget,
      includeSavedMustHaves,
      includeSavedNeighborhoods,
      ignoreCurrentNeighborhoods,
      mergeSavedNeighborhoods,
      requestContext,
      userId,
    },
  );
  const availableByDate = normalizeAvailableByDate(availableBy);
  const requestedNeighborhoods = resolvedRequestContext.neighborhoods;
  const requestedBudgetMax = resolvedRequestContext.budgetMax;
  const requestedBudgetMin = resolvedRequestContext.budgetMin;
  const requestedAvoidTerms = resolvedRequestContext.avoidTerms;
  const requestedBedrooms =
    resolvedRequestContext.bedroomsMin != null ||
    resolvedRequestContext.bedroomsMax != null;
  const requestedMustHaves = resolvedRequestContext.mustHaves;
  const resolvedProximityConstraints =
    await resolveListingProximityConstraints(
      resolvedRequestContext.proximityConstraints,
    );
  // A place that failed to geocode yields no distances, so leaving it in the
  // filter set would drop every candidate and misreport the search as "no
  // matches" (with useless relax-the-budget advice). Pull the dead constraint
  // out, surface the failure, and search whatever else was asked.
  const geocodeFailedPlaces = resolvedProximityConstraints.flatMap(
    (constraint) =>
      constraint.target.type === "place" && !constraint.resolvedTarget
        ? [constraint.target.name]
        : [],
  );
  const requestedProximityConstraints = resolvedProximityConstraints.filter(
    (constraint) =>
      constraint.target.type !== "place" || Boolean(constraint.resolvedTarget),
  );
  const requestedTransitTargets = resolvedRequestContext.transitTargets;
  // Only prefer-polarity places express "near <place>" intent. Avoid-polarity
  // ("not near X") is a pure exclusion filter: it never sets a
  // preferredDistance, so counting it here would make the near-place keep
  // filter below cull every candidate.
  const hasPlaceProximity = requestedProximityConstraints.some(
    (constraint) =>
      constraint.target.type === "place" && constraint.polarity === "prefer",
  );
  // When the place WAS the geographic intent and nothing else narrows the
  // area, returning saved-area or citywide listings would present far-away
  // units as "near" a place we never located. Dead-end honestly instead so the
  // caller can say the lookup failed and ask for a neighborhood. A failed
  // avoid-place lookup must NOT dead-end: it only means the exclusion can't be
  // applied.
  const geocodeFailedNearPlace = resolvedProximityConstraints.some(
    (constraint) =>
      constraint.target.type === "place" &&
      constraint.polarity === "prefer" &&
      !constraint.resolvedTarget,
  );
  if (
    geocodeFailedNearPlace &&
    !hasPlaceProximity &&
    requestedNeighborhoods.length === 0
  ) {
    return { cards: [], geocodeFailedPlaces };
  }
  const hasExplicitFallbackCriteria =
    requestedNeighborhoods.length > 0 ||
    requestedBedrooms ||
    requestedBudgetMax != null ||
    requestedBudgetMin != null ||
    requestedAvoidTerms.length > 0 ||
    requestedMustHaves.length > 0 ||
    requestedProximityConstraints.length > 0 ||
    requestedTransitTargets.length > 0;
  const matches = await supabase
    .from("apartment_listing_matches")
    .select(
      "listing_id, fit_score, evidence, tradeoffs, status, recommended_household_size, per_person_rent, effective_per_person_rent",
    )
    .eq("user_id", userId)
    .in("status", ["suggested", "saved", "touring"])
    .order("fit_score", { ascending: false })
    .limit(Math.max(limit * 4, limit));

  if (matches.error) {
    throw matches.error;
  }

  const listingIds = (matches.data ?? []).map((match) => match.listing_id);
  if (listingIds.length === 0) {
    return {
      cards: await loadFallbackListingCards(supabase, {
        allowPartialMustHaves,
        allowUnmatchedPartialMustHaves,
        availableBy: availableByDate,
        limit,
        requestContext: resolvedRequestContext,
        resolvedProximityConstraints: requestedProximityConstraints,
        userId,
      }),
      geocodeFailedPlaces,
    };
  }

  const [listings, photos, alreadySent] = await Promise.all([
    supabase
      .from("apartment_listings")
      .select(
        "id,source_url,address_line,city,state,neighborhood,latitude,longitude,monthly_rent,effective_monthly_rent,bedrooms,bathrooms,description,amenities,listing_status,available_at,poi_summary",
      )
      .in("id", listingIds)
      .eq("listing_status", "active"),
    supabase
      .from("apartment_listing_photos")
      .select("listing_id,url,position")
      .in("listing_id", listingIds)
      .order("position", { ascending: true }),
    supabase
      .from("text_listing_recommendations")
      .select("listing_id,reaction_type")
      .eq("user_id", userId)
      .in("listing_id", listingIds),
  ]);

  if (listings.error) throw listings.error;
  if (photos.error) throw photos.error;
  if (alreadySent.error) throw alreadySent.error;

  const listingsById = new Map((listings.data ?? []).map((listing) => [listing.id, listing]));
  const photoByListing = new Map<string, string>();
  for (const photo of photos.data ?? []) {
    if (!photoByListing.has(photo.listing_id)) {
      photoByListing.set(photo.listing_id, photo.url);
    }
  }
  const disliked = new Set(
    (alreadySent.data ?? []).flatMap((sent) =>
      sent.reaction_type === "dislike" ? [sent.listing_id] : [],
    ),
  );

  const candidates = (matches.data ?? [])
    .flatMap<ListingRecommendationCandidate>((match) => {
      if (disliked.has(match.listing_id)) {
        return [];
      }
      const listing = listingsById.get(match.listing_id);
      if (!listing) {
        return [];
      }
      if (isExcludedListingNeighborhood(listing.neighborhood ?? listing.city, resolvedRequestContext)) {
        return [];
      }
      if (
        requestedNeighborhoods.length > 0 &&
        !requestedNeighborhoods.some((neighborhood) =>
          listingMatchesRequestedArea(listing, neighborhood),
        )
      ) {
        return [];
      }
      const rent = listingBudgetRentForRecommendation(listing, match);
      if (!matchesRequestedBudget(rent, resolvedRequestContext)) {
        return [];
      }
      if (!matchesRequestedBedrooms(listing.bedrooms, resolvedRequestContext)) {
        return [];
      }
      if (!matchesListingAvailability(listing.available_at, availableByDate)) {
        return [];
      }
      if (!matchesRequestedMustHaves(listing, requestedMustHaves)) {
        return [];
      }
      if (listingMatchesAvoidTerms(listing, requestedAvoidTerms)) {
        return [];
      }
      if (!matchesRequestedTransitTargets(listing, requestedTransitTargets)) {
        return [];
      }
      const proximity = evaluateListingProximityConstraints(
        listing,
        requestedProximityConstraints,
      );
      if (!proximity.hardPass) {
        return [];
      }
      // For an explicit "near <place>" search, keep only listings that are
      // actually near the place — otherwise a far saved-area match (with no
      // distance to the place, or miles away) would be presented as "near" it.
      if (
        hasPlaceProximity &&
        (proximity.preferredDistance == null ||
          proximity.preferredDistance > MAX_NEAR_PLACE_MILES)
      ) {
        return [];
      }
      const transitPoi = bestRequestedTransitMatch(
        listing,
        requestedTransitTargets,
      );
      return [
        {
          card: {
            address: listing.address_line,
            bathrooms: listing.bathrooms,
            bedrooms: listing.bedrooms,
            description:
              listing.description?.trim() ||
              "A current Kinfolk apartment match based on your saved housing profile.",
            effectivePerPersonRent: readPositiveListingNumber(
              match.effective_per_person_rent,
            ),
            effectiveRent: listing.effective_monthly_rent,
            evidence: buildListingCardEvidence({
              baseEvidence: [
                ...formatListingTransitTargetEvidence(
                  listing,
                  requestedTransitTargets,
                  transitPoi,
                ),
                ...proximity.evidence,
                ...readRecommendationEvidence(match.evidence),
                ...formatListingMustHaveEvidence(listing, requestedMustHaves),
              ],
              listing,
            }),
            fitScore: match.fit_score,
            fit_source: "engine",
            id: listing.id,
            imageUrl: photoByListing.get(listing.id) ?? null,
            monthlyRent: listing.monthly_rent,
            neighborhood: listing.neighborhood ?? listing.city,
            perPersonRent: readPositiveListingNumber(match.per_person_rent),
            recommendedHouseholdSize: readRecommendedHouseholdSize(match),
            sourceUrl: listing.source_url,
          },
          proximityDistance: proximity.preferredDistance,
          transitDistance: transitPoi?.distance ?? null,
        },
      ];
    })
    .sort((left, right) =>
      compareListingRecommendationCandidates(
        left,
        right,
        resolvedRequestContext,
      ),
    );
  const cards = candidates.slice(0, limit).map((candidate) => candidate.card);

  // A "near <place>" search must always consult the apartment_listings table:
  // the listings actually near the place often have no precomputed match row
  // for this user (their matches are in their saved areas), so they live only in
  // the fallback pool. Without this, a near-place search silently returns the
  // user's saved-area matches instead of listings near the place.
  if (!hasPlaceProximity && (cards.length >= limit || !hasExplicitFallbackCriteria)) {
    return { cards, geocodeFailedPlaces };
  }

  const fallbackCards = await loadFallbackListingCards(supabase, {
    allowPartialMustHaves,
    allowUnmatchedPartialMustHaves,
    availableBy: availableByDate,
    limit,
    requestContext: resolvedRequestContext,
    resolvedProximityConstraints: requestedProximityConstraints,
    userId,
  });
  return {
    cards: mergeListingRecommendationCards(cards, fallbackCards, limit),
    geocodeFailedPlaces,
  };
}

async function loadFallbackListingCards(
  supabase: SupabaseServiceClient,
  {
    allowPartialMustHaves = false,
    allowUnmatchedPartialMustHaves = false,
    availableBy = null,
    limit,
    requestContext,
    resolvedProximityConstraints,
    userId,
  }: {
    allowPartialMustHaves?: boolean;
    allowUnmatchedPartialMustHaves?: boolean;
    availableBy?: string | null;
    limit: number;
    requestContext: ListingRequestContext;
    resolvedProximityConstraints: ResolvedListingProximityConstraint[];
    userId: string;
  },
): Promise<ListingRecommendationCard[]> {
  const requestedNeighborhoods = requestContext.neighborhoods;
  const requestedBudgetMax = requestContext.budgetMax;
  const requestedBudgetMin = requestContext.budgetMin;
  const requestedAvoidTerms = requestContext.avoidTerms;
  const requestedMustHaves = requestContext.mustHaves;
  const requestedProximityConstraints = resolvedProximityConstraints;
  const requestedTransitTargets = requestContext.transitTargets;
  // Prefer-polarity only — see searchCompatibleListingCards.
  const hasPlaceProximity = requestedProximityConstraints.some(
    (constraint) =>
      constraint.target.type === "place" && constraint.polarity === "prefer",
  );
  // A household size stated in the conversation beats the saved profile: SMS
  // intake facts can sit in pending review, and the fallback's default of 1
  // was pricing every splittable multi-bed out of per-person budgets.
  const householdPreference =
    requestContext.householdSize != null
      ? {
          householdSizeMax: requestContext.householdSize,
          householdSizeMin: requestContext.householdSize,
        }
      : await loadFallbackHouseholdPreference(supabase, userId);
  const requestedQueryBudgetMax = fallbackBudgetQueryMax(
    requestedBudgetMax,
    householdPreference,
  );

  const listingSelect =
    "id,source_url,address_line,city,state,neighborhood,latitude,longitude,monthly_rent,effective_monthly_rent,bedrooms,bathrooms,description,amenities,listing_status,available_at,poi_summary";
  const market = resolveTextAgentApartmentMarket();
  const listingFetchLimit = requestedMustHaves.length > 0 ? 500 : 250;
  const neighborhoodListingFetchLimit = requestedMustHaves.length > 0 ? 160 : 80;
  const withListingQueryFilters = <Query extends { or: (filters: string) => Query }>(
    query: Query,
  ) => {
    let next = query;
    if (requestedBudgetMin != null) {
      next = next.or(
        `effective_monthly_rent.gte.${requestedBudgetMin},monthly_rent.gte.${requestedBudgetMin}`,
      );
    }
    if (requestedQueryBudgetMax != null) {
      next = next.or(
        `effective_monthly_rent.lte.${requestedQueryBudgetMax},monthly_rent.lte.${requestedQueryBudgetMax}`,
      );
    }
    if (availableBy != null) {
      next = next.or(`available_at.is.null,available_at.lte.${availableBy}`);
    }
    return next;
  };

  // For a "near <place>" search, fetch the candidate pool inside a bounding box
  // around the geocoded place (at any rent — proximity ranking + the caller's
  // per-person budget cap trim it). Without this, the only listings considered
  // are the user's saved-area matches / the cheapest-N citywide, so listings
  // actually near the place are never even fetched.
  // Prefer-polarity only: building the pool around an AVOIDED place would
  // fetch exactly the listings the user asked to steer clear of.
  const placeTargets = requestedProximityConstraints.flatMap((constraint) =>
    constraint.target.type === "place" &&
    constraint.polarity === "prefer" &&
    constraint.resolvedTarget
      ? [constraint.resolvedTarget]
      : [],
  );
  // The fetch box must cover the keep radius (MAX_NEAR_PLACE_MILES): ~69 mi
  // per degree of latitude, ~54.6 mi per degree of longitude at SF's latitude.
  // A tighter box would silently pre-drop listings the keep filter still
  // counts as near the place.
  const NEAR_PLACE_DELTA_LAT = MAX_NEAR_PLACE_MILES / 69;
  const NEAR_PLACE_DELTA_LNG = MAX_NEAR_PLACE_MILES / 54.6;
  const placeQueries = placeTargets.map((target) =>
    withListingQueryFilters(
      supabase
        .from("apartment_listings")
        .select(listingSelect)
        .eq("listing_status", "active")
        .eq("provider_market", market)
        .gte("latitude", target.latitude - NEAR_PLACE_DELTA_LAT)
        .lte("latitude", target.latitude + NEAR_PLACE_DELTA_LAT)
        .gte("longitude", target.longitude - NEAR_PLACE_DELTA_LNG)
        .lte("longitude", target.longitude + NEAR_PLACE_DELTA_LNG),
    )
      .order("effective_monthly_rent", { ascending: true, nullsFirst: false })
      .order("monthly_rent", { ascending: true, nullsFirst: false })
      // Fetch the whole in-box pool, not the cheapest-N: the closest listing to
      // the place may be expensive, and SQL can't order by distance, so a small
      // rent-ordered cap would drop it before JS proximity ranking runs. The box
      // is geographically tiny, so this stays bounded.
      .limit(listingFetchLimit),
  );

  const neighborhoodQueries = requestedNeighborhoods.map((neighborhood) =>
    withListingQueryFilters(
      supabase
        .from("apartment_listings")
        .select(listingSelect)
        .eq("listing_status", "active")
        .eq("provider_market", market)
        .or(
          `neighborhood.ilike.${escapePostgrestFilterValue(neighborhood)},description.ilike.${escapePostgrestFilterValue(`%${neighborhood}%`)}`,
        ),
    )
      .order("effective_monthly_rent", { ascending: true, nullsFirst: false })
      .order("monthly_rent", { ascending: true, nullsFirst: false })
      .limit(neighborhoodListingFetchLimit),
  );

  // Fall back to the cheapest-N citywide pool ONLY when there's no narrowing
  // signal at all — a named place or neighborhood defines the pool instead, so
  // a "near <place>" search isn't diluted with far-away cheap listings.
  const citywideQueries =
    requestedNeighborhoods.length === 0 && placeTargets.length === 0
      ? [
          withListingQueryFilters(
            supabase
              .from("apartment_listings")
              .select(listingSelect)
              .eq("listing_status", "active")
              .eq("provider_market", market),
          )
            .order("effective_monthly_rent", {
              ascending: true,
              nullsFirst: false,
            })
            .order("monthly_rent", { ascending: true, nullsFirst: false })
            .limit(listingFetchLimit),
        ]
      : [];

  const listingResults = await Promise.all([
    ...neighborhoodQueries,
    ...citywideQueries,
    ...placeQueries,
  ]);
  const listingError = listingResults.find((result) => result.error)?.error;
  if (listingError) throw listingError;
  const listings = {
    data: Array.from(
      listingResults
        .flatMap((result) => result.data ?? [])
        .reduce((listingById, listing) => listingById.set(listing.id, listing), new Map())
        .values(),
    ),
  };

  const listingIds = (listings.data ?? []).map((listing) => listing.id);
  if (listingIds.length === 0) {
    return [];
  }

  const [photoRows, sentRows] = await Promise.all([
    fetchListingPhotoRows(supabase, listingIds),
    fetchSentListingRecommendationRows(supabase, {
      listingIds,
      userId,
    }),
  ]);

  const disliked = new Set(
    sentRows.flatMap((sent) => (sent.reaction_type === "dislike" ? [sent.listing_id] : [])),
  );
  const photoByListing = new Map<string, string>();
  for (const photo of photoRows) {
    if (!photoByListing.has(photo.listing_id)) {
      photoByListing.set(photo.listing_id, photo.url);
    }
  }

  const candidates = (listings.data ?? [])
    .flatMap<
      ListingRecommendationCandidate & { featureFit: ListingFeatureFit }
    >((listing) => {
      if (disliked.has(listing.id)) {
        return [];
      }
      const neighborhood = listing.neighborhood ?? listing.city;
      const matchedRequestedNeighborhood = requestedNeighborhoods.find((requested) =>
        listingMatchesRequestedArea(listing, requested),
      );
      const neighborhoodMatch = Boolean(matchedRequestedNeighborhood);
      if (isExcludedListingNeighborhood(neighborhood, requestContext)) {
        return [];
      }
      if (
        requestedNeighborhoods.length > 0 &&
        !requestedNeighborhoods.some((requested) =>
          listingMatchesRequestedArea(listing, requested),
        )
      ) {
        return [];
      }
      const totalRent = listing.effective_monthly_rent ?? listing.monthly_rent;
      const splitRent = fallbackPerPersonRentForListing(
        listing,
        householdPreference,
      );
      const rent = splitRent.rent;
      if (!matchesRequestedBudget(rent, requestContext)) {
        return [];
      }
      if (!matchesRequestedBedrooms(listing.bedrooms, requestContext)) {
        return [];
      }
      if (!matchesListingAvailability(listing.available_at, availableBy)) {
        return [];
      }
      if (listingMatchesAvoidTerms(listing, requestedAvoidTerms)) {
        return [];
      }
      if (!matchesRequestedTransitTargets(listing, requestedTransitTargets)) {
        return [];
      }
      const proximity = evaluateListingProximityConstraints(
        listing,
        requestedProximityConstraints,
      );
      if (!proximity.hardPass) {
        return [];
      }
      // Keep an explicit "near <place>" search bounded to listings actually
      // near the place (see MAX_NEAR_PLACE_MILES).
      if (
        hasPlaceProximity &&
        (proximity.preferredDistance == null ||
          proximity.preferredDistance > MAX_NEAR_PLACE_MILES)
      ) {
        return [];
      }
      const featureFit = scoreListingFeatureFit(listing, requestedMustHaves);
      if (
        !featureFit.strict &&
        (!allowPartialMustHaves ||
          requestedMustHaves.length === 0 ||
          (!allowUnmatchedPartialMustHaves &&
            (requestedMustHaves.length <= 1 || featureFit.matched.length === 0)))
      ) {
        return [];
      }
      const rentScore = scoreFallbackRent(rent);
      const bedroomScore = listing.bedrooms == null ? 0 : listing.bedrooms >= 1 ? 4 : 1;
      const transitPoi = bestRequestedTransitMatch(
        listing,
        requestedTransitTargets,
      );
      const transitScore =
        requestedTransitTargets.length === 0
          ? 0
          : scoreRequestedTransitDistance(transitPoi?.distance ?? null);
      const proximityScore =
        proximity.preferredDistance == null
          ? 0
          : scoreRequestedTransitDistance(proximity.preferredDistance);
      const fitScore = Math.max(
        55,
        Math.min(
          91,
          58 +
            rentScore +
            bedroomScore +
            featureFit.score +
            proximityScore +
            transitScore +
            (neighborhoodMatch ? 24 : 0),
        ),
      );
      const evidence = [
        ...formatListingTransitTargetEvidence(
          listing,
          requestedTransitTargets,
          transitPoi,
        ),
        ...proximity.evidence,
        neighborhoodMatch
          ? `Matches ${matchedRequestedNeighborhood}.`
          : `${neighborhood} is a strong active-market candidate.`,
        totalRent
          ? `Ranked from current active listings around $${Math.round(totalRent).toLocaleString()}/mo.`
          : "Ranked from current active Kinfolk listings.",
        splitRent.householdSize != null && splitRent.householdSize > 1 && rent
          ? `${splitRent.householdSize} people keeps the split at ${formatCurrency(rent)}/person.`
          : null,
        ...formatListingMustHaveEvidence(listing, requestedMustHaves),
        ...formatMissingListingMustHaveEvidence(featureFit),
      ].filter((entry): entry is string => Boolean(entry));

      return [
        {
          card: {
            address: listing.address_line,
            bathrooms: listing.bathrooms,
            bedrooms: listing.bedrooms,
            description:
              listing.description?.trim() ||
              "A current Kinfolk apartment candidate from the active listings feed.",
            effectivePerPersonRent:
              splitRent.householdSize != null && splitRent.householdSize > 1
                ? rent
                : null,
            effectiveRent: listing.effective_monthly_rent,
            evidence: buildListingCardEvidence({ baseEvidence: evidence, listing }),
            fitScore,
            fit_source: "heuristic",
            id: listing.id,
            imageUrl: photoByListing.get(listing.id) ?? null,
            monthlyRent: listing.monthly_rent,
            neighborhood,
            perPersonRent:
              splitRent.householdSize != null && splitRent.householdSize > 1
                ? rent
                : null,
            recommendedHouseholdSize: splitRent.householdSize,
            sourceUrl: listing.source_url,
          },
          featureFit,
          proximityDistance: proximity.preferredDistance,
          transitDistance: transitPoi?.distance ?? null,
        },
      ];
    });
  const strictCandidates = candidates.filter((candidate) => candidate.featureFit.strict);
  const rankedCandidates = strictCandidates.length > 0 ? strictCandidates : candidates;

  return rankedCandidates
    .sort((left, right) =>
      compareListingRecommendationCandidates(left, right, requestContext),
    )
    .slice(0, limit)
    .map((candidate) => candidate.card);
}

// Agent-facing phrasing guidance for a failed place lookup, embedded in the
// tool result. With cards present the search already fell back to the area
// criteria; with none, asking for a neighborhood is the only honest next step.
export function formatGeocodeFailureGuidance({
  cardCount,
  geocodeFailedPlaces,
}: {
  cardCount: number;
  geocodeFailedPlaces: string[];
}) {
  if (geocodeFailedPlaces.length === 0) {
    return null;
  }
  const places = geocodeFailedPlaces.join(", ");
  if (cardCount > 0) {
    return `Could not pin "${places}" on the map, so these listings come from the area criteria instead of distance ranking. Tell them the place lookup failed and that these are area matches, and ask for a cross street or neighborhood to rank by closeness.`;
  }
  return `Could not pin "${places}" on the map and there was no neighborhood to fall back to. Say the place lookup failed and ask which neighborhood (or a cross street) to search instead — do NOT suggest relaxing budget or beds.`;
}

function normalizeAvailableByDate(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function matchesListingAvailability(
  availableAt: string | null | undefined,
  availableBy: string | null,
) {
  if (availableBy == null || !availableAt) {
    return true;
  }
  return availableAt.slice(0, 10) <= availableBy;
}

export function mergeListingRecommendationCards(
  primary: ListingRecommendationCard[],
  secondary: ListingRecommendationCard[],
  limit: number,
) {
  const cardsById = new Map<string, ListingRecommendationCard>();
  for (const card of [...primary, ...secondary]) {
    if (!cardsById.has(card.id)) {
      cardsById.set(card.id, card);
    }
  }
  return [...cardsById.values()].slice(0, limit);
}

async function loadFallbackHouseholdPreference(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  // Deliberately unfiltered by status, matching how the saved budget cap is
  // read (loadSavedBudgetCaps). The asymmetry was the bug: an onboarding
  // profile is still 'draft', so the household lookup returned nothing and fell
  // back to a household of one while the user's budget was still applied as a
  // per-person cap. Every splittable multi-bedroom priced out and the search
  // came back studios-only.
  const result = await supabase
    .from("matching_profiles")
    .select("household_size_min,household_size_max")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return {
    householdSizeMax: readPositiveListingNumber(
      result.data?.household_size_max,
    ),
    householdSizeMin: readPositiveListingNumber(
      result.data?.household_size_min,
    ),
  };
}

async function resolveListingProximityConstraints(
  constraints: ListingProximityConstraint[],
): Promise<ResolvedListingProximityConstraint[]> {
  if (constraints.length === 0) {
    return [];
  }

  // Cache the geocoded TARGET, not the resolved constraint: two constraints
  // on the same place can differ in polarity/hardness/radius, and caching the
  // first constraint object would silently stamp its semantics onto the rest.
  const placeCache = new Map<string, Promise<ResolvedPlaceTarget | null>>();
  return Promise.all(
    constraints.map(async (constraint) => {
      if (!isPlaceProximityConstraint(constraint)) {
        return constraint;
      }

      const cacheKey = [
        constraint.target.name.toLowerCase(),
        constraint.target.area?.toLowerCase() ?? "",
      ].join("|");
      let cached = placeCache.get(cacheKey);
      if (!cached) {
        cached = resolvePlaceTarget(constraint);
        placeCache.set(cacheKey, cached);
      }
      return { ...constraint, resolvedTarget: await cached };
    }),
  );
}

type PlaceProximityConstraint = ListingProximityConstraint & {
  target: { area?: string | null; name: string; type: "place" };
};

function isPlaceProximityConstraint(
  constraint: ListingProximityConstraint,
): constraint is PlaceProximityConstraint {
  return constraint.target.type === "place";
}

type MapboxGeocodeFeature = {
  center?: unknown;
  place_name?: string;
  text?: string;
};

type ResolvedPlaceTarget = {
  label: string;
  latitude: number;
  longitude: number;
};

async function resolvePlaceTarget(
  constraint: PlaceProximityConstraint,
): Promise<ResolvedPlaceTarget | null> {
  const query = [
    constraint.target.name,
    constraint.target.area,
    "San Francisco CA",
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(", ");

  const googleResolved = await resolveGooglePlaceTarget(query);
  if (googleResolved) {
    return googleResolved;
  }

  return resolveMapboxPlaceTarget(query);
}

async function resolveGooglePlaceTarget(
  query: string,
): Promise<ResolvedPlaceTarget | null> {
  const apiKey = firstConfiguredEnvValue(
    process.env.GOOGLE_PLACES_API_KEY,
    process.env.GOOGLE_MAPS_API_KEY,
    process.env.GCP_API_KEY,
  );
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        body: JSON.stringify({
          locationBias: {
            circle: {
              center: { latitude: 37.8006, longitude: -122.4096 },
              radius: 5000,
            },
          },
          maxResultCount: 1,
          textQuery: query,
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location",
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      places?: {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
      }[];
    };
    const place = data.places?.[0];
    const latitude = numberFromUnknown(place?.location?.latitude);
    const longitude = numberFromUnknown(place?.location?.longitude);
    if (latitude == null || longitude == null) {
      return null;
    }
    return {
      label:
        place?.displayName?.text ??
        place?.formattedAddress ??
        query,
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}

async function resolveMapboxPlaceTarget(
  query: string,
): Promise<ResolvedPlaceTarget | null> {
  const token = firstConfiguredEnvValue(
    process.env.MAPBOX_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  );
  if (!token) {
    return null;
  }

  try {
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set("access_token", token);
    url.searchParams.set("autocomplete", "false");
    url.searchParams.set("country", "us");
    url.searchParams.set("language", "en");
    url.searchParams.set("limit", "1");
    url.searchParams.set("proximity", "-122.4194,37.7749");
    url.searchParams.set("types", "poi,address");

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      features?: MapboxGeocodeFeature[];
    };
    const feature = data.features?.[0];
    const center = Array.isArray(feature?.center) ? feature.center : [];
    const longitude = numberFromUnknown(center[0]);
    const latitude = numberFromUnknown(center[1]);
    if (latitude == null || longitude == null) {
      return null;
    }

    return {
      label: feature?.place_name ?? feature?.text ?? query,
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
