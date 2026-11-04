import {
  confirmedMustHavesEvidence,
  neighborhoodInterestEvidence,
  unconfirmedMustHavesTradeoff,
} from "./fit-evidence";
import {
  canShowRoommateSplitForListing,
  householdSizeForRoommates,
  propertyMarkerRentForDisplay,
} from "./roommate-splits";
import { listingMatchesFeatureMustHave } from "./listing-query-features";
import { listingMatchesRequestedNeighborhoodPreference } from "./listing-request-context";
import { formatListingDisplayAddress } from "./listing-address";
import type {
  ApartmentListing,
  ApartmentSearchSnapshot,
} from "./types";
import type { ApartmentMatch } from "../matching/matches";
import { formatCurrency } from "../shared/currency";
import {
  apartmentFitBreakdown,
  apartmentFitScore,
  type FitBreakdown,
  type FitInputs,
} from "../matching/apartment-fit-core";

type ActiveApartmentProfile = ApartmentSearchSnapshot["activeProfile"];
type BudgetRange = { min: number | null; max: number | null };

export function apartmentListingSurfaceFitScore({
  listing,
  profile,
  roommatesOverride,
}: {
  listing: ApartmentListing;
  profile: ActiveApartmentProfile;
  roommatesOverride: number | null;
}): number {
  const displayRent = propertyMarkerRentForDisplay(listing, roommatesOverride);
  if (displayRent == null) {
    // No rent to score against — fall back to the persisted score (or 0).
    return persistedFitScorePassthrough(listing.fitScore);
  }
  const splitActive =
    roommatesOverride != null &&
    roommatesOverride >= 1 &&
    canShowRoommateSplitForListing(listing);
  return listingFitScore(listing, displayRent, profile, splitActive);
}

/**
 * Itemized version of apartmentListingSurfaceFitScore: returns the per-category
 * contributions behind the displayed fit score so the detail modal can explain
 * it. Always recomputes from the active profile (no persisted passthrough) so
 * the rows always sum to the returned `total` — that total is what the modal
 * shows on the fit pill.
 */
export function apartmentListingSurfaceFitBreakdown({
  listing,
  profile,
  roommatesOverride,
}: {
  listing: ApartmentListing;
  profile: ActiveApartmentProfile;
  roommatesOverride: number | null;
}): FitBreakdown | null {
  const displayRent = propertyMarkerRentForDisplay(listing, roommatesOverride);
  if (displayRent == null) {
    return null;
  }
  const splitActive =
    roommatesOverride != null &&
    roommatesOverride >= 1 &&
    canShowRoommateSplitForListing(listing);
  return apartmentFitBreakdown(
    surfaceFitInputs(listing, displayRent, profile, splitActive),
  );
}

export function apartmentMatchesFromSearchSnapshot(
  snapshot: ApartmentSearchSnapshot,
): ApartmentMatch[] | undefined {
  if (snapshot.source.status !== "connected") {
    return undefined;
  }

  const budget = budgetRangeFromProfile(snapshot.activeProfile);
  if (!isBudgetRangeActive(budget)) {
    return undefined;
  }

  const roommatesOverride = roommatesFromProfile(
    snapshot.activeProfile,
    maxRoommatesForListings(snapshot.listings),
  );

  return snapshot.listings
    .flatMap((listing) => {
      const displayRent = propertyMarkerRentForDisplay(listing, roommatesOverride);
      if (displayRent == null) return [];
      if (!rentMatchesBudget(displayRent, budget)) return [];
      if (!listingMatchesSavedCriteria(listing, snapshot.activeProfile)) return [];
      return [
        apartmentMatchFromListing({
          displayRent,
          listing,
          profile: snapshot.activeProfile,
          roommatesOverride,
        }),
      ];
    })
    .toSorted(compareApartmentMatches);
}

