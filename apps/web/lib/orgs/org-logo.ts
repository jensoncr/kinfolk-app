// Resolve a durable logo URL for an organization domain.
//
// Logos are re-hosted in our own bucket keyed by domain, not hotlinked. That
// keeps profile rendering independent of a vendor's client-ID domain rules,
// stops a third party from seeing every profile view, and means one fetch
// serves every user at that organization.

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { findBrandByDomain } from "./brandfetch";
import { isFetchableLogoUrl, normalizeOrgDomain } from "./domain";
import { faviconUrl } from "./favicon";

const LOGO_BUCKET = "org-logos";
const MAX_LOGO_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
// Providers legitimately redirect to a CDN host; more hops than this is a
// chain we have no reason to follow.
const MAX_LOGO_REDIRECTS = 3;

// SVG is deliberately absent: these bytes come from a third party and are
// served from a public storage origin at a guessable URL, where direct
// navigation would execute any script the document carries. Every other image
// path in this repo excludes it too.
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Legal-form and filler tokens that shouldn't drive a name match either way. */
const NAME_NOISE =
  /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|the|of|and|university|college|school|institute)\b/g;

function nameTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(NAME_NOISE, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

/**
 * Does a provider's brand record actually describe the organization we're
 * saving? Brand search keyed by domain is not always right — nd.edu resolves
 * to an unrelated "Sclova Health" record — and showing the wrong company's
 * logo on someone's profile is worse than showing no logo at all.
 */
export function brandNameMatches(expected: string, candidate: string): boolean {
  const expectedTokens = nameTokens(expected);
  const candidateTokens = nameTokens(candidate);
  if (expectedTokens.size === 0 || candidateTokens.size === 0) return false;

  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) return true;
  }
  return false;
}

/**
 * Storage key for a domain. Safe because the caller has already validated the
 * domain — the character class here can no longer collapse two distinct inputs
 * onto one key.
 */
function storagePathFor(domain: string, extension: string): string {
  return `${domain}.${extension}`;
}

/**
 * A credential another user at this organization already paid to resolve.
 *
 * The label travels with the logo. Keying reuse on the domain alone dropped
 * the half that made the logo correct: brand search for nd.edu returns an
 * unrelated "Sclova Health" record, so the first user to accept it would have
 * pinned that mark on every later Notre Dame student, permanently and with no
 * repair path. Callers re-run corroboration against the peer's label.
 */
async function findCachedCredential(
  domain: string,
): Promise<{ label: string; logoUrl: string } | null> {
  const supabase = createSupabaseServiceClient();
  const [company, school] = await Promise.all([
    supabase
      .from("kinfolk_users")
      .select("occupation_company,occupation_company_logo_url")
      .eq("occupation_company_domain", domain)
      .not("occupation_company_logo_url", "is", null)
      .not("occupation_company", "is", null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("kinfolk_users")
      .select("education_school,education_school_logo_url")
      .eq("education_school_domain", domain)
      .not("education_school_logo_url", "is", null)
      .not("education_school", "is", null)
      .limit(1)
      .maybeSingle(),
  ]);

  const label = company.data?.occupation_company ?? school.data?.education_school;
  const logoUrl =
    company.data?.occupation_company_logo_url ?? school.data?.education_school_logo_url;

  return label && logoUrl ? { label, logoUrl } : null;
}

/**
 * Download a candidate logo and store it under the domain. Returns the public
 * URL, or null when the source is unusable — callers fall back to a monogram.
 */
async function rehostLogo(domain: string, sourceUrl: string): Promise<string | null> {
  try {
    const response = await fetchLogoBytes(sourceUrl);
    if (!response) return null;

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const extension = contentType ? CONTENT_TYPE_EXTENSIONS[contentType] : undefined;
    if (!contentType || !extension) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) return null;

    const supabase = createSupabaseServiceClient();
    const path = storagePathFor(domain, extension);
    const uploaded = await supabase.storage.from(LOGO_BUCKET).upload(path, bytes, {
      cacheControl: "86400",
      contentType,
      upsert: true,
    });
    if (uploaded.error) throw uploaded.error;

    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    return data.publicUrl || null;
  } catch (error) {
    console.warn("[orgs] Logo re-host failed.", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fetch logo bytes, checking every hop against the allowlist before it is
 * requested.
 *
 * `fetch` follows redirects itself, so inspecting the final URL afterwards
 * judges a request the server has already made — an allowlisted host that
 * redirects to an internal address would still be contacted. Following
 * manually is what actually enforces the boundary.
 */
async function fetchLogoBytes(sourceUrl: string): Promise<Response | null> {
  let target = sourceUrl;

  for (let hop = 0; hop <= MAX_LOGO_REDIRECTS; hop += 1) {
    if (!isFetchableLogoUrl(target)) {
      console.warn("[orgs] Refusing to fetch a logo from an unexpected host.", { target });
      return null;
    }

    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status < 300 || response.status >= 400) {
      return response.ok ? response : null;
    }

    const location = response.headers.get("location");
    if (!location) return null;
    target = new URL(location, target).toString();
  }

  return null;
}

/**
 * Best available logo for a domain, cached in our bucket.
 *
 * Order: a logo already resolved for this domain, then the brand record (real
 * logo, but only when its name corroborates the organization we're saving),
 * then the site's own favicon. Null means render the monogram.
 */
export async function resolveOrgLogoUrl(
  domain: string,
  expectedName: string,
): Promise<string | null> {
  const normalized = normalizeOrgDomain(domain);
  if (!normalized) return null;

  // Reuse is subject to the same corroboration as a fresh resolution: a peer's
  // logo is only ours to borrow when their label describes the same
  // organization we are saving.
  const cached = await findCachedCredential(normalized);
  if (cached && brandNameMatches(expectedName, cached.label)) {
    return cached.logoUrl;
  }

  const brand = await findBrandByDomain(normalized);
  if (brand?.iconUrl && brandNameMatches(expectedName, brand.name)) {
    const hosted = await rehostLogo(normalized, brand.iconUrl);
    if (hosted) return hosted;
  }

  // The favicon is served by the organization itself, so it is domain-derived
  // and needs no name corroboration.
  return rehostLogo(normalized, faviconUrl(normalized));
}
