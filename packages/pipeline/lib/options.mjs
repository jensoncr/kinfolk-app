export function readNonEmptyStringOption(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function readEnumStringOption(value, fallback, allowedValues, label = "option") {
  const next = readNonEmptyStringOption(value, fallback);
  if (allowedValues.includes(next)) return next;
  throw new Error(`${label} must be one of: ${allowedValues.join(", ")}.`);
}

export function readBooleanOption(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export function readFiniteNumberOption(
  value,
  fallback,
  { integer = false, max = Number.POSITIVE_INFINITY, min = Number.NEGATIVE_INFINITY } = {},
) {
  const parsed = parseFiniteNumberOption(value, { integer });
  const next = parsed ?? fallback;
  return Math.min(max, Math.max(min, next));
}

export function readOptionalFiniteNumberOption(
  value,
  { integer = false, max = Number.POSITIVE_INFINITY, min = Number.NEGATIVE_INFINITY } = {},
) {
  const parsed = parseFiniteNumberOption(value, { integer });
  if (parsed == null) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function parseFiniteNumberOption(value, { integer }) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return integer && !Number.isInteger(value) ? null : value;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (integer && !/^-?\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return integer && !Number.isInteger(parsed) ? null : parsed;
}
