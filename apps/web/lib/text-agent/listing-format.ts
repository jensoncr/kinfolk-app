import "server-only";
import { parsePoiSummary } from "@/lib/apartments/poi-summary";
import { buildListingShortlinkUrl } from "@/lib/apartments/listing-shortlink";
import { formatListingBeds, formatListingRent } from "@/lib/apartments/listing-card";
import { findListingFeatureDefinition, listingMatchesFeatureMustHave } from "@/lib/apartments/listing-query-features";
import {
  bestRequestedTransitPoi,
  listingMatchesRequestedNeighborhoodPreference,
  matchesRequestedNeighborhood,
  matchesRequestedTransitTargets,
} from "@/lib/apartments/listing-request-context";
import { formatNaturalList } from "@/lib/text-agent/fact-utils";
import { escapeRegExp } from "@/lib/shared/regex";
import { formatCurrency } from "@/lib/text-agent/store-shared";
import type { ListingCardSnapshot } from "@/lib/apartments/listing-card";
import type { ListingRequestContext } from "@/lib/apartments/listing-request-context";
import type { ListingFeatureFit, ListingRecommendationCandidate } from "@/lib/text-agent/store-types";
import type { Json } from "@/lib/supabase/types";

function normalizeListingPreferenceValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isExcludedListingNeighborhood(
  neighborhood: string | null | undefined,
  context: Pick<ListingRequestContext, "excludedNeighborhoods">,
) {
  return context.excludedNeighborhoods.some((excluded) =>
    matchesRequestedNeighborhood(neighborhood, excluded),
  );
}

export function compareListingRecommendationCandidates(
  left: ListingRecommendationCandidate,
  right: ListingRecommendationCandidate,
  context: Pick<ListingRequestContext, "proximityConstraints" | "transitTargets">,
) {
  const hasPreferredProximity = context.proximityConstraints.some(
    (constraint) => constraint.polarity === "prefer",
  );
  if (hasPreferredProximity) {
    const leftDistance = left.proximityDistance ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.proximityDistance ?? Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
  }

  if (context.transitTargets.length > 0) {
    const leftDistance = left.transitDistance ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.transitDistance ?? Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
  }

  return right.card.fitScore - left.card.fitScore;
}

export function scoreRequestedTransitDistance(distance: number | null) {
  if (distance == null || !Number.isFinite(distance)) {
    return -4;
  }
  if (distance <= 0.15) return 16;
  if (distance <= 0.35) return 11;
  if (distance <= 0.6) return 6;
  if (distance <= 1) return 2;
  return -3;
}

export function listingBudgetRentForRecommendation(
  listing: { effective_monthly_rent: number | null; monthly_rent: number | null },
  match: {
    effective_per_person_rent?: number | null;
    per_person_rent?: number | null;
  },
) {
  return (
    readPositiveListingNumber(match.effective_per_person_rent) ??
    readPositiveListingNumber(match.per_person_rent) ??
    listing.effective_monthly_rent ??
    listing.monthly_rent
  );
}

export function readPositiveListingNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function readRecommendedHouseholdSize(value: {
  recommended_household_size?: number | null;
}) {
  const householdSize = value.recommended_household_size;
  return typeof householdSize === "number" &&
    Number.isFinite(householdSize) &&
    householdSize > 0
    ? Math.round(householdSize)
    : null;
}

export function listingMatchesRequestedArea(
  listing: {
    city?: string | null;
    description?: string | null;
    neighborhood?: string | null;
  },
  requestedNeighborhood: string,
) {
  return listingMatchesRequestedNeighborhoodPreference(listing, requestedNeighborhood);
}

export function matchesRequestedMustHaves(
  listing: {
    amenities?: string[] | null;
    description?: string | null;
    poi_summary?: Json | null;
  },
  requestedMustHaves: string[],
) {
  return requestedMustHaves.every((mustHave) =>
    listingMatchesMustHave(listing, mustHave),
  );
}

