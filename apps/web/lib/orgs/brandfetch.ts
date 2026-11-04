// Brandfetch Brand Search API — company name -> domain + preview icon.
//
// Only the search endpoint is used. The Logo CDN is not called directly: a
// client ID is domain-bound (unregistered origins get redirected to the
// hotlinking guidelines instead of an image), and hotlinking would leak every
// profile view to a third party. Search results carry a ready-to-use icon URL,
// which `org-logo` downloads once and re-hosts.

import type { OrgSuggestion } from "./types";

const SEARCH_ENDPOINT = "https://api.brandfetch.io/v2/search";
const SEARCH_TIMEOUT_MS = 4_000;

type BrandfetchSearchResult = {
  name?: unknown;
  domain?: unknown;
  icon?: unknown;
  qualityScore?: unknown;
};

export function brandfetchClientId(): string | null {
  return process.env.BRANDFETCH_CLIENT_ID?.trim() || null;
}

/**
 * Search brands by name or domain. Brand Search is public; the optional client
 * ID attributes requests to our Brandfetch integration but must not gate the
 * picker. Returns [] on provider failure so a missing logo never blocks
 * someone from saving where they work.
 */
export async function searchBrands(query: string, limit: number): Promise<OrgSuggestion[]> {
  const clientId = brandfetchClientId();
  const needle = query.trim();
  if (needle.length < 2) return [];

  try {
    const url = new URL(`${SEARCH_ENDPOINT}/${encodeURIComponent(needle)}`);
    if (clientId) url.searchParams.set("c", clientId);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn("[orgs] Brand search failed.", { status: response.status });
      return [];
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return [];

    const suggestions: OrgSuggestion[] = [];
    for (const entry of payload as BrandfetchSearchResult[]) {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      const domain = typeof entry?.domain === "string" ? entry.domain.trim().toLowerCase() : "";
      if (!name || !domain) continue;

      suggestions.push({
        name,
        domain,
        kind: "company",
        iconUrl: typeof entry?.icon === "string" && entry.icon ? entry.icon : null,
      });

      if (suggestions.length >= limit) break;
    }

    return suggestions;
  } catch (error) {
    console.warn("[orgs] Brand search errored.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Resolve the brand record for a domain we already hold. */
export async function findBrandByDomain(domain: string): Promise<OrgSuggestion | null> {
  const results = await searchBrands(domain, 5);
  return results.find((result) => result.domain === domain.trim().toLowerCase()) ?? null;
}
