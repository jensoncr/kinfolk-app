import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/shared/api-error";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;

export type GroupJoinResponseStatus =
  | "accepted"
  | "already_accepted"
  | "declined"
  | "no_pending_request";

export async function respondToApartmentGroupJoinRequest(
  supabase: SupabaseServiceClient,
  {
    actorUserId,
    approve,
    groupId,
    targetUserId,
  }: {
    actorUserId: string;
    approve: boolean;
    groupId: string;
    targetUserId: string;
  },
): Promise<GroupJoinResponseStatus> {
  const group = await loadGroupForJoinResponse(supabase, groupId);
  if (group.created_by_user_id !== actorUserId) {
    throw new ApiError("Only the group's creator can respond to join requests.");
  }
  if (targetUserId === actorUserId) {
    throw new ApiError("You can't respond to your own request.");
  }

  if (!approve) {
    const declineResult = await supabase
      .from("apartment_roommate_group_memberships")
      .update({
        approved_at: null,
        left_at: null,
        status: "declined",
      })
      .eq("group_id", group.id)
      .eq("user_id", targetUserId)
      .eq("status", "requested")
      .select("id");
    if (declineResult.error) throw declineResult.error;
    return (declineResult.data ?? []).length > 0
      ? "declined"
      : "no_pending_request";
  }

  const otherActiveGroupId = await findActiveListingMembershipExcludingGroup(
    supabase,
    targetUserId,
    group.listing_id,
    group.id,
  );
  if (otherActiveGroupId) {
    throw new ApiError("That person is already active in another group on this listing.");
  }

  const membersResult = await supabase
    .from("apartment_roommate_group_memberships")
    .select("id", { count: "exact", head: true })
    .eq("group_id", group.id)
    .eq("status", "member");
  if (membersResult.error) throw membersResult.error;

  const memberCount = membersResult.count ?? 0;
  if (memberCount >= group.max_size) {
    throw new ApiError("This group is already full.");
  }

  const approveResult = await supabase
    .from("apartment_roommate_group_memberships")
    .update({
      approved_at: new Date().toISOString(),
      left_at: null,
      status: "member",
    })
    .eq("group_id", group.id)
    .eq("user_id", targetUserId)
    .eq("status", "requested")
    .select("id");
  if (approveResult.error) throw approveResult.error;

  if ((approveResult.data ?? []).length === 0) {
    const current = await supabase
      .from("apartment_roommate_group_memberships")
      .select("status")
      .eq("group_id", group.id)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (current.error) throw current.error;
    if (current.data?.status === "member") {
      return "already_accepted";
    }

    throw new ApiError("That request is no longer pending.");
  }

  if (memberCount + 1 >= group.max_size && group.status === "forming") {
    const statusResult = await supabase
      .from("apartment_roommate_groups")
      .update({ status: "ready" })
      .eq("id", group.id);
    if (statusResult.error) throw statusResult.error;
  }

  // Recompute-on-join: reconcile the group's real constraints (tightest
  // budget cap, dealbreaker union, move-in overlap) now that membership
  // changed, and persist them on the group so every surface reads arithmetic
  // instead of the naive rent/max_size. Best-effort — a reconciliation
  // failure must never undo an accepted join.
  try {
    await refreshGroupConstraints(supabase, group.id);
  } catch (error) {
    console.error("[groups] group constraint refresh failed", {
      error: error instanceof Error ? error.message : String(error),
      groupId: group.id,
    });
  }

  return "accepted";
}

/**
 * Load every member's matching profile + dealbreakers, reconcile them via
 * the pure group-feasibility module, and persist the result into the group's
 * preferences jsonb (`group_constraints`) plus a feasibility read against the
 * group's rent. Exported for the group surfaces and jobs that need a refresh.
 */
