import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { ApiError } from "@/lib/shared/api-error";
import { normalizeLaunchMarket } from "@/lib/shared/launch-market";
import { normalizeMapboxLocationValue } from "@/lib/integrations/mapbox-location";
import { normalizePhoneE164 } from "@/lib/shared/phone";
import { normalizeOrgDomain } from "@/lib/orgs/domain";
import { resolveOrgLogoUrl } from "@/lib/orgs/org-logo";
import {
  recomputeCompatibilityForUserId,
  syncMatchingSetupFactsForUserId,
  type MatchingSetupFactPatch,
} from "@/lib/profiles/enrichment-store";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type KinfolkUserUpdate = Database["public"]["Tables"]["kinfolk_users"]["Update"];
type MatchingProfileRow = Database["public"]["Tables"]["matching_profiles"]["Row"];
type MatchingProfileInsert = Database["public"]["Tables"]["matching_profiles"]["Insert"];
type MatchingProfileUpdate = Database["public"]["Tables"]["matching_profiles"]["Update"];
type RoommatePreferenceInsert = Database["public"]["Tables"]["roommate_preferences"]["Insert"];
type RoommatePreferenceUpdate = Database["public"]["Tables"]["roommate_preferences"]["Update"];

const PHOTO_BUCKET = "profile-photos";
const MAX_PHOTOS = 6;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type ProfileFieldsPatch = {
  displayName?: string | null;
  dateOfBirth?: string | null;
  aboutText?: string | null;
  interests?: string[] | null;
  occupationTitle?: string | null;
  occupationCompany?: string | null;
  /** Org-picker domain for the company; null when typed as free text. */
  occupationCompanyDomain?: string | null;
  educationSchool?: string | null;
  /** Org-picker domain for the school; null when typed as free text. */
  educationSchoolDomain?: string | null;
  educationDegree?: string | null;
  educationMajor?: string | null;
  educationYear?: string | null;
  hometown?: string | null;
  age?: number | null;
  preferredAgeMin?: number | null;
  preferredAgeMax?: number | null;
  preferredAgeStrict?: boolean | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  moveInStart?: string | null;
  moveInEnd?: string | null;
  householdSizeMin?: number | null;
  householdSizeMax?: number | null;
  /** 'public' shows the full profile everywhere; 'anonymous' hides identity until unlocked. */
  profileVisibility?: "public" | "anonymous" | null;
};

/**
 * The org columns a patch settled on. Returned to the caller because the
 * profile page renders the saved logo from its own state — without this it
 * would keep showing the pre-save value until a full page reload.
 */
export type ProfileOrgResolution = {
  occupationCompany?: { domain: string | null; logoUrl: string | null };
  educationSchool?: { domain: string | null; logoUrl: string | null };
};

type ProfileFieldsUpdateOptions = {
  refreshMatchingState?: boolean;
};

