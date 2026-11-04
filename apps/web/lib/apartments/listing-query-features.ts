import { parsePoiSummary } from "./poi-summary";
import { matchesRequestedTransitTargets } from "./listing-request-context";
import type { Json } from "@/lib/supabase/types";

type ListingFeatureKey =
  | "air conditioning"
  | "classic SF architecture"
  | "dishwasher"
  | "elevator or accessible"
  | "fitness amenities"
  | "hardwood floors"
  | "in-unit laundry"
  | "natural light"
  | "near nightlife"
  | "near parks"
  | "near restaurants"
  | "near transit"
  | "outdoor space"
  | "parking"
  | "pets allowed"
  | "quiet building"
  | "renovated finishes"
  | "Victorian architecture"
  | "views"
  | "work-from-home friendly";

export type ListingFeaturePoiConstraint = {
  kind: "grocery" | "parks" | "restaurant" | "transit";
  maxMiles: number;
};

type ListingFeatureDefinition = {
  allowAreaAvailabilityFallback?: boolean;
  evidence: string;
  key: ListingFeatureKey;
  listingPattern: RegExp;
  poi?: ListingFeaturePoiConstraint;
  queryPattern: RegExp;
};

export type ListingFeatureMatchInput = {
  amenities?: string[] | null;
  description?: string | null;
  poi_summary?: Json | null;
};

