import { describe, expect, it } from "vitest";
import {
  addPreferenceDraft,
  closePreferenceListEditor,
  normalizePreferenceList,
  openPreferenceListEditor,
} from "./preference-list-state";

describe("preference list state", () => {
  it("opens and closes the editor with stale feedback cleared", () => {
    expect(openPreferenceListEditor()).toEqual({
      editing: true,
      inlineError: null,
      topLevelError: null,
    });
    expect(closePreferenceListEditor()).toEqual({
      editing: false,
      inlineError: null,
      topLevelError: null,
    });
  });

  it("adds the current draft to the saved list", () => {
    expect(addPreferenceDraft(["In-unit laundry"], " Sunny   kitchen ")).toEqual([
      "In-unit laundry",
      "Sunny kitchen",
    ]);
  });

  it("normalizes existing tags and removes case-insensitive duplicates", () => {
    expect(
      normalizePreferenceList([
        "  In-unit   laundry ",
        "in-unit laundry",
        "",
        "Natural light",
      ]),
    ).toEqual(["In-unit laundry", "Natural light"]);
  });

  it("does not add a duplicate draft", () => {
    expect(addPreferenceDraft(["No smoking indoors"], "no smoking indoors")).toEqual([
      "No smoking indoors",
    ]);
  });

  it("keeps at most twelve tags to match server persistence", () => {
    const tags = Array.from({ length: 12 }, (_, index) => `Tag ${index + 1}`);

    expect(addPreferenceDraft(tags, "Tag 13")).toEqual(tags);
  });

  it("normalizes tags even when the draft is blank", () => {
    expect(addPreferenceDraft(["  Quiet   mornings ", "quiet mornings"], "  ")).toEqual([
      "Quiet mornings",
    ]);
  });

  it("clamps tags to the same max length as the editor and server", () => {
    const longTag = "Morning writing in the greenhouse with sunlight";

    expect(addPreferenceDraft([], longTag)).toEqual([
      "Morning writing in the greenhouse with s",
    ]);
    expect(normalizePreferenceList([longTag, `${longTag} after coffee`])).toEqual([
      "Morning writing in the greenhouse with s",
    ]);
  });
});