function apartmentMatchFromListing({
  displayRent,
  listing,
  profile,
  roommatesOverride,
}: {
  displayRent: number;
  listing: ApartmentListing;
  profile: ActiveApartmentProfile;
  roommatesOverride: number | null;
}): ApartmentMatch {
  const splitActive =
    roommatesOverride != null &&
    roommatesOverride >= 1 &&
    canShowRoommateSplitForListing(listing);
  const householdSize = householdSizeForRoommates(listing, roommatesOverride);
  const totalRent = propertyMarkerRentForDisplay(listing);
  const evidence = mergeEvidencePoints(
    listing.evidence,
    budgetEvidenceForListing({
      displayRent,
      householdSize,
      listing,
      profile,
      splitActive,
    }),
    petEvidenceForListing(listing, profile.pets),
    mustHaveEvidenceForListing(listing, profile.mustHaves),
  );
  const tradeoffs = mergeEvidencePoints(
    listing.tradeoffs.length > 0
      ? listing.tradeoffs
      : [{ label: "Availability", detail: "Confirm live pricing and fees before applying." }],
    petTradeoffsForListing(listing, profile.pets),
    mustHaveTradeoffsForListing(listing, profile.mustHaves),
    moveInTradeoffsForListing(listing, profile.moveInEnd),
  );

  return {
    id: listing.id,
    title: listingTitle(listing),
    subtitle: listing.neighborhood,
    fitScore: listingFitScore(listing, displayRent, profile, splitActive),
    monthlyRent: displayRent,
    perPersonRent: splitActive ? displayRent : listing.effectivePerPersonRent,
    rentCaption: splitActive
      ? `${householdSize}-way split${totalRent ? ` from ${formatCurrency(totalRent)}/mo` : ""}`
      : unitAvailabilityCaption(listing),
    beds: listingBedLabel(listing),
    photoUrls: listing.photoUrls.length > 0
      ? listing.photoUrls
      : listing.photoUrl
        ? [listing.photoUrl]
        : [],
    sourceUrl: listing.sourceUrl,
    status: "suggested",
    evidence: evidence.slice(0, 4),
    tradeoffs: tradeoffs.slice(0, 4),
    nextAction: "Review the listing",
  };
}

function listingTitle(listing: ApartmentListing) {
  return (
    formatListingDisplayAddress(listing.address, listing.unit) ??
    listing.address.trim()
  );
}

function budgetEvidenceForListing({
  displayRent,
  householdSize,
  listing,
  profile,
  splitActive,
}: {
  displayRent: number;
  householdSize: number;
  listing: ApartmentListing;
  profile: ActiveApartmentProfile;
  splitActive: boolean;
}): ApartmentMatch["evidence"] {
  const evidence: ApartmentMatch["evidence"] = [
    {
      label: "Budget",
      detail:
        profile.budgetMax > 0
          ? `${formatCurrency(displayRent)}/mo fits your ${formatCurrency(profile.budgetMax)} cap.`
          : `${formatCurrency(displayRent)}/mo is inside your saved range.`,
    },
  ];

  if (splitActive) {
    evidence.push({
      label: "Roommate split",
      detail: `${householdSize} people brings this listing to ${formatCurrency(displayRent)}/person.`,
    });
  }

  if (listing.availableUnitCount > 0) {
    evidence.push({
      label: "Unit pricing",
      detail: `${listing.availableUnitCount} available ${pluralize("unit", listing.availableUnitCount)} considered for display pricing.`,
    });
  }

  if (profile.neighborhoods.some((name) => sameNeighborhood(name, listing.neighborhood))) {
    evidence.push(neighborhoodInterestEvidence(listing.neighborhood));
  }

  return evidence.slice(0, 4);
}

function listingMatchesSavedCriteria(
  listing: ApartmentListing,
  profile: ActiveApartmentProfile,
) {
  if (!listingMatchesSavedNeighborhoods(listing, profile.neighborhoods)) {
    return false;
  }
  if (listingMatchesExcludedNeighborhood(listing, profile.dealbreakers)) {
    return false;
  }
  if (listingExplicitlyConflictsWithPets(listing, profile.pets)) {
    return false;
  }
  return true;
}

