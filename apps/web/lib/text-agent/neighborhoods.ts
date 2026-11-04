import { dedupeReasons, dedupeTextValues, formatCurrency, formatPoiReason, formatWalkabilityReason, readPoiSummary } from "./tools-format";
import type { NeighborhoodRecommendationCaution, NeighborhoodRecommendationIntent, NeighborhoodSearchContext, NeighborhoodValidationCandidate, NeighborhoodValidationResult, RecommendationTag, ScoredNeighborhood, TableRow } from "./tools";
import type { Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const sanFranciscoTextAgentMarket = "san-francisco-ca";

export function resolveTextAgentApartmentMarket(
  value = process.env.KINFOLK_APARTMENT_MARKET,
) {
  return value?.trim() || sanFranciscoTextAgentMarket;
}

const broadSanFranciscoLocationLabels = [
  "SF",
  "San Francisco",
  "San Francisco CA",
  "San Francisco, CA",
  "Bay Area",
  "California",
];

export const fallbackSanFranciscoNeighborhoods: NeighborhoodValidationCandidate[] = [
  { displayName: "Alamo Square" },
  { displayName: "Anza Vista" },
  { displayName: "Ashbury Heights" },
  { displayName: "Balboa Terrace" },
  { displayName: "Bayview" },
  { displayName: "Bernal Heights" },
  { displayName: "Buena Vista" },
  { displayName: "Castro", aliases: ["The Castro"] },
  { displayName: "Central Richmond" },
  { displayName: "Central Sunset" },
  { displayName: "Chinatown" },
  { displayName: "Civic Center" },
  { displayName: "Cole Valley" },
  { displayName: "Corona Heights" },
  { displayName: "Cow Hollow" },
  { displayName: "Design District" },
  { displayName: "Diamond Heights" },
  { displayName: "Dogpatch", aliases: ["Dog Patch"] },
  { displayName: "Dolores Heights" },
  { displayName: "Duboce Triangle" },
  { displayName: "Excelsior" },
  { displayName: "Fillmore" },
  { displayName: "Financial District", aliases: ["FiDi"] },
  { displayName: "Forest Hill" },
  { displayName: "Forest Knolls" },
  { displayName: "Glen Park" },
  { displayName: "Haight-Ashbury", aliases: ["Haight Ashbury", "The Haight"] },
  { displayName: "Hayes Valley" },
  { displayName: "Ingleside" },
  { displayName: "Ingleside Heights" },
  { displayName: "Inner Richmond" },
  { displayName: "Inner Sunset" },
  { displayName: "Japantown" },
  { displayName: "Lake Street" },
  { displayName: "Lakeshore" },
  { displayName: "Laurel Heights" },
  { displayName: "Lower Haight" },
  { displayName: "Lone Mountain" },
  { displayName: "Lower Nob Hill", aliases: ["Tendernob"] },
  { displayName: "Lower Pacific Heights", aliases: ["Lower Pac Heights"] },
  { displayName: "Marina", aliases: ["Marina District"] },
  { displayName: "Merced Heights" },
  { displayName: "Mid-Market", aliases: ["Mid Market"] },
  { displayName: "Miraloma Park" },
  { displayName: "Mission Bay" },
  { displayName: "Mission Dolores" },
  { displayName: "Mission District", aliases: ["Mission", "The Mission"] },
  { displayName: "Nob Hill" },
  { displayName: "Noe Valley" },
  { displayName: "NoPa", aliases: ["North of Panhandle"] },
  { displayName: "North Beach" },
  { displayName: "Oceanview" },
  { displayName: "Outer Mission" },
  { displayName: "Outer Richmond" },
  { displayName: "Outer Sunset" },
  { displayName: "Pacific Heights", aliases: ["Pac Heights"] },
  { displayName: "Panhandle" },
  { displayName: "Parkside" },
  { displayName: "Potrero Hill", aliases: ["Potrero"] },
  { displayName: "Portola" },
  { displayName: "Presidio" },
  { displayName: "Presidio Heights" },
  { displayName: "Richmond", aliases: ["Richmond District"] },
  { displayName: "Rincon Hill" },
  { displayName: "Russian Hill" },
  { displayName: "SoMa", aliases: ["SOMA", "South of Market"] },
  { displayName: "South Beach" },
  { displayName: "Sunset", aliases: ["Sunset District"] },
  { displayName: "Telegraph Hill" },
  { displayName: "Tenderloin" },
  { displayName: "Treasure Island" },
  { displayName: "Twin Peaks" },
  { displayName: "Union Square" },
  { displayName: "Visitacion Valley" },
  { displayName: "Western Addition" },
  { displayName: "West Portal" },
  { displayName: "Yerba Buena" },
];

export async function validateSanFranciscoNeighborhoods(
  supabase: SupabaseClient<Database>,
  values: string[],
): Promise<NeighborhoodValidationResult> {
  const profiles = await loadNeighborhoodProfiles(
    supabase,
    sanFranciscoTextAgentMarket,
  );
  const profileCandidates = profiles.map((profile) => ({
    aliases: [profile.name],
    displayName: profile.display_name,
  }));

  return validateSanFranciscoNeighborhoodValues(values, [
    ...profileCandidates,
    ...fallbackSanFranciscoNeighborhoods,
  ]);
}

export function validateSanFranciscoNeighborhoodValues(
  values: string[],
  candidates: NeighborhoodValidationCandidate[] = fallbackSanFranciscoNeighborhoods,
): NeighborhoodValidationResult {
  const canonicalNames = buildCanonicalNeighborhoodMap(candidates);
  const broadLocationKeys = new Set(
    broadSanFranciscoLocationLabels.flatMap((label) => {
      const normalized = normalizeNeighborhoodInput(label);
      return normalized ? [normalized] : [];
    }),
  );
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seenAccepted = new Set<string>();
  const seenRejected = new Set<string>();

  for (const rawValue of values.flatMap(splitNeighborhoodText)) {
    const raw = rawValue.replace(/\s+/g, " ").trim();
    const key = normalizeNeighborhoodInput(raw);
    const canonical = canonicalNames.get(key);

    if (!raw || !key || broadLocationKeys.has(key) || !canonical) {
      const rejectedKey = raw.toLowerCase();
      if (raw && !seenRejected.has(rejectedKey)) {
        seenRejected.add(rejectedKey);
        rejected.push(raw);
      }
      continue;
    }

    const acceptedKey = normalizeNeighborhoodName(canonical);
    if (!seenAccepted.has(acceptedKey)) {
      seenAccepted.add(acceptedKey);
      accepted.push(canonical);
    }
  }

  return { accepted, rejected };
}

export function extractKnownNeighborhoods(body: string) {
  const normalized = normalizeNeighborhoodName(body);
  const matches: string[] = [];

  for (const candidate of fallbackSanFranciscoNeighborhoods) {
    const names = [candidate.displayName, ...(candidate.aliases ?? [])];
    if (
      names.some((name) => {
        const key = normalizeNeighborhoodName(name);
        return key.length > 0 && hasNormalizedPhrase(normalized, key);
      })
    ) {
      matches.push(candidate.displayName);
    }
  }

  return dedupeTextValues(matches).slice(0, 4);
}

export async function loadNeighborhoodProfiles(
  supabase: SupabaseClient<Database>,
  market: string,
): Promise<TableRow<"neighborhood_profiles">[]> {
  const result = await supabase
    .from("neighborhood_profiles")
    .select("*")
    .eq("market", market)
    .order("listing_count", { ascending: false })
    .limit(50);

  if (result.error) {
    throw result.error;
  }

  return result.data ?? [];
}

export function rankNeighborhoodProfiles(
  profiles: TableRow<"neighborhood_profiles">[],
  context: NeighborhoodSearchContext,
  intent: NeighborhoodRecommendationIntent,
): ScoredNeighborhood[] {
  const excluded = new Set(
    context.preferredNeighborhoods.map(normalizeNeighborhoodName),
  );
  const tags = new Set(intent.tags);

  const scored = profiles
    .reduce<ScoredNeighborhood[]>((matches, profile) => {
      if (profile.listing_count <= 0) {
        return matches;
      }
      if (
        intent.excludeKnownNeighborhoods &&
        isPreferredNeighborhood(profile.display_name, [...excluded])
      ) {
        return matches;
      }
      matches.push(scoreNeighborhood(profile, context, tags));
      return matches;
    }, [])
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.listingCount - left.listingCount;
    });

  if (shouldAllowCautionNeighborhoods(scored, context, intent)) {
    return scored;
  }

  return scored.filter((neighborhood) => !neighborhood.caution);
}