async function refreshGroupConstraints(
  supabase: SupabaseServiceClient,
  groupId: string,
): Promise<void> {
  const [groupResult, membershipsResult] = await Promise.all([
    supabase
      .from("apartment_roommate_groups")
      .select("id,max_size,monthly_rent,preferences")
      .eq("id", groupId)
      .single(),
    supabase
      .from("apartment_roommate_group_memberships")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("status", "member"),
  ]);
  if (groupResult.error) throw groupResult.error;
  if (membershipsResult.error) throw membershipsResult.error;

  const memberIds = (membershipsResult.data ?? []).map((row) => row.user_id);
  if (memberIds.length === 0) return;

  const [profilesResult, housingResult] = await Promise.all([
    supabase
      .from("matching_profiles")
      .select("user_id,budget_min,budget_max,move_in_start,move_in_end,updated_at")
      .in("user_id", memberIds)
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
    supabase
      .from("housing_preferences")
      .select("user_id,dealbreakers,updated_at")
      .in("user_id", memberIds)
      .order("updated_at", { ascending: false }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (housingResult.error) throw housingResult.error;

  const profileByUser = new Map<string, (typeof profilesResult.data)[number]>();
  for (const profile of profilesResult.data ?? []) {
    if (!profileByUser.has(profile.user_id)) profileByUser.set(profile.user_id, profile);
  }
  const dealbreakersByUser = new Map<string, string[]>();
  for (const housing of housingResult.data ?? []) {
    if (!dealbreakersByUser.has(housing.user_id)) {
      dealbreakersByUser.set(housing.user_id, housing.dealbreakers ?? []);
    }
  }

  const members = memberIds.map((userId) => {
    const profile = profileByUser.get(userId);
    return {
      budgetMax: profile?.budget_max ?? null,
      budgetMin: profile?.budget_min ?? null,
      dealbreakers: dealbreakersByUser.get(userId) ?? [],
      moveInEnd: profile?.move_in_end ?? null,
      moveInStart: profile?.move_in_start ?? null,
      userId,
    };
  });

  const { evaluateGroupListingFeasibility, reconcileGroupConstraints } =
    await import("../matching/group-feasibility");
  const constraints = reconcileGroupConstraints(members);
  const feasibility = evaluateGroupListingFeasibility({
    groupSize: groupResult.data.max_size,
    members,
    monthlyRent: groupResult.data.monthly_rent,
  });

  const existingPreferences =
    groupResult.data.preferences &&
    typeof groupResult.data.preferences === "object" &&
    !Array.isArray(groupResult.data.preferences)
      ? (groupResult.data.preferences as Record<string, Json>)
      : {};

  const update = await supabase
    .from("apartment_roommate_groups")
    .update({
      preferences: {
        ...existingPreferences,
        group_constraints: {
          binding_budget_user_ids: constraints.bindingBudgetUserIds,
          budget_per_person_cap: constraints.budgetPerPersonCap,
          budget_per_person_floor: constraints.budgetPerPersonFloor,
          computed_at: new Date().toISOString(),
          dealbreakers: constraints.dealbreakers,
          move_in_disjoint: constraints.moveInDisjoint,
          move_in_window: constraints.moveInWindow,
          per_person_rent: feasibility.perPersonRent,
          stretched_user_ids: feasibility.stretchedUserIds,
          within_every_budget: feasibility.withinEveryBudget,
        },
      } as Json,
    })
    .eq("id", groupId);
  if (update.error) throw update.error;
}

export type StartApartmentGroupInput = {
  listingId: string;
  floorPlanKey: string;
  floorPlanName: string;
  targetUnitName?: string | null;
  bedrooms?: number | null;
  maxSize?: number | null;
  monthlyRent?: number | null;
  preferences?: Json | null;
};

/**
 * Create a user-started roommate group on a listing floor plan and seat the
 * creator. Idempotent per listing: an existing active membership (or pending
 * request) short-circuits instead of spawning a second group. Returns the
 * listing id so callers can re-read listing detail.
 */
export async function startApartmentGroup(
  supabase: SupabaseServiceClient,
  userId: string,
  input: StartApartmentGroupInput,
): Promise<string> {
  const maxSize = positiveInteger(input.maxSize ?? input.bedrooms, 1);
  const existingGroupId = await findActiveListingMembership(
    supabase,
    userId,
    input.listingId,
  );
  if (existingGroupId) return input.listingId;

  const groupResult = await supabase
    .from("apartment_roommate_groups")
    .insert({
      listing_id: input.listingId,
      floor_plan_key: input.floorPlanKey,
      floor_plan_name: input.floorPlanName,
      target_unit_name: input.targetUnitName ?? null,
      bedrooms: input.bedrooms ?? null,
      max_size: maxSize,
      monthly_rent: input.monthlyRent == null ? null : Math.round(input.monthlyRent),
      status: maxSize === 1 ? "ready" : "forming",
      source: "user",
      created_by_user_id: userId,
      preferences: input.preferences ?? {},
    })
    .select("id,listing_id")
    .single();

  if (groupResult.error) throw groupResult.error;

  const membershipResult = await supabase
    .from("apartment_roommate_group_memberships")
    .insert({
      group_id: groupResult.data.id,
      user_id: userId,
      status: "member",
      role: "creator",
      approved_at: new Date().toISOString(),
    });

  if (membershipResult.error) {
    await supabase
      .from("apartment_roommate_groups")
      .update({ status: "closed" })
      .eq("id", groupResult.data.id);
    throw membershipResult.error;
  }

  return groupResult.data.listing_id;
}

/**
 * Record a pending join request and notify the group's creator. Rejoining a
 * group the user is already active in is a no-op. Returns the listing id.
 */
export async function requestToJoinApartmentGroup(
  supabase: SupabaseServiceClient,
  userId: string,
  groupId: string,
): Promise<string> {
  const group = await loadActiveGroup(supabase, groupId);
  const existingGroupId = await findActiveListingMembership(
    supabase,
    userId,
    group.listing_id,
  );
  if (existingGroupId && existingGroupId !== group.id) {
    throw new ApiError("Leave your current group on this listing before joining another.");
  }
  if (existingGroupId === group.id) return group.listing_id;

  const membersResult = await supabase
    .from("apartment_roommate_group_memberships")
    .select("id", { count: "exact", head: true })
    .eq("group_id", group.id)
    .eq("status", "member");

  if (membersResult.error) throw membersResult.error;
  if ((membersResult.count ?? 0) >= group.max_size) {
    throw new ApiError("This group is already full.");
  }

  const result = await supabase
    .from("apartment_roommate_group_memberships")
    .upsert(
      {
        group_id: group.id,
        user_id: userId,
        status: "requested",
        role: "member",
        requested_at: new Date().toISOString(),
        approved_at: null,
        left_at: null,
      },
      { onConflict: "group_id,user_id" },
    )
    .select("id,requested_at")
    .single();

  if (result.error) throw result.error;

  if (group.created_by_user_id && group.created_by_user_id !== userId) {
    // Deferred import: group-join-notifications imports this module, so a
    // top-level import here would be circular.
    const { sendGroupJoinRequestNotification } = await import(
      "@/lib/contacts/group-join-notifications"
    );
    await sendGroupJoinRequestNotification(supabase, {
      groupId: group.id,
      membershipId: result.data.id,
      requesterUserId: userId,
    }).catch((error) => {
      console.error("[groups] Failed to send join request notification.", error);
    });
  }

  return group.listing_id;
}

/**
 * Soft-leave: keep the membership row so chat (and any future audit) has
 * durable join/leave history — readers all filter by status, so a 'left' row
 * never surfaces as active. Deletes the group when nobody remains, reopens it
 * to 'forming' when a seat frees up, and promotes a new creator when the
 * original leaves. Returns the listing id.
 */
export async function leaveApartmentGroup(
  supabase: SupabaseServiceClient,
  userId: string,
  groupId: string,
): Promise<string> {
  const group = await loadActiveGroup(supabase, groupId);
  const result = await supabase
    .from("apartment_roommate_group_memberships")
    .update({ status: "left", left_at: new Date().toISOString() })
    .eq("group_id", group.id)
    .eq("user_id", userId)
    .in("status", ["member", "requested"])
    .select("id,status,role");

  if (result.error) throw result.error;
  if ((result.data ?? []).length === 0) return group.listing_id;

  const remainingResult = await supabase
    .from("apartment_roommate_group_memberships")
    .select("user_id,role,created_at")
    .eq("group_id", group.id)
    .eq("status", "member")
    .order("created_at", { ascending: true });

  if (remainingResult.error) throw remainingResult.error;

  const remainingMembers = remainingResult.data ?? [];
  if (remainingMembers.length === 0) {
    const deleteResult = await supabase
      .from("apartment_roommate_groups")
      .delete()
      .eq("id", group.id);
    if (deleteResult.error) throw deleteResult.error;
    return group.listing_id;
  }

  const updates: { status?: string; created_by_user_id?: string | null } = {};
  if (remainingMembers.length < group.max_size && group.status !== "forming") {
    updates.status = "forming";
  }

  const creatorStillActive =
    group.created_by_user_id != null &&
    remainingMembers.some((member) => member.user_id === group.created_by_user_id);
  if (group.source === "user" && !creatorStillActive) {
    const promotedUserId =
      remainingMembers.find((member) => member.role === "creator")?.user_id ??
      remainingMembers[0]?.user_id ??
      null;
    updates.created_by_user_id = promotedUserId;
    if (promotedUserId) {
      const promoteResult = await supabase
        .from("apartment_roommate_group_memberships")
        .update({ role: "creator" })
        .eq("group_id", group.id)
        .eq("user_id", promotedUserId);
      if (promoteResult.error) throw promoteResult.error;
    }
  }

  if (Object.keys(updates).length > 0) {
    const updateResult = await supabase
      .from("apartment_roommate_groups")
      .update(updates)
      .eq("id", group.id);
    if (updateResult.error) throw updateResult.error;
  }

  return group.listing_id;
}

function positiveInteger(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

async function loadActiveGroup(supabase: SupabaseServiceClient, groupId: string) {
  const result = await supabase
    .from("apartment_roommate_groups")
    .select("id,listing_id,floor_plan_key,max_size,status,source,created_by_user_id")
    .eq("id", groupId)
    .in("status", ["forming", "ready", "touring"])
    .single();

  if (result.error) throw result.error;
  return result.data;
}

async function loadGroupForJoinResponse(
  supabase: SupabaseServiceClient,
  groupId: string,
) {
  const result = await supabase
    .from("apartment_roommate_groups")
    .select("id,listing_id,max_size,status,created_by_user_id")
    .eq("id", groupId)
    .in("status", ["forming", "ready", "touring"])
    .single();

  if (result.error) throw result.error;
  return result.data;
}

async function findActiveListingMembership(
  supabase: SupabaseServiceClient,
  userId: string,
  listingId: string,
) {
  return findActiveListingMembershipExcludingGroup(supabase, userId, listingId, null);
}

async function findActiveListingMembershipExcludingGroup(
  supabase: SupabaseServiceClient,
  userId: string,
  listingId: string,
  excludedGroupId: string | null,
) {
  const groupsResult = await supabase
    .from("apartment_roommate_groups")
    .select("id")
    .eq("listing_id", listingId)
    .in("status", ["forming", "ready", "touring"]);
  if (groupsResult.error) throw groupsResult.error;
  const groupIds = (groupsResult.data ?? [])
    .map((group) => group.id)
    .filter((groupId) => groupId !== excludedGroupId);
  if (groupIds.length === 0) return null;

  const membershipResult = await supabase
    .from("apartment_roommate_group_memberships")
    .select("group_id")
    .eq("user_id", userId)
    .in("group_id", groupIds)
    .in("status", ["member", "requested"])
    .limit(1)
    .maybeSingle();
  if (membershipResult.error) throw membershipResult.error;
  return membershipResult.data?.group_id ?? null;
}
