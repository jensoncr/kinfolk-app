/** Escape a literal string for safe interpolation into a RegExp source. */
export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
