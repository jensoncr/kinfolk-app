const PRODUCTION_ORIGIN = "https://usekinfolk.com";

/**
 * Public site origin for crawler-facing URLs (robots, sitemap). Falls back to
 * the production domain — never localhost — when the env var is missing or
 * malformed, mirroring app/layout.tsx's metadataBase policy.
 */
export function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_KINFOLK_BASE_URL?.trim();
  if (!configured) {
    return PRODUCTION_ORIGIN;
  }
  try {
    const url = new URL(configured);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : PRODUCTION_ORIGIN;
  } catch {
    return PRODUCTION_ORIGIN;
  }
}
