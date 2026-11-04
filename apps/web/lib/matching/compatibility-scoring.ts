// Roommate-matching algorithm — extracted from lib/profiles/enrichment.ts.
// This module owns scoreCompatibility and its scoring-private helpers.
// The shared comparison engine (valueSimilarityForKey, parseBudgetConstraint,
// mergeBudgetConstraints, budgetConstraintSimilarity, clamp, tokenize, etc.)
// and the shared constants/types (BudgetConstraint, trustEntityFactKeys,
// assistantTrustRapportFactKeys, marketBudget*, minimumBudgetGapScale)
// remain in ../profiles/enrichment and are imported relatively here.

import type { Json } from "../supabase/types";
import {
  consolidateProfileFactsForProjection,
  valueSimilarityForKey,
  clamp,
  parseBudgetConstraint,
  mergeBudgetConstraints,
  budgetConstraintSimilarity,
  parseJsonObject,
  titleCase,
  trustEntityLabelForTokens,
  trustEntityOverlap,
  tokenize,
  assistantTrustRapportFactKeys,
  trustEntityFactKeys,
  type ProfileFactForScoring,
  type CompatibilityScore,
} from "./fact-similarity";
import { savedTasteCompatBonus } from "./saved-place-taste";

// ---------------------------------------------------------------------------
// Age-comfort types
// ---------------------------------------------------------------------------

type AgePreference = {
  min: number | null;
  max: number | null;
  strict: boolean;
};

type AgePreferenceScore = {
  score: number;
  strictFailure: boolean;
  satisfied: boolean;
};

type AgeComfortResult = {
  score: number;
  strictFailure: boolean;
  hasSignal: boolean;
  hasRangeSignal: boolean;
  rangeSatisfied: boolean;
};

// ---------------------------------------------------------------------------
// Budget constants (scoring-private subset)
// ---------------------------------------------------------------------------

const budgetFactKeys = new Set([
  "budget",
  "budget_preferred_max",
  "budget_min",
  "budget_max",
]);

// Move-in windows only hard-exclude when they miss by more than ~a season.
// `moveInWindowSimilarity` decays linearly over a 90-day horizon, so this floor
// (~72 days apart) is where a shared lease becomes implausible; nearer
// near-misses soften the score through the weighted gate term instead.
const MOVE_IN_GATE_FLOOR = 0.2;

// ---------------------------------------------------------------------------
// Coverage-aware term signals
//
// A term is "covered" only when BOTH users have signal for it. Uncovered terms
// no longer masquerade as 0.5-neutral in the weighted sum — they contribute a
// conservative prior to the centered score and widen the confidence range
// instead, so a blank profile can no longer manufacture a mid-40s match.
// ---------------------------------------------------------------------------

type TermSignal = { value: number; covered: boolean };

// What an unmeasured soft term contributes to the centered / low / high score.
const UNKNOWN_TERM_CENTER = 0.4;
const UNKNOWN_TERM_LOW = 0.2;
const UNKNOWN_TERM_HIGH = 0.85;

// Fail-closed feasibility: a missing market/budget/move-in/household fact used
// to pass as 0.5-neutral through the gate; unknowns now drag the gate down.
const UNKNOWN_FEASIBILITY_CENTER = 0.3;
const UNKNOWN_FEASIBILITY_LOW = 0.15;
const UNKNOWN_FEASIBILITY_HIGH = 0.85;