function scoreNeighborhood(
  profile: TableRow<"neighborhood_profiles">,
  context: NeighborhoodSearchContext,
  tags: Set<RecommendationTag>,
): ScoredNeighborhood {
  const poi = readPoiSummary(profile.poi_summary);
  const restaurantCount = poi.restaurant.length;
  const transitCount = poi.transit.length;
  const parkCount = poi.parks.length;
  const groceryCount = poi.grocery.length;
  const knownBoosts = knownSanFranciscoBoosts(profile.display_name);
  const caution = neighborhoodRecommendationCaution(profile.display_name);
  const preferred = isPreferredNeighborhood(
    profile.display_name,
    context.preferredNeighborhoods,
  );
  const reasons: string[] = [];
  let score = Math.min(profile.listing_count, 40);

  if (preferred) {
    score += 42;
    reasons.push("already in your saved areas");
  }

  if (caution) {
    reasons.push("only consider if budget is the overriding constraint");
  }

  if (context.budgetMax) {
    if (profile.median_rent && profile.median_rent <= context.budgetMax) {
      score += 18;
      reasons.push(`median rent around ${formatCurrency(profile.median_rent)}`);
    } else if (profile.rent_min && profile.rent_min <= context.budgetMax) {
      score += 10;
      reasons.push(
        `some listings start near ${formatCurrency(profile.rent_min)}`,
      );
    } else if (profile.median_rent && profile.median_rent > context.budgetMax) {
      score -= 8;
      reasons.push(
        `watch rent: median is around ${formatCurrency(profile.median_rent)}`,
      );
    }
  }

  if (tags.has("nightlife")) {
    score += restaurantCount * 4 + knownBoosts.nightlife;
    reasons.push(
      knownBoosts.nightlife > 0
        ? "stronger nightlife/social fit"
        : "good restaurant density",
    );
  }

  if (tags.has("restaurants")) {
    score += restaurantCount * 3;
    const diningReason = formatPoiReason("dining nearby", poi.restaurant);
    if (diningReason) reasons.push(diningReason);
  }

  if (tags.has("commute")) {
    score += transitCount * 4;
    const transitReason = formatPoiReason("transit nearby", poi.transit);
    if (transitReason) reasons.push(transitReason);
  }

  if (tags.has("walkable")) {
    score += (restaurantCount + transitCount + groceryCount) * 2;
    const walkabilityReason = formatWalkabilityReason(poi);
    if (walkabilityReason) reasons.push(walkabilityReason);
  }

  if (tags.has("parks")) {
    score += parkCount * 3;
    const parksReason = formatPoiReason("parks nearby", poi.parks);
    if (parksReason) reasons.push(parksReason);
  }

  if (tags.has("quiet")) {
    score += parkCount * 3 + knownBoosts.quiet - restaurantCount;
    reasons.push(
      "more likely to feel calmer than the busiest nightlife corridors",
    );
  }

  if (reasons.length === 0) {
    if (profile.median_rent) {
      reasons.push(`median rent around ${formatCurrency(profile.median_rent)}`);
    }
    reasons.push(describeNeighborhoodVibe(profile.display_name));
  }

  return {
    caution,
    displayName: profile.display_name,
    listingCount: profile.listing_count,
    medianRent: profile.median_rent,
    reasons: dedupeReasons(reasons).slice(0, 2),
    rentMax: profile.rent_max,
    rentMin: profile.rent_min,
    score,
  };
}

