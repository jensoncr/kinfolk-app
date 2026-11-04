export function clampInteger(
  value: unknown,
  defaultValue: number,
  min: number,
  max: number,
) {
  if (value == null || typeof value === "boolean") {
    return defaultValue;
  }

  if (typeof value === "string" && !value.trim()) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, parsed));
}
