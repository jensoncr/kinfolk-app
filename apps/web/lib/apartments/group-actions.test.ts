import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  leaveApartmentGroup,
  requestToJoinApartmentGroup,
  respondToApartmentGroupJoinRequest,
  startApartmentGroup,
} from "./group-actions";
import { ApiError } from "@/lib/shared/api-error";

vi.mock("server-only", () => ({}));

const sendGroupJoinRequestNotification = vi.hoisted(() => vi.fn());
vi.mock("@/lib/contacts/group-join-notifications", () => ({
  sendGroupJoinRequestNotification,
}));

beforeEach(() => {
  sendGroupJoinRequestNotification.mockReset();
  sendGroupJoinRequestNotification.mockResolvedValue(undefined);
});

function supabaseFromQueue(...chains: unknown[]) {
  return {
    from: vi.fn(() => {
      const chain = chains.shift();
      if (!chain) throw new Error("Unexpected Supabase table access.");
      return chain;
    }),
  };
}

describe("respondToApartmentGroupJoinRequest", () => {
  it("rejects stale approvals when the requester already belongs to another group on the listing", async () => {
    const activeMembershipIn = vi.fn().mockReturnThis();
    const supabase = supabaseFromQueue(
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            created_by_user_id: "owner-user",
            id: "pending-group",
            listing_id: "listing-1",
            max_size: 3,
            status: "forming",
          },
          error: null,
        }),
      },
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [{ id: "pending-group" }, { id: "other-group" }],
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      },
      {
        eq: vi.fn().mockReturnThis(),
        in: activeMembershipIn,
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { group_id: "other-group" },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      },
    );

    await expect(
      respondToApartmentGroupJoinRequest(supabase as never, {
        actorUserId: "owner-user",
        approve: true,
        groupId: "pending-group",
        targetUserId: "requester-user",
      }),
    ).rejects.toThrow("That person is already active in another group on this listing.");

    expect(activeMembershipIn).toHaveBeenCalledWith("group_id", ["other-group"]);
    expect(activeMembershipIn).toHaveBeenCalledWith("status", [
      "member",
      "requested",
    ]);
    expect(supabase.from).toHaveBeenCalledTimes(3);
  });
});

describe("startApartmentGroup", () => {
  it("creates a group and seats the creator, normalizing size and rent", async () => {
    const groupInsert = vi.fn().mockReturnThis();
    const groupSingle = vi.fn().mockResolvedValue({
      data: { id: "group-1", listing_id: "listing-1" },
      error: null,
    });
    const membershipInsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = supabaseFromQueue(
      // findActiveListingMembership: no active groups on the listing
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
        select: vi.fn().mockReturnThis(),
      },
      { insert: groupInsert, select: vi.fn().mockReturnThis(), single: groupSingle },
      { insert: membershipInsert },
    );

    const listingId = await startApartmentGroup(supabase as never, "creator-user", {
      bedrooms: 2.4,
      floorPlanKey: "plan-a",
      floorPlanName: "Plan A",
      listingId: "listing-1",
      maxSize: 2.4,
      monthlyRent: 4200.6,
      preferences: { note: "quiet home" },
      targetUnitName: null,
    });

    expect(listingId).toBe("listing-1");
    expect(groupInsert).toHaveBeenCalledWith({
      bedrooms: 2.4,
      created_by_user_id: "creator-user",
      floor_plan_key: "plan-a",
      floor_plan_name: "Plan A",
      listing_id: "listing-1",
      max_size: 2,
      monthly_rent: 4201,
      preferences: { note: "quiet home" },
      source: "user",
      status: "forming",
      target_unit_name: null,
    });
    expect(membershipInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        group_id: "group-1",
        role: "creator",
        status: "member",
        user_id: "creator-user",
      }),
    );
  });

  it("does not create a duplicate group when the user already has an active listing membership", async () => {
    const groupInsert = vi.fn();
    const supabase = supabaseFromQueue(
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [{ id: "group-existing" }], error: null }),
        select: vi.fn().mockReturnThis(),
      },
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { group_id: "group-existing" },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      },
      { insert: groupInsert },
    );

    const listingId = await startApartmentGroup(supabase as never, "creator-user", {
      floorPlanKey: "plan-a",
      floorPlanName: "Plan A",
      listingId: "listing-1",
      maxSize: 2,
    });

    expect(listingId).toBe("listing-1");
    expect(groupInsert).not.toHaveBeenCalled();
  });
});