export async function updateProfileFieldsForCurrentUser(
  patch: ProfileFieldsPatch,
  options: ProfileFieldsUpdateOptions = {},
) {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);

  if (!user) {
    throw new ApiError("Sign in before editing your profile.", 401);
  }

  const update: KinfolkUserUpdate = {};

  if (patch.displayName !== undefined) {
    const displayName = clampText(patch.displayName, 120);
    if (displayName) {
      update.display_name = displayName;
    }
  }
  if (patch.dateOfBirth !== undefined) {
    const dateOfBirth = cleanDate(patch.dateOfBirth);
    update.date_of_birth = dateOfBirth;
    update.birth_year = dateOfBirth ? birthYearFromDateOfBirth(dateOfBirth) : null;
  }
  if (patch.aboutText !== undefined) {
    update.about_text = clampText(patch.aboutText, 800);
  }
  if (patch.interests !== undefined) {
    update.interests = cleanInterestList(patch.interests);
  }
  if (patch.occupationTitle !== undefined) {
    update.occupation_title = clampText(patch.occupationTitle, 120);
  }
  if (patch.occupationCompany !== undefined || patch.occupationCompanyDomain !== undefined) {
    Object.assign(
      update,
      await resolveOrgColumns({
        current: {
          domain: user.occupation_company_domain,
          label: user.occupation_company,
          logoUrl: user.occupation_company_logo_url,
        },
        domainColumn: "occupation_company_domain",
        labelColumn: "occupation_company",
        logoColumn: "occupation_company_logo_url",
        patch: {
          domain: patch.occupationCompanyDomain,
          label: patch.occupationCompany,
        },
      }),
    );
  }
  if (patch.educationSchool !== undefined || patch.educationSchoolDomain !== undefined) {
    Object.assign(
      update,
      await resolveOrgColumns({
        current: {
          domain: user.education_school_domain,
          label: user.education_school,
          logoUrl: user.education_school_logo_url,
        },
        domainColumn: "education_school_domain",
        labelColumn: "education_school",
        logoColumn: "education_school_logo_url",
        patch: {
          domain: patch.educationSchoolDomain,
          label: patch.educationSchool,
        },
      }),
    );
  }
  if (patch.educationDegree !== undefined) {
    update.education_degree = clampText(patch.educationDegree, 60);
  }
  if (patch.educationMajor !== undefined) {
    update.education_major = clampText(patch.educationMajor, 120);
  }
  if (patch.educationYear !== undefined) {
    update.education_year = clampText(patch.educationYear, 20);
  }
  if (patch.hometown !== undefined) {
    update.hometown = clampText(
      await normalizeMapboxLocationValue(patch.hometown, {
        allowTopTextMatch: false,
      }),
      120,
    );
  }
  if (patch.age !== undefined && patch.dateOfBirth === undefined) {
    update.birth_year = ageToBirthYear(patch.age);
  }

  const matchingPatch = pickMatchingProfilePatch(patch);
  const roommatePatch = pickRoommatePreferencePatch(patch);

  if (Object.keys(update).length > 0) {
    const result = await supabase
      .from("kinfolk_users")
      .update(update)
      .eq("id", user.id);

    if (result.error) {
      throw result.error;
    }
  }

  if (Object.keys(matchingPatch).length > 0) {
    await updateMatchingProfileFields(supabase, user, matchingPatch);
  }
  if (Object.keys(roommatePatch).length > 0) {
    await updateRoommatePreferenceFields(supabase, user, roommatePatch);
  }

  const resolvedOrg: ProfileOrgResolution = {};
  if ("occupation_company_domain" in update) {
    resolvedOrg.occupationCompany = {
      domain: update.occupation_company_domain ?? null,
      logoUrl: update.occupation_company_logo_url ?? null,
    };
  }
  if ("education_school_domain" in update) {
    resolvedOrg.educationSchool = {
      domain: update.education_school_domain ?? null,
      logoUrl: update.education_school_logo_url ?? null,
    };
  }

  if (options.refreshMatchingState === false) {
    return resolvedOrg;
  }

  const userId = user.id;
  if (Object.keys(matchingPatch).length > 0) {
    after(async () => {
      try {
        await syncMatchingSetupFactsForUserId(
          userId,
          matchingSetupFactPatchFromUpdate(matchingPatch),
        );
      } catch (err) {
        console.error("[profile] background sync failed", err);
      }
    });
  } else if (Object.keys(update).length > 0 || Object.keys(roommatePatch).length > 0) {
    after(async () => {
      try {
        await recomputeCompatibilityForUserId(userId);
      } catch (err) {
        console.error("[profile] background recompute failed", err);
      }
    });
  }

  return resolvedOrg;
}

export async function getKinfolkPhoneVerificationStatusForCurrentUser() {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);

  if (!user) {
    throw new ApiError("Sign in before checking phone verification.", 401);
  }

  const result = await supabase
    .from("user_phone_numbers")
    .select("phone_e164,verified_at,sms_consent_state")
    .eq("user_id", user.id)
    .eq("sms_consent_state", "opted_in")
    .not("verified_at", "is", null)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  const phone = normalizePhoneE164(result.data?.phone_e164);

  return {
    phone,
    phoneVerified: phone.length > 0,
    phoneVerifiedAt: result.data?.verified_at ?? null,
    smsConsentState: result.data?.sms_consent_state ?? null,
  };
}

