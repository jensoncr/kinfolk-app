import type {
  MembershipStatus,
  RoommateGroup,
  RoommateGroupMember,
} from "@/lib/apartments/types";

const VIEWER_MEMBER_NAME = "You";

type GroupDetailFooterInput = {
  group: Pick<RoommateGroup, "id" | "members">;
  hasOtherMembership: boolean;
  isSoloUserGroup: boolean;
  isUserInThis: boolean;
  pendingAction?: string | null;
  ready: boolean;
  userStatus: MembershipStatus | null;
};

export type GroupDetailFooterActionState =
  | {
      kind: "requested";
      statusText: string;
      buttonLabel: "Withdraw";
      disabled: boolean;
    }
  | {
      kind: "member";
      detailText: string;
      buttonLabel: string;
      disabled: boolean;
    }
  | {
      kind: "other-membership";
      detailText: string;
    }
  | {
      kind: "full";
      detailText: string;
    }
  | {
      kind: "request";
      detailText: string;
      buttonLabel: "Request to join" | "Requesting...";
      disabled: boolean;
    };

function isViewer(member: RoommateGroupMember): boolean {
  return member.name === VIEWER_MEMBER_NAME;
}

function firstName(name: string): string {
  if (name === VIEWER_MEMBER_NAME) return "You";
  return name.split(" ")[0] ?? name;
}

function joinReviewerNames(members: RoommateGroupMember[]): string {
  const names = members.filter((member) => !isViewer(member)).map((member) => firstName(member.name));
  if (names.length === 0) return "the group";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function reviewStatusText(members: RoommateGroupMember[]): string {
  const reviewers = members.filter((member) => !isViewer(member));
  if (reviewers.length === 0) return "The group is reviewing your profile.";
  const names = joinReviewerNames(reviewers);
  const verb = reviewers.length === 1 ? "is" : "are";
  return `${names} ${verb} reviewing your profile.`;
}

export function userGroupActionLabel(
  group: Pick<RoommateGroup, "members"> | null,
  status: MembershipStatus | null,
): string {
  if (status === "requested") return "Withdraw request";
  if (group && group.members.length <= 1) return "Delete group";
  return "Leave group";
}

export function groupDetailFooterActionState({
  group,
  hasOtherMembership,
  isSoloUserGroup,
  isUserInThis,
  pendingAction,
  ready,
  userStatus,
}: GroupDetailFooterInput): GroupDetailFooterActionState {
  if (isUserInThis && userStatus === "requested") {
    return {
      kind: "requested",
      statusText: reviewStatusText(group.members),
      buttonLabel: "Withdraw",
      disabled: pendingAction === `leave:${group.id}`,
    };
  }

  if (isUserInThis) {
    return {
      kind: "member",
      detailText: isSoloUserGroup
        ? "Delete it if you aren't looking here anymore."
        : "Kinfolk will help line up a unit and a tour.",
      buttonLabel: userGroupActionLabel(group, userStatus),
      disabled: pendingAction === `leave:${group.id}`,
    };
  }

  if (hasOtherMembership) {
    return {
      kind: "other-membership",
      detailText:
        "You're already with another group on this listing. Leave it first to request a different one.",
    };
  }

  if (ready) {
    return {
      kind: "full",
      detailText: "This group is full and ready to book. No open rooms right now.",
    };
  }

  const isRequesting = pendingAction === `request:${group.id}`;
  return {
    kind: "request",
    detailText: `${joinReviewerNames(group.members)} will see your profile to confirm the household. Nothing is final until they accept.`,
    buttonLabel: isRequesting ? "Requesting..." : "Request to join",
    disabled: isRequesting,
  };
}
