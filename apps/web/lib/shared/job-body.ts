/**
 * Lenient body reading for scheduler-triggered job routes.
 *
 * Job routes are poked by crons and manual curls: an empty body, a non-object
 * body, or loosely-typed option values ("true", 1) must fall back to defaults
 * instead of 400ing — only malformed JSON is rejected. This is deliberately
 * NOT parseJsonBody (lib/shared/api-body), whose strict schema-or-400 contract
 * fits user-facing routes.
 */

export type ParsedJobBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

export async function readJobRequestBody(
  request: Request,
): Promise<ParsedJobBody> {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: true, body: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Request body must be valid JSON" };
  }

  return {
    ok: true,
    body:
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
  };
}

/** Boolean option that also accepts "true"/"false"/"1"/"0" and 1/0. */
export function readBooleanOption(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    if (normalized === "1") return true;
    if (normalized === "0") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}

/** Integer option: floors finite numbers, parses numeric strings; clamped. */
export function readIntegerOption(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : null;
  if (parsed == null || !Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * A `since` cursor from the body, clamped to the past; anything missing or
 * unparseable falls back to the given default.
 */
export function readSinceDate(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = new Date(value);
  const parsedTime = parsed.getTime();
  return Number.isFinite(parsedTime) && parsedTime <= Date.now()
    ? parsed
    : fallback;
}
