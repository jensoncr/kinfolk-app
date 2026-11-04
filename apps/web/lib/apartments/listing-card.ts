import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePublicHttpsOrigin } from "../shared/public-url";
import { requireBoundarySecret } from "../shared/secrets";

/**
 * Shared shape + formatting for a listing recommendation card.
 *
 * A snapshot is captured on the `text_listing_recommendations` row when the
 * carousel is sent, so the rendered card image and any follow-up message stay
 * consistent even if the underlying listing later changes.
 */
export type ListingCardSnapshot = {
  address: string;
  bathrooms: number | null;
  bedrooms: number | null;
  description: string;
  effectivePerPersonRent: number | null;
  effectiveRent: number | null;
  evidence: string[];
  fitScore: number;
  fitSource: string | null;
  id: string;
  imageUrl: string | null;
  monthlyRent: number | null;
  neighborhood: string;
  perPersonRent: number | null;
  recommendedHouseholdSize: number | null;
  sourceUrl: string | null;
};

const listingCardTokenTtlSeconds = 7 * 24 * 60 * 60;

// Cap on the encoded snapshot carried in an embedded card URL. A stateless card
// trades a DB row for a signed blob in the link, so it must stay inside SMS/MMS
// URL limits — far shorter than the carousel cards that read from the DB.
const embeddedListingCardDataMaxLength = 3500;
const embeddedListingCardFieldLimits = {
  address: 120,
  imageUrl: 1024,
  neighborhood: 80,
  sourceUrl: 1024,
} as const;

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableTrimmedString(value: unknown): string | null {
  const trimmed = readTrimmedString(value);
  return trimmed || null;
}

// Snapshots written before fit_source existed carry no source at all; they
// get the same honest treatment as the heuristic ranker's estimates.
function readFitSource(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseListingCardSnapshot(
  value: unknown,
): ListingCardSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const address = readTrimmedString(record.address);
  if (!address) {
    return null;
  }

  return {
    address,
    bathrooms: readNumber(record.bathrooms),
    bedrooms: readNumber(record.bedrooms),
    description: readTrimmedString(record.description),
    effectivePerPersonRent: readNumber(record.effectivePerPersonRent),
    effectiveRent: readNumber(record.effectiveRent),
    evidence: Array.isArray(record.evidence)
      ? record.evidence.flatMap((entry) => {
          const trimmed = readTrimmedString(entry);
          return trimmed ? [trimmed] : [];
        })
      : [],
    fitScore: readNumber(record.fitScore) ?? 0,
    fitSource: readFitSource(record.fit_source),
    id: readTrimmedString(record.id),
    imageUrl: readNullableTrimmedString(record.imageUrl),
    monthlyRent: readNumber(record.monthlyRent),
    neighborhood: readTrimmedString(record.neighborhood),
    perPersonRent: readNumber(record.perPersonRent),
    recommendedHouseholdSize: readNumber(record.recommendedHouseholdSize),
    sourceUrl: readNullableTrimmedString(record.sourceUrl),
  };
}

export function formatListingRent(snapshot: {
  effectivePerPersonRent?: number | null;
  effectiveRent: number | null;
  monthlyRent: number | null;
  perPersonRent?: number | null;
  recommendedHouseholdSize?: number | null;
}): string | null {
  const splitSize = snapshot.recommendedHouseholdSize ?? null;
  const splitRent = snapshot.effectivePerPersonRent ?? snapshot.perPersonRent ?? null;
  if (splitSize != null && splitSize > 1 && splitRent != null) {
    return `$${Math.round(splitRent).toLocaleString()}/person`;
  }

  const rent = snapshot.effectiveRent ?? snapshot.monthlyRent;
  return rent != null ? `$${Math.round(rent).toLocaleString()}/mo` : null;
}

export function formatListingBeds(snapshot: {
  bathrooms: number | null;
  bedrooms: number | null;
}): string {
  if (snapshot.bedrooms == null) {
    return "Apartment";
  }
  const beds = snapshot.bedrooms === 0 ? "Studio" : `${snapshot.bedrooms} bed`;
  return snapshot.bathrooms ? `${beds}, ${snapshot.bathrooms} bath` : beds;
}

// Only an engine-scored match (a precomputed apartment_listing_matches row)
// may claim a "% fit" on the card; a heuristic or unsourced rank reads as a
// pick, not a score.
export function formatListingFitBadge(
  snapshot: { fitScore: number; fitSource: string | null },
  rank: number,
): string {
  const fit = normalizeCardFitScore(snapshot.fitScore);
  if (snapshot.fitSource === "engine" && fit != null) {
    return `#${rank} match · ${fit}% fit`;
  }
  return `#${rank} pick`;
}

function normalizeCardFitScore(score: number): number | null {
  if (!Number.isFinite(score) || score <= 0) {
    return null;
  }
  return Math.min(100, Math.round(score));
}

// Card text never breaks mid-word: overflow clips at the last full word
// before the limit, with trailing punctuation tidied ahead of the ellipsis.
// The implementation lives in the shared card-text module so the profile and
// roommate cards clip the same way.
export { clipCardText as clipListingCardText } from "../shared/card-text";

export function buildListingCardUrl({
  baseUrl,
  now = new Date(),
  recommendationId,
}: {
  baseUrl: string;
  now?: Date;
  recommendationId: string;
}) {
  const expiresAt = Math.floor(now.getTime() / 1000) + listingCardTokenTtlSeconds;
  const token = signListingCardToken(recommendationId, expiresAt);
  const pathRecommendationId = encodeURIComponent(recommendationId);
  return `${normalizeCardBaseUrl(baseUrl)}/api/listing-card/${pathRecommendationId}?expires=${expiresAt}&token=${token}`;
}

