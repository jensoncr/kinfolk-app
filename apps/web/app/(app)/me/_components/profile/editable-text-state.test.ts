import { describe, expect, it } from "vitest";
import {
  closeEditableTextEditor,
  openEditableTextEditor,
} from "./editable-text-state";

describe("editable text state", () => {
  it("starts editing from the current value and clears stale errors", () => {
    expect(openEditableTextEditor("Existing about text")).toEqual({
      draft: "Existing about text",
      editing: true,
      inlineError: null,
      topLevelError: null,
    });
  });

  it("closes the editor with cleared feedback", () => {
    expect(closeEditableTextEditor()).toEqual({
      draft: "",
      editing: false,
      inlineError: null,
      topLevelError: null,
    });
  });
});
