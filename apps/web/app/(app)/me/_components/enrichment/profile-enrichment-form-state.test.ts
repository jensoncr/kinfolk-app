import { describe, expect, it } from "vitest";
import {
  ENRICHMENT_TAG_FIELD_CAPS,
  ENRICHMENT_TAG_VALUE_MAX_LENGTH,
  addEnrichmentTagDraft,
  applyEnrichmentTagDrafts,
  emptyEnrichmentTagDrafts,
  normalizeEnrichmentBudgetRange,
  resolveEnrichmentBudgetMaxChange,
  resolveEnrichmentBudgetMinChange,
} from "./profile-enrichment-form-state";
import { emptyProfileEnrichmentFormValues } from "@/lib/profiles/enrichment-form";

describe("profile enrichment budget range state", () => {
  it("keeps normal ranges and sorts inverted prefill values", () => {
    expect(normalizeEnrichmentBudgetRange(2200, 3400)).toEqual({
      budgetMin: 2200,
      budgetMax: 3400,
    });
    expect(normalizeEnrichmentBudgetRange(5200, 450)).toEqual({
      budgetMin: 500,
      budgetMax: 5000,
    });
  });

  it("expands collapsed lower-bound ranges onto the slider track", () => {
    expect(normalizeEnrichmentBudgetRange(500, 500)).toEqual({
      budgetMin: 500,
      budgetMax: 600,
    });
  });

  it("expands collapsed upper-bound ranges back onto the slider track", () => {
    expect(normalizeEnrichmentBudgetRange(5000, 5000)).toEqual({
      budgetMin: 4900,
      budgetMax: 5000,
    });
  });

  it("defaults invalid range values instead of coercing blanks or booleans", () => {
    expect(normalizeEnrichmentBudgetRange("   ", true)).toEqual({
      budgetMin: 1400,
      budgetMax: 2600,
    });
  });

  it("accepts trimmed numeric range strings", () => {
    expect(normalizeEnrichmentBudgetRange(" 1800 ", " 3200 ")).toEqual({
      budgetMin: 1800,
      budgetMax: 3200,
    });
  });

  it("does not let minimum changes push below the slider lower bound", () => {
    expect(resolveEnrichmentBudgetMinChange(500, 500)).toEqual({
      budgetMin: 500,
      budgetMax: 600,
    });
  });

  it("does not let maximum changes push beyond the slider upper bound", () => {
    expect(resolveEnrichmentBudgetMaxChange(5000, 5000)).toEqual({
      budgetMin: 4900,
      budgetMax: 5000,
    });
  });
});

describe("profile enrichment tag drafts", () => {
  it("includes visible draft text in the submitted tag values", () => {
    expect(addEnrichmentTagDraft(["Mission"], "  Hayes   Valley  ")).toEqual([
      "Mission",
      "Hayes Valley",
    ]);
  });

  it("dedupes draft tags case-insensitively and ignores blanks", () => {
    expect(addEnrichmentTagDraft(["Mission"], " mission ")).toEqual(["Mission"]);
    expect(addEnrichmentTagDraft(["Mission"], "   ")).toEqual(["Mission"]);
  });

  it("clamps tag values and caps tag counts to the save contract", () => {
    const longDraft = "A".repeat(ENRICHMENT_TAG_VALUE_MAX_LENGTH + 24);
    expect(addEnrichmentTagDraft([], longDraft)).toEqual([
      "A".repeat(ENRICHMENT_TAG_VALUE_MAX_LENGTH),
    ]);

    const currentInterests = Array.from(
      { length: ENRICHMENT_TAG_FIELD_CAPS.interests },
      (_, index) => `Interest ${index + 1}`,
    );
    expect(
      addEnrichmentTagDraft(
        currentInterests,
        "Too many",
        ENRICHMENT_TAG_FIELD_CAPS.interests,
      ),
    ).toEqual(currentInterests);
  });

  it("applies all draft tag fields before submit", () => {
    const values = {
      ...emptyProfileEnrichmentFormValues(),
      dealbreakers: ["Smoking indoors"],
      interests: ["Cooking"],
      mustHaves: ["Natural light"],
      neighborhoods: ["Mission"],
    };
    const drafts = {
      ...emptyEnrichmentTagDrafts(),
      dealbreakers: "Long commute",
      interests: "Live music",
      mustHaves: "In-unit laundry",
      neighborhoods: "Hayes Valley",
    };

    expect(applyEnrichmentTagDrafts(values, drafts)).toMatchObject({
      dealbreakers: ["Smoking indoors", "Long commute"],
      interests: ["Cooking", "Live music"],
      mustHaves: ["Natural light", "In-unit laundry"],
      neighborhoods: ["Mission", "Hayes Valley"],
    });
  });
});
