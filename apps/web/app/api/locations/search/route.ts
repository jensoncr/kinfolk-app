import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { searchMapboxLocationSuggestions } from "@/lib/integrations/mapbox-location";
import {
  LOCATION_SEARCH_MAX_QUERY_LENGTH,
  LOCATION_SEARCH_MIN_QUERY_LENGTH,
  type LocationSuggestion,
} from "@/lib/shared/location-suggestions";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < LOCATION_SEARCH_MIN_QUERY_LENGTH) {
    return Response.json({ results: [] satisfies LocationSuggestion[] });
  }
  if (query.length > LOCATION_SEARCH_MAX_QUERY_LENGTH) {
    return Response.json(
      {
        error: `Location search must be ${LOCATION_SEARCH_MAX_QUERY_LENGTH} characters or fewer.`,
      },
      { status: 400 },
    );
  }

  // Throttle the paid Mapbox geocoding proxy per user so autocomplete can't be
  // looped to drive third-party cost. Only valid, Mapbox-bound queries count.
  const limited = await enforceApiUserRateLimit({
    userId,
    bucketType: "locations_search",
    limit: 60,
    window: "minute",
  });
  if (limited) {
    return limited;
  }

  try {
    const results = await searchMapboxLocationSuggestions(query);
    return Response.json({ results });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Location search is not configured."
    ) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("[locations] search failed", { error });
    return Response.json({ error: "Mapbox lookup failed." }, { status: 502 });
  }
}
