/**
 * apartment-fit-core.ts
 *
 * Single source of truth for apartment-fit scoring constants and helpers.
 * This module has NO `import "server-only"` and NO `@/` imports — it is a
 * plain relative-imported leaf so both:
 *   - lib/apartments/match-surface.ts  (pure, relative imports, test-friendly)
 *   - lib/matching/apartment-listing-matches.ts  (server-only, @/ imports)
 * can import it without breaking either file's colocated test.
 */

// ---------------------------------------------------------------------------
// Named constants — all scoring literals live here, nowhere else.
// ---------------------------------------------------------------------------

/** Base fit score before any signal bonuses. */
const FIT_BASE_SCORE = 62;

/**
 * Budget bonus when per-person effective rent is below budget max by > $400.
 * The DB scorer used `> 400`; the old surface scorer used `>= 400`.
 * Canonical choice: DB rule (`> 400`), one-point boundary difference acknowledged.
 */
const BUDGET_BONUS_HIGH = 16;

/** Budget bonus when per-person effective rent is within $400 of budget max. */
const BUDGET_BONUS_STD = 10;

/** Budget bonus when only a budget floor (no cap) is present. */
const BUDGET_MIN_ONLY_BONUS = 8;

/** Neighborhood match bonus. */
const NEIGHBORHOOD_BONUS = 14;

/**
 * DB slack tolerance on budget max.
 * A listing is NOT filtered out when effectivePerPersonRent <= budgetMax + 150.
 * This governs the DB persistence path only; the surface snapshot pre-filter
 * remains strict (no slack) — see the comment in match-surface.ts.
 */
const BUDGET_MAX_SLACK = 150;

/**
 * Clamp bounds for the computed fit score.
 * Canonical choice: [50, 96] (the DB bounds).
 * Old surface bounds were [50, 88] — widened intentionally to match the DB path.
 */
export const FIT_CLAMP_MIN = 50;
export const FIT_CLAMP_MAX = 96;

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Canonical household-size rule.
 *
 * DB rule: Math.max(1, Math.min(requestedMax, bedroomLimit, 4))
 * The 4-person cap is a product decision (see plan 008).
 *
 * NOTE: lib/apartments/roommate-splits.ts has NO 4-cap and is out of scope
 * for this plan.  The surface path's *display* household may exceed 4 for
 * 5+ bedroom listings; the *scoring* household (via this function) is capped.
 */
export function recommendedHouseholdSizeCore({
  householdSizeMax,
  bedrooms,
}: {
  householdSizeMax: number | null | undefined;
  bedrooms: number | null | undefined;
}): number {
  const requestedMax =
    householdSizeMax != null && householdSizeMax > 0 ? householdSizeMax : 1;
  const bedroomLimit =
    bedrooms == null || bedrooms < 1
      ? 1
      : Math.max(1, Math.floor(bedrooms));
  return Math.max(1, Math.min(requestedMax, bedroomLimit, 4));
}

/**
 * Per-person rent using Math.round (NOT Math.ceil).
 * The old DB scorer used Math.ceil; the surface scorer used Math.round.
 * Canonical choice: Math.round — changes persisted per_person_rent by at most
 * $1 on existing apartment_listing_matches rows (acknowledged, harmless).
 */
export function perPersonRent(total: number, householdSize: number): number {
  return Math.round(total / householdSize);
}

/**
 * Budget gate: returns false when the listing should be excluded.
 *
 * - Strict on min side: exclude when effectivePerPersonRent < budgetMin.
 * - Tolerant on max side: exclude when effectivePerPersonRent > budgetMax + 150.
 *
 * This governs the DB persistence path.  The surface snapshot pre-filter
 * (rentMatchesBudget in match-surface.ts) remains STRICT (no +150 slack)
 * because loosening it would surface over-budget listings to users — a
 * product decision beyond this plan's scope.
 */
export function withinBudget(
  effectivePerPersonRent: number,
  budgetMin: number | null | undefined,
  budgetMax: number | null | undefined,
): boolean {
  if (budgetMax != null && effectivePerPersonRent > budgetMax + BUDGET_MAX_SLACK) {
    return false;
  }
  if (budgetMin != null && effectivePerPersonRent < budgetMin) {
    return false;
  }
  return true;
}

/** Clamp a fit score to [FIT_CLAMP_MIN, FIT_CLAMP_MAX]. */
export function clampFit(score: number): number {
  return Math.max(FIT_CLAMP_MIN, Math.min(FIT_CLAMP_MAX, score));
}

// ---------------------------------------------------------------------------
// Unified scoring function
// ---------------------------------------------------------------------------

export type FitInputs = {
  budgetMin: number | null;
  budgetMax: number | null;
  /** Per-person effective rent, already divided by household size. */
  effectivePerPersonRent: number;
  neighborhoodMatches: boolean;
  mustHavesMatched: number;
  mustHavesUnconfirmed: number;
  /**
   * Surface-only: +5 when a roommate split is active.
   * Intentionally absent from the DB path (defaults off).
   */
  splitActive?: boolean;
  /**
   * Surface-only: +2 when listing confirms pets allowed; -2 when pet owner
   * and listing does NOT confirm; 0 otherwise.
   * Intentionally absent from the DB path (defaults off / 0).
   */
  petBonus?: number;
  /**
   * Surface-only: +3 when availableUnitCount > 1.
   * Intentionally absent from the DB path (defaults off / 0).
   */
  extraUnitsBonus?: number;
  /**
   * DB path only: numeric delta returned by scoreBehavioralListingHints().
   * Intentionally absent from the surface path (defaults off / 0).
   */
  behavioralDelta?: number;
  /**
   * Taste bonus from the viewer's saved places (savedListingFitBonus):
   * +8 when the listing itself was saved, +5 when its neighbourhood matches a
   * saved area, 0 otherwise. Never negative.
   */
  savedPlaceBonus?: number;
};