export type UploadedPhoto = {
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export async function addProfilePhotoForCurrentUser({
  filename,
  contentType,
  bytes,
}: UploadedPhoto) {
  if (!ALLOWED_MIME.has(contentType)) {
    throw new ApiError("Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF.");
  }
  if (bytes.byteLength === 0) {
    throw new ApiError("Photo file is empty.");
  }
  if (bytes.byteLength > 10 * 1024 * 1024) {
    throw new ApiError("Photo must be under 10 MB.");
  }

  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!user) {
    throw new ApiError("Sign in before uploading photos.", 401);
  }

  const existing = await supabase
    .from("kinfolk_user_photos")
    .select("*")
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  if (existing.error) {
    throw existing.error;
  }

  const photos = existing.data ?? [];
  const hasLinkedInPhoto = hasVisibleLinkedInProfilePhoto(identity);
  if (photos.length + (hasLinkedInPhoto ? 1 : 0) >= MAX_PHOTOS) {
    throw new ApiError(`You can store up to ${MAX_PHOTOS} photos.`);
  }

  const extension = EXT_BY_MIME[contentType] ?? extensionFromName(filename) ?? "jpg";
  const objectId = randomUUID();
  const storagePath = `${user.id}/${objectId}.${extension}`;

  const uploaded = await supabase.storage.from(PHOTO_BUCKET).upload(storagePath, bytes, {
    contentType,
    upsert: false,
  });

  if (uploaded.error) {
    throw uploaded.error;
  }

  const { data: publicUrl } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath);
  const nextPosition = photos.length;
  const isPrimary = !hasLinkedInPhoto && photos.length === 0;

  const inserted = await supabase
    .from("kinfolk_user_photos")
    .insert({
      user_id: user.id,
      storage_path: storagePath,
      public_url: publicUrl.publicUrl,
      position: nextPosition,
      is_primary: isPrimary,
      content_type: contentType,
    })
    .select("*")
    .single();

  if (inserted.error) {
    await removeProfilePhotoObjectsBestEffort(supabase, [storagePath]);
    throw inserted.error;
  }

  return inserted.data;
}

function hasVisibleLinkedInProfilePhoto(
  identity: Awaited<ReturnType<typeof ensureCurrentKinfolkUser>>["identity"],
) {
  if (!identity?.linkedin) {
    return false;
  }

  return Boolean(identity.linkedin.imageUrl?.trim() || identity.avatarUrl?.trim());
}

export async function deleteProfilePhotoForCurrentUser(photoId: string) {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);

  if (!user) {
    throw new ApiError("Sign in before editing photos.", 401);
  }

  const target = await supabase
    .from("kinfolk_user_photos")
    .select("*")
    .eq("id", photoId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (target.error) {
    throw target.error;
  }
  if (!target.data) {
    return;
  }

  const removed = await supabase
    .from("kinfolk_user_photos")
    .delete()
    .eq("id", photoId)
    .eq("user_id", user.id);

  if (removed.error) {
    throw removed.error;
  }

  await removeProfilePhotoObjectsBestEffort(supabase, [target.data.storage_path]);

  await resequencePhotos(supabase, user.id);
}

export async function reorderProfilePhotosForCurrentUser(orderedIds: string[]) {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);

  if (!user) {
    throw new ApiError("Sign in before reordering photos.", 401);
  }

  const photos = await supabase
    .from("kinfolk_user_photos")
    .select("id, position")
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  if (photos.error) {
    throw photos.error;
  }

  const currentIds = (photos.data ?? []).map((row) => row.id);
  const allowed = new Set(currentIds);
  const requested = new Set<string>();
  const filtered = orderedIds
    .map((id) => id.trim())
    .filter((id) => {
      if (!id) {
        return false;
      }
      if (!allowed.has(id) || requested.has(id)) {
        return false;
      }
      requested.add(id);
      return true;
    });

  if (filtered.length === 0) {
    return;
  }

  await applyPhotoOrder(
    supabase,
    user.id,
    [...filtered, ...currentIds.filter((id) => !requested.has(id))],
  );
}

async function resequencePhotos(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
) {
  const list = await supabase
    .from("kinfolk_user_photos")
    .select("id, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (list.error) {
    throw list.error;
  }

  await applyPhotoOrder(
    supabase,
    userId,
    (list.data ?? []).map((row) => row.id),
  );
}

