import { describe, expect, it } from "vitest";
import {
  GROUP_PREFERENCES_SUBMIT_ERROR,
  groupPreferencesSubmitErrorMessage,
} from "./group-preferences-modal-state";

describe("group preferences modal submit errors", () => {
  it("surfaces the action failure message when group creation fails", () => {
    expect(
      groupPreferencesSubmitErrorMessage(
        new Error("Leave your current group on this listing before joining another."),
      ),
    ).toBe("Leave your current group on this listing before joining another.");
  });

  it("falls back for blank or unknown failures", () => {
    expect(groupPreferencesSubmitErrorMessage(new Error("   "))).toBe(
      GROUP_PREFERENCES_SUBMIT_ERROR,
    );
    expect(groupPreferencesSubmitErrorMessage("network failed")).toBe(
      GROUP_PREFERENCES_SUBMIT_ERROR,
    );
  });
});