function listingMatchesSavedNeighborhoods(
  listing: ApartmentListing,
  neighborhoods: string[],
) {
  const saved = compactStrings(neighborhoods);
  if (saved.length === 0) return true;
  return saved.some((neighborhood) => listingMatchesNeighborhood(listing, neighborhood));
}

function listingMatchesExcludedNeighborhood(
  listing: ApartmentListing,
  dealbreakers: string[],
) {
  return extractExcludedNeighborhoods(dealbreakers).some((neighborhood) =>
    listingMatchesNeighborhood(listing, neighborhood),
  );
}

function listingMatchesNeighborhood(listing: ApartmentListing, neighborhood: string) {
  return listingMatchesRequestedNeighborhoodPreference(listing, neighborhood);
}

function moveInTradeoffsForListing(listing: ApartmentListing, moveInEnd: string) {
  const availableAt = listing.availableAt;
  if (!isIsoDate(moveInEnd) || !isIsoDate(availableAt)) {
    return [];
  }
  if (availableAt <= moveInEnd) {
    return [];
  }
  return [
    {
      label: "Move-in",
      detail: "Availability is later than your saved move-in date, so treat timing as flexible.",
    },
  ];
}

function petEvidenceForListing(
  listing: ApartmentListing,
  pets: string,
): ApartmentMatch["evidence"] {
  if (!profileNeedsPetFriendly(pets) || !listingConfirmsPetsAllowed(listing)) {
    return [];
  }
  return [
    {
      label: "Pets",
      detail: "Listing mentions pet-friendly rules.",
    },
  ];
}

function petTradeoffsForListing(
  listing: ApartmentListing,
  pets: string,
): ApartmentMatch["tradeoffs"] {
  if (!profileNeedsPetFriendly(pets) || listingConfirmsPetsAllowed(listing)) {
    return [];
  }
  return [
    {
      label: "Pets",
      detail: "Pet policy is not confirmed in listing data.",
    },
  ];
}

function profileNeedsPetFriendly(pets: string) {
  const normalized = pets.toLowerCase();
  if (!/\b(?:pet|pets|dog|dogs|cat|cats)\b/.test(normalized)) {
    return false;
  }
  if (/\b(?:no|without|not)\s+(?:pet|pets|dog|dogs|cat|cats)\b/.test(normalized)) {
    return false;
  }
  return true;
}

function listingConfirmsPetsAllowed(listing: ApartmentListing) {
  return listingMatchesFeatureMustHave(listing, "pets allowed");
}

function listingExplicitlyConflictsWithPets(listing: ApartmentListing, pets: string) {
  if (!profileNeedsPetFriendly(pets)) return false;
  const text = listingPreferenceText(listing);
  return (
    /\bno\s+(?:pets?|dogs?|cats?)\b/i.test(text) ||
    /\b(?:pets?|dogs?|cats?)\s+(?:not\s+allowed|prohibited)\b/i.test(text) ||
    /\b(?:not\s+allowed|prohibited)\b.{0,24}\b(?:pets?|dogs?|cats?)\b/i.test(text)
  );
}

function extractExcludedNeighborhoods(dealbreakers: string[]) {
  return compactStrings(dealbreakers).flatMap((dealbreaker) => {
    const match = dealbreaker.match(/\b(?:avoid|not|no|exclude|skip)\s+(.+?)\s*$/i);
    return match?.[1] ? [match[1].trim()] : [];
  });
}

// Listings that already carry a persisted fit score pass it straight through.
// Intentionally clamps to [0,100], not the core scorer's [50,96] — by design.
function persistedFitScorePassthrough(fitScore: number): number {
  return clamp(Math.round(fitScore), 0, 100);
}

