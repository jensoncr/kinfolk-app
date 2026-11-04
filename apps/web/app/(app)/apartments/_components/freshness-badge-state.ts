// Pure display-state selection for the header freshness badge, kept out of
// the client component so the three tones × pre/post-mount matrix is testable
// (same pattern as fit-tone.ts).

export type FreshnessTone = "fresh" | "stale" | "unknown";

export type FreshnessBadgeState = {
  tone: FreshnessTone;
  /** Tailwind class painting the status dot (and its ping halo). */
  dotClass: string;
  /** Whether the dot gets the animated ping halo (fresh only). */
  ping: boolean;
  /** Tooltip heading. */
  title: string;
  /** Text inside the pill at `sm` and up. */
  badgeLabel: string;
  /**
   * Compact undated text shown below the `sm` breakpoint, or null to hide.
   * Non-fresh tones must keep a text label on small screens — dot color
   * alone fails WCAG 1.4.1 and the hover tooltip is unreachable on touch —
   * but the dated label would crush the mobile search input, so the
   * timestamp is reserved for `sm` widths and the tooltip.
   */
  mobileBadgeLabel: string | null;
  /** Accessible name — must carry the warning, not just the date. */
  ariaLabel: string;
  /** Tooltip body copy. */
  detail: string;
};

export function freshnessBadgeState({
  hasTimestamp,
  stale,
  shortLabel,
  fullLabel,
}: {
  hasTimestamp: boolean;
  stale: boolean;
  /** Locale-formatted timestamp labels; null until mounted on the client. */
  shortLabel: string | null;
  fullLabel: string | null;
}): FreshnessBadgeState {
  // The timestamp is the median last_seen_at over the displayed listings —
  // the middle observation, which nothing else need share — so every dated
  // claim is hedged to "checked around <date>". "Was last refreshed on
  // <date>" (or "most were checked on") overstates it in a mixed catalog.
  if (!hasTimestamp) {
    return {
      tone: "unknown",
      dotClass: "bg-[var(--ink-400)]",
      ping: false,
      title: "Freshness unknown",
      badgeLabel: "Freshness unknown",
      mobileBadgeLabel: "Unknown",
      ariaLabel: "Listings freshness unknown",
      detail: "We couldn't confirm when apartment data was last checked.",
    };
  }

  if (stale) {
    return {
      tone: "stale",
      dotClass: "bg-[var(--ochre)]",
      ping: false,
      title: "Listings may be outdated",
      badgeLabel: shortLabel ? `Data from ${shortLabel}` : "Data outdated",
      mobileBadgeLabel: "Outdated",
      ariaLabel: fullLabel
        ? `Listings may be outdated — last checked around ${fullLabel}`
        : "Listings may be outdated",
      detail: fullLabel
        ? `Listings were last checked around ${fullLabel} and may no longer reflect what's on the market.`
        : "Listings haven't been checked recently and may no longer reflect what's on the market.",
    };
  }

  return {
    tone: "fresh",
    dotClass: "bg-[#3a9b66]",
    ping: true,
    title: "Listings up to date",
    badgeLabel: shortLabel ? `Updated ${shortLabel}` : "Up to date",
    mobileBadgeLabel: null,
    ariaLabel: fullLabel
      ? `Listings last checked around ${fullLabel}`
      : "Listings up to date",
    detail: fullLabel
      ? `Listings were last checked around ${fullLabel}. We keep the latest listings close while making this view quick to reopen.`
      : "Apartment data refreshes frequently. We keep the latest listings close while making this view quick to reopen.",
  };
}
