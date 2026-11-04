/**
 * Stateless short codes for listing links: a listing uuid encoded as base62
 * (~22 chars instead of 36, no dashes, URL-safe). Deterministic both ways, so
 * /l/<code> can 302 straight to the listing without a lookup table, and the
 * code stays exactly as non-enumerable as the uuid it encodes.
 */

const base62Alphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const maxShortCodeLength = 22;

const base62Radix = BigInt(62);

const zero = BigInt(0);

const uuidValueCeiling = BigInt(2) ** BigInt(128);

export function encodeListingShortCode(
  listingId: string | null | undefined,
): string | null {
  const normalized = listingId?.trim().toLowerCase() ?? "";
  if (!uuidPattern.test(normalized)) {
    return null;
  }

  let value = BigInt(`0x${normalized.replace(/-/g, "")}`);
  if (value === zero) {
    return base62Alphabet[0];
  }

  let code = "";
  while (value > zero) {
    code = base62Alphabet[Number(value % base62Radix)] + code;
    value /= base62Radix;
  }
  return code;
}

// The tappable Kinfolk destination for a listing: the short /l/<code> link that
// 302s to the unit pinned on the Kinfolk map. Falls back to the full
// ?listing=<uuid> URL if the code can't be built. Returns null without a base
// URL or listing id so callers can omit the link cleanly.
export function buildListingShortlinkUrl(
  baseUrl: string | null | undefined,
  listingId: string | null | undefined,
): string | null {
  const normalizedBase = normalizeListingShortlinkBaseUrl(baseUrl);
  if (!normalizedBase || !listingId) {
    return null;
  }

  const code = encodeListingShortCode(listingId);
  return code
    ? `${normalizedBase}/l/${code}`
    : `${normalizedBase}/apartments?listing=${encodeURIComponent(listingId)}`;
}

export function normalizeListingShortlinkBaseUrl(
  baseUrl: string | null | undefined,
): string | null {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function decodeListingShortCode(
  code: string | null | undefined,
): string | null {
  const normalized = code?.trim() ?? "";
  if (
    !normalized ||
    normalized.length > maxShortCodeLength ||
    !/^[0-9A-Za-z]+$/.test(normalized)
  ) {
    return null;
  }

  let value = zero;
  for (const char of normalized) {
    value = value * base62Radix + BigInt(base62Alphabet.indexOf(char));
  }
  if (value >= uuidValueCeiling) {
    return null;
  }

  const hex = value.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
