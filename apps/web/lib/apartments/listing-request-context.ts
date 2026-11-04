import { parsePoiSummary } from "./poi-summary";
import type { Json } from "@/lib/supabase/types";

export type ListingRequestContext = {
  avoidTerms: string[];
  bedroomsMax: number | null;
  bedroomsMin: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  excludedNeighborhoods: string[];
  // How many people will share the unit, when the conversation says so.
  // Overrides the saved matching-profile household size — without it, users
  // whose profile hasn't synced default to 1 and every splittable multi-bed
  // above their per-person budget silently disappears from search results.
  householdSize: number | null;
  mustHaves: string[];
  neighborhoods: string[];
  proximityConstraints: ListingProximityConstraint[];
  transitTargets: string[];
};

export type ListingProximityConstraint = {
  hardness: "dealbreaker" | "preference";
  kind: "proximity";
  polarity: "avoid" | "prefer";
  target:
    | { name: string; type: "transit" }
    | { area?: string | null; name: string; type: "place" };
  threshold: {
    label: string;
    maxMiles: number;
  };
};

export type ResolvedListingProximityConstraint = ListingProximityConstraint & {
  resolvedTarget?: {
    label: string;
    latitude: number;
    longitude: number;
  } | null;
};

export type SavedListingPreferences = {
  budgetMax?: number | null;
  budgetMin?: number | null;
  excludedNeighborhoods?: string[];
  mustHaves?: string[];
  neighborhoods?: string[];
};

export type SavedListingPreferenceMergeOptions = {
  includeSavedBudget?: boolean;
  includeSavedMustHaves?: boolean;
  includeSavedNeighborhoods?: boolean;
  mergeSavedNeighborhoods?: boolean;
};

export const emptyListingRequestContext: ListingRequestContext = {
  avoidTerms: [],
  bedroomsMax: null,
  bedroomsMin: null,
  budgetMin: null,
  budgetMax: null,
  excludedNeighborhoods: [],
  householdSize: null,
  mustHaves: [],
  neighborhoods: [],
  proximityConstraints: [],
  transitTargets: [],
};

export type ListingRequestPlanInput = {
  apartmentCriteria?: {
    avoidTerms?: string[] | null;
    bedroomsMax?: number | null;
    bedroomsMin?: number | null;
    budgetMax?: number | null;
    budgetMin?: number | null;
    desiredTerms?: string[] | null;
    excludedNeighborhoods?: string[] | null;
    neighborhoods?: string[] | null;
    proximityConstraints?: ListingProximityConstraint[] | null;
    transitTargets?: string[] | null;
  } | null;
  primaryDomain?: string | null;
};

export type ListingTransitMatchInput = {
  amenities?: string[] | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  poi_summary?: Json | null;
};

export type ListingProximityMatchInput = ListingTransitMatchInput;

export type ListingProximityEvaluation = {
  evidence: string[];
  hardPass: boolean;
  preferredDistance: number | null;
};

export function listingRequestContextFromTypedPlan(
  plan: ListingRequestPlanInput | null | undefined,
): ListingRequestContext {
  if (!plan || plan.primaryDomain !== "apartment") {
    return { ...emptyListingRequestContext };
  }

  const criteria = plan.apartmentCriteria ?? {};
  return {
    avoidTerms: dedupeTextValues(criteria.avoidTerms ?? []),
    bedroomsMax: criteria.bedroomsMax ?? null,
    bedroomsMin: criteria.bedroomsMin ?? null,
    budgetMax: criteria.budgetMax ?? null,
    budgetMin: criteria.budgetMin ?? null,
    excludedNeighborhoods: dedupeTextValues(criteria.excludedNeighborhoods ?? []),
    householdSize: null,
    mustHaves: dedupeTextValues(criteria.desiredTerms ?? []),
    neighborhoods: dedupeTextValues(criteria.neighborhoods ?? []),
    proximityConstraints: dedupeProximityConstraints(
      criteria.proximityConstraints ?? [],
    ),
    transitTargets: dedupeTextValues(criteria.transitTargets ?? []),
  };
}