async function applyPhotoOrder(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  orderedIds: string[],
) {
  // Two-pass write to dodge the unique (user_id, position) index — bump
  // positions out of range, then settle them back at 0..n in final order.
  const bumpUpdates = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("kinfolk_user_photos")
        .update({ position: index + 1000, is_primary: false })
        .eq("id", id)
        .eq("user_id", userId),
    ),
  );
  for (const update of bumpUpdates) {
    if (update.error) {
      throw update.error;
    }
  }

  const settleUpdates = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("kinfolk_user_photos")
        .update({ position: index, is_primary: index === 0 })
        .eq("id", id)
        .eq("user_id", userId),
    ),
  );
  for (const update of settleUpdates) {
    if (update.error) {
      throw update.error;
    }
  }
}

async function removeProfilePhotoObjectsBestEffort(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  paths: string[],
) {
  try {
    await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  } catch {
    // Storage cleanup is best-effort: the database row/order is the user-visible source of truth.
  }
}

/**
 * Label, domain, and logo for one org field, resolved as a single unit.
 *
 * These three columns are one fact — who this person says they work or study
 * at — and every way of writing them independently produces a lie. A label-only
 * PATCH (the contract before the picker existed, and what any stale client
 * still sends) would leave the previous employer's domain and logo attached to
 * a new name; a domain-only PATCH would attach a credential to no one. So the
 * label decides: change it without a matching domain and the org identity is
 * cleared, and an unparseable domain is treated as free text rather than
 * coerced into something adjacent.
 *
 * The logo is re-resolved only when the domain actually changes. Profile
 * autosave sends the whole form on every edit, and a failed resolution that
 * retried on each save would spend a provider call and two outbound fetches
 * per keystroke-save — worst during exactly the vendor outage that caused it.
 */
async function resolveOrgColumns({
  current,
  domainColumn,
  labelColumn,
  logoColumn,
  patch,
}: {
  current: { domain: string | null; label: string | null; logoUrl: string | null };
  domainColumn: "occupation_company_domain" | "education_school_domain";
  labelColumn: "occupation_company" | "education_school";
  logoColumn: "occupation_company_logo_url" | "education_school_logo_url";
  patch: { domain?: string | null; label?: string | null };
}): Promise<KinfolkUserUpdate> {
  const nextLabel =
    patch.label !== undefined ? clampText(patch.label, 120) : current.label;
  const labelChanged = nextLabel !== current.label;

  // A domain only survives when it arrives with the label it describes. The
  // rule is symmetric: a domain sent without a label cannot be shown to
  // describe the label already stored, so it is ignored rather than pinned to
  // whatever happens to be there.
  const claimedDomain =
    patch.domain === undefined
      ? labelChanged
        ? null
        : current.domain
      : patch.label === undefined
        ? current.domain
        : normalizeOrgDomain(patch.domain);
  const nextDomain = nextLabel ? claimedDomain : null;

  const columns: KinfolkUserUpdate = {};
  if (patch.label !== undefined) {
    columns[labelColumn] = nextLabel;
  }

  if (!nextDomain) {
    return { ...columns, [domainColumn]: null, [logoColumn]: null };
  }
  if (nextDomain === current.domain) {
    return { ...columns, [domainColumn]: nextDomain, [logoColumn]: current.logoUrl };
  }

  return {
    ...columns,
    [domainColumn]: nextDomain,
    [logoColumn]: await resolveOrgLogoUrl(nextDomain, nextLabel ?? nextDomain),
  };
}

function clampText(value: string | null, max: number): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, max);
}

function pickMatchingProfilePatch(patch: ProfileFieldsPatch): MatchingProfileUpdate {
  const update: MatchingProfileUpdate = {};

  if (patch.budgetMin !== undefined) {
    update.budget_min = cleanOptionalWholeNumber(patch.budgetMin, 0, 50000);
  }
  if (patch.budgetMax !== undefined) {
    update.budget_max = cleanOptionalWholeNumber(patch.budgetMax, 0, 50000);
  }
  if (patch.moveInStart !== undefined) {
    update.move_in_start = cleanDate(patch.moveInStart);
  }
  if (patch.moveInEnd !== undefined) {
    update.move_in_end = cleanDate(patch.moveInEnd);
  }
  if (patch.householdSizeMin !== undefined) {
    update.household_size_min = cleanWholeNumber(patch.householdSizeMin, 0, 8);
  }
  if (patch.householdSizeMax !== undefined) {
    update.household_size_max = cleanWholeNumber(patch.householdSizeMax, 0, 8);
  }
  if (patch.profileVisibility === "public" || patch.profileVisibility === "anonymous") {
    update.visibility_mode = patch.profileVisibility;
  }

  return update;
}

