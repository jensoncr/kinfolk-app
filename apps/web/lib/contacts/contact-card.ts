export const kinfolkContactCardPath = "/api/kinfolk/contact-card.vcf";

const defaultContactNote =
  "Your Kinfolk apartment and roommate matching assistant. Text this thread to update preferences, ask about listings, or review roommate matches.";

export type KinfolkVCardOptions = {
  baseUrl?: string | null;
  logoBase64?: string | null;
  note?: string | null;
  phoneNumber?: string | null;
  websiteUrl?: string | null;
};

export function buildKinfolkContactCardUrl({
  baseUrl,
}: {
  baseUrl: string | null | undefined;
}) {
  const normalized = normalizeKinfolkContactCardBaseUrl(baseUrl);
  return normalized ? `${normalized}${kinfolkContactCardPath}` : "";
}

export function buildKinfolkVCard({
  baseUrl,
  logoBase64,
  note,
  phoneNumber,
  websiteUrl,
}: KinfolkVCardOptions = {}) {
  const normalizedPhone = phoneNumber?.trim();
  const normalizedWebsite =
    normalizeKinfolkContactWebsiteUrl(websiteUrl) ||
    normalizeKinfolkContactCardBaseUrl(baseUrl);
  const normalizedLogo = logoBase64?.replace(/\s+/g, "");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "PRODID:-//Kinfolk//Text Agent Contact//EN",
    "N:Kinfolk;;;;",
    "FN:Kinfolk",
    "ORG:Kinfolk",
    "TITLE:Apartment and roommate matching assistant",
    normalizedPhone ? `TEL;TYPE=CELL:${normalizedPhone}` : null,
    normalizedWebsite ? `URL:${normalizedWebsite}` : null,
    `NOTE:${escapeVCardText(note?.trim() || defaultContactNote)}`,
    normalizedLogo ? `PHOTO;ENCODING=b;TYPE=PNG:${normalizedLogo}` : null,
    "END:VCARD",
  ].filter((line): line is string => Boolean(line));

  return `${lines.map(foldVCardLine).join("\r\n")}\r\n`;
}

export function normalizeKinfolkContactCardBaseUrl(value: string | null | undefined) {
  return parseHttpUrl(value)?.origin ?? "";
}

export function normalizeKinfolkContactWebsiteUrl(value: string | null | undefined) {
  const url = parseHttpUrl(value);
  if (!url) {
    return "";
  }
  if (/^\/+$/u.test(url.pathname) && !url.search && !url.hash) {
    return url.origin;
  }
  return url.toString();
}

function parseHttpUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function escapeVCardText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldVCardLine(line: string) {
  const maxLineLength = 75;
  if (line.length <= maxLineLength) {
    return line;
  }

  const parts = [line.slice(0, maxLineLength)];
  let remaining = line.slice(maxLineLength);
  const continuationLength = maxLineLength - 1;
  while (remaining.length > continuationLength) {
    parts.push(remaining.slice(0, continuationLength));
    remaining = remaining.slice(continuationLength);
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts
    .map((part, index) => (index === 0 ? part : ` ${part}`))
    .join("\r\n");
}
