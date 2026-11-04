import { NextRequest } from "next/server";
import { searchBrands } from "@/lib/orgs/brandfetch";
import { searchSchools } from "@/lib/orgs/schools";
import type { OrgKind, OrgSuggestion } from "@/lib/orgs/types";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

const MAX_SUGGESTIONS = 6;

function parseKind(value: string | null): OrgKind {
  return value === "school" ? "school" : "company";
}

export async function GET(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { ok: false, error: "Sign in to search organizations." },
      { status: 401 },
    );
  }

  // Typeahead fires per keystroke (debounced client-side) and the company path
  // hits a third-party API, so cap it generously but firmly.
  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "org-search",
    limit: 120,
    window: "minute",
  });
  if (limited) return limited;

  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const kind = parseKind(request.nextUrl.searchParams.get("kind"));

    if (query.length < 2) {
      return Response.json({ ok: true, suggestions: [] as OrgSuggestion[] });
    }

    const suggestions =
      kind === "school"
        ? searchSchools(query, MAX_SUGGESTIONS)
        : await searchBrands(query, MAX_SUGGESTIONS);

    return Response.json({ ok: true, suggestions });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Organization search is unavailable right now.",
      logMessage: "[orgs] search failed",
    });
  }
}
