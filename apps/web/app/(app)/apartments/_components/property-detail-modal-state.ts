import type { MembershipStatus } from "@/lib/apartments/types";

export function wholeUnitGroupActionLabel({
  hasFormingGroups,
  viewerMembershipStatus,
}: {
  hasFormingGroups: boolean;
  viewerMembershipStatus: MembershipStatus | null;
}) {
  if (viewerMembershipStatus === "member") return "View your group";
  if (viewerMembershipStatus === "requested") return "View request";
  return hasFormingGroups ? "Join a forming group" : "Start a group here";
}

export function wholeUnitGroupSummaryText(
  viewerMembershipStatus: MembershipStatus | null,
) {
  if (viewerMembershipStatus === "member") return "— you're in this group.";
  if (viewerMembershipStatus === "requested") return "are reviewing your request.";
  return "are forming a group here.";
}