export function listingMatchesAvoidTerms(
  listing: {
    amenities?: string[] | null;
    description?: string | null;
  },
  avoidTerms: string[],
) {
  if (avoidTerms.length === 0) {
    return false;
  }

  const text = normalizeListingPreferenceValue(
    `${(listing.amenities ?? []).join(" ")} ${listing.description ?? ""}`,
  );
  if (!text) {
    return false;
  }

  return avoidTerms.some((term) => {
    const normalizedTerm = normalizeListingPreferenceValue(term);
    if (!normalizedTerm) return false;
    if (normalizedTerm.includes(" ")) {
      return text.includes(normalizedTerm);
    }
    return new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`, "i").test(text);
  });
}

export function scoreListingFeatureFit(
  listing: {
    amenities?: string[] | null;
    description?: string | null;
    poi_summary?: Json | null;
  },
  requestedMustHaves: string[],
): ListingFeatureFit {
  if (requestedMustHaves.length === 0) {
    return { matched: [], missing: [], score: 0, strict: true };
  }

  const matched = requestedMustHaves.filter((mustHave) =>
    listingMatchesMustHave(listing, mustHave),
  );
  const missing = requestedMustHaves.filter(
    (mustHave) => !matched.includes(mustHave),
  );
  const strict = missing.length === 0;
  const score = strict
    ? Math.min(22, 10 + matched.length * 5)
    : Math.max(
        -8,
        Math.round((matched.length / requestedMustHaves.length) * 14) -
          missing.length * 3,
      );

  return { matched, missing, score, strict };
}

function listingMatchesMustHave(
  listing: {
    amenities?: string[] | null;
    description?: string | null;
    poi_summary?: Json | null;
  },
  mustHave: string,
) {
  return listingMatchesFeatureMustHave(listing, mustHave);
}

export function formatListingMustHaveEvidence(
  listing: {
    amenities?: string[] | null;
    description?: string | null;
    poi_summary?: Json | null;
  },
  requestedMustHaves: string[],
) {
  return requestedMustHaves
    .map((mustHave) =>
      listingMatchesMustHave(listing, mustHave)
        ? findListingFeatureDefinition(mustHave)?.evidence
        : null,
    )
    .filter((value): value is string => Boolean(value));
}

export function formatListingTransitTargetEvidence(
  listing: {
    amenities?: string[] | null;
    description?: string | null;
    poi_summary?: Json | null;
  },
  transitTargets: string[],
  transitPoi = bestRequestedTransitPoi(listing.poi_summary, transitTargets),
) {
  if (transitTargets.length === 0) {
    return [];
  }

  const targetLabel = transitTargets.map(formatTransitTargetLabel).join("/");
  if (transitPoi) {
    return [
      `Closest ${targetLabel}: ${formatPoiNameAndDistance(transitPoi)}.`,
    ];
  }

  return matchesRequestedTransitTargets(listing, transitTargets)
    ? [`Mentions requested ${targetLabel} access.`]
    : [];
}

function formatTransitTargetLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bart") return "BART";
  if (normalized === "muni") return "Muni";
  if (normalized === "caltrain") return "Caltrain";
  return value.trim();
}

export function formatMissingListingMustHaveEvidence(fit: ListingFeatureFit) {
  if (fit.strict || fit.missing.length === 0) {
    return [];
  }

  return [`Tradeoff: no clear ${formatNaturalList(fit.missing)} evidence.`];
}

export function readRecommendationEvidence(value: Json): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const detail = typeof entry.detail === "string" ? entry.detail.trim() : "";
      const label = typeof entry.label === "string" ? entry.label.trim() : "";
      return detail || label ? [detail || label] : [];
    })
    .slice(0, 2);
}

export function buildListingCardEvidence({
  baseEvidence,
  listing,
}: {
  baseEvidence: string[];
  listing: {
    effective_monthly_rent: number | null;
    monthly_rent: number | null;
    poi_summary?: Json | null;
  };
}) {
  const evidence = [
    ...baseEvidence,
    ...formatListingPricingEvidence(listing),
    ...formatListingPoiEvidence(listing.poi_summary),
  ];
  const seen = new Set<string>();

  return evidence
    .reduce<string[]>((items, rawItem) => {
      const item = rawItem.trim();
      const key = item.toLowerCase();
      if (!item || seen.has(key) || items.length >= 4) {
        return items;
      }
      seen.add(key);
      items.push(item);
      return items;
    }, []);
}

function formatListingPricingEvidence(listing: {
  effective_monthly_rent: number | null;
  monthly_rent: number | null;
}) {
  const effectiveRent = listing.effective_monthly_rent;
  const monthlyRent = listing.monthly_rent;

  if (
    effectiveRent != null &&
    monthlyRent != null &&
    Math.round(effectiveRent) < Math.round(monthlyRent)
  ) {
    return [
      `Effective rent shown; listed rent ${formatCurrency(monthlyRent)}/mo.`,
    ];
  }

  if (monthlyRent != null || effectiveRent != null) {
    return ["Ask for mandatory fees before applying."];
  }

  return [];
}

function formatListingPoiEvidence(rawPoiSummary: Json | null | undefined) {
  const poiSummary = parsePoiSummary(rawPoiSummary);
  if (!poiSummary) {
    return [];
  }

  const evidence: string[] = [];
  const transit = nearestPoi(poiSummary.transit);
  const grocery = nearestPoi(poiSummary.grocery);
  const park = nearestPoi(poiSummary.parks);

  if (transit) {
    evidence.push(`Transit nearby: ${formatPoiNameAndDistance(transit)}.`);
  }

  if (grocery) {
    evidence.push(`Grocery nearby: ${formatPoiNameAndDistance(grocery)}.`);
  } else if (park) {
    evidence.push(`Park nearby: ${formatPoiNameAndDistance(park)}.`);
  }

  return evidence;
}

function nearestPoi(points: { distance: number; name: string }[]) {
  return points.reduce<{ distance: number; name: string } | undefined>((nearest, point) => {
    if (nearest === undefined) return point;
    if (!Number.isFinite(point.distance)) return nearest;
    if (!Number.isFinite(nearest.distance)) return point;
    return point.distance < nearest.distance ? point : nearest;
  }, undefined);
}

function formatPoiNameAndDistance(point: { distance: number; name: string }) {
  const name = point.name.trim();
  if (!Number.isFinite(point.distance) || point.distance <= 0) {
    return name;
  }

  const distance =
    point.distance < 0.1 ? "<0.1 mi" : `${point.distance.toFixed(1)} mi`;
  return `${name} (${distance})`;
}

// The tappable destination for a listing card: the listing pinned on the
// Kinfolk map. The cards themselves are images, so this link is the only way
// a listing in Messages becomes actionable. Prose carries the short /l/<code>
// form, which redirects to the full map URL.
export function buildListingDetailWebUrl(
  baseUrl: string | null | undefined,
  listingId: string | null | undefined,
) {
  return buildListingShortlinkUrl(baseUrl, listingId);
}

export function formatListingLikeFollowUpText(
  snapshot: ListingCardSnapshot | null,
  detailUrl?: string | null,
) {
  const link = detailUrl ?? snapshot?.sourceUrl ?? null;
  if (!snapshot) {
    return ["nice pick — saved it to your shortlist.", link]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  const detail = [
    snapshot.neighborhood,
    formatListingRent(snapshot),
    formatListingBeds(snapshot),
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    `nice pick — saved ${snapshot.address} to your shortlist.`,
    detail,
    link,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
