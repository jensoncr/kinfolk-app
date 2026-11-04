import { describe, expect, it } from "vitest";
import {
  normalizeGroupPreferences,
  summarizeGroupPreferences,
  validatePreferredAgeRange,
} from "./group-preferences";
import type { GroupPreferences } from "@/lib/apartments/types";

const invalidAgePreference: GroupPreferences = {
  gender: "men",
  ageMin: 20,
  ageMax: 18,
  pets: { value: "none", gate: "required" },
  industry: { value: "Tech", gate: "preferred" },
  moveIn: null,
};

describe("group preference age ranges", () => {
  it("rejects impossible min/max age ranges", () => {
    expect(validatePreferredAgeRange(20, 18)).toBe(
      "Minimum age must be less than or equal to maximum age.",
    );
  });

  it("removes invalid stored age ranges before saving or rendering chips", () => {
    const normalized = normalizeGroupPreferences(invalidAgePreference);
    expect(normalized?.ageMin).toBeNull();
    expect(normalized?.ageMax).toBeNull();

    const chipLabels = summarizeGroupPreferences(invalidAgePreference).map(
      (chip) => chip.label,
    );
    expect(chipLabels).not.toContain("Age 20-18");
    expect(chipLabels).toEqual(["Men", "No pets", "Tech"]);
  });
});