export function verifyListingCardToken({
  expires,
  now = new Date(),
  recommendationId,
  token,
}: {
  expires: string | null;
  now?: Date;
  recommendationId: string;
  token: string | null;
}) {
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now.getTime() / 1000)) {
    return false;
  }

  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    return false;
  }

  let expected: string;
  try {
    expected = signListingCardToken(recommendationId, expiresAt);
  } catch {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const tokenBuffer = Buffer.from(token, "hex");
  return (
    expectedBuffer.length === tokenBuffer.length &&
    timingSafeEqual(expectedBuffer, tokenBuffer)
  );
}

// ---------------------------------------------------------------------------
// Stateless ("embedded") listing card
//
// The carousel card reads its snapshot from a persisted text_listing_recommendations
// row, which needs a text_thread to exist first. Match notifications fire before
// any thread exists (often the first outbound to a verified phone), so they sign
// the snapshot directly into the link instead — mirroring the roommate card. The
// `/api/listing-card/embedded` route verifies the token and renders straight from
// the decoded blob, no DB lookup required.
// ---------------------------------------------------------------------------

export function buildEmbeddedListingCardUrl({
  baseUrl,
  now = new Date(),
  rank = 1,
  snapshot,
}: {
  baseUrl: string;
  now?: Date;
  rank?: number;
  snapshot: ListingCardSnapshot;
}) {
  const expiresAt = Math.floor(now.getTime() / 1000) + listingCardTokenTtlSeconds;
  const data = encodeEmbeddedListingCardSnapshot(snapshot);
  const token = signEmbeddedListingCardToken(data, expiresAt);
  const normalizedRank =
    Number.isFinite(rank) && rank >= 1 ? Math.floor(rank) : 1;
  return `${normalizeCardBaseUrl(baseUrl)}/api/listing-card/embedded?data=${encodeURIComponent(data)}&rank=${normalizedRank}&expires=${expiresAt}&token=${token}`;
}

export function parseEmbeddedListingCardData(
  data: string | null,
): ListingCardSnapshot | null {
  if (!data || data.length > embeddedListingCardDataMaxLength) {
    return null;
  }

  try {
    const decoded = Buffer.from(data, "base64url").toString("utf8");
    return parseListingCardSnapshot(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export function verifyEmbeddedListingCardToken({
  data,
  expires,
  now = new Date(),
  token,
}: {
  data: string | null;
  expires: string | null;
  now?: Date;
  token: string | null;
}) {
  const expiresAt = Number(expires);
  if (
    !data ||
    data.length > embeddedListingCardDataMaxLength ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(now.getTime() / 1000)
  ) {
    return false;
  }

  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    return false;
  }

  let expected: string;
  try {
    expected = signEmbeddedListingCardToken(data, expiresAt);
  } catch {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const tokenBuffer = Buffer.from(token, "hex");
  return (
    expectedBuffer.length === tokenBuffer.length &&
    timingSafeEqual(expectedBuffer, tokenBuffer)
  );
}

function encodeEmbeddedListingCardSnapshot(snapshot: ListingCardSnapshot) {
  // Only the fields the rendered card reads are carried; description/evidence are
  // dropped to keep the link short. parseListingCardSnapshot reconstructs the
  // full shape (with safe defaults) on the other side.
  const compact = {
    address: snapshot.address
      .trim()
      .slice(0, embeddedListingCardFieldLimits.address),
    bathrooms: snapshot.bathrooms,
    bedrooms: snapshot.bedrooms,
    effectivePerPersonRent: snapshot.effectivePerPersonRent,
    effectiveRent: snapshot.effectiveRent,
    fitScore: snapshot.fitScore,
    fit_source: snapshot.fitSource,
    id: snapshot.id,
    imageUrl: boundedEmbeddedUrl(
      snapshot.imageUrl,
      embeddedListingCardFieldLimits.imageUrl,
    ),
    monthlyRent: snapshot.monthlyRent,
    neighborhood: snapshot.neighborhood
      .trim()
      .slice(0, embeddedListingCardFieldLimits.neighborhood),
    perPersonRent: snapshot.perPersonRent,
    recommendedHouseholdSize: snapshot.recommendedHouseholdSize,
    sourceUrl: boundedEmbeddedUrl(
      snapshot.sourceUrl,
      embeddedListingCardFieldLimits.sourceUrl,
    ),
  };
  return Buffer.from(JSON.stringify(compact), "utf8").toString("base64url");
}

function boundedEmbeddedUrl(
  value: string | null,
  maxLength: number,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function signEmbeddedListingCardToken(data: string, expiresAt: number) {
  return createHmac("sha256", getListingCardSigningSecret())
    .update(`listing-card-embedded.${expiresAt}.${data}`)
    .digest("hex");
}

function signListingCardToken(recommendationId: string, expiresAt: number) {
  return createHmac("sha256", getListingCardSigningSecret())
    .update(`${recommendationId}.${expiresAt}`)
    .digest("hex");
}

function normalizeCardBaseUrl(baseUrl: string) {
  const origin = normalizePublicHttpsOrigin(baseUrl);
  if (origin) {
    return origin;
  }
  throw new Error("Listing card base URL must be a public HTTPS origin.");
}

function getListingCardSigningSecret() {
  return requireBoundarySecret("KINFOLK_LISTING_CARD_SECRET", "listing-card");
}
