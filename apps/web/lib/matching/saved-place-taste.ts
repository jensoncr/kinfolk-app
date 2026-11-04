/**
 * saved-place-taste.ts
 *
 * Pure math for saved-place taste overlap — the web twin of SMS listing reactions.
 * Two people who saved overlapping areas/listings get a small taste-overlap bump
 * in roommate compatibility scoring.
 *
 * Design constraints (enforced by callers):
 *  - NO `@/` imports, NO `import "server-only"` — must be relative-importable
 *    from both source and test files (Vitest has no `@/` alias).
 *  - Every function is pure and total: never throws on empty arrays; returns 0
 *    when there is no overlap (sparsity is an exact additive no-op).
 *
 * Weight rationale (chosen to stay in the same magnitude band as the existing
 * `0.08 * rapport` term in scoreCompatibility):
 *
 *   areaWeight   = 0.05  — one shared area is a weak signal (coarse geography)
 *   listingWeight = 0.08 — one shared saved listing is a stronger signal (specific taste)
 *   CAP           = 0.12 — hard cap keeps the bonus from dominating the weighted sum
 *
 * A single shared area contributes +0.05 to the calibrated score fraction, which
 * after `clamp(raw / 0.78 + bonus)` and `Math.round(* 100)` lands as roughly
 * 3–6 points for a mid-range pair — single-digit, additive, and never a penalty.
 */

/** Normalize an area label the same way match-surface.ts normalises neighbourhood
 *  names: trim + lowercase. Case-insensitive equality is safe for area labels. */
export function normalizeAreaLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Count the number of area labels that appear in both arrays (case-insensitive).
 * Returns 0 when either array is empty — additive no-op, never a penalty.
 */
export function countSavedAreaOverlap(areasA: string[], areasB: string[]): number {
  if (areasA.length === 0 || areasB.length === 0) return 0;
  const setB = new Set(areasB.map(normalizeAreaLabel));
  return areasA.filter((area) => setB.has(normalizeAreaLabel(area))).length;
}

/**
 * Count the number of listing IDs that appear in both arrays (exact match —
 * UUIDs are already case-stable). Returns 0 when either array is empty.
 */
export function countSavedListingOverlap(idsA: string[], idsB: string[]): number {
  if (idsA.length === 0 || idsB.length === 0) return 0;
  const setB = new Set(idsB);
  return idsA.filter((id) => setB.has(id)).length;
}

/**
 * Compute a small non-negative bonus for two people who saved overlapping
 * areas or listings. Returns EXACTLY 0 when both counts are 0 (sparsity
 * must be a byte-identical additive no-op when absent).
 *
 * Result is in [0, CAP] and lives in calibratedScore space (0..1 fractions)
 * alongside institutionalAffinity, personalityAffinity, and ageComfort.score.
 */
export function savedTasteCompatBonus(input: {
  sharedAreaCount: number;
  sharedListingCount: number;
}): number {
  const AREA_WEIGHT = 0.05;
  const LISTING_WEIGHT = 0.08;
  const CAP = 0.12;

  const { sharedAreaCount, sharedListingCount } = input;
  if (sharedAreaCount === 0 && sharedListingCount === 0) return 0;

  return Math.min(CAP, AREA_WEIGHT * sharedAreaCount + LISTING_WEIGHT * sharedListingCount);
}

/**
 * Compute a small non-negative point bonus for an apartment listing whose
 * neighbourhood or listing ID matches the viewer's saved places.
 *
 * Bonus bands (same order-of-magnitude as the +14 neighbourhood bump in
 * listingFitScore):
 *   - +8 if the listing itself was saved by the viewer
 *   - +5 if the listing's neighbourhood case-insensitively matches a saved area
 *   -  0 otherwise (never a penalty)
 *
 * This is intentionally weaker than the preferences-based +14 because a save
 * is a taste nudge, not a stated requirement.
 */
export function savedListingFitBonus(input: {
  listingNeighborhood: string;
  listingId: string;
  savedAreaLabels: string[];
  savedListingIds: string[];
}): number {
  const { listingNeighborhood, listingId, savedAreaLabels, savedListingIds } = input;

  if (savedListingIds.includes(listingId)) {
    return 8;
  }

  const normalizedNeighborhood = normalizeAreaLabel(listingNeighborhood);
  if (
    normalizedNeighborhood.length > 0 &&
    savedAreaLabels.some((area) => normalizeAreaLabel(area) === normalizedNeighborhood)
  ) {
    return 5;
  }

  return 0;
}
