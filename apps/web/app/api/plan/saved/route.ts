import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { z } from "zod";
import { normalizeSavedAreaLabel } from "@/lib/plan/saved-place-labels";
import { toggleSavedPlaceForCurrentUser, type SavedPlaceInput } from "@/lib/plan/plan";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Current user's saved listing ids — lets the apartments map render hearts. */
export async function GET() {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    // Signed-out viewers still get the map; hearts just start unfilled.
    return Response.json({ listingIds: [] });
  }

  const supabase = createSupabaseServiceClient();
  const result = await supabase
    .from("saved_places")
    .select("listing_id")
    .eq("user_id", user.id)
    .eq("kind", "listing");
  if (result.error) {
    console.error("[plan] saved-place read failed", { error: result.error });
    return Response.json({ error: "Unable to load saved places." }, { status: 500 });
  }

  return Response.json({
    listingIds: (result.data ?? []).flatMap((row) =>
      row.listing_id ? [row.listing_id] : [],
    ),
  });
}

const bodySchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("listing"),
      listingId: z
        .string({ message: "Provide a listing id or an area label to save." })
        .min(1, "Provide a listing id or an area label to save."),
      saved: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal("area"),
      areaLabel: z
        .string({ message: "Provide a listing id or an area label to save." })
        .transform((value) => normalizeSavedAreaLabel(value))
        .refine((value): value is string => Boolean(value), "Add an area to save."),
      saved: z.boolean().optional(),
    }),
  ],
  { errorMap: () => ({ message: "Provide a listing id or an area label to save." }) },
);

export async function POST(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before updating saved places." },
      { status: 401 },
    );
  }

  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "plan_saved",
    limit: 60,
    window: "minute",
  });
  if (limited) {
    return limited;
  }

  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) {
    return parsed.response;
  }
  const { saved, ...input } = parsed.data;

  try {
    const result = await toggleSavedPlaceForCurrentUser(input as SavedPlaceInput, saved);
    revalidatePath("/me/plan");
    return Response.json(result);
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to update saved places.",
      logMessage: "[plan] saved-place update failed",
    });
  }
}
