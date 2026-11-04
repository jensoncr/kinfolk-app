/**
 * A roommate match is "viable" — worth surfacing to the user — only when its
 * compatibility score is positive. A score of 0 marks a hard-gated edge (e.g. a
 * strict age or feasibility failure): it is persisted, but must never be shown.
 * Scores are always rounded finite numbers, so `> 0` is the whole rule.
 *
 * This is distinct from profile-level *visibility* (isVisibleRoommateProfile),
 * which drops people a user shouldn't see at all (privacy / completeness).
 */
export function isViableRoommateMatch(match: { score: number }): boolean {
  return match.score > 0;
}

/**
 * An "early read" is a viable match whose score rests on thin two-sided data:
 * coverage below 0.7 with a confidence range at least 8 points wide. Point
 * percentages overstate what the engine knows here — surfaces that show these
 * matches must hedge (range badge in the web pane, provisional framing in the
 * agent). Null coverage (edges scored before coverage existed) counts as thin.
 */
export function isEarlyReadRoommateMatch(match: {
  coverage: number | null;
  scoreLow: number | null;
  scoreHigh: number | null;
}): boolean {
  if (match.coverage == null) return true;
  if (match.coverage >= 0.7) return false;
  if (match.scoreLow == null || match.scoreHigh == null) return true;
  return match.scoreHigh - match.scoreLow >= 8;
}
