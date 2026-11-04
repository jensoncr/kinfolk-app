import { describe, expect, it } from "vitest";
import {
  buildCorrectionConfirmationReply,
  buildCorrectionProfileActions,
  exclusiveTextProfileFactFamily,
  isTextProfileCorrectionMessage,
  normalizePreferredAgeRangeValue,
  normalizeTextProfileFactForCorrection,
  textProfileFactsCoverAgeComfortStep,
  type CorrectionProfileFact,
} from "./corrections";

function fact(
  factKey: string,
  value: CorrectionProfileFact["value"],
): CorrectionProfileFact {
  return { fact_key: factKey, value };
}

describe("text-agent-corrections", () => {
  it("detects common correction phrases", () => {
    expect(isTextProfileCorrectionMessage("Sorry I mean 20-29")).toBe(true);
    expect(isTextProfileCorrectionMessage("actually 22-30")).toBe(true);
    expect(isTextProfileCorrectionMessage("August")).toBe(false);
  });

  it("treats age and preferred_age_range as exclusive revocable slots", () => {
    expect(exclusiveTextProfileFactFamily("preferred_age_range")).toEqual([
      "preferred_age_range",
    ]);
    expect(exclusiveTextProfileFactFamily("age")).toEqual(["age"]);
  });

  it("rejects inverted age ranges", () => {
    expect(normalizePreferredAgeRangeValue({ min: 20, max: 19 })).toBeNull();
    expect(normalizePreferredAgeRangeValue({ min: 20, max: 29 })).toEqual({
      min: 20,
      max: 29,
      strict: false,
    });
    expect(normalizePreferredAgeRangeValue("20-29")).toEqual({
      min: 20,
      max: 29,
      strict: false,
    });
  });

  it("does not mark age comfort complete when only an invalid range is present", () => {
    expect(
      textProfileFactsCoverAgeComfortStep([
        fact("age", 24),
        fact("preferred_age_range", { min: 20, max: 19 }),
      ]),
    ).toBe(false);
    expect(
      textProfileFactsCoverAgeComfortStep([
        fact("preferred_age_range", { min: 20, max: 19 }),
      ]),
    ).toBe(false);
    expect(
      textProfileFactsCoverAgeComfortStep([
        fact("age", 24),
        fact("preferred_age_range", { min: 20, max: 29 }),
      ]),
    ).toBe(true);
  });

  it("builds replace actions for correction messages", () => {
    const actions = buildCorrectionProfileActions("Sorry I mean 20-29", [
      fact("preferred_age_range", { min: 20, max: 29 }),
    ]);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toBe("replace_profile_facts");
    expect(actions[0]?.revokeFactKeys).toEqual(["preferred_age_range"]);
    expect(actions[0]?.facts[0]?.value).toEqual({
      min: 20,
      max: 29,
      strict: false,
    });
  });

  it("treats target and stretch budget corrections as one budget edit", () => {
    const actions = buildCorrectionProfileActions(
      "Actually target is $2,800 but I can stretch to $3,200",
      [fact("budget_preferred_max", 2800), fact("budget_max", 3200)],
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]?.slot).toBe("budget");
    expect(actions[0]?.revokeFactKeys).toEqual([
      "budget",
      "budget_min",
      "budget_max",
      "budget_preferred_max",
    ]);
    expect(actions[0]?.facts.map((item) => item.fact_key)).toEqual([
      "budget_preferred_max",
      "budget_max",
    ]);
    expect(buildCorrectionConfirmationReply(actions[0]?.facts ?? [])).toBe(
      "Updated your budget.",
    );
  });

  it("normalizes corrected age range facts before persistence", () => {
    const normalized = normalizeTextProfileFactForCorrection(
      fact("preferred_age_range", { min: 20, max: 29 }),
    );

    expect(normalized?.value).toEqual({
      min: 20,
      max: 29,
      strict: false,
    });
  });

  it("builds a slot-specific correction confirmation", () => {
    expect(
      buildCorrectionConfirmationReply([
        fact("preferred_age_range", { min: 20, max: 29 }),
      ]),
    ).toBe("Updated your roommate age range to 20-29.");
  });
});
