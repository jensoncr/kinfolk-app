import { describe, expect, it } from "vitest";
import { resolveAboutTextSave } from "./about-text-state";

describe("about text save state", () => {
  it("saves trimmed user text as the persisted and displayed value", () => {
    expect(resolveAboutTextSave("  Quiet mornings.\nDinner sometimes.  ", "Imported bio")).toEqual({
      displayValue: "Quiet mornings.\nDinner sometimes.",
      isUserEdited: true,
      patchValue: "Quiet mornings.\nDinner sometimes.",
    });
  });

  it("treats a blank save as resetting to the imported suggestion", () => {
    expect(resolveAboutTextSave("   \n  ", "Imported bio")).toEqual({
      displayValue: "Imported bio",
      isUserEdited: false,
      patchValue: null,
    });
  });

  it("clamps optimistic saved text to the same max length as the editor and server", () => {
    const saved = resolveAboutTextSave("  1234567890  ", "Imported bio", 5);

    expect(saved).toEqual({
      displayValue: "12345",
      isUserEdited: true,
      patchValue: "12345",
    });
  });
});
