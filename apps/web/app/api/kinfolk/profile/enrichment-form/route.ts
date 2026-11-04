import { NextRequest } from "next/server";
import { z } from "zod";
import { saveProfileEnrichmentFormForCurrentUser } from "@/lib/profiles/enrichment-form-store";
import type { ProfileEnrichmentFormValues } from "@/lib/profiles/enrichment-form";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

const bodySchema = z.object(
  {
    values: z.record(z.unknown(), {
      message: "Request body must include form values.",
    }),
  },
  { message: "Request body must be an object." },
);

export async function POST(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before saving your profile." },
      { status: 401 },
    );
  }

  // This save recomputes matching state and can resolve organization logos
  // (provider call plus outbound fetches), so it needs the same throttle the
  // profile PATCH carries.
  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "profile_enrichment_form",
    limit: 20,
    window: "minute",
  });
  if (limited) {
    return limited;
  }

  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await saveProfileEnrichmentFormForCurrentUser(
      parsed.data.values as ProfileEnrichmentFormValues,
    );
    return Response.json({ ok: true, summary: result.summary });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Profile enrichment save failed.",
      logMessage: "[profile] enrichment form save failed",
    });
  }
}
