/**
 * Site favicon for a domain. Authoritative (the organization serves it) and
 * needs no vendor key, which makes it the fallback when brand search has no
 * usable record — and the picker preview for schools, which brand search
 * covers poorly.
 */
export function faviconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}
