import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/shared/api-error";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  enforceApiUserRateLimit: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  getApartmentListingDetail: vi.fn(),
  leaveApartmentGroup: vi.fn(),
  requestToJoinApartmentGroup: vi.fn(),
  respondToApartmentGroupJoinRequest: vi.fn(),
  startApartmentGroup: vi.fn(),
}));

vi.mock("@/lib/apartments/group-actions", () => ({
  leaveApartmentGroup: mocks.leaveApartmentGroup,
  requestToJoinApartmentGroup: mocks.requestToJoinApartmentGroup,
  respondToApartmentGroupJoinRequest: mocks.respondToApartmentGroupJoinRequest,
  startApartmentGroup: mocks.startApartmentGroup,
}));

vi.mock("@/lib/apartments/search", () => ({
  getApartmentListingDetail: mocks.getApartmentListingDetail,
}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

function jsonRequest(body: unknown) {
  return new Request("https://kinfolk.test/api/apartments/groups", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<typeof POST>[0];
}

function rawRequest(body: string) {
  return new Request("https://kinfolk.test/api/apartments/groups", {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<typeof POST>[0];
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/apartments/groups", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createSupabaseServiceClient.mockReturnValue({ from: vi.fn() });
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      user: { id: "creator-user" },
    });
    mocks.getApartmentListingDetail.mockResolvedValue({
      id: "listing-1",
      title: "77 Bruton St",
    });
    mocks.leaveApartmentGroup.mockResolvedValue("listing-1");
    mocks.requestToJoinApartmentGroup.mockResolvedValue("listing-1");
    mocks.respondToApartmentGroupJoinRequest.mockResolvedValue("accepted");
    mocks.startApartmentGroup.mockResolvedValue("listing-1");
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("rejects signed-out group actions before parsing or mutating", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({ user: null });

    const response = await POST(rawRequest("{oops"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before managing groups.",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.respondToApartmentGroupJoinRequest).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before group-action parsing or mutation setup", async () => {
    const malformed = await POST(rawRequest("{oops"));

    expect(malformed.status).toBe(400);
    await expect(readJson(malformed)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.ensureCurrentKinfolkUser).toHaveBeenCalledTimes(1);
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.respondToApartmentGroupJoinRequest).not.toHaveBeenCalled();
  });

  it("rejects unknown group actions after auth work", async () => {
    const unknown = await POST(jsonRequest({ action: "teleport" }));

    expect(unknown.status).toBe(400);
    await expect(readJson(unknown)).resolves.toEqual({
      error: "Invalid group action.",
    });
    expect(mocks.ensureCurrentKinfolkUser).toHaveBeenCalledTimes(1);
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("enforces the per-user rate limit before parsing", async () => {
    mocks.enforceApiUserRateLimit.mockResolvedValue(
      Response.json({ error: "Too many requests." }, { status: 429 }),
    );

    const response = await POST(jsonRequest({ action: "leave", groupId: "group-1" }));

    expect(response.status).toBe(429);
    expect(mocks.enforceApiUserRateLimit).toHaveBeenCalledWith({
      userId: "creator-user",
      bucketType: "apartment_groups",
      limit: 30,
      window: "minute",
    });
    expect(mocks.leaveApartmentGroup).not.toHaveBeenCalled();
  });

  it("requires sign-in before mutating groups", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({ user: null });

    const response = await POST(
      jsonRequest({
        action: "approve_request",
        groupId: "group-1",
        targetUserId: "requester-user",
      }),
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before managing groups.",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.respondToApartmentGroupJoinRequest).not.toHaveBeenCalled();
  });

  it("approves a pending join request through the group action service", async () => {
    const response = await POST(
      jsonRequest({
        action: "approve_request",
        groupId: "group-1",
        targetUserId: "requester-user",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.createSupabaseServiceClient).toHaveBeenCalledTimes(1);
    expect(mocks.respondToApartmentGroupJoinRequest).toHaveBeenCalledWith(
      expect.any(Object),
      {
        actorUserId: "creator-user",
        approve: true,
        groupId: "group-1",
        targetUserId: "requester-user",
      },
    );
    expect(mocks.getApartmentListingDetail).not.toHaveBeenCalled();
  });

  it("declines a pending join request through the group action service", async () => {
    mocks.respondToApartmentGroupJoinRequest.mockResolvedValue("declined");

    const response = await POST(
      jsonRequest({
        action: "decline_request",
        groupId: "group-1",
        targetUserId: "requester-user",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.respondToApartmentGroupJoinRequest).toHaveBeenCalledWith(
      expect.any(Object),
      {
        actorUserId: "creator-user",
        approve: false,
        groupId: "group-1",
        targetUserId: "requester-user",
      },
    );
    expect(mocks.getApartmentListingDetail).not.toHaveBeenCalled();
  });

  it("rejects approve or decline requests without a group and target user", async () => {
    const missingTarget = await POST(
      jsonRequest({
        action: "approve_request",
        groupId: "group-1",
      }),
    );
    const missingGroup = await POST(
      jsonRequest({
        action: "decline_request",
        targetUserId: "requester-user",
      }),
    );

    expect(missingTarget.status).toBe(400);
    expect(missingGroup.status).toBe(400);
    await expect(readJson(missingTarget)).resolves.toEqual({
      error: "Missing group or member.",
    });
    await expect(readJson(missingGroup)).resolves.toEqual({
      error: "Missing group or member.",
    });
    expect(mocks.respondToApartmentGroupJoinRequest).not.toHaveBeenCalled();
  });

  it("surfaces group action service errors as validation failures", async () => {
    mocks.respondToApartmentGroupJoinRequest.mockRejectedValue(
      new ApiError("Only the group's creator can respond to join requests."),
    );

    const response = await POST(
      jsonRequest({
        action: "approve_request",
        groupId: "group-1",
        targetUserId: "requester-user",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Only the group's creator can respond to join requests.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected group action service failures", async () => {
    mocks.respondToApartmentGroupJoinRequest.mockRejectedValue(
      new Error("approval update failed: private detail"),
    );

    const response = await POST(
      jsonRequest({
        action: "approve_request",
        groupId: "group-1",
        targetUserId: "requester-user",
      }),
    );

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unable to update group.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("[groups] group action failed", {
      error: expect.any(Error),
    });
  });

  it("starts a group with coerced metadata and returns refreshed listing detail", async () => {
    const response = await POST(
      jsonRequest({
        action: "start",
        bedrooms: 2.4,
        floorPlanKey: "plan-a",
        floorPlanName: "Plan A",
        listingId: "listing-1",
        maxSize: "2.4",
        monthlyRent: 4200.6,
        preferences: { note: "quiet home" },
        targetUnitName: "",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      listing: {
        id: "listing-1",
        title: "77 Bruton St",
      },
    });
    // bedrooms/maxSize are clamped to bounded integers at the boundary;
    // rent passes through as-is when positive.
    expect(mocks.startApartmentGroup).toHaveBeenCalledWith(
      expect.any(Object),
      "creator-user",
      expect.objectContaining({
        action: "start",
        bedrooms: 2,
        floorPlanKey: "plan-a",
        floorPlanName: "Plan A",
        listingId: "listing-1",
        maxSize: 2,
        monthlyRent: 4200.6,
        preferences: { note: "quiet home" },
        targetUnitName: null,
      }),
    );
    expect(mocks.getApartmentListingDetail).toHaveBeenCalledWith(
      "listing-1",
      "creator-user",
      { ensureViewerEdges: true },
    );
  });

  it("rejects starting a group without a listing and floor plan", async () => {
    const response = await POST(
      jsonRequest({
        action: "start",
        floorPlanName: "Plan A",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Missing listing or floor plan.",
    });
    expect(mocks.startApartmentGroup).not.toHaveBeenCalled();
  });

  it("requests to join a group and returns refreshed listing detail", async () => {
    const response = await POST(
      jsonRequest({
        action: "request_join",
        groupId: "group-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      listing: {
        id: "listing-1",
        title: "77 Bruton St",
      },
    });
    expect(mocks.requestToJoinApartmentGroup).toHaveBeenCalledWith(
      expect.any(Object),
      "creator-user",
      "group-1",
    );
  });

  it("rejects join and leave requests without a group", async () => {
    const missingJoin = await POST(jsonRequest({ action: "request_join" }));
    const missingLeave = await POST(jsonRequest({ action: "leave", groupId: "  " }));

    expect(missingJoin.status).toBe(400);
    expect(missingLeave.status).toBe(400);
    await expect(readJson(missingJoin)).resolves.toEqual({ error: "Missing group." });
    await expect(readJson(missingLeave)).resolves.toEqual({ error: "Missing group." });
    expect(mocks.requestToJoinApartmentGroup).not.toHaveBeenCalled();
    expect(mocks.leaveApartmentGroup).not.toHaveBeenCalled();
  });

  it("leaves a group and returns refreshed listing detail", async () => {
    const response = await POST(
      jsonRequest({
        action: "leave",
        groupId: "group-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      listing: {
        id: "listing-1",
        title: "77 Bruton St",
      },
    });
    expect(mocks.leaveApartmentGroup).toHaveBeenCalledWith(
      expect.any(Object),
      "creator-user",
      "group-1",
    );
  });
});