export function mergeListingRequestContextWithSavedPreferences(
  requestContext: ListingRequestContext,
  savedPreferences: SavedListingPreferences,
  {
    includeSavedBudget = true,
    includeSavedMustHaves = true,
    includeSavedNeighborhoods = true,
    mergeSavedNeighborhoods = false,
  }: SavedListingPreferenceMergeOptions = {},
): ListingRequestContext {
  const requestNeighborhoods = dedupeTextValues(requestContext.neighborhoods);
  const savedNeighborhoods = includeSavedNeighborhoods
    ? dedupeTextValues(savedPreferences.neighborhoods ?? [])
    : [];

  return {
    ...requestContext,
    avoidTerms: dedupeTextValues(requestContext.avoidTerms),
    budgetMax:
      requestContext.budgetMax ??
      (includeSavedBudget ? (savedPreferences.budgetMax ?? null) : null),
    budgetMin:
      requestContext.budgetMin ??
      (includeSavedBudget ? (savedPreferences.budgetMin ?? null) : null),
    excludedNeighborhoods: dedupeTextValues([
      ...requestContext.excludedNeighborhoods,
      ...(savedPreferences.excludedNeighborhoods ?? []),
    ]),
    mustHaves: dedupeTextValues([
      ...(includeSavedMustHaves ? (savedPreferences.mustHaves ?? []) : []),
      ...requestContext.mustHaves,
    ]),
    neighborhoods:
      requestNeighborhoods.length > 0
        ? mergeSavedNeighborhoods
          ? dedupeTextValues([...savedNeighborhoods, ...requestNeighborhoods])
          : requestNeighborhoods
        : includeSavedNeighborhoods
          ? savedNeighborhoods
          : [],
    proximityConstraints: dedupeProximityConstraints(
      requestContext.proximityConstraints,
    ),
    transitTargets: dedupeTextValues(requestContext.transitTargets),
  };
}

export function matchesRequestedBedrooms(
  bedrooms: number | null,
  context: Pick<ListingRequestContext, "bedroomsMax" | "bedroomsMin">,
) {
  if (bedrooms == null) {
    return context.bedroomsMax == null && context.bedroomsMin == null;
  }

  if (context.bedroomsMin != null && bedrooms < context.bedroomsMin) {
    return false;
  }

  if (context.bedroomsMax != null && bedrooms > context.bedroomsMax) {
    return false;
  }

  return true;
}

export function matchesRequestedBudget(
  rent: number | null,
  context: Pick<ListingRequestContext, "budgetMax" | "budgetMin">,
) {
  if (rent == null) {
    return context.budgetMax == null && context.budgetMin == null;
  }

  if (context.budgetMin != null && rent < context.budgetMin) {
    return false;
  }

  if (context.budgetMax != null && rent > context.budgetMax) {
    return false;
  }

  return true;
}

export function matchesRequestedNeighborhood(
  listingNeighborhood: string | null | undefined,
  requestedNeighborhood: string,
) {
  const listing = normalizeNeighborhoodToken(listingNeighborhood ?? "");
  const requested = normalizeNeighborhoodToken(requestedNeighborhood);

  if (!listing || !requested) {
    return false;
  }

  if (listing === requested) {
    return true;
  }

  if (requested === "richmond" || requested === "sunset") {
    return listing.endsWith(` ${requested}`);
  }

  if (requested === "mission") {
    return listing === "mission district" || listing === "mission dolores";
  }

  return false;
}

const neighborhoodDirectionalQualifiers = new Set([
  "lower",
  "upper",
  "inner",
  "outer",
  "west",
  "east",
  "north",
  "south",
  "little",
  "greater",
  "old",
  "new",
  "mid",
]);

export function listingMatchesRequestedNeighborhoodPreference(
  listing: {
    city?: string | null;
    description?: string | null;
    neighborhood?: string | null;
  },
  requestedNeighborhood: string,
) {
  const neighborhood = listing.neighborhood?.trim() ?? "";
  const city = listing.city?.trim() ?? "";

  if (matchesRequestedNeighborhood(neighborhood || null, requestedNeighborhood)) {
    return true;
  }

  if (
    neighborhood &&
    city &&
    normalizeNeighborhoodToken(neighborhood) !== normalizeNeighborhoodToken(city)
  ) {
    return false;
  }

  return textMentionsRequestedNeighborhood(listing.description, requestedNeighborhood);
}