function shouldAllowCautionNeighborhoods(
  neighborhoods: ScoredNeighborhood[],
  context: NeighborhoodSearchContext,
  intent: NeighborhoodRecommendationIntent,
) {
  const nonCautionNeighborhoods = neighborhoods.filter(
    (neighborhood) => !neighborhood.caution,
  );

  if (nonCautionNeighborhoods.length === 0) {
    return true;
  }

  if (intent.tags.includes("budget")) {
    return true;
  }

  if (context.budgetMax == null) {
    return false;
  }

  return !nonCautionNeighborhoods.some(
    (neighborhood) =>
      hasBudgetPath(neighborhood, context.budgetMax ?? 0),
  );
}

function hasBudgetPath(
  neighborhood: Pick<ScoredNeighborhood, "medianRent" | "rentMin">,
  budgetMax: number,
) {
  return (
    (neighborhood.medianRent != null && neighborhood.medianRent <= budgetMax) ||
    (neighborhood.rentMin != null && neighborhood.rentMin <= budgetMax)
  );
}

export function findNeighborhoodProfile(
  profileMap: Map<string, TableRow<"neighborhood_profiles">>,
  neighborhood: string,
) {
  const key = normalizeNeighborhoodName(neighborhood);
  const direct = profileMap.get(key);
  if (direct) return direct;

  const withThe = profileMap.get(`the ${key}`);
  if (withThe) return withThe;

  if (key === "richmond" || key === "sunset") {
    return (
      [...profileMap.entries()].find(([profileKey]) =>
        profileKey.endsWith(` ${key}`),
      )?.[1] ?? null
    );
  }

  return null;
}

