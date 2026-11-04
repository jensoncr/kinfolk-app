"use client";

import { useCallback, useState } from "react";
import { WHOLE_UNIT_GROUP_KEY } from "./persisted-roommate-groups";
import type {
  ApartmentListing,
  FloorPlanType,
  GroupPreferences,
  MembershipStatus,
} from "./types";

export type { MembershipStatus } from "./types";

export type UserMembership = {
  groupId: string;
  status: MembershipStatus;
};

export const VIEWER_MEMBER_NAME = "You";

type UseUserGroupsOptions = {
  listingId: string;
  onListingUpdated: (listing: ApartmentListing) => void;
};

type GroupActionResponse = {
  listing?: ApartmentListing;
  error?: string;
};

function membershipForPlan(plan: FloorPlanType): UserMembership | null {
  for (const group of plan.groups) {
    if (group.viewerMembershipStatus === "requested" || group.viewerMembershipStatus === "member") {
      return { groupId: group.id, status: group.viewerMembershipStatus };
    }
  }
  return null;
}

export function useUserGroups({ listingId, onListingUpdated }: UseUserGroupsOptions) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const postAction = useCallback(
    async (actionKey: string, payload: Record<string, unknown>) => {
      setPendingAction(actionKey);
      setError(null);
      try {
        const response = await fetch("/api/apartments/groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => ({}))) as GroupActionResponse;
        if (!response.ok) {
          throw new Error(body.error ?? "Unable to update group.");
        }
        if (body.listing) {
          onListingUpdated(body.listing);
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unable to update group.";
        setError(message);
        throw caught;
      } finally {
        setPendingAction(null);
      }
    },
    [onListingUpdated],
  );

  const requestJoinGroup = useCallback(
    async (groupId: string) => {
      await postAction(`request:${groupId}`, { action: "request_join", groupId });
    },
    [postAction],
  );

  const startGroup = useCallback(
    async (
      plan: FloorPlanType,
      floorPlanKey: string,
      preferences?: GroupPreferences | null,
    ) => {
      await postAction(`start:${floorPlanKey}`, {
        action: "start",
        listingId,
        floorPlanKey,
        floorPlanName: plan.name,
        targetUnitName: plan.id === WHOLE_UNIT_GROUP_KEY ? null : plan.name,
        bedrooms: plan.bedrooms,
        maxSize: plan.bedrooms,
        monthlyRent:
          plan.effectiveRentPriceMin ??
          plan.effectiveRentPriceMax ??
          plan.rentPriceMin ??
          plan.rentPriceMax,
        preferences: preferences ?? null,
      });
    },
    [listingId, postAction],
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      await postAction(`leave:${groupId}`, { action: "leave", groupId });
    },
    [postAction],
  );

  const membershipFor = useCallback(
    (plan: FloorPlanType): UserMembership | null => membershipForPlan(plan),
    [],
  );

  return {
    pendingAction,
    error,
    membershipFor,
    requestJoinGroup,
    startGroup,
    leaveGroup,
  };
}