function textMentionsRequestedNeighborhood(
  text: string | null | undefined,
  requestedNeighborhood: string,
) {
  if (!text?.trim()) {
    return false;
  }

  if (matchesRequestedNeighborhood(text, requestedNeighborhood)) {
    return true;
  }

  const words = normalizeNeighborhoodToken(text).split(/\s+/).filter(Boolean);
  const requestedWords = normalizeNeighborhoodToken(requestedNeighborhood)
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || requestedWords.length === 0) {
    return false;
  }

  for (let index = 0; index <= words.length - requestedWords.length; index += 1) {
    const candidate = words.slice(index, index + requestedWords.length).join(" ");
    if (!matchesRequestedNeighborhood(candidate, requestedNeighborhood)) {
      continue;
    }

    const prefix = words[index - 1];
    if (prefix && neighborhoodDirectionalQualifiers.has(prefix)) {
      continue;
    }

    return true;
  }

  return false;
}

export function matchesRequestedTransitTargets(
  listing: ListingTransitMatchInput,
  transitTargets: string[],
) {
  if (transitTargets.length === 0) {
    return true;
  }

  if (bestRequestedTransitMatch(listing, transitTargets)) {
    return true;
  }

  const text = normalizeTransitText(
    `${(listing.amenities ?? []).join(" ")} ${listing.description ?? ""}`,
  );
  if (!text) {
    return false;
  }

  return transitTargets.some((target) => {
    const normalizedTarget = normalizeTransitText(target);
    if (!normalizedTarget) return false;
    if (normalizedTarget === "muni") {
      return /\b(?:muni|transit|train|bus|streetcar|light rail|metro|station)\b/.test(
        text,
      );
    }
    return text.includes(normalizedTarget);
  });
}

export function bestRequestedTransitPoi(
  rawPoiSummary: Json | null | undefined,
  transitTargets: string[],
  maxMiles = requestedTransitTargetMaxMiles,
) {
  const poiSummary = parsePoiSummary(rawPoiSummary);
  const rows = poiSummary?.transit ?? [];
  if (rows.length === 0) {
    return null;
  }

  const targets = transitTargets.flatMap((target) => {
    const normalized = normalizeTransitText(target);
    return normalized ? [normalized] : [];
  });
  if (targets.length === 0) {
    return nearestTransitPoi(rows);
  }

  const candidates = rows.filter((row) =>
    targets.some((target) => transitPoiMatchesTarget(row.name, target)) &&
    isWithinRequestedTransitTargetDistance(row.distance, maxMiles),
  );

  return nearestTransitPoi(candidates);
}

export function bestRequestedTransitMatch(
  listing: ListingTransitMatchInput,
  transitTargets: string[],
  maxMiles = requestedTransitTargetMaxMiles,
) {
  const poi = bestRequestedTransitPoi(
    listing.poi_summary,
    transitTargets,
    maxMiles,
  );
  const coordinateMatch = bestRequestedTransitCoordinateMatch(
    listing,
    transitTargets,
    maxMiles,
  );

  if (!poi) return coordinateMatch;
  if (!coordinateMatch) return poi;
  return coordinateMatch.distance < poi.distance ? coordinateMatch : poi;
}

export function evaluateListingProximityConstraints(
  listing: ListingProximityMatchInput,
  constraints: ResolvedListingProximityConstraint[],
): ListingProximityEvaluation {
  if (constraints.length === 0) {
    return { evidence: [], hardPass: true, preferredDistance: null };
  }

  const evidence: string[] = [];
  let hardPass = true;
  let preferredDistance: number | null = null;

  for (const constraint of constraints) {
    const match = matchListingProximityConstraint(listing, constraint);
    const label = listingProximityConstraintLabel(constraint);
    const maxMiles = proximityConstraintMaxMiles(constraint);

    if (constraint.polarity === "avoid") {
      if (match.withinThreshold) {
        if (constraint.hardness === "dealbreaker") {
          hardPass = false;
        }
        evidence.push(
          match.distance != null
            ? `Tradeoff: ${label} is ${formatDistanceMiles(match.distance)} away.`
            : `Tradeoff: listing mentions ${label} access.`,
        );
      } else if (constraint.hardness === "dealbreaker") {
        evidence.push(
          `Avoids ${label}: no nearby match within ${formatDistanceMiles(maxMiles)}.`,
        );
      }
      continue;
    }

    if (match.distance != null) {
      preferredDistance =
        preferredDistance == null
          ? match.distance
          : Math.min(preferredDistance, match.distance);
      evidence.push(`${label}: ${formatWalkFromDistanceMiles(match.distance)} away.`);
    } else if (match.withinThreshold) {
      evidence.push(`Mentions ${label} access.`);
    }

    if (constraint.hardness === "dealbreaker" && !match.withinThreshold) {
      hardPass = false;
    }
  }

  return { evidence, hardPass, preferredDistance };
}