export function describeNeighborhoodVibe(name: string) {
  const key = normalizeNeighborhoodName(name);
  if (/\bmarina\b/.test(key)) return "social, polished, waterfront, and expensive";
  if (/\bdogpatch\b/.test(key)) return "newer, sunnier, quieter, and design/warehouse leaning";
  if (/\bmission\b/.test(key)) return "busy, food-heavy, nightlife-friendly, and transit-connected";
  if (/\blower nob hill\b/.test(key)) return "central, restaurant-heavy, apartment-dense, and more urban";
  if (/\bnob hill\b/.test(key)) return "classic, central, hillier, restaurant-heavy, and pricey";
  if (/\bpacific heights\b/.test(key)) return "classic, upscale, quieter, and hillier";
  if (/\bnorth beach\b/.test(key)) return "social, restaurant-heavy, historic, and nightlife-friendly";
  if (/\brichmond\b/.test(key)) return "residential, park-adjacent, calmer, and west-side";
  if (/\bsunset\b/.test(key)) return "residential, beach/park-adjacent, calmer, and foggier";
  if (/\bbernal\b/.test(key)) return "residential, warmer, community-oriented, and calmer";
  if (/\bsoma|south of market\b/.test(key)) return "central, apartment-dense, and more urban";
  return "worth comparing on rent, commute, and day-to-day feel";
}

function knownSanFranciscoBoosts(name: string) {
  const normalized = normalizeNeighborhoodName(name);
  const nightlifeNames = [
    "castro",
    "hayes valley",
    "lower haight",
    "marina",
    "mission",
    "mission district",
    "nob hill",
    "north beach",
    "soma",
    "south of market",
  ];
  const quietNames = [
    "cole valley",
    "inner sunset",
    "noe valley",
    "presidio heights",
    "richmond",
    "sunset",
  ];

  return {
    nightlife: nightlifeNames.some((candidate) =>
      normalized.includes(candidate),
    )
      ? 18
      : 0,
    quiet: quietNames.some((candidate) => normalized.includes(candidate))
      ? 12
      : 0,
  };
}

function neighborhoodRecommendationCaution(
  name: string,
): NeighborhoodRecommendationCaution | null {
  const normalized = normalizeNeighborhoodName(name);
  const highScreeningAreas = ["tenderloin", "civic center"];

  return highScreeningAreas.some((candidate) => normalized === candidate)
    ? "high_public_safety_screening"
    : null;
}

function isPreferredNeighborhood(name: string, preferredNeighborhoods: string[]) {
  const normalized = normalizeNeighborhoodName(name);

  return preferredNeighborhoods.some((preferred) => {
    const preferredKey = normalizeNeighborhoodName(preferred);
    if (!preferredKey) {
      return false;
    }

    if (normalized === preferredKey) {
      return true;
    }

    if (preferredKey === "richmond" || preferredKey === "sunset") {
      return normalized.endsWith(` ${preferredKey}`);
    }

    if (preferredKey === "mission") {
      return normalized === "mission" || normalized === "mission dolores";
    }

    return false;
  });
}

export function normalizeNeighborhoodName(value: string) {
  return value
    .toLowerCase()
    .replace(/^\s*the\s+/i, "")
    .replace(/\b(?:district|neighborhood)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildCanonicalNeighborhoodMap(
  candidates: NeighborhoodValidationCandidate[],
) {
  const map = new Map<string, string>();

  for (const candidate of candidates) {
    for (const value of [candidate.displayName, ...(candidate.aliases ?? [])]) {
      const key = normalizeNeighborhoodInput(value);
      if (key && !map.has(key)) {
        map.set(key, candidate.displayName);
      }
    }
  }

  return map;
}

function normalizeNeighborhoodInput(value: string) {
  return normalizeNeighborhoodName(
    value
      .replace(
        /\b(?:in|near|around|within)\s+(?:sf|san francisco)(?:\s*,?\s*(?:ca|california))?\b/gi,
        "",
      )
      .replace(/\b(?:sf|san francisco|california|ca)\b/gi, ""),
  );
}

function splitNeighborhoodText(value: string) {
  return value
    .split(/[,;/]|\s+\band\b\s+|\s+\bor\b\s+/i)
    .flatMap((entry) => {
      const trimmed = entry.trim();
      return trimmed ? [trimmed] : [];
    });
}

function hasNormalizedPhrase(value: string, phrase: string) {
  return ` ${value} `.includes(` ${phrase} `);
}
