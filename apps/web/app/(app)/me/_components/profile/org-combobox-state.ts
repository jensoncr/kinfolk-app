// Pure state for the org picker, kept out of the component so the keyboard
// and domain-invalidation rules can be unit-tested without a DOM.

export type OrgPick = {
  label: string;
  /** Null when the user typed free text instead of picking a suggestion. */
  domain: string | null;
};

/**
 * Wrap-around highlight movement. Returns -1 for an empty list so the caller
 * renders nothing as active.
 */
export function moveHighlight(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/**
 * Does an edited label still describe the organization whose domain we hold?
 *
 * Picking "Fifth Wall" stores fifthwall.com. If the text is then edited to
 * something else the domain is stale and must be dropped — otherwise a profile
 * could read "Acme" while carrying a competitor's logo and matching key.
 * Case and surrounding whitespace changes are not edits.
 */
export function domainSurvivesEdit(pickedLabel: string, nextLabel: string): boolean {
  return pickedLabel.trim().toLowerCase() === nextLabel.trim().toLowerCase();
}

/** Apply a free-text edit to the current pick, invalidating a stale domain. */
export function applyTextEdit(pick: OrgPick, nextLabel: string): OrgPick {
  return {
    label: nextLabel,
    domain: pick.domain && domainSurvivesEdit(pick.label, nextLabel) ? pick.domain : null,
  };
}

/** A query is worth sending once it can plausibly match something. */
export function isSearchableQuery(value: string): boolean {
  return value.trim().length >= 2;
}