function pickRoommatePreferencePatch(patch: ProfileFieldsPatch): RoommatePreferenceUpdate {
  const update: RoommatePreferenceUpdate = {};

  if ("preferredAgeMin" in patch) {
    update.preferred_age_min = cleanOptionalWholeNumberInclusive(
      patch.preferredAgeMin ?? null,
      18,
      100,
    );
  }
  if ("preferredAgeMax" in patch) {
    update.preferred_age_max = cleanOptionalWholeNumberInclusive(
      patch.preferredAgeMax ?? null,
      18,
      100,
    );
  }
  if ("preferredAgeStrict" in patch) {
    update.preferred_age_strict = Boolean(patch.preferredAgeStrict);
  }

  return update;
}

function matchingSetupFactPatchFromUpdate(
  patch: MatchingProfileUpdate,
): MatchingSetupFactPatch {
  const facts: MatchingSetupFactPatch = {};

  if ("budget_min" in patch) {
    facts.budgetMin = patch.budget_min ?? null;
  }
  if ("budget_max" in patch) {
    facts.budgetMax = patch.budget_max ?? null;
  }
  if ("move_in_start" in patch) {
    facts.moveInStart = patch.move_in_start ?? null;
  }
  if ("move_in_end" in patch) {
    facts.moveInEnd = patch.move_in_end ?? null;
  }
  if ("household_size_min" in patch) {
    facts.householdSizeMin = patch.household_size_min ?? null;
  }
  if ("household_size_max" in patch) {
    facts.householdSizeMax = patch.household_size_max ?? null;
  }

  return facts;
}

async function updateMatchingProfileFields(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  user: NonNullable<Awaited<ReturnType<typeof ensureCurrentKinfolkUser>>["user"]>,
  patch: MatchingProfileUpdate,
) {
  const existing = await supabase
    .from("matching_profiles")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const next = mergeMatchingProfile(existing.data, user, patch);

  if (next.move_in_start && next.move_in_end && next.move_in_start > next.move_in_end) {
    throw new ApiError("Move-in start must be before move-in end.");
  }
  if (
    isPositiveNumber(next.budget_min) &&
    isPositiveNumber(next.budget_max) &&
    next.budget_min > next.budget_max
  ) {
    throw new ApiError("Budget minimum must be below budget maximum.");
  }
  if (
    next.household_size_min > 0 &&
    next.household_size_max > 0 &&
    next.household_size_min > next.household_size_max
  ) {
    throw new ApiError("Household minimum must be below household maximum.");
  }

  const completenessScore = computeMatchingProfileCompleteness(next);
  const launchMarket = normalizeLaunchMarket(user.launch_market);

  if (existing.data) {
    const result = await supabase
      .from("matching_profiles")
      .update({ ...patch, completeness_score: completenessScore })
      .eq("id", existing.data.id)
      .eq("user_id", user.id);

    if (result.error) {
      throw result.error;
    }
    return;
  }

  const insert: MatchingProfileInsert = {
    user_id: user.id,
    status: "draft",
    target_markets: launchMarket ? [launchMarket] : [],
    budget_min: next.budget_min,
    budget_max: next.budget_max,
    move_in_start: next.move_in_start,
    move_in_end: next.move_in_end,
    household_size_min: next.household_size_min,
    household_size_max: next.household_size_max,
    visibility_mode: patch.visibility_mode ?? "anonymous",
    completeness_score: completenessScore,
  };
  const result = await supabase.from("matching_profiles").insert(insert);

  if (result.error) {
    throw result.error;
  }
}

