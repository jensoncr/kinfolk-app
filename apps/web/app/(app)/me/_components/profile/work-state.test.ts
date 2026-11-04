import { describe, expect, it } from "vitest";
import {
  closeWorkEditor,
  openWorkEditor,
  resolveWorkSave,
} from "./work-state";

describe("work save state", () => {
  it("opens and closes the editor with stale top-level feedback cleared", () => {
    expect(openWorkEditor()).toEqual({ editing: true, topLevelError: null });
    expect(closeWorkEditor()).toEqual({ editing: false, topLevelError: null });
  });

  it("saves trimmed role and company as user-edited values", () => {
    expect(
      resolveWorkSave(
        "  Product designer  ",
        "  Kinfolk Labs  ",
        "Imported role",
        "Imported company",
      ),
    ).toEqual({
      companyDisplayValue: "Kinfolk Labs",
      companyIsUserEdited: true,
      companyPatchValue: "Kinfolk Labs",
      titleDisplayValue: "Product designer",
      titleIsUserEdited: true,
      titlePatchValue: "Product designer",
    });
  });

  it("treats blank role and company fields as resetting to imported suggestions", () => {
    expect(resolveWorkSave("  ", "\n", "Imported role", "Imported company")).toEqual({
      companyDisplayValue: "Imported company",
      companyIsUserEdited: false,
      companyPatchValue: null,
      titleDisplayValue: "Imported role",
      titleIsUserEdited: false,
      titlePatchValue: null,
    });
  });

  it("can reset one field while preserving the other user edit", () => {
    expect(resolveWorkSave("", "NewCo", "Imported role", "Imported company")).toEqual({
      companyDisplayValue: "NewCo",
      companyIsUserEdited: true,
      companyPatchValue: "NewCo",
      titleDisplayValue: "Imported role",
      titleIsUserEdited: false,
      titlePatchValue: null,
    });
  });

  it("clamps optimistic work values to the same max length as the editor and server", () => {
    expect(resolveWorkSave("  ProductDesigner  ", "  KinfolkLabs  ", "", "", 7)).toEqual({
      companyDisplayValue: "Kinfolk",
      companyIsUserEdited: true,
      companyPatchValue: "Kinfolk",
      titleDisplayValue: "Product",
      titleIsUserEdited: true,
      titlePatchValue: "Product",
    });
  });
});