export function matchesListingProximityConstraints(
  listing: ListingProximityMatchInput,
  constraints: ResolvedListingProximityConstraint[],
) {
  return evaluateListingProximityConstraints(listing, constraints).hardPass;
}

function listingProximityConstraintLabel(
  constraint: Pick<ListingProximityConstraint, "target">,
) {
  if (constraint.target.type === "transit") {
    return formatTransitTargetLabel(constraint.target.name);
  }
  return constraint.target.name.trim();
}

function nearestTransitPoi(points: { distance: number; name: string }[]) {
  return points.reduce<{ distance: number; name: string } | null>((nearest, point) => {
    if (nearest === null) return point;
    if (!Number.isFinite(point.distance)) return nearest;
    if (!Number.isFinite(nearest.distance)) return point;
    return point.distance < nearest.distance ? point : nearest;
  }, null);
}

function transitPoiMatchesTarget(name: string, target: string) {
  const normalizedName = normalizeTransitText(name);
  if (!normalizedName || !target) {
    return false;
  }

  if (normalizedName.includes(target)) {
    return true;
  }

  if (target === "bart") {
    return bartStationSignals.some((station) =>
      normalizedName.includes(station),
    );
  }

  if (target === "caltrain") {
    return caltrainStationSignals.some((station) =>
      normalizedName.includes(station),
    );
  }

  if (target === "muni") {
    return (
      !/\b(?:bart|caltrain)\b/.test(normalizedName) ||
      /\b(?:muni|metro|streetcar|light rail)\b/.test(normalizedName)
    );
  }

  return false;
}

function dedupeTextValues(values: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const cleaned = value.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    deduped.push(cleaned);
  }

  return deduped;
}

function normalizeNeighborhoodToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^the\s+/, "");
}

function normalizeTransitText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchListingProximityConstraint(
  listing: ListingProximityMatchInput,
  constraint: ResolvedListingProximityConstraint,
) {
  const maxMiles = proximityConstraintMaxMiles(constraint);

  if (constraint.target.type === "transit") {
    const transitMatch = bestRequestedTransitMatch(
      listing,
      [constraint.target.name],
      maxMiles,
    );
    if (transitMatch) {
      return {
        distance: transitMatch.distance,
        withinThreshold: true,
      };
    }

    return {
      distance: null,
      withinThreshold: matchesRequestedTransitTargets(listing, [
        constraint.target.name,
      ]),
    };
  }

  const target = constraint.resolvedTarget;
  const listingLat = finiteNumberOrNull(listing.latitude);
  const listingLng = finiteNumberOrNull(listing.longitude);
  if (!target || listingLat == null || listingLng == null) {
    return { distance: null, withinThreshold: false };
  }

  const distance = roundMiles(
    haversineDistanceMiles(
      listingLat,
      listingLng,
      target.latitude,
      target.longitude,
    ),
  );
  return {
    distance,
    withinThreshold: distance <= maxMiles,
  };
}

function proximityConstraintMaxMiles(constraint: ListingProximityConstraint) {
  const maxMiles = finiteNumberOrNull(constraint.threshold.maxMiles);
  if (maxMiles != null && maxMiles > 0) {
    return maxMiles;
  }
  return constraint.target.type === "transit"
    ? requestedTransitTargetMaxMiles
    : requestedPlaceTargetMaxMiles;
}