// Gate fit weights (market/budget/move-in/household). The coverage denominator
// derives from this table, so editing a weight can never silently skew it.
const FEASIBILITY_FIT_WEIGHTS = {
  market: 0.18,
  budget: 0.22,
  moveIn: 0.15,
  household: 0.1,
} as const;
const FEASIBILITY_FIT_WEIGHT_TOTAL = Object.values(
  FEASIBILITY_FIT_WEIGHTS,
).reduce((sum, weight) => sum + weight, 0);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function scoreCompatibility(
  userA: { userId: string; displayName: string; facts: ProfileFactForScoring[] },
  userB: { userId: string; displayName: string; facts: ProfileFactForScoring[] },
  savedOverlap?: { sharedAreaCount: number; sharedListingCount: number },
): CompatibilityScore {
  const factsA = consolidatedEligibleFacts(userA.facts);
  const factsB = consolidatedEligibleFacts(userB.facts);
  const lifestyle = dimensionSimilaritySignal(factsA, factsB, ["daily_rhythm", "environment_tolerance", "social_boundary"]);
  const communication = dimensionSimilaritySignal(factsA, factsB, ["communication"]);
  const homeLabor = dimensionSimilaritySignal(factsA, factsB, ["home_labor"]);
  const budgetLocation = budgetLocationFitSignal(factsA, factsB);
  const trustBridge = bestCoveredSignal([
    dimensionSimilaritySignal(factsA, factsB, ["trust_context"]),
    bestFactKeySimilaritySignal(factsA, factsB, ["verified_work_or_school"]),
    bestFactKeySimilaritySignal(factsA, factsB, ["shared_communities", "mutuals", "references"]),
  ]);
  const elasticity = dimensionSimilaritySignal(factsA, factsB, ["preference_elasticity"]);
  const schedule = groupedFactKeySimilaritySignal(factsA, factsB, ["sleep_schedule", "work_from_home"]);
  // Guest/overnight-guest cadence is a high-salience roommate signal (how often
  // guests — or a partner — stay over). It is part of social_boundary→lifestyle,
  // but as one of many keys its marginal pull was tiny; promote it to its own
  // weighted term (mirroring `schedule`) so divergent guest expectations
  // meaningfully separate matches. Soft factor only — never a hard exclusion.
  // factKeySimilaritySignal (not grouped): "overnight_guests" and "guests" are
  // the same concept under two key names, so when the sides stated different
  // ones the cross-key fallback should still cover the term.
  const guestRhythm = factKeySimilaritySignal(factsA, factsB, ["overnight_guests", "guests"]);
  const rapport = rapportTasteFitSignal(factsA, factsB);
  const institutionalAffinity = institutionalOverlapStrength(factsA, factsB);
  const personalityAffinity = personalityAlignmentStrength(factsA, factsB);
  const ageComfort = ageComfortFit(factsA, factsB);
  // The gate's budget slot requires BOTH budgets — unlike the soft
  // budget-location term, market overlap alone must not mark budget "known",
  // or stating a budget would never move the gate or coverage.
  const budgetA = readBudget(factsA);
  const budgetB = readBudget(factsB);
  const budgetSignal: TermSignal =
    budgetA && budgetB
      ? { value: budgetConstraintSimilarity(budgetA, budgetB), covered: true }
      : { value: 0.5, covered: false };
  const gate = computeFeasibilityGate(factsA, factsB, budgetSignal);

  const terms: { weight: number; signal: TermSignal }[] = [
    { weight: 0.18, signal: communication },
    { weight: 0.16, signal: lifestyle },
    { weight: 0.16, signal: homeLabor },
    { weight: 0.14, signal: budgetLocation },
    { weight: 0.1, signal: trustBridge },
    { weight: 0.08, signal: elasticity },
    { weight: 0.08, signal: guestRhythm },
    { weight: 0.08, signal: rapport },
    { weight: 0.06, signal: schedule },
  ];
  const totalTermWeight = terms.reduce((sum, term) => sum + term.weight, 0);
  const coveredTermWeight = terms.reduce(
    (sum, term) => sum + (term.signal.covered ? term.weight : 0),
    0,
  );
  const blendAt = (unknownFill: number) =>
    terms.reduce(
      (sum, term) =>
        sum + term.weight * (term.signal.covered ? term.signal.value : unknownFill),
      0,
    ) / totalTermWeight;

  const savedBonus = savedOverlap ? savedTasteCompatBonus(savedOverlap) : 0;
  const bonuses =
    0.12 * institutionalAffinity +
    0.05 * personalityAffinity +
    0.1 * (ageComfort.score - 0.5) +
    savedBonus;
  const hardZero = gate.hardFail || ageComfort.strictFailure;
  const centerScore = hardZero ? 0 : clamp(gate.center * blendAt(UNKNOWN_TERM_CENTER) + bonuses);
  const lowScore = hardZero ? 0 : clamp(gate.low * blendAt(UNKNOWN_TERM_LOW) + bonuses);
  const highScore = hardZero ? 0 : clamp(gate.high * blendAt(UNKNOWN_TERM_HIGH) + bonuses);
  const coverage =
    (gate.knownWeight + coveredTermWeight) /
    (FEASIBILITY_FIT_WEIGHT_TOTAL + totalTermWeight);

  const feasibilityGate = hardZero ? 0 : gate.center;
  const risks = buildCompatibilityRisks(userA.displayName, userB.displayName, {
    ageComfort,
    lifestyle: lifestyle.value,
    communication: communication.value,
    homeLabor: homeLabor.value,
    budgetLocation: budgetLocation.value,
    guestRhythm: guestRhythm.value,
    feasibilityGate,
  });

  const score = Math.round(centerScore * 100);
  return {
    score,
    scoreLow: Math.min(score, Math.round(lowScore * 100)),
    scoreHigh: Math.max(score, Math.round(highScore * 100)),
    coverage: roundComponent(coverage),
    components: {
      feasibility_gate: roundComponent(feasibilityGate),
      lifestyle_friction_fit: roundComponent(lifestyle.value),
      communication_fit: roundComponent(communication.value),
      home_labor_fit: roundComponent(homeLabor.value),
      budget_location_synergy: roundComponent(budgetLocation.value),
      trust_bridge_strength: roundComponent(trustBridge.value),
      preference_elasticity_fit: roundComponent(elasticity.value),
      schedule_collision_fit: roundComponent(schedule.value),
      guest_rhythm_fit: roundComponent(guestRhythm.value),
      rapport_taste_fit: roundComponent(rapport.value),
      age_comfort_fit: roundComponent(ageComfort.score),
    },
    evidence: buildCompatibilityEvidence(userA.displayName, userB.displayName, factsA, factsB, ageComfort),
    risks,
  };
}

