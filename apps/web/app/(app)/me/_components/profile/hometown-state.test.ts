import { describe, expect, it } from "vitest";
import {
  canSaveHometownDraft,
  closeHometownEditor,
  openHometownEditor,
  resolveHometownSave,
} from "./hometown-state";

describe("hometown save state", () => {
  it("opens and closes the editor with stale top-level feedback cleared", () => {
    expect(openHometownEditor()).toEqual({ editing: true, topLevelError: null });
    expect(closeHometownEditor()).toEqual({ editing: false, topLevelError: null });
  });

  it("allows equivalent selected hometown labels with different casing or punctuation", () => {
    expect(canSaveHometownDraft("austin tx", "Austin, TX")).toBe(true);
    expect(canSaveHometownDraft("  San   Francisco, ca  ", "San Francisco, CA"))
      .toBe(true);
  });

  it("requires a selected hometown suggestion for non-empty drafts", () => {
    expect(canSaveHometownDraft("Austin, TX", "")).toBe(false);
    expect(canSaveHometownDraft("Austin, TX", "Boston, MA")).toBe(false);
    expect(canSaveHometownDraft("   ", "")).toBe(true);
  });

  it("saves a trimmed selected hometown as the persisted and displayed value", () => {
    expect(resolveHometownSave("  Chicago, IL  ", "Palo Alto, CA")).toEqual({
      displayValue: "Chicago, IL",
      patchValue: "Chicago, IL",
    });
  });

  it("treats a blank hometown save as resetting to the imported suggestion", () => {
    expect(resolveHometownSave("   \n  ", "Palo Alto, CA")).toEqual({
      displayValue: "Palo Alto, CA",
      patchValue: null,
    });
  });

  it("stays empty when there is no imported hometown suggestion", () => {
    expect(resolveHometownSave("", "")).toEqual({
      displayValue: "",
      patchValue: null,
    });
  });

  it("clamps optimistic hometown values to the same max length as the editor and server", () => {
    expect(resolveHometownSave("  San Francisco, CA  ", "", 13)).toEqual({
      displayValue: "San Francisco",
      patchValue: "San Francisco",
    });
  });
});
