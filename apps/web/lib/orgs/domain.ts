/**
 * Domain validation for organization identity.
 *
 * A picked domain is not just display text: it is the storage key for the
 * shared `org-logos` bucket, the key two people are compared on, and an input
 * to an outbound fetch. Sanitizing at the point of use was many-to-one —
 * "fifth wall.com" and "fifth-wall.com" collapsed to the same object key, so
 * one user's upload could overwrite another's logo. Validation happens here,
 * once, before the value is persisted or used as a key; anything that fails is
 * treated as free text (no domain) rather than coerced into something close.
 */

/** Labels are 1–63 chars, alphanumeric with inner hyphens; TLD is alphabetic. */
const DOMAIN_PATTERN =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Normalize a user-supplied organization domain, or null when it is not a
 * plausible hostname. Accepts a pasted URL and keeps only its host.
 *
 * Parsing is delegated to `URL` rather than done by hand. Hand-rolled splitting
 * truncated instead of rejecting — `example.com:not-a-port` became
 * `example.com`, so a malformed value silently collided with a real
 * organization's key — and it left internationalized names unconverted, which
 * is the same many-to-one hazard this module exists to close. `URL` rejects the
 * former and punycodes the latter.
 */
export function normalizeOrgDomain(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(raw);
  let url: URL;
  try {
    url = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  // A bare hostname is what we store. Credentials, a port, or anything else
  // that would have to be discarded means the input was not a hostname.
  if (url.username || url.password || url.port) return null;
  if (!hasScheme && url.pathname !== "/" && url.pathname !== "") return null;

  const host = url.hostname.replace(/\.$/, "");
  return DOMAIN_PATTERN.test(host) ? host : null;
}

/**
 * Hosts we will fetch logo bytes from.
 *
 * The brand record's icon URL is vendor-supplied and the record is selected by
 * a user-supplied domain, so an unrestricted server-side fetch would let a
 * caller steer requests at internal addresses. An allowlist of the two hosts
 * this code actually uses closes that without host-resolution heuristics; add
 * to it deliberately when adding a provider.
 */
const FETCHABLE_LOGO_HOSTS = new Set(["cdn.brandfetch.io", "www.google.com"]);

/** Is this a URL we are willing to fetch logo bytes from? */
export function isFetchableLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && FETCHABLE_LOGO_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