/**
 * Compute a fit score from the canonical constants.
 * Returns a value clamped to [FIT_CLAMP_MIN, FIT_CLAMP_MAX].
 *
 * Derived from apartmentFitBreakdown() so the single score and its per-category
 * itemization can never drift: the score IS clampFit(sum of the breakdown rows).
 * See apartmentFitBreakdown() below for the per-signal scoring rules (must-have
 * caps, the `> 400` budget-bonus boundary, surface-vs-DB term gating).
 */
export function apartmentFitScore(inputs: FitInputs): number {
  return apartmentFitBreakdown(inputs).total;
}

// ---------------------------------------------------------------------------
// Breakdown — same math as apartmentFitScore, but itemized per category so the
// UI can explain how each signal moved the score. The contributions sum to
// `raw`; `total` applies the [50, 96] clamp (and may differ from the sum).
// ---------------------------------------------------------------------------

type FitContribution = {
  /** Stable identifier for the contributing category. */
  key:
    | "base"
    | "budget"
    | "neighborhood"
    | "mustHavesMatched"
    | "mustHavesUnconfirmed"
    | "split"
    | "pet"
    | "extraUnits"
    | "behavioral"
    | "savedPlace";
  /** Human-readable label for the row. */
  label: string;
  /** Signed point contribution (can be 0 for an evaluated-but-neutral signal). */
  points: number;
};

export type FitBreakdown = {
  rows: FitContribution[];
  /** Unclamped sum of all contributions. */
  raw: number;
  /** Clamped final score, matching apartmentFitScore(inputs). */
  total: number;
};

/**
 * Itemize a fit score into per-category contributions.
 *
 * The arithmetic mirrors apartmentFitScore() exactly: summing `rows[].points`
 * yields `raw`, and clampFit(raw) === total === apartmentFitScore(inputs).
 * Neutral-but-evaluated signals (e.g. an over-budget listing, or a listing
 * outside saved neighborhoods) are included with `points: 0` so the user can
 * see *why* the score isn't higher, not just what helped.
 */
export function apartmentFitBreakdown(inputs: FitInputs): FitBreakdown {
  const rows: FitContribution[] = [
    { key: "base", label: "Starting fit", points: FIT_BASE_SCORE },
  ];

  if (inputs.budgetMax != null) {
    const delta = inputs.budgetMax - inputs.effectivePerPersonRent;
    if (delta >= 0) {
      rows.push(
        delta > 400
          ? { key: "budget", label: "Well under budget", points: BUDGET_BONUS_HIGH }
          : { key: "budget", label: "Within budget", points: BUDGET_BONUS_STD },
      );
    } else {
      rows.push({ key: "budget", label: "Over budget", points: 0 });
    }
  } else if (inputs.budgetMin != null) {
    rows.push({
      key: "budget",
      label: "Above your budget floor",
      points: BUDGET_MIN_ONLY_BONUS,
    });
  }

  rows.push(
    inputs.neighborhoodMatches
      ? { key: "neighborhood", label: "In a saved neighborhood", points: NEIGHBORHOOD_BONUS }
      : { key: "neighborhood", label: "Outside saved neighborhoods", points: 0 },
  );

  if (inputs.mustHavesMatched > 0) {
    rows.push({
      key: "mustHavesMatched",
      label: "Must-haves confirmed",
      points: Math.min(12, inputs.mustHavesMatched * 4),
    });
  }
  if (inputs.mustHavesUnconfirmed > 0) {
    rows.push({
      key: "mustHavesUnconfirmed",
      label: "Must-haves unconfirmed",
      points: -Math.min(10, inputs.mustHavesUnconfirmed * 3),
    });
  }

  if (inputs.splitActive) {
    rows.push({ key: "split", label: "Roommate split", points: 5 });
  }
  if (inputs.petBonus) {
    rows.push({
      key: "pet",
      label: inputs.petBonus > 0 ? "Pet-friendly" : "Pets not confirmed",
      points: inputs.petBonus,
    });
  }
  if (inputs.extraUnitsBonus) {
    rows.push({
      key: "extraUnits",
      label: "Multiple units available",
      points: inputs.extraUnitsBonus,
    });
  }
  if (inputs.behavioralDelta) {
    rows.push({
      key: "behavioral",
      label: inputs.behavioralDelta > 0 ? "Listing signals" : "Listing concerns",
      points: inputs.behavioralDelta,
    });
  }
  if (inputs.savedPlaceBonus) {
    rows.push({
      key: "savedPlace",
      label: "Matches places you saved",
      points: inputs.savedPlaceBonus,
    });
  }

  const raw = rows.reduce((sum, row) => sum + row.points, 0);
  return { rows, raw, total: clampFit(Math.round(raw)) };
}
