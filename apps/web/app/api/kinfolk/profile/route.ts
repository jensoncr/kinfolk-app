import { NextRequest } from "next/server";
import { z } from "zod";
import {
  updateProfileFieldsForCurrentUser,
  type ProfileFieldsPatch,
} from "@/lib/profiles/store";
import { revalidateProfileDependentPaths } from "@/lib/profiles/route-cache";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

// Lenient by design: profile autosave sends whatever the form holds, so
// unusable values coerce to null rather than failing the whole patch.
const nullableString = z
  .unknown()
  .transform((value) => (typeof value === "string" ? value : null));

const nullableNumber = z.unknown().transform((value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
});

const nullableBoolean = z
  .unknown()
  .transform((value) =>
    value === null || value === undefined ? null : value === true || value === "true",
  );

const stringArray = z
  .unknown()
  .transform((value) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
  );

const patchSchema = z.object(
  {
    displayName: nullableString.optional(),
    dateOfBirth: nullableString.optional(),
    aboutText: nullableString.optional(),
    occupationTitle: nullableString.optional(),
    occupationCompany: nullableString.optional(),
    occupationCompanyDomain: nullableString.optional(),
    educationSchool: nullableString.optional(),
    educationSchoolDomain: nullableString.optional(),
    educationDegree: nullableString.optional(),
    educationMajor: nullableString.optional(),
    educationYear: nullableString.optional(),
    hometown: nullableString.optional(),
    age: nullableNumber.optional(),
    preferredAgeMin: nullableNumber.optional(),
    preferredAgeMax: nullableNumber.optional(),
    preferredAgeStrict: nullableBoolean.optional(),
    interests: stringArray.optional(),
    budgetMin: nullableNumber.optional(),
    budgetMax: nullableNumber.optional(),
    moveInStart: nullableString.optional(),
    moveInEnd: nullableString.optional(),
    householdSizeMin: nullableNumber.optional(),
    householdSizeMax: nullableNumber.optional(),
    // Strict, unlike the lenient autosave fields above: for a privacy control,
    // silently dropping an invalid value while reporting success is worse
    // than rejecting the patch.
    profileVisibility: z.enum(["public", "anonymous"]).optional(),
  },
  { message: "Request body must be an object." },
);

export async function PATCH(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before editing your profile." },
      { status: 401 },
    );
  }

  // A profile PATCH geocodes via paid Mapbox and recomputes embeddings +
  // compatibility synchronously, so throttle it per user.
  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "profile_patch",
    limit: 20,
    window: "minute",
  });
  if (limited) {
    return limited;
  }

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const org = await updateProfileFieldsForCurrentUser(parsed.data satisfies ProfileFieldsPatch);
    revalidateProfileDependentPaths();
    return Response.json({ ok: true, org });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Profile update failed.",
      logMessage: "[profile] update failed",
    });
  }
}