// ---------------------------------------------------------------------------
// Eligibility + feasibility
// ---------------------------------------------------------------------------

function eligibleFacts(facts: ProfileFactForScoring[]) {
  return facts.filter(
    (fact) =>
      fact.matchingEligible &&
      ["approved", "edited"].includes(fact.reviewState) &&
      fact.sensitivityLevel === "standard",
  );
}

// Keyed on the caller's facts-array identity: the rerank loop scores one
// viewer against up to 150 candidates, and re-consolidating the same facts
// per pair is O(facts²) similarity work repeated 150×. DB-loaded arrays are
// never mutated, so identity is a safe cache key.
const consolidatedFactsCache = new WeakMap<
  ProfileFactForScoring[],
  ProfileFactForScoring[]
>();

function consolidatedEligibleFacts(facts: ProfileFactForScoring[]) {
  const cached = consolidatedFactsCache.get(facts);
  if (cached) {
    return cached;
  }
  const consolidated = consolidateProfileFactsForProjection(eligibleFacts(facts));
  consolidatedFactsCache.set(facts, consolidated);
  return consolidated;
}

type FeasibilityGate = {
  hardFail: boolean;
  center: number;
  low: number;
  high: number;
  /** Weight of feasibility fits where both sides had signal (of FEASIBILITY_FIT_WEIGHT_TOTAL). */
  knownWeight: number;
};

