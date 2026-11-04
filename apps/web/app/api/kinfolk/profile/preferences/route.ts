import { NextRequest } from "next/server";
import { z } from "zod";
import {
  saveListPreferenceForCurrentUser,
  saveStructuredPreferenceForCurrentUser,
} from "@/lib/profiles/enrichment-store";
import { normalizeEditablePreferenceList } from "@/lib/profiles/fact-normalization";
import { revalidateProfileDependentPaths } from "@/lib/profiles/route-cache";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

const bodySchema = z.object({
  factKey: z.string({ message: "factKey is required." }).min(1, "factKey is required."),
  value: z.string().optional(),
  values: z.array(z.unknown()).optional(),
});

export async function PATCH(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before editing preferences." },
      { status: 401 },
    );
  }

  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) {
    return parsed.response;
  }
  const { factKey, value, values } = parsed.data;

  try {
    if (Array.isArray(values)) {
      await saveListPreferenceForCurrentUser(
        factKey,
        normalizeEditablePreferenceList(values),
      );
    } else if (value) {
      await saveStructuredPreferenceForCurrentUser(factKey, value);
    } else {
      return Response.json(
        { error: "value or values is required." },
        { status: 400 },
      );
    }
    revalidateProfileDependentPaths();
    return Response.json({ ok: true });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Preference update failed.",
      logMessage: "[profile] preference update failed",
    });
  }
}
