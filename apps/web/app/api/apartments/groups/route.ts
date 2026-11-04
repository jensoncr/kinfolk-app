import { NextRequest } from "next/server";
import { z } from "zod";
import {
  leaveApartmentGroup,
  requestToJoinApartmentGroup,
  respondToApartmentGroupJoinRequest,
  startApartmentGroup,
} from "@/lib/apartments/group-actions";
import { getApartmentListingDetail } from "@/lib/apartments/search";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

const requiredId = (message: string) => z.string({ message }).trim().min(1, message);

// Lenient by design for optional group metadata: the modal sends whatever the
// floor-plan card holds, so unusable values coerce to null instead of failing.
const nullableTrimmedString = z
  .unknown()
  .transform((value) =>
    typeof value === "string" && value.trim() ? value.trim() : null,
  );

const nullableNumber = z.unknown().transform((value) => {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
});

// The client sends whatever its floor-plan card holds, but these values are
// persisted and drive feasibility math — clamp them at the boundary so a
// forged max_size of 10⁶ can't create a group that is never "ready".
const groupMaxSize = nullableNumber.transform((value) =>
  value == null ? null : Math.min(Math.max(Math.round(value), 1), 8),
);
const bedroomsCount = nullableNumber.transform((value) =>
  value == null ? null : Math.min(Math.max(Math.round(value), 0), 10),
);
const positiveRent = nullableNumber.transform((value) =>
  value != null && value > 0 ? value : null,
);

const jsonObject = z
  .unknown()
  .transform((value) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null,
  );

const respondFields = {
  groupId: requiredId("Missing group or member."),
  /** User whose pending request is being approved or declined. */
  targetUserId: requiredId("Missing group or member."),
};

const payloadSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("start"),
      listingId: requiredId("Missing listing or floor plan."),
      floorPlanKey: requiredId("Missing listing or floor plan."),
      floorPlanName: requiredId("Missing listing or floor plan."),
      targetUnitName: nullableTrimmedString.optional(),
      bedrooms: bedroomsCount.optional(),
      maxSize: groupMaxSize.optional(),
      monthlyRent: positiveRent.optional(),
      preferences: jsonObject.optional(),
    }),
    z.object({ action: z.literal("request_join"), groupId: requiredId("Missing group.") }),
    z.object({ action: z.literal("leave"), groupId: requiredId("Missing group.") }),
    z.object({ action: z.literal("approve_request"), ...respondFields }),
    z.object({ action: z.literal("decline_request"), ...respondFields }),
  ],
  { errorMap: () => ({ message: "Invalid group action." }) },
);

export async function POST(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json({ error: "Sign in before managing groups." }, { status: 401 });
  }

  // Join requests fan out SMS notifications, so throttle per user.
  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "apartment_groups",
    limit: 30,
    window: "minute",
  });
  if (limited) {
    return limited;
  }

  const parsed = await parseJsonBody(request, payloadSchema);
  if (!parsed.ok) {
    return parsed.response;
  }
  const payload = parsed.data;

  try {
    const supabase = createSupabaseServiceClient();
    // Approve/decline only mutate membership rows the matches page reads back via
    // a router refresh, so they return a lightweight ack instead of a listing.
    if (payload.action === "approve_request" || payload.action === "decline_request") {
      await respondToApartmentGroupJoinRequest(supabase, {
        actorUserId: user.id,
        approve: payload.action === "approve_request",
        groupId: payload.groupId,
        targetUserId: payload.targetUserId,
      });
      return Response.json({ ok: true });
    }

    const listingId =
      payload.action === "start"
        ? await startApartmentGroup(supabase, user.id, payload)
        : payload.action === "request_join"
          ? await requestToJoinApartmentGroup(supabase, user.id, payload.groupId)
          : await leaveApartmentGroup(supabase, user.id, payload.groupId);

    const listing = await getApartmentListingDetail(listingId, user.id, {
      ensureViewerEdges: true,
    });
    return Response.json({ listing });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to update group.",
      logMessage: "[groups] group action failed",
    });
  }
}
