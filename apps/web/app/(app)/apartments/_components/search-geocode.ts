// Client-side forward geocoding for the apartments search box. A renter names
// where they want to live by whatever landmark is in their head — an address,
// a BART stop, a park, the restaurant on the corner — and we resolve it to
// coordinates and take the map there. Results are bounded to the listing
// market's bbox so "Barcelona" resolves to Barcelona Ave, never Barcelona,
// Spain.
//
// This uses the Search Box forward endpoint rather than the older
// /geocoding/v5/mapbox.places one. v5 is address-first and silently mangles
// everything else: measured against the live API, "Zuni Cafe" returned no
// result at all, "Powell Street Station" resolved to a street in Emeryville,
// and "Dolores Park" came back as an unrelated "Park Street". Search Box
// returns the restaurant, the station plaza and Mission Dolores Park. The
// /forward endpoint needs no session token (only suggest+retrieve do).
const MAPBOX_SEARCH_URL = "https://api.mapbox.com/search/searchbox/v1/forward";

export type MarketBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type GeocodedPlace = {
  center: [number, number];
  label: string;
  // Mapbox's own bbox for the feature (neighborhoods/localities have one;
  // addresses/POIs usually don't).
  bbox: [number, number, number, number] | null;
};

/** "near dolores park" → "dolores park"; other queries pass through. */
export function stripNearPrefix(query: string): string {
  return query.replace(/^\s*near\s+/i, "").trim();
}

export async function geocodeSearchQuery({
  query,
  token,
  bbox,
  proximity,
  signal,
}: {
  query: string;
  token: string;
  bbox: MarketBbox | null;
  proximity: [number, number] | null;
  signal?: AbortSignal;
}): Promise<GeocodedPlace | null> {
  const place = stripNearPrefix(query);
  if (place.length < 3 || place.length > 128) return null;

  const url = new URL(MAPBOX_SEARCH_URL);
  url.searchParams.set("q", place);
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "1");
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
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        name?: string;
        full_address?: string;
        place_formatted?: string;
        // Present on features with real extent (neighborhoods, parks,
        // localities); absent on a single address or storefront.
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
    label: properties?.full_address ?? properties?.name ?? place,
    bbox: properties?.bbox ?? null,
  };
}
