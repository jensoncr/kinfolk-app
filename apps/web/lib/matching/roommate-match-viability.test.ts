import { describe, expect, it } from "vitest";
import { isViableRoommateMatch } from "./roommate-match-viability";

describe("roommate match viability", () => {
  it("treats only positive scores as viable roommate matches", () => {
    expect(isViableRoommateMatch({ score: 1 })).toBe(true);
    expect(isViableRoommateMatch({ score: 87 })).toBe(true);

    expect(isViableRoommateMatch({ score: 0 })).toBe(false);
    expect(isViableRoommateMatch({ score: -1 })).toBe(false);
  });

  it("filters hard-gated roommate edges while preserving viable ones", () => {
    const matches = [
      { id: "hard-gated", score: 0 },
      { id: "viable", score: 73 },
    ];

    expect(matches.filter(isViableRoommateMatch).map((match) => match.id)).toEqual([
      "viable",
    ]);
  });
});
