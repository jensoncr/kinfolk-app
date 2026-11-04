import { describe, expect, it } from "vitest";
import { freshnessBadgeState } from "./freshness-badge-state";

const labels = {
  shortLabel: "Jun 24, 4:47 AM",
  fullLabel: "Wednesday, June 24, 4:47 AM PDT",
};

describe("freshnessBadgeState()", () => {
  it("fresh: green ping, date labels, no mobile label", () => {
    const state = freshnessBadgeState({
      hasTimestamp: true,
      stale: false,
      ...labels,
    });
    expect(state.tone).toBe("fresh");
    expect(state.ping).toBe(true);
    expect(state.dotClass).toBe("bg-[#3a9b66]");
    expect(state.title).toBe("Listings up to date");
    expect(state.badgeLabel).toBe("Updated Jun 24, 4:47 AM");
    expect(state.ariaLabel).toContain("last checked around Wednesday");
    expect(state.mobileBadgeLabel).toBeNull();
  });

  it("fresh before mount: no date claims, still 'up to date'", () => {
    const state = freshnessBadgeState({
      hasTimestamp: true,
      stale: false,
      shortLabel: null,
      fullLabel: null,
    });
    expect(state.badgeLabel).toBe("Up to date");
    expect(state.ariaLabel).toBe("Listings up to date");
  });

  it("stale: warning carried by text, aria label, and a compact mobile label", () => {
    const state = freshnessBadgeState({
      hasTimestamp: true,
      stale: true,
      ...labels,
    });
    expect(state.tone).toBe("stale");
    expect(state.ping).toBe(false);
    expect(state.dotClass).toBe("bg-[var(--ochre)]");
    expect(state.title).toBe("Listings may be outdated");
    expect(state.badgeLabel).toBe("Data from Jun 24, 4:47 AM");
    // A screen-reader user must hear the warning, not just the date.
    expect(state.ariaLabel).toContain("may be outdated");
    // Median semantics: hedged "checked around", never "refreshed on" or
    // "most were checked on" — both over-claim in a mixed catalog.
    expect(state.detail).toContain("last checked around");
    expect(state.detail).toContain("may no longer reflect");
    // Dot color alone fails WCAG 1.4.1, but the dated label would crush the
    // 320px search input — mobile gets a compact undated warning.
    expect(state.mobileBadgeLabel).toBe("Outdated");
  });

  it("stale before mount: warns without fabricating a date", () => {
    const state = freshnessBadgeState({
      hasTimestamp: true,
      stale: true,
      shortLabel: null,
      fullLabel: null,
    });
    expect(state.badgeLabel).toBe("Data outdated");
    expect(state.ariaLabel).toBe("Listings may be outdated");
  });

  it("unknown: never claims freshness in any channel", () => {
    const state = freshnessBadgeState({
      hasTimestamp: false,
      stale: false,
      ...labels,
    });
    expect(state.tone).toBe("unknown");
    expect(state.ping).toBe(false);
    expect(state.dotClass).toBe("bg-[var(--ink-400)]");
    expect(state.title).toBe("Freshness unknown");
    expect(state.badgeLabel).toBe("Freshness unknown");
    expect(state.ariaLabel).toBe("Listings freshness unknown");
    expect(state.mobileBadgeLabel).toBe("Unknown");
    for (const text of [state.badgeLabel, state.ariaLabel, state.detail]) {
      expect(text).not.toContain("up to date");
    }
  });

  it("no timestamp wins over a stray stale flag", () => {
    const state = freshnessBadgeState({
      hasTimestamp: false,
      stale: true,
      shortLabel: null,
      fullLabel: null,
    });
    expect(state.tone).toBe("unknown");
    // The whole presentation must follow, not just the tone.
    expect(state.dotClass).toBe("bg-[var(--ink-400)]");
    expect(state.mobileBadgeLabel).toBe("Unknown");
  });
});