const listingFeatureDefinitions: ListingFeatureDefinition[] = [
  {
    evidence: "Mentions in-unit laundry or washer/dryer.",
    key: "in-unit laundry",
    listingPattern:
      /\b(?:in[- ]?unit laundry|laundry in (?:the )?unit|washer(?:\/| and )dryer|washer dryer|w\/d|washer\/dryer combo)\b/i,
    queryPattern:
      /\b(?:in[- ]?unit laundry|laundry in (?:the )?unit|washer(?:\/| and )dryer|washer dryer|w\/d(?:\s+in(?:\s+the)?\s+unit)?)\b/i,
  },
  {
    evidence: "Mentions a dishwasher.",
    key: "dishwasher",
    listingPattern: /\bdishwasher\b/i,
    queryPattern: /\bdishwasher\b/i,
  },
  {
    evidence: "Mentions parking or a garage.",
    key: "parking",
    listingPattern: /\b(?:parking|garage)\b/i,
    queryPattern: /\b(?:parking|garage)\b/i,
  },
  {
    evidence: "Mentions pet-friendly rules.",
    key: "pets allowed",
    listingPattern:
      /\b(?:pets welcome|pets allowed|pet friendly|dogs? ok|cats? ok)\b/i,
    queryPattern:
      /\b(?:pet friendly|pets allowed|allows pets|dogs? ok|cats? ok)\b/i,
  },
  {
    evidence: "Mentions Victorian architecture.",
    key: "Victorian architecture",
    listingPattern: /\bvictorians?\b/i,
    queryPattern: /\bvictorians?\b/i,
  },
  {
    evidence:
      "Mentions Victorian, Edwardian, historic, vintage, or period-detail architecture.",
    key: "classic SF architecture",
    listingPattern:
      /\b(?:victorians?|edwardians?|historic(?:al)?(?:\s+(?:building|home|architecture))?|vintage(?:\s+(?:building|home|architecture|charm))?|old charm|period details?|original (?:woodwork|mou?lding)|pre[- ]?war|turn[- ]of[- ]the[- ]century)\b/i,
    queryPattern:
      /\b(?:edwardians?|historic|vintage|classic(?:\s+sf|\s+san francisco)?|old charm|sf charm|san francisco charm|period details?|not a tower|not a high[- ]?rise)\b/i,
  },
  {
    evidence: "Mentions hardwood or wood floors.",
    key: "hardwood floors",
    listingPattern:
      /\b(?:hardwood (?:floors?|flooring)|wood floors?|oak floors?|parquet)\b/i,
    queryPattern:
      /\b(?:hardwood(?:\s+(?:floors?|flooring))?|wood floors?|oak floors?|parquet)\b/i,
  },
  {
    evidence: "Mentions renovated or updated finishes.",
    key: "renovated finishes",
    listingPattern:
      /\b(?:renovated|remodeled|newly updated|recently updated|updated finishes|modern finishes|stainless steel appliances?|new appliances?)\b/i,
    queryPattern:
      /\b(?:renovated|remodeled|newly updated|recently updated|updated finishes|modern finishes|stainless steel appliances?|new appliances?)\b/i,
  },
  {
    evidence: "Mentions private or shared outdoor space.",
    key: "outdoor space",
    listingPattern:
      /\b(?:outdoor space|balcony|patio|deck|yard|garden|roof deck|rooftop|terrace)\b/i,
    queryPattern:
      /\b(?:outdoor space|balcony|patio|deck|yard|garden|roof deck|rooftop|terrace)\b/i,
  },
  {
    evidence: "Mentions notable views.",
    key: "views",
    listingPattern:
      /\b(?:(?:city|bay|ocean|water|park|panoramic|skyline)\s+views?|views?\s+of|panoramic|skyline)\b/i,
    queryPattern:
      /\b(?:views?|city view|bay view|ocean view|water view|park view|panoramic|skyline)\b/i,
  },
  {
    evidence: "Mentions air conditioning.",
    key: "air conditioning",
    listingPattern:
      /\b(?:air conditioning|central air|a\/c|\bac\b|climate control)\b/i,
    queryPattern:
      /\b(?:air conditioning|central air|a\/c|\bac\b|climate control)\b/i,
  },
  {
    evidence: "Mentions office, den, desk, or bonus-room space.",
    key: "work-from-home friendly",
    listingPattern:
      /\b(?:wfh|work from home|work-from-home|office|den|desk space|bonus room|high[- ]?speed internet|fiber)\b/i,
    queryPattern:
      /\b(?:wfh|work from home|work-from-home|office|den|desk space|bonus room|high[- ]?speed internet|fiber)\b/i,
  },
  {
    evidence: "Mentions natural light, bright rooms, or skylights.",
    key: "natural light",
    listingPattern:
      /\b(?:natural light|sunny|bright|skylight|south[- ]?facing|lots? of light)\b/i,
    queryPattern:
      /\b(?:natural light|sunny|bright|skylight|lots? of light)\b/i,
  },
  {
    evidence: "Park access appears in listing or nearby POI data.",
    key: "near parks",
    listingPattern: /\b(?:park|green space|outdoors?)\b/i,
    poi: { kind: "parks", maxMiles: 0.6 },
    queryPattern:
      /\b(?:near|close to|by|walk(?:ing)? distance to)?\s*(?:parks?|green space|outdoors?)\b/i,
  },
  {
    evidence: "Transit access appears in listing or nearby POI data.",
    key: "near transit",
    listingPattern:
      /\b(?:bart|muni|caltrain|transit|train|bus|rider's paradise|excellent transit)\b/i,
    poi: { kind: "transit", maxMiles: 0.6 },
    queryPattern:
      /\b(?:near|close to|by|walk(?:ing)? distance to)?\s*(?:bart|muni|caltrain|transit|train|bus)\b/i,
  },
  {
    evidence: "Close to dining signals in listing or POI data.",
    key: "near restaurants",
    listingPattern: /\b(?:coffee|cafe|restaurant|dining)\b/i,
    poi: { kind: "restaurant", maxMiles: 0.4 },
    queryPattern:
      /\b(?:near|close to|by|walk(?:ing)? distance to)?\s*(?:coffee shops?|cafes?|restaurants?|dining)\b/i,
  },
  {
    evidence: "Close to dining/nightlife signals in listing or POI data.",
    key: "near nightlife",
    listingPattern: /\b(?:bars?|cocktails?|nightlife|going out|restaurant row)\b/i,
    poi: { kind: "restaurant", maxMiles: 0.35 },
    queryPattern:
      /\b(?:near|close to|by|walk(?:ing)? distance to)?\s*(?:bars?|nightlife|cocktails?|going out)\b/i,
  },
  {
    evidence: "Mentions elevator or accessibility features.",
    key: "elevator or accessible",
    listingPattern: /\b(?:elevator|no stairs?|accessible|accessibility|wheelchair)\b/i,
    queryPattern: /\b(?:elevator|no stairs?|accessible|accessibility|wheelchair)\b/i,
  },
  {
    evidence: "Mentions gym or fitness amenities.",
    key: "fitness amenities",
    listingPattern: /\b(?:gym|fitness center|workout room)\b/i,
    queryPattern: /\b(?:gym|fitness center|workout room)\b/i,
  },
  {
    evidence: "Mentions quiet-building or quieter-unit signals.",
    key: "quiet building",
    listingPattern:
      /\b(?:quiet|soundproof|double[- ]?pane|top floor|rear unit|away from street noise)\b/i,
    queryPattern:
      /\b(?:quiet building|quiet street|quiet|not noisy|not loud|no thin walls|soundproof|top floor|rear unit|away from street noise)\b/i,
  },
];

export function findListingFeatureDefinition(key: string) {
  const normalizedKey = normalizeListingFeatureKey(key);
  if (readTargetedTransitMustHave(normalizedKey)) {
    return (
      listingFeatureDefinitions.find((feature) => feature.key === "near transit") ??
      null
    );
  }

  return (
    listingFeatureDefinitions.find(
      (feature) => normalizeListingFeatureKey(feature.key) === normalizedKey,
    ) ?? null
  );
}

export function listingMatchesFeatureMustHave(
  listing: ListingFeatureMatchInput,
  mustHave: string,
) {
  const targetedTransit = readTargetedTransitMustHave(mustHave);
  if (targetedTransit) {
    return matchesRequestedTransitTargets(listing, [targetedTransit]);
  }

  const feature = findListingFeatureDefinition(mustHave);
  const text = listingFeatureText(listing);
  if (!feature) {
    const fallback = matchesMustHaveTextFallback(text, mustHave);
    if (fallback != null) {
      return fallback;
    }
    return listingTextIncludesMustHave(text, mustHave);
  }

  const negativeLaundry =
    feature.key === "in-unit laundry" &&
    /\b(?:no|not|without|does not have)\b.{0,24}\blaundry\b/i.test(text);
  if (negativeLaundry) {
    return false;
  }

  return (
    feature.listingPattern.test(text) ||
    Boolean(
      feature.poi &&
        hasNearbyPoi(listing.poi_summary, feature.poi.kind, feature.poi.maxMiles),
    )
  );
}

/**
 * Regex fallbacks for free-text must-haves that don't normalize to a known
 * feature definition (e.g. "washer/dryer", "w/d"). Returns a match decision
 * when the must-have keyword is recognized, or `null` to defer to token
 * matching. Shared so the DB-row and snapshot match paths stay consistent.
 */
function matchesMustHaveTextFallback(text: string, mustHave: string): boolean | null {
  const key = mustHave.toLowerCase();

  if (/\b(?:in[- ]?unit laundry|washer|dryer|w\/d)\b/.test(key)) {
    return /\b(?:in[- ]?unit laundry|washer(?:\/| and )dryer|washer dryer|w\/d|washer\/dryer)\b/i.test(
      text,
    );
  }

  if (/\bdishwasher\b/.test(key)) {
    return /\bdishwasher\b/i.test(text);
  }

  if (/\bparking|garage\b/.test(key)) {
    return /\b(?:parking|garage)\b/i.test(text);
  }

  if (/\bpets?|cats?|dogs?\b/.test(key)) {
    return /\b(?:pets welcome|pets allowed|pet friendly|dogs? ok|cats? ok)\b/i.test(
      text,
    );
  }

  return null;
}

function listingTextIncludesMustHave(text: string, mustHave: string) {
  const normalizedText = normalizeListingFeatureKey(text);
  const tokens = normalizeListingFeatureKey(mustHave)
    .split(" ")
    .filter((token) => token.length > 2 && !listingMustHaveStopwords.has(token));
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function normalizeListingFeatureKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function readTargetedTransitMustHave(value: string) {
  const normalized = normalizeListingFeatureKey(value);
  if (!normalized || /\b(?:avoid|no|not|without)\b/.test(normalized)) {
    return null;
  }

  if (/\bcaltrain\b/.test(normalized)) {
    return "Caltrain";
  }
  if (/\bbart\b/.test(normalized)) {
    return "BART";
  }
  if (/\bmuni\b/.test(normalized)) {
    return "Muni";
  }

  return null;
}

const listingMustHaveStopwords = new Set([
  "and",
  "apartment",
  "apartments",
  "building",
  "for",
  "home",
  "homes",
  "near",
  "the",
  "unit",
  "units",
  "with",
]);

function listingFeatureText(listing: ListingFeatureMatchInput) {
  return `${(listing.amenities ?? []).join(" ")} ${listing.description ?? ""}`;
}

function hasNearbyPoi(
  rawPoiSummary: Json | null | undefined,
  kind: ListingFeaturePoiConstraint["kind"],
  maxMiles: number,
) {
  const poiSummary = parsePoiSummary(rawPoiSummary);
  if (!poiSummary) {
    return false;
  }

  const points = poiSummary[kind];
  return points.some(
    (point) => Number.isFinite(point.distance) && point.distance <= maxMiles,
  );
}
