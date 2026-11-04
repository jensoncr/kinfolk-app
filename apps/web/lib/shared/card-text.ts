/**
 * Shared text helpers for the OG-card ImageResponse routes (roommate-card,
 * profile-card, listing-card). Centralizes truncation + short-date formatting
 * so the card renderers stay visually consistent.
 */

/**
 * Truncates `value` to roughly `max` characters without breaking mid-word:
 * overflow clips at the last full word before the limit, with trailing
 * punctuation tidied ahead of the ellipsis. Only a single unbroken word
 * longer than `max` ever gets cut mid-word.
 */
export function clipCardText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  const window = trimmed.slice(0, max);
  const lastSpace = window.lastIndexOf(" ");
  const kept = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return `${kept.replace(/[\s,;:·–-]+$/, "")}…`;
}

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

/**
 * Formats `value` as a short "1 Jan" style date (en-US, numeric day + short
 * month). Returns `fallback` when the value is not a parseable date.
 */
export function formatShortDate(value: string, fallback: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  return shortDateFormatter.format(new Date(timestamp));
}
