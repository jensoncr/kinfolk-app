/**
 * Pure gating policy for proactive "new high-fit roommate" notifications.
 *
 * Spike (plan 017). This module decides WHETHER an edge should trigger a
 * notification and WHAT redacted preview is allowed to leave the app. It does
 * NO I/O and sends nothing — the caller (a future plan-013/014 detector) is
 * responsible for loading edges/consent/history and for the consented send.
 *
 * Reveal contract: the preview returned here contains ONLY a fit score and
 * dimension labels plus first name + initials. It MUST NOT contain phone,
 * email, full address, or any other contact/identity detail. Surfacing
 * contact info before mutual opt-in is the documented failure mode.
 */

/** Minimal edge shape the policy needs (a subset of matches.ts RoommateMatch). */
export type RoommateMatchCandidate = {
  /** compatibility_edges.id */
  edgeId: string;
  /** The other user in the edge (the suggested roommate). */
  otherUserId: string;
  /** Rounded compatibility score, 0-100. */
  score: number;
  /** compatibility_edges.computed_at (ISO). */
  computedAt: string;
  /** Display name of the other user (used only for first-name/initials). */
  name: string;
  /** Ordered dimension labels, e.g. ["Lifestyle","Schedule","Budget"]. */
  dimensionLabels: string[];
};

/** A prior notification this recipient already received (for de-dup + velocity). */
export type RecentRoommateNotification = {
  /** The edge that was notified. */
  edgeId: string;
  /** The computed_at that was notified (so a re-score can re-notify). */
  computedAt: string;
  /** When the notification was sent (ISO). */
  sentAt: string;
};

export type RoommateNotificationConfig = {
  /** Minimum score (inclusive) to be notify-worthy. Default 80. */
  minScore: number;
  /** Max proactive roommate notifications per recipient per rolling 24h. Default 1. */
  maxPerDay: number;
};

export const DEFAULT_ROOMMATE_NOTIFICATION_CONFIG: RoommateNotificationConfig = {
  minScore: 80,
  maxPerDay: 1,
};

/** A redacted, contact-free preview safe to send pre-mutual-opt-in. */
export type RoommateMatchPreview = {
  edgeId: string;
  fitScore: number;
  /** First name only — never the full legal name + last name pairing. */
  firstName: string;
  initials: string;
  /** Up to three dimension labels, no values. */
  dimensionLabels: string[];
};

function firstNameOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "A potential roommate";
  return trimmed.split(/\s+/)[0];
}

function initialsOf(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "K";
}

/** The contact-free preview. By construction it carries no phone/email/address. */
export function buildRoommateMatchPreview(
  candidate: RoommateMatchCandidate,
): RoommateMatchPreview {
  return {
    edgeId: candidate.edgeId,
    fitScore: candidate.score,
    firstName: firstNameOf(candidate.name),
    initials: initialsOf(candidate.name),
    dimensionLabels: candidate.dimensionLabels.slice(0, 3),
  };
}

/**
 * Decide which candidate edges should trigger a proactive notification.
 *
 * Gates (all must pass for an edge to be selected):
 *  1. recipient consent: `silentMatcherEnabled === true` — else returns [].
 *  2. threshold: `score >= config.minScore`.
 *  3. not-already-notified: no prior notification for the same
 *     `(edgeId, computedAt)` pair (a re-score with a newer computedAt CAN
 *     re-notify; an identical re-run cannot).
 *  4. velocity cap: at most `config.maxPerDay` sends in the rolling 24h before
 *     `now`, counting both prior sends AND edges selected in this same batch.
 *
 * Highest-scoring eligible edges win the remaining daily budget.
 */
export function selectRoommateMatchNotifications({
  candidates,
  silentMatcherEnabled,
  recentNotifications,
  config = DEFAULT_ROOMMATE_NOTIFICATION_CONFIG,
  now = new Date(),
}: {
  candidates: RoommateMatchCandidate[];
  silentMatcherEnabled: boolean;
  recentNotifications: RecentRoommateNotification[];
  config?: RoommateNotificationConfig;
  now?: Date;
}): RoommateMatchPreview[] {
  if (!silentMatcherEnabled) {
    return [];
  }

  const dayAgoMs = now.getTime() - 24 * 60 * 60 * 1000;
  const alreadyNotified = new Set(
    recentNotifications.map((n) => `${n.edgeId}::${n.computedAt}`),
  );
  const sentInWindow = recentNotifications.filter((n) => {
    const sentMs = Date.parse(n.sentAt);
    return Number.isFinite(sentMs) && sentMs >= dayAgoMs;
  }).length;

  let remaining = Math.max(0, config.maxPerDay - sentInWindow);

  const eligible = candidates
    .filter((c) => c.score >= config.minScore)
    .filter((c) => !alreadyNotified.has(`${c.edgeId}::${c.computedAt}`))
    .sort((a, b) => b.score - a.score);

  const selected: RoommateMatchPreview[] = [];
  for (const candidate of eligible) {
    if (remaining <= 0) break;
    selected.push(buildRoommateMatchPreview(candidate));
    remaining -= 1;
  }
  return selected;
}