function listingFitScore(
  listing: ApartmentListing,
  displayRent: number,
  profile: ActiveApartmentProfile,
  splitActive: boolean,
) {
  if (listing.fitScore > 0) {
    return persistedFitScorePassthrough(listing.fitScore);
  }

  return apartmentFitScore(
    surfaceFitInputs(listing, displayRent, profile, splitActive),
  );
}

/**
 * Build the canonical FitInputs from the active profile + a display rent.
 * Shared by the surface scorer and the surface breakdown so the two can never
 * drift apart.
 *
 * 008: delegate to the canonical core.
 * Intentional changes from the old surface scorer:
 *   - Clamp widened from [50, 88] to [50, 96] (DB clamp via core).
 *   - Must-have caps widened: matched min(8, n*2) → min(12, n*4);
 *     unconfirmed min(8, n*2) → min(10, n*3).
 *   - Budget-bonus boundary: >= 400 → > 400 (one-point shift).
 * Surface-only additive terms (split +5, pet ±2, extraUnits +3) are
 * intentionally passed through and remain absent from the DB path.
 */
function surfaceFitInputs(
  listing: ApartmentListing,
  displayRent: number,
  profile: ActiveApartmentProfile,
  splitActive: boolean,
): FitInputs {
  const mustHaves = partitionMustHavesForListing(listing, profile.mustHaves);

  // Pet bonus: +2 when listing confirms pets allowed; -2 when pet owner but
  // listing does NOT confirm; 0 when no pet preference.
  let petBonus = 0;
  if (profileNeedsPetFriendly(profile.pets)) {
    petBonus = listingConfirmsPetsAllowed(listing) ? 2 : -2;
  }

  return {
    budgetMin: profile.budgetMin > 0 ? profile.budgetMin : null,
    budgetMax: profile.budgetMax > 0 ? profile.budgetMax : null,
    effectivePerPersonRent: displayRent,
    neighborhoodMatches: profile.neighborhoods.some((name) =>
      sameNeighborhood(name, listing.neighborhood),
    ),
    mustHavesMatched: mustHaves.matched.length,
    mustHavesUnconfirmed: mustHaves.unconfirmed.length,
    splitActive,
    petBonus,
    extraUnitsBonus: listing.availableUnitCount > 1 ? 3 : 0,
  };
}

function mustHaveEvidenceForListing(
  listing: ApartmentListing,
  mustHaves: string[],
): ApartmentMatch["evidence"] {
  const matched = partitionMustHavesForListing(listing, mustHaves).matched;
  if (matched.length === 0) return [];
  return [confirmedMustHavesEvidence(matched)];
}

function mustHaveTradeoffsForListing(
  listing: ApartmentListing,
  mustHaves: string[],
): ApartmentMatch["tradeoffs"] {
  const unconfirmed = partitionMustHavesForListing(listing, mustHaves).unconfirmed;
  if (unconfirmed.length === 0) return [];
  return [unconfirmedMustHavesTradeoff(unconfirmed)];
}

function partitionMustHavesForListing(
  listing: ApartmentListing,
  mustHaves: string[],
) {
  const matched: string[] = [];
  const unconfirmed: string[] = [];
  for (const mustHave of compactStrings(mustHaves)) {
    if (listingMatchesFeatureMustHave(listing, mustHave)) {
      matched.push(mustHave);
    } else {
      unconfirmed.push(mustHave);
    }
  }
  return { matched, unconfirmed };
}

function listingPreferenceText(listing: ApartmentListing) {
  return `${listing.amenities.join(" ")} ${listing.description ?? ""}`;
}

function mergeEvidencePoints(
  ...groups: ApartmentMatch["evidence"][]
): ApartmentMatch["evidence"] {
  const seen = new Set<string>();
  const merged: ApartmentMatch["evidence"] = [];
  for (const group of groups) {
    for (const point of group) {
      const key = `${point.label.trim().toLowerCase()}:${point.detail.trim().toLowerCase()}`;
      const labelKey = point.label.trim().toLowerCase();
      if (seen.has(key) || seen.has(labelKey)) continue;
      seen.add(key);
      seen.add(labelKey);
      merged.push(point);
    }
  }
  return merged;
}