describe("requestToJoinApartmentGroup", () => {
  function activeGroupChain() {
    return {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          created_by_user_id: "owner-user",
          floor_plan_key: "plan-a",
          id: "group-1",
          listing_id: "listing-1",
          max_size: 3,
          source: "user",
          status: "forming",
        },
        error: null,
      }),
    };
  }

  it("records a pending request and notifies the creator", async () => {
    const memberCountEq = vi.fn().mockReturnThis();
    const requestUpsert = vi.fn().mockReturnThis();
    const requestSingle = vi.fn().mockResolvedValue({
      data: { id: "membership-1", requested_at: "2026-06-21T12:00:00.000Z" },
      error: null,
    });
    const supabase = supabaseFromQueue(
      activeGroupChain(),
      // findActiveListingMembership: the group itself is the only active group
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [{ id: "group-1" }], error: null }),
        select: vi.fn().mockReturnThis(),
      },
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        select: vi.fn().mockReturnThis(),
      },
      { count: 1, eq: memberCountEq, error: null, select: vi.fn().mockReturnThis() },
      { select: vi.fn().mockReturnThis(), single: requestSingle, upsert: requestUpsert },
    );

    const listingId = await requestToJoinApartmentGroup(
      supabase as never,
      "joiner-user",
      "group-1",
    );

    expect(listingId).toBe("listing-1");
    expect(memberCountEq).toHaveBeenCalledWith("group_id", "group-1");
    expect(memberCountEq).toHaveBeenCalledWith("status", "member");
    expect(requestUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        approved_at: null,
        group_id: "group-1",
        left_at: null,
        role: "member",
        status: "requested",
        user_id: "joiner-user",
      }),
      { onConflict: "group_id,user_id" },
    );
    expect(sendGroupJoinRequestNotification).toHaveBeenCalledWith(supabase, {
      groupId: "group-1",
      membershipId: "membership-1",
      requesterUserId: "joiner-user",
    });
  });

  it("rejects joining a second active group on the same listing", async () => {
    const supabase = supabaseFromQueue(
      activeGroupChain(),
      {
        eq: vi.fn().mockReturnThis(),
        in: vi
          .fn()
          .mockResolvedValue({ data: [{ id: "group-1" }, { id: "other-group" }], error: null }),
        select: vi.fn().mockReturnThis(),
      },
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { group_id: "other-group" },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      },
    );

    await expect(
      requestToJoinApartmentGroup(supabase as never, "joiner-user", "group-1"),
    ).rejects.toThrow(
      new ApiError("Leave your current group on this listing before joining another."),
    );
    expect(sendGroupJoinRequestNotification).not.toHaveBeenCalled();
  });
});

describe("leaveApartmentGroup", () => {
  it("soft-leaves and deletes the group when no members remain", async () => {
    const membershipUpdate = vi.fn().mockReturnThis();
    const membershipSelect = vi.fn().mockResolvedValue({
      data: [{ id: "membership-1", role: "creator", status: "member" }],
      error: null,
    });
    const groupDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const supabase = supabaseFromQueue(
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            created_by_user_id: "creator-user",
            floor_plan_key: "plan-a",
            id: "group-1",
            listing_id: "listing-1",
            max_size: 2,
            source: "user",
            status: "forming",
          },
          error: null,
        }),
      },
      {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        select: membershipSelect,
        update: membershipUpdate,
      },
      {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        select: vi.fn().mockReturnThis(),
      },
      { delete: vi.fn().mockReturnThis(), eq: groupDeleteEq },
    );

    const listingId = await leaveApartmentGroup(supabase as never, "creator-user", "group-1");

    expect(listingId).toBe("listing-1");
    expect(membershipUpdate).toHaveBeenCalledWith({
      left_at: expect.any(String),
      status: "left",
    });
    expect(membershipSelect).toHaveBeenCalledWith("id,status,role");
    expect(groupDeleteEq).toHaveBeenCalledWith("id", "group-1");
  });
});