function computeFeasibilityGate(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  budget: TermSignal,
): FeasibilityGate {
  const market = factKeySimilaritySignal(factsA, factsB, ["target_market", "neighborhoods"]);
  const moveIn = factKeySimilaritySignal(factsA, factsB, ["move_in_window"]);
  const household = factKeySimilaritySignal(factsA, factsB, ["household_size"]);

  const hardFail =
    (market.value === 0 &&
      hasAnyFact(factsA, "target_market") &&
      hasAnyFact(factsB, "target_market")) ||
    (moveIn.covered && moveIn.value <= MOVE_IN_GATE_FLOOR) ||
    (household.covered && household.value === 0);

  const fits = [
    { weight: FEASIBILITY_FIT_WEIGHTS.market, signal: market },
    { weight: FEASIBILITY_FIT_WEIGHTS.budget, signal: budget },
    { weight: FEASIBILITY_FIT_WEIGHTS.moveIn, signal: moveIn },
    { weight: FEASIBILITY_FIT_WEIGHTS.household, signal: household },
  ];
  const gateAt = (unknownFill: number) =>
    clamp(
      0.35 +
        fits.reduce(
          (sum, fit) =>
            sum + fit.weight * (fit.signal.covered ? fit.signal.value : unknownFill),
          0,
        ),
    );

  return {
    hardFail,
    center: gateAt(UNKNOWN_FEASIBILITY_CENTER),
    low: gateAt(UNKNOWN_FEASIBILITY_LOW),
    high: gateAt(UNKNOWN_FEASIBILITY_HIGH),
    knownWeight: fits.reduce(
      (sum, fit) => sum + (fit.signal.covered ? fit.weight : 0),
      0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Dimension / fact-key similarity
// ---------------------------------------------------------------------------

/**
 * Similarity across a dimension group, computed ONLY over fact keys both users
 * share. No mutual key → uncovered (the neutral 0.5 is display-only; the
 * weighted sum treats the term as unknown instead of half-compatible).
 */
function dimensionSimilaritySignal(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  dimensions: string[],
): TermSignal {
  const keys = new Set(
    [...factsA, ...factsB].flatMap((fact) =>
      dimensions.includes(fact.dimension) ? [fact.factKey] : [],
    ),
  );
  const mutualKeys = [...keys].filter(
    (key) => hasAnyFact(factsA, key) && hasAnyFact(factsB, key),
  );

  if (mutualKeys.length === 0) {
    return { value: 0.5, covered: false };
  }

  return {
    value: average(mutualKeys.map((key) => factKeySimilarity(factsA, factsB, [key]))),
    covered: true,
  };
}

function factKeySimilarity(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  factKeys: string[],
) {
  const valuesA = factsA.filter((fact) => factKeys.includes(fact.factKey));
  const valuesB = factsB.filter((fact) => factKeys.includes(fact.factKey));

  if (valuesA.length === 0 || valuesB.length === 0) {
    return 0.5;
  }

  // Average per mutual key: cross-key pairs (target_market vs neighborhoods,
  // which score ~0) must not dilute keys both users actually stated —
  // otherwise adding more profile data lowers the score. Cross-key comparison
  // survives only as the fallback when the sides stated disjoint keys.
  const mutualKeys = factKeys.filter(
    (key) =>
      valuesA.some((fact) => fact.factKey === key) &&
      valuesB.some((fact) => fact.factKey === key),
  );

  const pairwiseAverage = (
    pairValuesA: ProfileFactForScoring[],
    pairValuesB: ProfileFactForScoring[],
  ) =>
    average(
      pairValuesA.flatMap((valueA) =>
        pairValuesB.map((valueB) =>
          valueSimilarityForKey(
            valueA.factKey,
            valueA.normalizedValue,
            valueB.normalizedValue,
            valueB.factKey,
          ),
        ),
      ),
    );

  if (mutualKeys.length === 0) {
    return pairwiseAverage(valuesA, valuesB);
  }

  return average(
    mutualKeys.map((key) =>
      pairwiseAverage(
        valuesA.filter((fact) => fact.factKey === key),
        valuesB.filter((fact) => fact.factKey === key),
      ),
    ),
  );
}

function factKeySimilaritySignal(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  factKeys: string[],
): TermSignal {
  const valuesA = factsA.filter((fact) => factKeys.includes(fact.factKey));
  const valuesB = factsB.filter((fact) => factKeys.includes(fact.factKey));

  if (valuesA.length === 0 || valuesB.length === 0) {
    return { value: 0.5, covered: false };
  }

  return { value: factKeySimilarity(factsA, factsB, factKeys), covered: true };
}

function groupedFactKeySimilaritySignal(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  factKeys: string[],
): TermSignal {
  const mutualKeys = factKeys.filter(
    (key) => hasAnyFact(factsA, key) && hasAnyFact(factsB, key),
  );
  if (mutualKeys.length === 0) {
    return { value: 0.5, covered: false };
  }
  return {
    value: average(mutualKeys.map((key) => factKeySimilarity(factsA, factsB, [key]))),
    covered: true,
  };
}

/** Best (max) pairwise similarity, uncovered when either side lacks the keys. */
function bestFactKeySimilaritySignal(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  factKeys: string[],
): TermSignal {
  const valuesA = factsA.filter((fact) => factKeys.includes(fact.factKey));
  const valuesB = factsB.filter((fact) => factKeys.includes(fact.factKey));

  if (valuesA.length === 0 || valuesB.length === 0) {
    return { value: 0.5, covered: false };
  }

  return {
    value: factKeySimilarityIfPresent(factsA, factsB, factKeys),
    covered: true,
  };
}

/**
 * Rapport/taste fit. Two deliberate differences from the friction terms:
 *
 * 1. CROSS-KEY, dimension-wide comparison. Extraction emits drifting taste
 *    keys (`media_taste` vs `media_interests`, `aesthetic_taste` vs
 *    `music_and_aesthetic_orientation`, `humor_style`, …), so requiring the
 *    same key on both sides silently discards most real taste signal. Every
 *    rapport_taste-dimension fact on either side joins the comparison pool.
 * 2. BONUS-SHAPED value: shared taste lifts the term above neutral, but
 *    different tastes are not roommate friction — the term never drops below
 *    0.5, so "no stated overlap" stops reading as a hard penalty (a real
 *    match once showed "Rapport · 20" for this reason).
 */
function rapportTasteFitSignal(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
): TermSignal {
  const keys = new Set([
    "interests",
    "music_taste",
    "media_taste",
    "aesthetic_taste",
  ]);
  for (const fact of [...factsA, ...factsB]) {
    if (fact.dimension === "rapport_taste") {
      keys.add(fact.factKey);
    }
  }

  const overlap = bestFactKeySimilaritySignal(factsA, factsB, [...keys]);
  if (!overlap.covered) {
    return { value: 0.5, covered: false };
  }
  return { value: clamp(0.5 + 0.5 * overlap.value), covered: true };
}

/** Max over the covered signals; uncovered when none of the parts have data. */
function bestCoveredSignal(signals: TermSignal[]): TermSignal {
  const covered = signals.filter((signal) => signal.covered);
  if (covered.length === 0) {
    return { value: 0.5, covered: false };
  }
  return {
    value: Math.max(...covered.map((signal) => signal.value)),
    covered: true,
  };
}

function factKeySimilarityIfPresent(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  factKeys: string[],
) {
  const valuesA = factsA.filter((fact) => factKeys.includes(fact.factKey));
  const valuesB = factsB.filter((fact) => factKeys.includes(fact.factKey));

  if (valuesA.length === 0 || valuesB.length === 0) {
    return 0;
  }

  return Math.max(
    ...valuesA.flatMap((valueA) =>
      valuesB.map((valueB) =>
        valueSimilarityForKey(
          valueA.factKey,
          valueA.normalizedValue,
          valueB.normalizedValue,
          valueB.factKey,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Budget / location fit
// ---------------------------------------------------------------------------

function budgetLocationFitSignal(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
): TermSignal {
  const budgetA = readBudget(factsA);
  const budgetB = readBudget(factsB);
  const location = factKeySimilaritySignal(factsA, factsB, ["target_market", "neighborhoods", "commute"]);
  const budget =
    budgetA && budgetB ? budgetConstraintSimilarity(budgetA, budgetB) : null;

  if (budget != null && location.covered) {
    return { value: clamp(0.6 * budget + 0.4 * location.value), covered: true };
  }
  if (budget != null) {
    return { value: budget, covered: true };
  }
  return location;
}

function readBudget(facts: ProfileFactForScoring[]) {
  const constraints = facts.flatMap((fact) => {
    if (!budgetFactKeys.has(fact.factKey)) {
      return [];
    }
    const constraint = parseBudgetConstraint(fact.factKey, fact.normalizedValue);
    return constraint ? [constraint] : [];
  });

  if (constraints.length === 0) {
    return null;
  }

  return mergeBudgetConstraints(constraints);
}

// ---------------------------------------------------------------------------
// Age-comfort scoring
// ---------------------------------------------------------------------------

function ageComfortFit(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
): AgeComfortResult {
  const ageA = readAgeFact(factsA);
  const ageB = readAgeFact(factsB);
  const preferenceA = readAgePreferenceFact(factsA);
  const preferenceB = readAgePreferenceFact(factsB);
  const preferenceScores = [
    scoreAgePreference(preferenceA, ageB),
    scoreAgePreference(preferenceB, ageA),
  ].filter((score): score is AgePreferenceScore => score !== null);
  const strictFailure = preferenceScores.some((score) => score.strictFailure);

  if (strictFailure) {
    return {
      score: 0,
      strictFailure: true,
      hasSignal: true,
      hasRangeSignal: preferenceScores.length > 0,
      rangeSatisfied: false,
    };
  }

  const cohortScore = ageCohortSimilarity(ageA, ageB);
  const scoreParts = preferenceScores.map((score) => score.score);
  if (cohortScore !== null) {
    scoreParts.push(
      preferenceScores.length > 0
        ? 0.5 + (cohortScore - 0.5) * 0.45
        : cohortScore,
    );
  }

  return {
    score: scoreParts.length > 0 ? clamp(average(scoreParts)) : 0.5,
    strictFailure: false,
    hasSignal: scoreParts.length > 0,
    hasRangeSignal: preferenceScores.length > 0,
    rangeSatisfied:
      preferenceScores.length > 0 &&
      preferenceScores.every((score) => score.satisfied),
  };
}

function scoreAgePreference(
  preference: AgePreference | null,
  age: number | null,
): AgePreferenceScore | null {
  if (!preference) {
    return null;
  }

  if (age == null) {
    return {
      score: preference.strict ? 0 : 0.5,
      strictFailure: preference.strict,
      satisfied: false,
    };
  }

  const distance = ageDistanceOutsidePreference(preference, age);
  if (distance === 0) {
    return { score: 1, strictFailure: false, satisfied: true };
  }

  return {
    score: preference.strict ? 0 : clamp(Math.max(0.25, 1 / (1 + distance / 8))),
    strictFailure: preference.strict,
    satisfied: false,
  };
}

function ageDistanceOutsidePreference(preference: AgePreference, age: number) {
  if (preference.min != null && age < preference.min) {
    return preference.min - age;
  }
  if (preference.max != null && age > preference.max) {
    return age - preference.max;
  }
  return 0;
}

function ageCohortSimilarity(ageA: number | null, ageB: number | null) {
  if (ageA == null || ageB == null) {
    return null;
  }

  const gap = Math.abs(ageA - ageB);
  if (gap <= 2) return 1;
  if (gap <= 5) return 0.86;
  if (gap <= 10) return 0.68;
  if (gap <= 20) return 0.42;
  return 0.22;
}

function readAgeFact(facts: ProfileFactForScoring[]) {
  for (const fact of facts) {
    if (fact.factKey !== "age") {
      continue;
    }

    const value = readAgeValue(fact.value) ?? readAgeValue(fact.normalizedValue);
    if (value != null) {
      return value;
    }
  }

  return null;
}

function readAgePreferenceFact(facts: ProfileFactForScoring[]) {
  for (const fact of facts) {
    if (fact.factKey !== "preferred_age_range") {
      continue;
    }

    const value =
      readAgePreferenceValue(fact.value) ??
      readAgePreferenceValue(fact.normalizedValue);
    if (value) {
      return value;
    }
  }

  return null;
}

function readAgePreferenceValue(value: Json | string | null | undefined): AgePreference | null {
  const record =
    typeof value === "string"
      ? parseJsonObject(value)
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

  if (record) {
    const min = readAgeValue(
      record.min ?? record.minimum ?? record.preferred_age_min,
    );
    const max = readAgeValue(
      record.max ?? record.maximum ?? record.preferred_age_max,
    );
    if (min == null && max == null) {
      return null;
    }
    if (min != null && max != null && min > max) {
      return null;
    }
    return {
      min,
      max,
      strict: readBooleanLike(
        record.strict ?? record.preferred_age_strict ?? record.hard,
      ),
    };
  }

  if (typeof value !== "string") {
    return null;
  }

  const ages = [...value.matchAll(/\b(1[89]|[2-9]\d|100)\b/g)]
    .map((match) => readAgeValue(match[1]))
    .filter((age): age is number => age !== null);
  if (ages.length === 0) {
    return null;
  }

  if (ages.length === 1) {
    const [age] = ages;
    if (/\b(max|under|younger|up to|below)\b/i.test(value)) {
      return { min: null, max: age, strict: false };
    }
    return { min: age, max: null, strict: false };
  }

  return {
    min: Math.min(...ages),
    max: Math.max(...ages),
    strict: /\b(strict|only|required|hard)\b/i.test(value),
  };
}

function readAgeValue(value: unknown) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(number)) {
    return null;
  }

  const rounded = Math.round(number);
  return rounded >= 18 && rounded <= 100 ? rounded : null;
}

function readBooleanLike(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return /^(true|1|yes|strict|only|hard|required)$/i.test(value.trim());
  }

  return false;
}

// ---------------------------------------------------------------------------
// Misc predicates
// ---------------------------------------------------------------------------

function hasAnyFact(facts: ProfileFactForScoring[], factKey: string | string[]) {
  const keys = Array.isArray(factKey) ? factKey : [factKey];
  return facts.some((fact) => keys.includes(fact.factKey));
}

// ---------------------------------------------------------------------------
// Institutional / personality strength
// ---------------------------------------------------------------------------

function institutionalOverlapStrength(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
) {
  return Math.max(
    factKeySimilarityIfPresent(factsA, factsB, ["verified_work_or_school"]),
    factKeySimilarityIfPresent(factsA, factsB, ["shared_communities"]),
    factKeySimilarityIfPresent(factsA, factsB, ["mutuals"]),
  );
}

function personalityAlignmentStrength(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
) {
  const scores = [
    dimensionSimilarityIfPresent(factsA, factsB, ["communication"]),
    dimensionSimilarityIfPresent(factsA, factsB, ["social_boundary"]),
    dimensionSimilarityIfPresent(factsA, factsB, ["daily_rhythm"]),
    dimensionSimilarityIfPresent(factsA, factsB, ["rapport_taste"]),
  ].filter((score): score is number => score != null);

  return scores.length > 0 ? average(scores) : 0;
}

function dimensionSimilarityIfPresent(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  dimensions: string[],
) {
  const signal = dimensionSimilaritySignal(factsA, factsB, dimensions);
  return signal.covered ? signal.value : null;
}

// ---------------------------------------------------------------------------
// Evidence / risk builders
// ---------------------------------------------------------------------------

function buildCompatibilityEvidence(
  nameA: string,
  nameB: string,
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  ageComfort: ReturnType<typeof ageComfortFit>,
) {
  const shared: { label: string; detail: string }[] = [];
  if (
    ageComfort.hasRangeSignal &&
    ageComfort.rangeSatisfied &&
    !ageComfort.strictFailure
  ) {
    shared.push({
      label: "Age comfort",
      detail: "Their stated roommate age-comfort ranges are compatible.",
    });
  }

  const keyLabels: Record<string, string> = {
    sleep_schedule: "Daily rhythm",
    cleanliness: "Home labor",
    noise_tolerance: "Environment",
    guests: "Guests",
    communication_style: "Communication",
    // target_market deliberately absent: in a single-market product every pair
    // "matches" on market (and the field is backfilled to SF by default), so a
    // "Location" evidence line reads as affinity that was never stated —
    // the empty-profile matches-honesty failure. Neighborhood overlap earns
    // points through budget_location_synergy instead.
    neighborhoods: "Location",
    trust_context: "Trust bridge",
    verified_work_or_school: "Work or school",
    shared_communities: "Communities",
    rent_tradeoff: "Flexibility",
    location_tradeoff: "Location flexibility",
    commute_tradeoff: "Commute flexibility",
    room_quality_tradeoff: "Room flexibility",
    interests: "Interests",
    music_taste: "Music taste",
    media_taste: "Media taste",
    aesthetic_taste: "Aesthetic taste",
  };

  for (const [factKey, label] of Object.entries(keyLabels)) {
    const usesBestOverlap =
      trustEntityFactKeys.has(factKey) || assistantTrustRapportFactKeys.has(factKey);
    const similarity = usesBestOverlap
      ? factKeySimilarityIfPresent(factsA, factsB, [factKey])
      : factKeySimilarity(factsA, factsB, [factKey]);
    if (
      (
        trustEntityFactKeys.has(factKey) ||
        assistantTrustRapportFactKeys.has(factKey)
      ) &&
      similarity >= 0.45
    ) {
      const overlap = describeInstitutionalOverlap(factsA, factsB, factKey);
      if (overlap) {
        shared.push({ label, detail: overlap });
        continue;
      }
    }

    if (trustEntityFactKeys.has(factKey)) {
      continue;
    }

    if (similarity >= 0.68) {
      shared.push({
        label,
        detail: `${nameA} and ${nameB} have compatible ${label.toLowerCase()} signals.`,
      });
      continue;
    }

  }

  return shared.slice(0, 5);
}

function describeInstitutionalOverlap(
  factsA: ProfileFactForScoring[],
  factsB: ProfileFactForScoring[],
  factKey: string,
) {
  const valuesA = factsA.flatMap((fact) =>
    fact.factKey === factKey ? [fact.normalizedValue] : [],
  );
  const valuesB = factsB.flatMap((fact) =>
    fact.factKey === factKey ? [fact.normalizedValue] : [],
  );

  if (valuesA.length === 0 || valuesB.length === 0) {
    return null;
  }

  if (trustEntityFactKeys.has(factKey)) {
    let best: ReturnType<typeof trustEntityOverlap> | null = null;
    for (const valueA of valuesA) {
      for (const valueB of valuesB) {
        const overlap = trustEntityOverlap(valueA, valueB);
        if (best === null || overlap.score > best.score) {
          best = overlap;
        }
      }
    }
    if (!best || best.score < 0.45 || !best.label) {
      return null;
    }

    const contextLabel = factKey === "shared_communities"
      ? "community"
      : factKey.replaceAll("_", " ");
    return `Shared ${contextLabel} context: ${best.label}.`;
  }

  const tokensA = new Set<string>();
  const tokensB = new Set<string>();
  for (const value of valuesA) {
    for (const token of tokenize(value)) tokensA.add(token);
  }
  for (const value of valuesB) {
    for (const token of tokenize(value)) tokensB.add(token);
  }

  const sharedTokens = [...tokensA].filter((token) => tokensB.has(token));
  if (sharedTokens.length === 0) {
    return null;
  }

  const label = overlapLabel(sharedTokens);
  const contextLabel = factKey === "shared_communities"
    ? "community"
    : factKey.replaceAll("_", " ");
  return `Shared ${contextLabel} context: ${label}.`;
}

function overlapLabel(sharedTokens: string[]) {
  const canonical = trustEntityLabelForTokens(sharedTokens);
  if (canonical) return canonical;
  if (sharedTokens.includes("university") && sharedTokens.length > 1) {
    return titleCase(sharedTokens.filter((token) => token !== "university").slice(0, 2).join(" "));
  }
  return titleCase(sharedTokens.slice(0, 2).join(" / "));
}

function buildCompatibilityRisks(
  nameA: string,
  nameB: string,
  components: {
    ageComfort: AgeComfortResult;
    lifestyle: number;
    communication: number;
    homeLabor: number;
    budgetLocation: number;
    guestRhythm: number;
    feasibilityGate: number;
  },
) {
  const risks: { label: string; detail: string }[] = [];

  if (components.feasibilityGate === 0) {
    risks.push({ label: "Feasibility", detail: "Hard location, budget, timing, or household constraints do not overlap." });
  }
  if (components.ageComfort.strictFailure) {
    risks.push({ label: "Age comfort", detail: "A stated roommate age-comfort range does not overlap or cannot be verified." });
  } else if (components.ageComfort.hasRangeSignal && components.ageComfort.score < 0.45) {
    risks.push({ label: "Age comfort", detail: "Age comfort should be discussed before an intro." });
  }
  if (components.lifestyle < 0.45) {
    risks.push({ label: "Lifestyle friction", detail: `${nameA} and ${nameB} may need to align daily rhythm, noise, or guest expectations.` });
  }
  if (components.communication < 0.45) {
    risks.push({ label: "Communication", detail: "Communication styles look different enough to require an explicit intro script." });
  }
  if (components.homeLabor < 0.45) {
    risks.push({ label: "Home labor", detail: "Cleaning or chore expectations should be clarified before an intro." });
  }
  if (components.guestRhythm < 0.45) {
    risks.push({ label: "Guests", detail: `${nameA} and ${nameB} should compare how often guests or a partner stay over.` });
  }
  if (components.budgetLocation < 0.45) {
    risks.push({ label: "Budget and location", detail: "Budget, timing, or neighborhood tradeoffs may reduce apartment overlap." });
  }

  return risks;
}

// ---------------------------------------------------------------------------
// Numeric utilities
// ---------------------------------------------------------------------------

function average(values: number[]) {
  if (values.length === 0) {
    return 0.5;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundComponent(value: number) {
  return Math.round(value * 1000) / 1000;
}
