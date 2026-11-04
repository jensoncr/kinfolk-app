import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePublicHttpsOrigin, parsePublicHttpsUrl } from "../shared/public-url";
import { requireBoundarySecret } from "../shared/secrets";

export type ProfileCardFact = {
  label: string;
  value: string;
};

export type GroupJoinProfileCardSnapshot = {
  about: string | null;
  facts: ProfileCardFact[];
  fitScore: number | null;
  groupLabel: string;
  groupNeighborhood: string;
  headline: string;
  imageUrl: string | null;
  requestedAt: string;
  requesterInitials: string;
  requesterName: string;
  requesterUserId: string;
};

const profileCardTokenTtlSeconds = 7 * 24 * 60 * 60;
const roommateProfileCardDataMaxLength = 5000;

const roommateCardFieldLimits = {
  about: 140,
  factLabel: 28,
  factValue: 72,
  groupLabel: 72,
  groupNeighborhood: 56,
  headline: 72,
  imageUrl: 384,
  requestedAt: 32,
  requesterInitials: 8,
  requesterName: 72,
  requesterUserId: 72,
} as const;

type EncodedRoommateProfileCardSnapshot = {
  a: string | null;
  d: string;
  f: Array<[string, string]>;
  g: string;
  h: string;
  i: string | null;
  n: string;
  r: string;
  s: number | null;
  u: string;
  x: string;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readProfileCardFacts(value: unknown): ProfileCardFact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }

      const record = entry as Record<string, unknown>;
      const label = readString(record.label).trim();
      const factValue = readString(record.value).trim();
      return label && factValue ? [{ label, value: factValue }] : [];
    })
    .slice(0, 5);
}

export function parseGroupJoinProfileCardSnapshot(
  value: unknown,
): GroupJoinProfileCardSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const requesterName = readString(record.requesterName).trim();
  const groupLabel = readString(record.groupLabel).trim();
  if (!requesterName || !groupLabel) {
    return null;
  }

  return {
    about: readNullableString(record.about),
    facts: readProfileCardFacts(record.facts),
    fitScore: readNullableNumber(record.fitScore),
    groupLabel,
    groupNeighborhood: readString(record.groupNeighborhood).trim(),
    headline: readString(record.headline).trim(),
    imageUrl: readNullableString(record.imageUrl),
    requestedAt: readString(record.requestedAt).trim(),
    requesterInitials: readString(record.requesterInitials).trim() || "K",
    requesterName,
    requesterUserId: readString(record.requesterUserId).trim(),
  };
}

export function buildGroupJoinProfileCardUrl({
  baseUrl,
  notificationId,
  now = new Date(),
}: {
  baseUrl: string;
  notificationId: string;
  now?: Date;
}) {
  const expiresAt = Math.floor(now.getTime() / 1000) + profileCardTokenTtlSeconds;
  const token = signGroupJoinProfileCardToken(notificationId, expiresAt);
  const pathNotificationId = encodeURIComponent(notificationId);
  return `${normalizeProfileCardBaseUrl(baseUrl)}/api/profile-card/${pathNotificationId}?expires=${expiresAt}&token=${token}`;
}

export function buildRoommateProfileCardUrl({
  baseUrl,
  now = new Date(),
  snapshot,
}: {
  baseUrl: string;
  now?: Date;
  snapshot: GroupJoinProfileCardSnapshot;
}) {
  const expiresAt = Math.floor(now.getTime() / 1000) + profileCardTokenTtlSeconds;
  const data = encodeRoommateProfileCardSnapshot(snapshot);
  const token = signRoommateProfileCardToken(data, expiresAt);
  return `${normalizeProfileCardBaseUrl(baseUrl)}/api/roommate-card?data=${encodeURIComponent(data)}&expires=${expiresAt}&token=${token}`;
}

