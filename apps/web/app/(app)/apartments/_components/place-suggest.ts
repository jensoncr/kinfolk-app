import type { GeocodedPlace, MarketBbox } from "./search-geocode";

// Autocomplete for the apartments "Where" field.
//
// This is the suggest/retrieve pair, not /forward. Forward is a resolver: give
// it a complete query and it returns the best single answer. Fed a partial one
// it guesses badly — measured against the live API, "saint franks" came back as
// Broadway St, Park Street and Lane Street, and "zuni" never surfaced Zuni Cafe.
// /suggest is built for prefixes and returns Zuni Cafe, "noe val" → the Noe
// Valley neighborhood, "24th st mission bart" → the station plaza.
//
// The trade is that suggestions carry no coordinates — they carry a mapbox_id
// that /retrieve exchanges for the feature. Both calls must share one session
// token, which is also how Mapbox bills the pair as a single search rather than
// per keystroke.
const SUGGEST_URL = "https://api.mapbox.com/search/searchbox/v1/suggest";
const RETRIEVE_URL = "https://api.mapbox.com/search/searchbox/v1/retrieve";

export type PlaceSuggestion = {
  id: string;
  name: string;
  /** Street address or region under the name — may be empty. */
  context: string;
  /** Mapbox's own classification: poi, address, street, neighborhood, place… */
  featureType: string;
};

export function newSearchSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Session tokens only need to be unique per search, not unguessable.
  return `kin-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export async function suggestPlaces({
  query,
  token,
  sessionToken,
  bbox,
  proximity,
  limit = 5,
  signal,
}: {
  query: string;
  token: string;
  sessionToken: string;
  bbox: MarketBbox | null;
  proximity: [number, number] | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > 128) return [];

  const url = new URL(SUGGEST_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("country", "US");
  if (bbox) {
    url.searchParams.set(
      "bbox",
      [bbox.west, bbox.south, bbox.east, bbox.north].join(","),
    );
  }
  if (proximity) {
    url.searchParams.set("proximity", proximity.join(","));
  }

  let payload: {
    suggestions?: Array<{
      mapbox_id?: string;
      name?: string;
      full_address?: string;
      place_formatted?: string;
      feature_type?: string;
    }>;
  };
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return [];
    payload = await response.json();
  } catch {
    return [];
  }

  return (payload.suggestions ?? [])
    // `brand` results are chains, not locations — "PacSun", "Pacific Catch",
    // each with no address and nothing to centre a map on. They crowd out the
    // real places for short queries.
    .filter((item) => item.mapbox_id && item.name && item.feature_type !== "brand")
    .map((item) => ({
      id: item.mapbox_id as string,
      name: item.name as string,
      context: item.full_address ?? item.place_formatted ?? "",
      featureType: item.feature_type ?? "",
    }));
}

export async function retrievePlace({
  id,
  token,
  sessionToken,
  signal,
}: {
  id: string;
  token: string;
  sessionToken: string;
  signal?: AbortSignal;
}): Promise<GeocodedPlace | null> {
  const url = new URL(`${RETRIEVE_URL}/${encodeURIComponent(id)}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", sessionToken);

  let payload: {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        name?: string;
        full_address?: string;
        place_formatted?: string;
        bbox?: [number, number, number, number];
      };
    }>;
  };
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }

  const feature = payload.features?.[0];
  const center = feature?.geometry?.coordinates;
  if (!center || center.length !== 2) return null;
  const properties = feature?.properties;
  return {
    center,
    label: properties?.name ?? properties?.full_address ?? "",
    bbox: properties?.bbox ?? null,
  };
}
