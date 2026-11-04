import { describe, expect, it } from "vitest";
import {
  buildRoommateMatchPreview,
  selectRoommateMatchNotifications,
  DEFAULT_ROOMMATE_NOTIFICATION_CONFIG,
  type RoommateMatchCandidate,
} from "./roommate-match-notification";

const NOW = new Date("2026-06-10T18:00:00.000Z");

function candidate(
  over: Partial<RoommateMatchCandidate> = {},
): RoommateMatchCandidate {
  return {
    edgeId: "edge-1",
    otherUserId: "user-2",
    score: 90,
    computedAt: "2026-06-10T17:00:00.000Z",
    name: "Jack Munhall",
    dimensionLabels: ["Lifestyle", "Schedule", "Budget", "Guests"],
    ...over,
  };
}

describe("selectRoommateMatchNotifications", () => {
  it("returns nothing when the recipient has not opted into the silent matcher", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [candidate()],
      silentMatcherEnabled: false,
      recentNotifications: [],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("selects an above-threshold, opted-in, not-yet-notified edge", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [candidate()],
      silentMatcherEnabled: true,
      recentNotifications: [],
      now: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0].edgeId).toBe("edge-1");
    expect(result[0].fitScore).toBe(90);
  });

  it("drops edges below the score threshold", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [candidate({ score: DEFAULT_ROOMMATE_NOTIFICATION_CONFIG.minScore - 1 })],
      silentMatcherEnabled: true,
      recentNotifications: [],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("does not re-notify the same (edge, computedAt) pair", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [candidate()],
      silentMatcherEnabled: true,
      recentNotifications: [
        { edgeId: "edge-1", computedAt: "2026-06-10T17:00:00.000Z", sentAt: "2026-06-09T10:00:00.000Z" },
      ],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("re-notifies when the edge has been re-scored (newer computedAt)", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [candidate({ computedAt: "2026-06-10T17:30:00.000Z" })],
      silentMatcherEnabled: true,
      recentNotifications: [
        { edgeId: "edge-1", computedAt: "2026-06-10T17:00:00.000Z", sentAt: "2026-06-09T10:00:00.000Z" },
      ],
      now: NOW,
    });
    expect(result).toHaveLength(1);
  });

  it("enforces the per-day velocity cap, keeping the highest-scoring edge", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [
        candidate({ edgeId: "edge-low", score: 85 }),
        candidate({ edgeId: "edge-high", score: 95 }),
      ],
      silentMatcherEnabled: true,
      recentNotifications: [],
      config: { minScore: 80, maxPerDay: 1 },
      now: NOW,
    });
    expect(result.map((r) => r.edgeId)).toEqual(["edge-high"]);
  });

  it("counts a recent send against the daily budget", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [candidate()],
      silentMatcherEnabled: true,
      recentNotifications: [
        { edgeId: "edge-other", computedAt: "x", sentAt: "2026-06-10T09:00:00.000Z" },
      ],
      config: { minScore: 80, maxPerDay: 1 },
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("ignores sends older than 24h for the velocity cap", () => {
    const result = selectRoommateMatchNotifications({
      candidates: [candidate()],
      silentMatcherEnabled: true,
      recentNotifications: [
        { edgeId: "edge-other", computedAt: "x", sentAt: "2026-06-08T09:00:00.000Z" },
      ],
      config: { minScore: 80, maxPerDay: 1 },
      now: NOW,
    });
    expect(result).toHaveLength(1);
  });
});

describe("buildRoommateMatchPreview (reveal contract)", () => {
  it("exposes only fit + first name + initials + labels, never contact info", () => {
    const preview = buildRoommateMatchPreview(candidate());
    expect(preview).toEqual({
      edgeId: "edge-1",
      fitScore: 90,
      firstName: "Jack",
      initials: "JM",
      dimensionLabels: ["Lifestyle", "Schedule", "Budget"],
    });
    // Hard assertion that no contact/identity field can leak through.
    const keys = Object.keys(preview);
    for (const forbidden of ["phone", "email", "address", "lastName", "userId", "otherUserId"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
