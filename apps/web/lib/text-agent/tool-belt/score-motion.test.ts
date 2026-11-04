import { describe, expect, it } from "vitest";
import { describeScoreMotion, type TopEdgeScore } from "./score-motion";

function edge(otherUserId: string, name: string, score: number): TopEdgeScore {
  return { name, otherUserId, score };
}

describe("describeScoreMotion", () => {
  it("narrates the biggest riser of at least 2 points", () => {
    const before = [
      edge("u-jack", "Jack", 78),
      edge("u-priya", "Priya", 70),
      edge("u-nora", "Nora", 69),
    ];
    const after = [
      edge("u-jack", "Jack", 84),
      edge("u-priya", "Priya", 71),
      edge("u-nora", "Nora", 69),
    ];

    expect(describeScoreMotion(before, after)).toEqual({
      after: 84,
      becameTopMatch: false,
      before: 78,
      name: "Jack",
    });
  });

  it("flags a leader change", () => {
    const before = [edge("u-priya", "Priya", 74), edge("u-jack", "Jack", 72)];
    const after = [edge("u-jack", "Jack", 80), edge("u-priya", "Priya", 74)];

    expect(describeScoreMotion(before, after)).toEqual({
      after: 80,
      becameTopMatch: true,
      before: 72,
      name: "Jack",
    });
  });

  it("returns null when nothing moved enough to mention", () => {
    const before = [edge("u-jack", "Jack", 78)];
    const after = [edge("u-jack", "Jack", 79)];

    expect(describeScoreMotion(before, after)).toBeNull();
    expect(describeScoreMotion([], [])).toBeNull();
  });

  it("ignores brand-new edges with no prior score to compare against", () => {
    const before = [edge("u-jack", "Jack", 78)];
    const after = [edge("u-new", "Sam", 82), edge("u-jack", "Jack", 78)];

    // A first-ever score isn't "motion" — narrating it as movement would lie.
    expect(describeScoreMotion(before, after)).toBeNull();
  });

  it("never narrates score drops", () => {
    const before = [edge("u-jack", "Jack", 84)];
    const after = [edge("u-jack", "Jack", 70)];

    expect(describeScoreMotion(before, after)).toBeNull();
  });
});
