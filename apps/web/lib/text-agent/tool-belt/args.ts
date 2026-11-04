export function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }

  return value.trim().toLowerCase() === "true";
}

export function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
}

export function readPositiveLimit(value: unknown, fallback: number, max: number) {
  const parsed = readNumber(value);
  if (parsed == null || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}
