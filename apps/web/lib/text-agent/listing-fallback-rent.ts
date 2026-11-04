// Heuristic rent score for fallback-ranked listings. The rent passed in is
// per-person wherever the unit splits, and a low split is the product working
// (a 4-bed split four ways lands well under $1,200/person), so cheap never
// loses points — only high per-person rents do.
export function scoreFallbackRent(rent: number | null) {
  if (rent == null) {
    return 6;
  }
  if (rent <= 4000) {
    return 14;
  }
  if (rent <= 4500) {
    return 5;
  }
  return -8;
}
