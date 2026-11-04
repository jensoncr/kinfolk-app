import "server-only";

import {
  LOCATION_SEARCH_MAX_QUERY_LENGTH,
  LOCATION_SEARCH_MIN_QUERY_LENGTH,
  comparableLocationText,
  formatMapboxLocationLabel,
  type LocationSuggestion,
} from "../shared/location-suggestions";

const MAPBOX_GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const DEFAULT_LIMIT = 6;

type MapboxContext = {
  id: string;
  text: string;
  short_code?: string;
};

type MapboxFeature = {
  id: string;
  text: string;
  place_type: string[];
  properties?: { short_code?: string };
  context?: MapboxContext[];
};

type NormalizeLocationOptions = {
  allowTopTextMatch?: boolean;
};

export async function searchMapboxLocationSuggestions(
  query: string,
  options: { limit?: number } = {},
): Promise<LocationSuggestion[]> {
  const trimmed = query.trim();
  if (
    trimmed.length < LOCATION_SEARCH_MIN_QUERY_LENGTH ||
    trimmed.length > LOCATION_SEARCH_MAX_QUERY_LENGTH
  ) {
    return [];
  }

  const token = resolveMapboxAccessToken();
  if (!token) {
    throw new Error("Location search is not configured.");
  }

  const url = new URL(`${MAPBOX_GEOCODING_URL}/${encodeURIComponent(trimmed)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "place,region");
  url.searchParams.set("limit", String(options.limit ?? DEFAULT_LIMIT));
  url.searchParams.set("language", "en");

  // Interactive autocomplete path: a hung Mapbox response must fail fast,
  // not block for undici's ~300s default.
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) {
    throw new Error("Mapbox lookup failed.");
  }

  const data = (await response.json()) as { features?: MapboxFeature[] };
  return (data.features ?? [])
    .map(toSuggestion)
    .filter((suggestion): suggestion is LocationSuggestion => suggestion !== null);
}

function resolveMapboxAccessToken() {
  return (
    process.env.MAPBOX_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ||
    ""
  );
}

export async function normalizeMapboxLocationValue(
  value: string | null | undefined,
  options: NormalizeLocationOptions = {},
) {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const suggestions = await searchMapboxLocationSuggestions(trimmed);
  const exact = suggestions.find((suggestion) =>
    locationsMatch(trimmed, suggestion.label),
  );
  if (exact) {
    return exact.label;
  }

  const top = suggestions[0];
  if (options.allowTopTextMatch && top && isConfidentTextMatch(trimmed, top)) {
    return top.label;
  }

  throw new Error("Choose a city from the suggestions.");
}

function toSuggestion(feature: MapboxFeature): LocationSuggestion | null {
  if (!feature.place_type?.length) return null;
  const isPlace = feature.place_type.includes("place");
  const isRegion = feature.place_type.includes("region");
  if (!isPlace && !isRegion) return null;

  if (isRegion) {
    const stateCode = extractStateCode(feature.properties?.short_code ?? "");
    return {
      id: feature.id,
      label: feature.text,
      city: "",
      state: feature.text,
      stateCode,
    };
  }

  const region = feature.context?.find((context) => context.id.startsWith("region"));
  if (!region) return null;

  const stateCode = extractStateCode(region.short_code ?? "");
  return {
    id: feature.id,
    label: formatMapboxLocationLabel({
      city: feature.text,
      state: region.text,
      stateCode,
    }),
    city: feature.text,
    state: region.text,
    stateCode,
  };
}

function isConfidentTextMatch(rawValue: string, suggestion: LocationSuggestion) {
  const raw = comparableLocationText(rawValue);
  const city = comparableLocationText(suggestion.city);
  const state = comparableLocationText(suggestion.state);
  const stateCode = comparableLocationText(suggestion.stateCode);
  const label = comparableLocationText(suggestion.label);

  return (
    raw === label ||
    (city.length > 0 &&
      (raw === city ||
        raw === comparableLocationText(`${suggestion.city} ${suggestion.stateCode}`) ||
        raw === comparableLocationText(`${suggestion.city} ${suggestion.state}`))) ||
    (city.length === 0 && (raw === state || raw === stateCode))
  );
}

function locationsMatch(a: string, b: string) {
  return comparableLocationText(a) === comparableLocationText(b);
}

function extractStateCode(shortCode: string): string {
  const parts = shortCode.split("-");
  return parts.length === 2 ? parts[1].toUpperCase() : "";
}
