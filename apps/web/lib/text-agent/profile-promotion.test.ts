import { describe, expect, it } from "vitest";
import type { TextProfileFact } from "./index";
import { refreshMatchingStateForTextProfileFacts } from "./profile-promotion";

describe("text agent profile promotion", () => {
  it("refreshes matching inline for foundation facts that unstarve apartment matching", () => {
    expect(
      refreshMatchingStateForTextProfileFacts([
        fact("budget_max", 1500),
        fact("neighborhoods", ["Mission"]),
      ]),
    ).toBe(true);
    expect(
      refreshMatchingStateForTextProfileFacts([
        fact("move_in_window", { start: "2026-07-01", end: "2026-08-01" }),
      ]),
    ).toBe(true);
  });

  it("refreshes matching inline for standard roommate compatibility facts", () => {
    expect(
      refreshMatchingStateForTextProfileFacts([
        fact("work_from_home", "2 days a week"),
        fact("cleanliness", "tidy"),
        fact("communication_style", "direct"),
      ]),
    ).toBe(true);
  });

  it("keeps non-matching profile details deferred", () => {
    expect(
      refreshMatchingStateForTextProfileFacts([
        {
          ...fact("interests", ["film", "cooking"]),
          matching_eligible: false,
        },
      ]),
    ).toBe("deferred");
  });

  it("does not inline refresh sensitive matching facts", () => {
    expect(
      refreshMatchingStateForTextProfileFacts([
        {
          ...fact("cleanliness", "tidy"),
          sensitivity_level: "sensitive",
        },
      ]),
    ).toBe("deferred");
  });
});

function fact(
  factKey: string,
  value: TextProfileFact["value"],
): TextProfileFact {
  return {
    assertion_type: "explicit",
    confidence: 1,
    dimension: "feasibility",
    evidence: String(value),
    fact_key: factKey,
    importance: 1,
    matching_eligible: true,
    sensitivity_level: "standard",
    value,
  };
}