async function updateRoommatePreferenceFields(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  user: NonNullable<Awaited<ReturnType<typeof ensureCurrentKinfolkUser>>["user"]>,
  patch: RoommatePreferenceUpdate,
) {
  const existing = await supabase
    .from("roommate_preferences")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const nextMin =
    patch.preferred_age_min !== undefined
      ? patch.preferred_age_min
      : (existing.data?.preferred_age_min ?? null);
  const nextMax =
    patch.preferred_age_max !== undefined
      ? patch.preferred_age_max
      : (existing.data?.preferred_age_max ?? null);
  if (nextMin != null && nextMax != null && nextMin > nextMax) {
    throw new ApiError("Age range minimum must be below maximum.");
  }

  const nextPatch: RoommatePreferenceUpdate = {
    ...patch,
    preferred_age_strict:
      nextMin == null && nextMax == null
        ? false
        : Boolean(
            patch.preferred_age_strict ??
              existing.data?.preferred_age_strict ??
              false,
          ),
  };

  if (existing.data) {
    const result = await supabase
      .from("roommate_preferences")
      .update(nextPatch)
      .eq("id", existing.data.id)
      .eq("user_id", user.id);

    if (result.error) {
      throw result.error;
    }
    return;
  }

  const profile = await supabase
    .from("matching_profiles")
    .select("id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (profile.error) {
    throw profile.error;
  }

  const insert: RoommatePreferenceInsert = {
    user_id: user.id,
    profile_id: profile.data?.id ?? null,
    ...nextPatch,
  };
  const result = await supabase.from("roommate_preferences").insert(insert);

  if (result.error) {
    throw result.error;
  }
}

function mergeMatchingProfile(
  current: MatchingProfileRow | null,
  user: NonNullable<Awaited<ReturnType<typeof ensureCurrentKinfolkUser>>["user"]>,
  patch: MatchingProfileUpdate,
): Pick<
  MatchingProfileRow,
  | "budget_min"
  | "budget_max"
  | "move_in_start"
  | "move_in_end"
  | "household_size_min"
  | "household_size_max"
> {
  return {
    budget_min:
      patch.budget_min !== undefined ? patch.budget_min : (current?.budget_min ?? null),
    budget_max:
      patch.budget_max !== undefined ? patch.budget_max : (current?.budget_max ?? null),
    move_in_start:
      patch.move_in_start !== undefined
        ? patch.move_in_start
        : (current?.move_in_start ?? null),
    move_in_end:
      patch.move_in_end !== undefined ? patch.move_in_end : (current?.move_in_end ?? null),
    household_size_min: patch.household_size_min ?? current?.household_size_min ?? 0,
    household_size_max:
      patch.household_size_max ??
      current?.household_size_max ??
      (normalizeLaunchMarket(user.launch_market) ? 4 : 0),
  };
}

function computeMatchingProfileCompleteness(
  profile: Pick<
    MatchingProfileRow,
    | "budget_min"
    | "budget_max"
    | "move_in_start"
    | "move_in_end"
    | "household_size_min"
    | "household_size_max"
  >,
) {
  const completed = [
    isBudgetComplete(profile.budget_min, profile.budget_max),
    Boolean(profile.move_in_start && profile.move_in_end),
    profile.household_size_min > 0 && profile.household_size_max >= profile.household_size_min,
  ].filter(Boolean).length;

  return Number(((completed / 3) * 100).toFixed(2));
}

function cleanWholeNumber(value: number | null, min: number, max: number) {
  if (value === null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cleanOptionalWholeNumber(value: number | null, min: number, max: number) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.min(max, Math.max(min, Math.round(value)));
  return rounded > min ? rounded : null;
}

function cleanOptionalWholeNumberInclusive(value: number | null, min: number, max: number) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function ageToBirthYear(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const age = Math.round(value);
  if (age < 18 || age > 100) {
    throw new ApiError("Age must be between 18 and 100.");
  }
  return new Date().getFullYear() - age;
}

function birthYearFromDateOfBirth(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("Use a valid birthday.");
  }
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const birthdayThisYear = Date.UTC(
    today.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  if (Date.now() < birthdayThisYear) {
    age -= 1;
  }
  if (age < 18 || age > 100) {
    throw new ApiError("Age must be between 18 and 100.");
  }
  return date.getUTCFullYear();
}

function isPositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && value > 0;
}

function isBudgetComplete(min: number | null, max: number | null) {
  const hasMin = isPositiveNumber(min);
  const hasMax = isPositiveNumber(max);

  if (!hasMin && !hasMax) {
    return false;
  }

  return !(hasMin && hasMax && min > max);
}

function cleanDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError("Use a valid date.");
  }
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("Use a valid date.");
  }
  return trimmed;
}

function cleanInterestList(values: string[] | null): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 12) break;
  }
  return out;
}

function extensionFromName(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}
