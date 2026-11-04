import "server-only";

/**
 * =============================================================================
 * Silent Matcher — Read-Only Background Candidate Computation
 * =============================================================================
 *
 * DESIGN SPIKE (plan 016). This module computes and stores compatibility
 * candidates for users who have opted into the silent matcher on /me/plan.
 * It is READ-ONLY from the users' perspective: nothing is ever sent or revealed
 * to any user. The store rows are server-side artifacts that future
 * (separately-approved) work may surface.
 *
 * -----------------------------------------------------------------------------
 * DELIVERABLE 1 — GRANT CONTRACT: what "silent_matcher_enabled = true" grants
 * -----------------------------------------------------------------------------
 *
 * A user's living plan is ELIGIBLE TO BE SCANNED only when ALL of the following
 * hold:
 *
 *   1. silent_matcher_enabled = true
 *   2. intent_confirmed_at is not null  (the user actually saved intent — not a
 *      default empty row)
 *   3. array_length(future_cities, 1) >= 1  (at least one target city declared)
 *   4. move_horizon is not null
 *   5. relocation_flexibility is one of: 'some' | 'flexible' | 'ready'
 *      — 'locked' is EXCLUDED (user is not actually movable; scanning produces
 *        noise and may conflict with their housing situation)
 *      — null is also EXCLUDED
 *
 * Two eligible users are CANDIDATES FOR EACH OTHER only when:
 *
 *   A. They share at least one future_cities entry, compared case-insensitively
 *      after trimming (normalizeCity: s.trim().toLowerCase()). Exact normalized
 *      string match only — NO fuzzy or geocode match for this spike.
 *   B. Their move_horizon values overlap within one adjacent band on the ordered
 *      scale: ['now', 'lt_3mo', '3_6mo', '6_12mo', '1_2yr']
 *        — index distance <= 1 on that array means "adjacent"
 *        — 'exploring' short-circuits to true: an explorer overlaps any horizon
 *
 * Only after this pairing gate is the scorer called.
 *
 * This eligibility gate is enforced IN CODE (not only in SQL) so there is one
 * auditable choke point that tests can assert against.
 *
 * -----------------------------------------------------------------------------
 * DELIVERABLE 2 — RESULT STORE + REVEAL CONTRACT
 * -----------------------------------------------------------------------------
 *
 * Store choice: OPTION A — reuse compatibility_edges (no migration needed).
 *
 * Rationale: for a spike, the "silent candidate store" = the set of
 * compatibility_edges rows produced by the silent sweep. The existing
 * ensureCompatibilityEdgesForPairs function already writes symmetric edges
 * (one row per unordered pair, user_a_id < user_b_id) with score, evidence,
 * and status='active'. These edges are already the established compatibility
 * store (lib/plan/plan.ts:266-269 reads them for plan fit). No new table or
 * migration is needed for the spike.
 *
 * REVEAL CONTRACT FOR THIS SPIKE: NOTHING IS REVEALED.
 * Candidates are computed and stored only. No identity, no name, no fit
 * number, no count, no notification crosses to any user. Store rows are
 * server-side artifacts only.
 *
 * Future reveal design (NOT implemented here): reveal is intended to be
 * a DOUBLE OPT-IN: a stored edge is only shown to a user after BOTH sides
 * separately opt into that specific match via a future
 * match_reveal_consents(compatibility_edge_id, user_id, opted_in_at) table
 * (NOT built here). Reveal is also gated to feasible-only feasibility (never
 * feasible_with_unknowns). This module implements none of that; it writes
 * candidates and returns counts.
 *
 * -----------------------------------------------------------------------------
 * DELIVERABLE 4 — OPEN LEGAL / PRODUCT QUESTIONS (enumerate; do NOT resolve)
 * -----------------------------------------------------------------------------
 *
 * These questions require human sign-off before ANY reveal or notification is
 * built:
 *
 * 1. CONSENT WORDING. Does the current /me/plan toggle copy actually inform the
 *    user their relocation intent will be scored against strangers? Does
 *    enabling it constitute informed consent to be *matched*, vs. merely
 *    "remembered"? (Legal sign-off needed before any reveal.)
 *
 * 2. THE "WANTS OUT" FACT. relocation_flexibility = 'ready' combined with a
 *    current lease is a legally sensitive "wants to leave" signal (growth-engine
 *    line 13). What is the retention policy for stored silent candidates? Do
 *    they expire? Are they deleted on toggle-off?
 *
 * 3. TOGGLE-OFF SEMANTICS. When a user flips silent_matcher_enabled back to
 *    false, must existing stored candidates be deleted (right-to-be-forgotten),
 *    marked 'hidden', or retained? Spike default: stored candidates are NEVER
 *    surfaced regardless, and a re-run will not re-include an opted-out user —
 *    but historical rows are NOT auto-deleted. Flag this for product.
 *
 * 4. REVEAL TRIGGER. Who/what initiates the first reveal, and what double-
 *    opt-in UX gates it? (Out of scope; blocks all notification work.)
 *
 * 5. MUTUAL ELIGIBILITY. If user A is eligible but user B later opts out, can A
 *    still see a stored candidate naming B? Spike answer: never, because nothing
 *    is ever surfaced — but record the question for the reveal design.
 * =============================================================================
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { ensureCompatibilityEdgesForPairs } from "@/lib/profiles/enrichment-store";

type SupabaseServiceClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Move-horizon ordered scale (used by the horizon-band predicate).
// 'exploring' is NOT in this array — it short-circuits to "compatible with all".
// ---------------------------------------------------------------------------
const HORIZON_BAND_ORDER = [
  "now",
  "lt_3mo",
  "3_6mo",
  "6_12mo",
  "1_2yr",
] as const;

// ---------------------------------------------------------------------------
// Pure helpers — tested directly without a DB
// ---------------------------------------------------------------------------

/** Normalize a city string for exact matching: lowercase + trim. */
export function normalizeCity(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Return true when two move_horizon values "overlap within one adjacent band".
 *   - 'exploring' is compatible with any horizon (short-circuits to true).
 *   - Two values from HORIZON_BAND_ORDER are compatible when their index
 *     distance is <= 1.
 */
export function horizonBandsOverlap(a: string, b: string): boolean {
  if (a === "exploring" || b === "exploring") return true;
  const idxA = HORIZON_BAND_ORDER.indexOf(a as (typeof HORIZON_BAND_ORDER)[number]);
  const idxB = HORIZON_BAND_ORDER.indexOf(b as (typeof HORIZON_BAND_ORDER)[number]);
  if (idxA === -1 || idxB === -1) return false;
  return Math.abs(idxA - idxB) <= 1;
}

/**
 * Return the normalized shared cities between two city arrays.
 * Result is the intersection of both normalized lists.
 */
export function sharedNormalizedCities(a: string[], b: string[]): string[] {
  const setB = new Set(b.map(normalizeCity));
  return a.map(normalizeCity).filter((city) => setB.has(city));
}

// ---------------------------------------------------------------------------
// Eligibility gate
// ---------------------------------------------------------------------------

const ELIGIBLE_FLEXIBILITIES = new Set<string>(["some", "flexible", "ready"]);

export type EligiblePlan = {
  userId: string;
  futureCities: string[];
  moveHorizon: string;
  relocationFlexibility: string;
};

/**
 * Apply the Deliverable-1 eligibility gate in code.
 * Filters a raw living_plans row set to only those eligible for scanning.
 */
export function filterEligiblePlans(
  rows: Array<{
    user_id: string;
    future_cities: string[];
    move_horizon: string | null;
    relocation_flexibility: string | null;
    intent_confirmed_at: string | null;
    silent_matcher_enabled: boolean;
  }>,
): EligiblePlan[] {
  return rows
    .filter(
      (r) =>
        r.silent_matcher_enabled &&
        r.intent_confirmed_at !== null &&
        r.future_cities.length >= 1 &&
        r.move_horizon !== null &&
        r.relocation_flexibility !== null &&
        ELIGIBLE_FLEXIBILITIES.has(r.relocation_flexibility),
    )
    .map((r) => ({
      userId: r.user_id,
      futureCities: r.future_cities,
      moveHorizon: r.move_horizon as string,
      relocationFlexibility: r.relocation_flexibility as string,
    }));
}

/**
 * Build the unique unordered candidate pairs from a set of eligible plans.
 * Two plans are paired when they share at least one normalized city AND
 * their move_horizon values overlap within one adjacent band.
 *
 * Returns pairs as [userAId, userBId] sorted so user_a_id < user_b_id,
 * consistent with the compatibility_edges pair convention.
 */
export function buildCandidatePairs(plans: EligiblePlan[]): [string, string][] {
  const pairs: [string, string][] = [];
  const seen = new Set<string>();

  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i];
      const b = plans[j];

      const sharedCities = sharedNormalizedCities(a.futureCities, b.futureCities);
      if (sharedCities.length === 0) continue;
      if (!horizonBandsOverlap(a.moveHorizon, b.moveHorizon)) continue;

      const [sortedA, sortedB] = [a.userId, b.userId].sort() as [string, string];
      const key = `${sortedA}:${sortedB}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([sortedA, sortedB]);
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Main sweep function (DELIVERABLE 3)
// ---------------------------------------------------------------------------

/**
 * Run the silent-matcher sweep over all opted-in living plans.
 *
 * For each eligible user, calls ensureCompatibilityEdgesForPairs to compute
 * and persist compatibility edges against their city-and-horizon-matched
 * candidates. This reuses the existing scoring + edge-persistence primitive
 * without duplicating the scoring loop.
 *
 * SEND / REVEAL NOTHING. No notification, no transport, no identity crosses
 * to any user. Returns counts only.
 */
export async function runSilentMatcherSweep(
  supabase: SupabaseServiceClient,
): Promise<{ scannedUsers: number; pairsConsidered: number; candidatesWritten: number }> {
  // 1. Load all opted-in rows from living_plans (SQL pre-filter on the toggle).
  //    Fine-grained eligibility gate is applied in code below (Deliverable 1).
  const { data: rows, error } = await supabase
    .from("living_plans")
    .select(
      "user_id, future_cities, move_horizon, relocation_flexibility, intent_confirmed_at, silent_matcher_enabled",
    )
    .eq("silent_matcher_enabled", true);

  if (error) {
    console.error("[silent-matcher] Failed to load living_plans", { error });
    return { scannedUsers: 0, pairsConsidered: 0, candidatesWritten: 0 };
  }

  // 2. Apply the full eligibility gate in code (the auditable choke point).
  const eligible = filterEligiblePlans(rows ?? []);
  if (eligible.length < 2) {
    return {
      scannedUsers: eligible.length,
      pairsConsidered: 0,
      candidatesWritten: 0,
    };
  }

  // 3. Build candidate pairs (city overlap + adjacent horizon band).
  const pairs = buildCandidatePairs(eligible);

  // 4. Score + persist via ensureCompatibilityEdgesForPairs.
  //    Group pairs by the "viewer" side so we can call the function once per
  //    viewer with the full candidate list. Use the first element of each sorted
  //    pair as the viewer (consistent across runs for the same pair).
  const candidatesByViewer = new Map<string, string[]>();
  for (const [userA, userB] of pairs) {
    if (!candidatesByViewer.has(userA)) candidatesByViewer.set(userA, []);
    candidatesByViewer.get(userA)!.push(userB);
  }

  let candidatesWritten = 0;
  for (const [viewerId, candidateIds] of candidatesByViewer.entries()) {
    const results = await ensureCompatibilityEdgesForPairs(
      supabase,
      viewerId,
      candidateIds,
    );
    // Count distinct edges that were returned (computed or cached).
    candidatesWritten += results.length;
  }

  // SEND / REVEAL NOTHING — return counts only.
  return {
    scannedUsers: eligible.length,
    pairsConsidered: pairs.length,
    candidatesWritten,
  };
}