function isWithinRequestedTransitTargetDistance(
  distance: number,
  maxMiles = requestedTransitTargetMaxMiles,
) {
  return Number.isFinite(distance) && distance <= maxMiles;
}

const requestedTransitTargetMaxMiles = 0.6;
const requestedPlaceTargetMaxMiles = 0.6;

const knownTransitStops = [
  {
    latitude: 37.7573748,
    longitude: -122.3924312,
    name: "22nd Street Caltrain Station",
    target: "caltrain",
  },
  {
    latitude: 37.77667,
    longitude: -122.39484,
    name: "San Francisco Caltrain Station",
    target: "caltrain",
  },
] as const;

const bartStationSignals = [
  "16th street mission",
  "24th street mission",
  "balboa park",
  "civic center",
  "embarcadero",
  "glen park",
  "montgomery",
  "powell st",
  "powell street",
];

const caltrainStationSignals = [
  "22nd street caltrain station",
  "22nd street station",
  "22nd street",
  "san francisco station",
  "4th king",
  "4th and king",
  "4th street and king street",
  "fourth street and king street",
  "king street and 4th street",
  "king street and fourth street",
];

function formatTransitTargetLabel(value: string) {
  const normalized = normalizeTransitText(value);
  if (normalized === "bart") return "BART";
  if (normalized === "muni") return "Muni";
  if (normalized === "caltrain") return "Caltrain";
  return value.trim();
}

function formatDistanceMiles(value: number) {
  const rounded = roundMiles(value);
  return `${rounded.toLocaleString(undefined, {
    maximumFractionDigits: rounded < 1 ? 2 : 1,
    minimumFractionDigits: rounded < 1 ? 1 : 0,
  })} mi`;
}

// Conversational walk-time estimate from straight-line miles (~3 mph). The mile
// figure stays in parentheses so the claim remains grounded; this is a rough
// "X-min walk" framing, not a routed walking time.
function formatWalkFromDistanceMiles(value: number) {
  const minutes = Math.max(1, Math.round(value * 20));
  return `about a ${minutes}-min walk (${formatDistanceMiles(value)})`;
}

function roundMiles(value: number) {
  return Number(value.toFixed(2));
}

function bestRequestedTransitCoordinateMatch(
  listing: ListingTransitMatchInput,
  transitTargets: string[],
  maxMiles = requestedTransitTargetMaxMiles,
) {
  const listingLat = finiteNumberOrNull(listing.latitude);
  const listingLng = finiteNumberOrNull(listing.longitude);
  if (listingLat == null || listingLng == null) {
    return null;
  }

  const targets = transitTargets.flatMap((target) => {
    const normalized = normalizeTransitText(target);
    return normalized ? [normalized] : [];
  });
  if (targets.length === 0) {
    return null;
  }

  const candidates = knownTransitStops
    .filter((stop) =>
      targets.some((target) => transitPoiMatchesTarget(stop.name, target)),
    )
    .flatMap((stop) => {
      const distance = roundMiles(
        haversineDistanceMiles(
          listingLat,
          listingLng,
          stop.latitude,
          stop.longitude,
        ),
      );
      return isWithinRequestedTransitTargetDistance(distance, maxMiles)
        ? [{ distance, name: stop.name }]
        : [];
    });

  return nearestTransitPoi(candidates);
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const radiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function dedupeProximityConstraints(values: ListingProximityConstraint[]) {
  const seen = new Set<string>();
  const deduped: ListingProximityConstraint[] = [];

  for (const value of values) {
    if (!value || value.kind !== "proximity") continue;
    const targetName = value.target.name.trim();
    if (!targetName) continue;
    const normalizedName = normalizeTransitText(targetName);
    const area =
      value.target.type === "place"
        ? normalizeNeighborhoodToken(value.target.area ?? "")
        : "";
    const key = [
      value.polarity,
      value.hardness,
      value.target.type,
      normalizedName,
      area,
      proximityConstraintMaxMiles(value),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...value,
      target:
        value.target.type === "place"
          ? { ...value.target, name: targetName }
          : { ...value.target, name: targetName },
      threshold: {
        label: value.threshold.label.trim() || "near",
        maxMiles: proximityConstraintMaxMiles(value),
      },
    });
  }

  return deduped;
}