export function resolveProfileCardPhotoUrl({
  baseUrl,
  imageUrl,
}: {
  baseUrl: string | null | undefined;
  imageUrl: string | null;
}) {
  const trimmedImageUrl = imageUrl?.trim();
  if (!trimmedImageUrl) {
    return null;
  }

  const absoluteImageUrl = parsePublicHttpsUrl(trimmedImageUrl);
  if (absoluteImageUrl) {
    return absoluteImageUrl.toString();
  }

  if (trimmedImageUrl.startsWith("//") || trimmedImageUrl.includes("\\")) {
    return null;
  }

  const baseOrigin = normalizeProfileCardPhotoBaseUrl(baseUrl);
  if (!baseOrigin) {
    return null;
  }

  try {
    const resolved = new URL(trimmedImageUrl, `${baseOrigin}/`);
    return resolved.protocol === "https:" && resolved.origin === baseOrigin
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseRoommateProfileCardData(data: string | null) {
  if (!data || data.length > roommateProfileCardDataMaxLength) {
    return null;
  }

  try {
    const decoded = Buffer.from(data, "base64url").toString("utf8");
    return parseCompactRoommateProfileCardPayload(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export function verifyGroupJoinProfileCardToken({
  expires,
  notificationId,
  now = new Date(),
  token,
}: {
  expires: string | null;
  notificationId: string;
  now?: Date;
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
    expected = signGroupJoinProfileCardToken(notificationId, expiresAt);
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

export function verifyRoommateProfileCardToken({
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
    data.length > roommateProfileCardDataMaxLength ||
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
    expected = signRoommateProfileCardToken(data, expiresAt);
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

export function normalizeProfileCardFitScore(
  score: number | null | undefined,
): number | null {
  if (score == null || !Number.isFinite(score) || score <= 0) {
    return null;
  }
  return Math.min(100, Math.round(score));
}

function encodeRoommateProfileCardSnapshot(snapshot: GroupJoinProfileCardSnapshot) {
  return Buffer.from(
    JSON.stringify(encodeCompactRoommateProfileCardSnapshot(snapshot)),
    "utf8",
  ).toString("base64url");
}

function parseCompactRoommateProfileCardPayload(
  value: unknown,
): GroupJoinProfileCardSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<EncodedRoommateProfileCardSnapshot>;
  const requesterName = readString(record.r).trim();
  const groupLabel = readString(record.g).trim();
  if (!requesterName || !groupLabel) {
    return null;
  }

  return {
    about: readNullableString(record.a),
    facts: Array.isArray(record.f)
      ? record.f.flatMap((entry) => {
          if (!Array.isArray(entry)) return [];
          const label = readString(entry[0]).trim();
          const factValue = readString(entry[1]).trim();
          return label && factValue ? [{ label, value: factValue }] : [];
        })
      : [],
    fitScore: readNullableNumber(record.s),
    groupLabel,
    groupNeighborhood: readString(record.n).trim(),
    headline: readString(record.h).trim(),
    imageUrl: readNullableString(record.i),
    requestedAt: readString(record.d).trim(),
    requesterInitials: readString(record.x).trim() || "K",
    requesterName,
    requesterUserId: readString(record.u).trim(),
  };
}

function encodeCompactRoommateProfileCardSnapshot(
  snapshot: GroupJoinProfileCardSnapshot,
): EncodedRoommateProfileCardSnapshot {
  return {
    a: truncateNullable(snapshot.about, roommateCardFieldLimits.about),
    d: truncateRequired(
      snapshot.requestedAt,
      roommateCardFieldLimits.requestedAt,
    ),
    f: snapshot.facts.slice(0, 4).flatMap((fact) => {
      const label = truncateRequired(fact.label, roommateCardFieldLimits.factLabel);
      const value = truncateRequired(fact.value, roommateCardFieldLimits.factValue);
      return label && value ? ([[label, value]] as Array<[string, string]>) : [];
    }),
    g: truncateRequired(
      snapshot.groupLabel,
      roommateCardFieldLimits.groupLabel,
    ),
    h: truncateRequired(snapshot.headline, roommateCardFieldLimits.headline),
    i: boundedNullableUrl(snapshot.imageUrl, roommateCardFieldLimits.imageUrl),
    n: truncateRequired(
      snapshot.groupNeighborhood,
      roommateCardFieldLimits.groupNeighborhood,
    ),
    r: truncateRequired(
      snapshot.requesterName,
      roommateCardFieldLimits.requesterName,
    ),
    s: snapshot.fitScore,
    u: truncateRequired(
      snapshot.requesterUserId,
      roommateCardFieldLimits.requesterUserId,
    ),
    x:
      truncateRequired(
        snapshot.requesterInitials,
        roommateCardFieldLimits.requesterInitials,
      ) || "K",
  };
}

function truncateNullable(value: string | null, maxLength: number): string | null {
  const truncated = truncateRequired(value ?? "", maxLength);
  return truncated || null;
}

function truncateRequired(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function boundedNullableUrl(value: string | null, maxLength: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function signGroupJoinProfileCardToken(
  notificationId: string,
  expiresAt: number,
) {
  return createHmac("sha256", getGroupJoinProfileCardSigningSecret())
    .update(`${notificationId}.${expiresAt}`)
    .digest("hex");
}

function signRoommateProfileCardToken(data: string, expiresAt: number) {
  return createHmac("sha256", getGroupJoinProfileCardSigningSecret())
    .update(`roommate-card.${expiresAt}.${data}`)
    .digest("hex");
}

function normalizeProfileCardBaseUrl(baseUrl: string) {
  const origin = normalizePublicHttpsOrigin(baseUrl);
  if (!origin) {
    throw new Error("Profile card base URL must be a public HTTPS origin.");
  }
  return origin;
}

function normalizeProfileCardPhotoBaseUrl(
  baseUrl: string | null | undefined,
) {
  return normalizePublicHttpsOrigin(baseUrl);
}

function getGroupJoinProfileCardSigningSecret() {
  return requireBoundarySecret("KINFOLK_PROFILE_CARD_SECRET", "profile-card");
}