function compareApartmentMatches(left: ApartmentMatch, right: ApartmentMatch) {
  const scoreDelta = right.fitScore - left.fitScore;
  if (scoreDelta !== 0) return scoreDelta;
  return (left.monthlyRent ?? Number.MAX_SAFE_INTEGER) -
    (right.monthlyRent ?? Number.MAX_SAFE_INTEGER);
}

function budgetRangeFromProfile(profile: ActiveApartmentProfile): BudgetRange {
  const min = positiveWholeNumber(profile.budgetMin);
  const max = positiveWholeNumber(profile.budgetMax);
  if (min != null && max != null && min > max) {
    return { min: max, max: min };
  }
  return { min, max };
}

function isBudgetRangeActive(range: BudgetRange) {
  return range.min != null || range.max != null;
}

function rentMatchesBudget(value: number | null, range: BudgetRange) {
  if (value == null) return false;
  if (range.min != null && value < range.min) return false;
  if (range.max != null && value > range.max) return false;
  return true;
}

function maxRoommatesForListings(listings: ApartmentListing[]) {
  return listings.reduce(
    (current, listing) => Math.max(current, listing.roommateSplitLimit),
    0,
  );
}

function roommatesFromProfile(profile: ActiveApartmentProfile, maxRoommates: number) {
  // householdSizeMax counts the whole household including the user, so the
  // number of roommates to split rent with is one fewer.
  const householdSize = positiveWholeNumber(profile.householdSizeMax);
  if (householdSize == null || maxRoommates <= 0) {
    return null;
  }
  const roommates = householdSize - 1;
  if (roommates < 1) {
    return null;
  }
  return Math.min(roommates, maxRoommates);
}

function positiveWholeNumber(value: number) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function listingBedLabel(listing: ApartmentListing) {
  const bedroomLabel =
    bedroomRangeLabel(listing.floorPlanBedroomMin, listing.floorPlanBedroomMax) ??
    bedroomLabelForCount(listing.bedrooms);
  return listing.bathrooms ? `${bedroomLabel} · ${listing.bathrooms} ba` : bedroomLabel;
}

function bedroomRangeLabel(min: number | null, max: number | null) {
  if (min == null && max == null) return null;
  const low = min ?? max;
  const high = max ?? min;
  if (low == null || high == null) return null;
  if (low === high) return bedroomLabelForCount(low);
  if (low === 0) return `Studio-${high} bd`;
  return `${low}-${high} bd`;
}

function bedroomLabelForCount(value: number | null) {
  if (value == null) return "Apartment";
  return value === 0 ? "Studio" : `${value} bd`;
}

function unitAvailabilityCaption(listing: ApartmentListing) {
  if (listing.availableUnitCount <= 0) return null;
  const range = rentRangeLabel(
    listing.unitEffectiveRentMin ?? listing.unitRentMin,
    listing.unitEffectiveRentMax ?? listing.unitRentMax,
  );
  return `${listing.availableUnitCount} ${pluralize("unit", listing.availableUnitCount)}${range ? ` · ${range}` : ""}`;
}

function rentRangeLabel(min: number | null, max: number | null) {
  if (min == null && max == null) return null;
  if (min != null && max != null && max > min) {
    return `${formatCurrency(min)}-${formatCurrency(max)}/mo`;
  }
  return `${formatCurrency(min ?? max ?? 0)}/mo`;
}

function sameNeighborhood(left: string, right: string) {
  return normalizeNeighborhood(left) === normalizeNeighborhood(right);
}

function normalizeNeighborhood(value: string) {
  return value.trim().toLowerCase();
}

function compactStrings(values: string[]) {
  return values.flatMap((value) => {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  });
}

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function pluralize(word: string, count: number) {
  return count === 1 ? word : `${word}s`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
