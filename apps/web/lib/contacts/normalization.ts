export type ContactImportSource =
  | "browser_picker"
  | "computer_contacts"
  | "csv"
  | "google"
  | "manual"
  | "microsoft"
  | "paste"
  | "vcard";

export type ContactImportInput = {
  name?: string | string[] | null;
  emails?: string[] | null;
  phones?: string[] | null;
  source?: ContactImportSource | string | null;
};

export type NormalizedImportedContact = {
  displayName: string;
  emails: string[];
  phones: string[];
  primaryEmail: string | null;
  primaryPhoneE164: string | null;
  source: ContactImportSource;
};

const supportedSources = new Set<ContactImportSource>([
  "browser_picker",
  "computer_contacts",
  "csv",
  "google",
  "manual",
  "microsoft",
  "paste",
  "vcard",
]);

function normalizeContactImportSource(value: unknown): ContactImportSource {
  return typeof value === "string" && supportedSources.has(value as ContactImportSource)
    ? (value as ContactImportSource)
    : "manual";
}

function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizePhoneE164(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function normalizeImportedContact(
  input: ContactImportInput,
  fallbackSource: ContactImportSource = "manual",
): NormalizedImportedContact | null {
  const name = normalizeContactName(input.name);
  const emails = uniqueClean((input.emails ?? []).map(normalizeEmailAddress));
  const phones = uniqueClean((input.phones ?? []).map(normalizePhoneE164));
  const displayName = name || emails[0] || phones[0] || "";

  if (!displayName || (emails.length === 0 && phones.length === 0)) {
    return null;
  }

  return {
    displayName,
    emails,
    phones,
    primaryEmail: emails[0] ?? null,
    primaryPhoneE164: phones[0] ?? null,
    source: normalizeContactImportSource(input.source ?? fallbackSource),
  };
}

function parseLooseContactsText(
  text: string,
  source: ContactImportSource = "paste",
): ContactImportInput[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      const emailMatches = trimmed.match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) ?? [];
      const phoneMatches = trimmed.match(/(?:\+?\d[\d().\-\s]{6,}\d)/g) ?? [];
      const emails = emailMatches.flatMap((part) => normalizeEmailAddress(part) ?? []);
      const phones = phoneMatches.flatMap((part) => normalizePhoneE164(part) ?? []);
      const nameSource = [...emailMatches, ...phoneMatches].reduce(
        (next, match) => next.replace(match, " "),
        trimmed,
      );
      const nameParts = splitContactLine(nameSource);
      return [
        {
          name: nameParts.join(" ").replace(/\s+/g, " ").trim() || undefined,
          emails,
          phones,
          source,
        },
      ];
    });
}

export function parseVCardContactsText(text: string): ContactImportInput[] {
  const cards = text
    .replace(/\r\n[ \t]/g, "")
    .split(/BEGIN:VCARD/i)
    .flatMap((card) => {
      const trimmed = card.trim();
      return trimmed ? [trimmed] : [];
    });

  return cards.flatMap((card) => {
    const lines = card.split(/\r?\n/);
    const names: string[] = [];
    const emails: string[] = [];
    const phones: string[] = [];

    for (const line of lines) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) continue;
      const key = line.slice(0, separatorIndex).toUpperCase();
      const rawValue = decodeVCardValue(line.slice(separatorIndex + 1));

      if (key.startsWith("FN")) {
        names.push(rawValue);
      } else if (key.startsWith("N") && names.length === 0) {
        names.push(
          rawValue
            .split(";")
            .filter(Boolean)
            .reverse()
            .join(" "),
        );
      } else if (key.startsWith("EMAIL")) {
        emails.push(rawValue);
      } else if (key.startsWith("TEL")) {
        phones.push(rawValue);
      }
    }

    return [
      {
        name: names.find((name) => name.trim())?.trim(),
        emails,
        phones,
        source: "vcard",
      },
    ];
  });
}

export function parseContactsPayloadText(
  text: string,
  source: ContactImportSource = "paste",
): ContactImportInput[] {
  return /BEGIN:VCARD/i.test(text)
    ? parseVCardContactsText(text)
    : parseLooseContactsText(text, source);
}

function normalizeContactName(value: ContactImportInput["name"]): string | null {
  const raw = Array.isArray(value) ? value.find((item) => item?.trim()) : value;
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 160) : null;
}

function splitContactLine(line: string) {
  const csvParts = line.includes(",")
    ? line.split(",")
    : line.includes("\t")
      ? line.split("\t")
      : line.split(/\s{2,}/);
  return csvParts.flatMap((part) => {
    const trimmed = part.trim();
    return trimmed ? [trimmed] : [];
  });
}

function decodeVCardValue(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueClean(values: Array<string | null>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
