import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  MOVE_HORIZONS,
  RELOCATION_FLEXIBILITIES,
  updateLivingPlanForCurrentUser,
  type LivingPlanPatch,
} from "@/lib/plan/plan";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

const planFieldMessage = "Unexpected value for a plan field.";

const patchSchema = z.object(
  {
    futureCities: z
      .unknown()
      .transform((value) =>
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : undefined,
      )
      .optional(),
    moveHorizon: z.enum(MOVE_HORIZONS, { message: planFieldMessage }).nullable().optional(),
    relocationFlexibility: z
      .enum(RELOCATION_FLEXIBILITIES, { message: planFieldMessage })
      .nullable()
      .optional(),
    intentNote: z
      .unknown()
      .transform((value) =>
        typeof value === "string" ? value.slice(0, 600) : undefined,
      )
      .optional(),
    silentMatcherEnabled: z
      .unknown()
      .transform((value) => (typeof value === "boolean" ? value : undefined))
      .optional(),
  },
  { message: "Request body must be an object." },
);

export async function POST(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before saving your plan." },
      { status: 401 },
    );
  }

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const plan = await updateLivingPlanForCurrentUser(parsed.data satisfies LivingPlanPatch);
    revalidatePath("/me/plan");
    return Response.json({ plan });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to save your plan.",
      logMessage: "[plan] intent save failed",
    });
  }
}
