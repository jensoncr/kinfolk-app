import { describe, expect, it } from "vitest";
import {
  wholeUnitGroupActionLabel,
  wholeUnitGroupSummaryText,
} from "./property-detail-modal-state";

describe("property detail whole-unit group state", () => {
  it("keeps pending group requests distinct from joined groups", () => {
    expect(
      wholeUnitGroupActionLabel({
        hasFormingGroups: true,
        viewerMembershipStatus: "requested",
      }),
    ).toBe("View request");
    expect(wholeUnitGroupSummaryText("requested")).toBe(
      "are reviewing your request.",
    );
  });

  it("labels confirmed memberships as joined", () => {
    expect(
      wholeUnitGroupActionLabel({
        hasFormingGroups: true,
        viewerMembershipStatus: "member",
      }),
    ).toBe("View your group");
    expect(wholeUnitGroupSummaryText("member")).toBe("— you're in this group.");
  });

  it("keeps non-members on the join/start path", () => {
    expect(
      wholeUnitGroupActionLabel({
        hasFormingGroups: true,
        viewerMembershipStatus: null,
      }),
    ).toBe("Join a forming group");
    expect(
      wholeUnitGroupActionLabel({
        hasFormingGroups: false,
        viewerMembershipStatus: null,
      }),
    ).toBe("Start a group here");
    expect(wholeUnitGroupSummaryText(null)).toBe("are forming a group here.");
  });
});
