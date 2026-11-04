import "server-only";

import { cache } from "react";
import { getCurrentClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import { syncLinkedInIdentitySnapshot } from "@/lib/profiles/linkedin-identity-snapshot";
import { selectPreferredIdentityAvatarUrl } from "@/lib/profiles/identity-avatar";
import type { ClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import { parseEvidencePoints } from "@/lib/shared/evidence";
import { normalizeLaunchMarket } from "@/lib/shared/launch-market";
import { normalizePhoneE164 } from "@/lib/shared/phone";
import { prependLinkedInProfilePhoto } from "@/lib/profiles/photos";
import type {
  DashboardSnapshot,
  LinkedInEnrichmentStatus,
  LinkedInTimelineItem,
  MatchQueueItem,
} from "@/lib/shared/types";
import { hasServerSupabaseConfig, supabaseUrl } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { upsertKinfolkUserFromClerk } from "@/lib/shared/users";

type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

function textOrFallback(value: string | null, fallback: string) {
  return value && value.trim().length > 0 ? value : fallback;
}

function computeAge({
  birthYear,
  dateOfBirth,
}: {
  birthYear: number | null;
  dateOfBirth: string | null;
}): number | null {
  if (birthYear != null && Number.isFinite(birthYear)) {
    const age = new Date().getFullYear() - birthYear;
    return age >= 18 && age <= 100 ? age : null;
  }

  if (!dateOfBirth) return null;

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthsBefore = now.getMonth() - dob.getMonth();
  if (monthsBefore < 0 || (monthsBefore === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }

  return age >= 18 && age <= 100 ? age : null;
}

function mapQueueItem(row: TableRow<"match_queue_items">): MatchQueueItem {
  return {
    id: row.id,
    candidateType: row.candidate_type,
    title: row.title,
    subtitle: row.subtitle,
    status: row.status,
    fitScore: row.fit_score,
    monthlyRent: row.monthly_rent,
    evidence: parseEvidencePoints(row.evidence),
    tradeoffs: parseEvidencePoints(row.tradeoffs),
    nextAction: textOrFallback(row.next_action, "Review the match evidence"),
    expiresAt: textOrFallback(row.expires_at, new Date().toISOString()),
  };
}

function parseTimelineItems(value: Json): LinkedInTimelineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const id = item.id;
    const title = item.title;
    const organization = item.organization;
    const subtitle = item.subtitle;
    const dateRange = item.dateRange;
    const logoUrl = item.logoUrl;

    if (typeof id !== "string" || typeof organization !== "string") {
      return [];
    }

    return [
      {
        id,
        title: typeof title === "string" ? title : "",
        organization,
        subtitle: typeof subtitle === "string" ? subtitle : "",
        dateRange: typeof dateRange === "string" ? dateRange : "",
        logoUrl: typeof logoUrl === "string" && logoUrl.length > 0 ? logoUrl : null,
      },
    ];
  });
}

function toEnrichmentStatus(status: string | null): LinkedInEnrichmentStatus {
  switch (status) {
    case "queued":
    case "running":
    case "ready":
    case "failed":
    case "skipped":
    case "source_not_configured":
      return status;
    default:
      return "not_started";
  }
}

function toReviewStatus(status: string | null) {
  switch (status) {
    case "needs_review":
    case "reviewed":
      return status;
    default:
      return "pending";
  }
}

function withCurrentUser(
  snapshot: DashboardSnapshot,
  identity: ClerkLinkedInIdentity | null,
  linkedinProfileImageUrl?: string | null,
): DashboardSnapshot {
  if (!identity) {
    return snapshot;
  }

  const preferredLinkedInImageUrl =
    linkedinProfileImageUrl?.trim() ||
    identity.linkedin?.imageUrl ||
    identity.avatarUrl ||
    null;

  return {
    ...snapshot,
    user: {
      ...snapshot.user,
      displayName: identity.displayName,
      email: identity.email ?? snapshot.user.email,
      avatarUrl: identity.avatarUrl,
      linkedinUrl: identity.linkedin?.profileUrl ?? snapshot.user.linkedinUrl,
      photos: prependLinkedInProfilePhoto(
        snapshot.user.photos,
        identity.linkedin ? preferredLinkedInImageUrl : null,
      ),
    },
  };
}

function emptyLinkedInProfile(
  identity: ClerkLinkedInIdentity | null,
  status: LinkedInEnrichmentStatus,
  lastError: string | null,
): DashboardSnapshot["linkedinProfile"] {
  return {
    headline: identity?.linkedin
      ? "LinkedIn connected. Work and education history will appear after enrichment runs."
      : "Connect LinkedIn to import professional context.",
    resumeStatus: "missing",
    salaryTarget: null,
    workMode: "",
    startDate: "",
    startupGrind: "not_sure",
    workExperience: [],
    education: [],
    recentInteractions: [],
    enrichmentStatus: status,
    reviewStatus: "pending",
    sourceProvider: null,
    sourceConfidence: null,
    enrichedAt: null,
    lastError,
  };
}

function emptyDashboardSnapshot(
  identity: ClerkLinkedInIdentity | null,
  source: DashboardSnapshot["source"],
  status: LinkedInEnrichmentStatus,
  lastError: string | null,
): DashboardSnapshot {
  return withCurrentUser(
    {
      source,
      user: {
        id: "",
        displayName: identity?.displayName ?? "Unknown user",
        email: identity?.email ?? "",
        phone: "Not verified",
        phoneVerified: false,
        externalAuthConnected: Boolean(identity?.externalAuthConnected),
        linkedinUrl: identity?.linkedin?.profileUrl ?? "",
        linkedinConnected: Boolean(identity?.linkedin),
        avatarUrl: identity?.avatarUrl ?? "",
        launchMarket: "",
        dateOfBirth: null,
        birthYear: null,
        age: null,
        aboutText: null,
        interests: [],
        occupationTitle: null,
        occupationCompany: null,
        occupationCompanyDomain: null,
        occupationCompanyLogoUrl: null,
        educationSchool: null,
        educationSchoolDomain: null,
        educationSchoolLogoUrl: null,
        educationDegree: null,
        educationMajor: null,
        educationYear: null,
        hometown: null,
        photos: [],
      },
      profile: {
        id: "",
        status: "not_started",
        targetMarkets: [],
        budgetMin: 0,
        budgetMax: 0,
        moveInStart: "",
        moveInEnd: "",
        householdSizeMin: 0,
        householdSizeMax: 0,
        visibilityMode: "private",
        completenessScore: 0,
      },
      housing: {
        neighborhoods: [],
        commuteNotes: "",
        pets: "",
        mustHaves: [],
        dealbreakers: [],
        flexibilityNotes: "",
      },
      roommate: {
        lifestyleNotes: "",
        cleanliness: "",
        sleepSchedule: "",
        socialEnergy: "",
        hostingExpectations: "",
        conflictStyle: "",
        dealbreakers: [],
        preferredAgeMin: null,
        preferredAgeMax: null,
        preferredAgeStrict: false,
      },
      linkedinProfile: emptyLinkedInProfile(identity, status, lastError),
      interview: {
        status: "not_started",
        channel: "",
        completedAt: "",
        summary: "",
        extractionStatus: "not_started",
      },
      queue: [],
      agentAccess: {
        activeConnections: 0,
        recentTool: "",
        scopes: [],
        lastSummary: "",
      },
    },
    identity,
  );
}

function mapProfessionalProfile({
  identity,
  job,
  profile,
}: {
  identity: ClerkLinkedInIdentity | null;
  job: TableRow<"linkedin_enrichment_jobs"> | null;
  profile: TableRow<"professional_profiles"> | null;
}): DashboardSnapshot["linkedinProfile"] {
  if (!profile) {
    return emptyLinkedInProfile(
      identity,
      toEnrichmentStatus(job?.status ?? null),
      job?.last_error ?? null,
    );
  }

  return {
    headline: textOrFallback(profile.headline, identity?.displayName ?? ""),
    resumeStatus: profile.resume_status === "uploaded" ? "uploaded" : "missing",
    salaryTarget: profile.salary_target,
    workMode: textOrFallback(profile.work_mode, ""),
    startDate: profile.start_date,
    startupGrind:
      profile.startup_grind === "no" || profile.startup_grind === "yes"
        ? profile.startup_grind
        : "not_sure",
    workExperience: parseTimelineItems(profile.experiences),
    education: parseTimelineItems(profile.education),
    recentInteractions: profile.recent_interactions,
    enrichmentStatus: toEnrichmentStatus(profile.enrichment_status),
    reviewStatus: toReviewStatus(profile.review_status),
    sourceProvider: profile.source_provider,
    sourceConfidence: profile.source_confidence,
    enrichedAt: profile.enriched_at,
    lastError: profile.last_enrichment_error,
  };
}

export const getDashboardSnapshot = cache(async (): Promise<DashboardSnapshot> => {
  const identity = await getCurrentClerkLinkedInIdentity();

  if (!hasServerSupabaseConfig()) {
    return emptyDashboardSnapshot(
      identity,
      {
        kind: "supabase",
        status: "unavailable",
        detail: "Supabase is not configured. No mock dashboard data is shown.",
      },
      "source_not_configured",
      "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load dashboard data.",
    );
  }

  if (!identity) {
    return emptyDashboardSnapshot(
      null,
      {
        kind: "supabase",
        status: "connected",
        detail: "Sign in to load your Kinfolk dashboard data.",
      },
      "not_started",
      null,
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    // Identity persistence belongs to the authenticated server boundary, not a
    // client enrichment side effect. This creates the Kinfolk row for a fresh
    // signup before the dashboard reads the rest of their profile.
    const user = await upsertKinfolkUserFromClerk(supabase, identity);
    await syncLinkedInIdentitySnapshot(
      supabase,
      user.id,
      identity,
    ).catch((error) => {
      console.error("[LinkedIn identity] Avatar snapshot failed", {
        error,
        userId: user.id,
      });
    });
    const [
      profileResult,
      housingResult,
      roommateResult,
      professionalProfileResult,
      enrichmentJobResult,
      interviewResult,
      queueResult,
      consentResult,
      actionLogResult,
      photosResult,
      verifiedPhoneResult,
    ] = await Promise.all([
      supabase
        .from("matching_profiles")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("housing_preferences")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("roommate_preferences")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("professional_profiles")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("linkedin_enrichment_jobs")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("matching_interviews")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("match_queue_items")
        .select("*")
        .eq("user_id", user.id)
        .order("fit_score", { ascending: false }),
      supabase
        .from("agent_delegation_consents")
        .select("*")
        .eq("user_id", user.id)
        .is("revoked_at", null),
      supabase
        .from("agent_action_log")
        .select("*")
        .eq("user_id", user.id)
        .order("called_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("kinfolk_user_photos")
        .select("*")
        .eq("user_id", user.id)
        .order("position", { ascending: true }),
      supabase
        .from("user_phone_numbers")
        .select("*")
        .eq("user_id", user.id)
        .eq("sms_consent_state", "opted_in")
        .not("verified_at", "is", null)
        .order("verified_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const firstError = [
      profileResult.error,
      housingResult.error,
      roommateResult.error,
      professionalProfileResult.error,
      enrichmentJobResult.error,
      interviewResult.error,
      queueResult.error,
      consentResult.error,
      actionLogResult.error,
      photosResult.error,
      verifiedPhoneResult.error,
    ].find(Boolean);

    if (firstError) {
      return emptyDashboardSnapshot(
        identity,
        {
          kind: "supabase",
          status: "error",
          detail: `Supabase dashboard query failed: ${firstError.message}`,
        },
        "not_started",
        firstError.message,
      );
    }

    const profile = profileResult.data;
    const housing = housingResult.data;
    const roommate = roommateResult.data;
    const interview = interviewResult.data;
    const queue = queueResult.data ?? [];
    const consents = consentResult.data ?? [];
    const lastAction = actionLogResult.data;
    const verifiedPhone = verifiedPhoneResult.data;
    const verifiedPhoneNumber = normalizePhoneE164(verifiedPhone?.phone_e164);
    const photos = (photosResult.data ?? []).map((row) => ({
      id: row.id,
      url: row.public_url,
      position: row.position,
      isPrimary: row.is_primary,
      width: row.width,
      height: row.height,
      source: "upload" as const,
    }));
    const enrichmentJobs = enrichmentJobResult.data ?? [];
    const enrichmentJob = enrichmentJobs[0] ?? null;
    const identityAvatarUrl = selectPreferredIdentityAvatarUrl(
      enrichmentJobs,
      supabaseUrl,
    );
    const professionalProfile = mapProfessionalProfile({
      identity,
      job: enrichmentJob,
      profile: professionalProfileResult.data ?? null,
    });

    const snapshot: DashboardSnapshot = {
      source: {
        kind: "supabase",
        status: "connected",
        detail: "Reading Kinfolk dashboard data from Supabase.",
      },
      user: {
        id: user.id,
        displayName: user.display_name,
        email: textOrFallback(user.email, identity.email ?? ""),
        phone: verifiedPhoneNumber || "Not verified",
        phoneVerified: Boolean(verifiedPhone?.verified_at && verifiedPhoneNumber),
        externalAuthConnected: identity.externalAuthConnected,
        linkedinUrl: textOrFallback(user.linkedin_url, identity.linkedin?.profileUrl ?? ""),
        linkedinConnected: Boolean(identity.linkedin),
        avatarUrl: identity.avatarUrl ?? "",
        launchMarket: normalizeLaunchMarket(user.launch_market),
        dateOfBirth: user.date_of_birth,
        birthYear: user.birth_year,
        age: computeAge({
          birthYear: user.birth_year,
          dateOfBirth: user.date_of_birth,
        }),
        aboutText: user.about_text,
        interests: user.interests ?? [],
        occupationTitle: user.occupation_title,
        occupationCompany: user.occupation_company,
        occupationCompanyDomain: user.occupation_company_domain,
        occupationCompanyLogoUrl: user.occupation_company_logo_url,
        educationSchool: user.education_school,
        educationSchoolDomain: user.education_school_domain,
        educationSchoolLogoUrl: user.education_school_logo_url,
        educationDegree: user.education_degree,
        educationMajor: user.education_major,
        educationYear: user.education_year,
        hometown: user.hometown,
        photos,
      },
      profile: {
        id: profile?.id ?? "",
        status: profile?.status ?? "not_started",
        targetMarkets: profile?.target_markets ?? [],
        budgetMin: profile?.budget_min ?? 0,
        budgetMax: profile?.budget_max ?? 0,
        moveInStart: textOrFallback(profile?.move_in_start ?? null, ""),
        moveInEnd: textOrFallback(profile?.move_in_end ?? null, ""),
        householdSizeMin: profile?.household_size_min ?? 0,
        householdSizeMax: profile?.household_size_max ?? 0,
        visibilityMode: profile?.visibility_mode ?? "private",
        completenessScore: profile?.completeness_score ?? 0,
      },
      housing: {
        neighborhoods: housing?.neighborhoods ?? [],
        commuteNotes: textOrFallback(housing?.commute_notes ?? null, ""),
        pets: textOrFallback(housing?.pets ?? null, ""),
        mustHaves: housing?.must_haves ?? [],
        dealbreakers: housing?.dealbreakers ?? [],
        flexibilityNotes: textOrFallback(housing?.flexibility_notes ?? null, ""),
      },
      roommate: {
        lifestyleNotes: textOrFallback(roommate?.lifestyle_notes ?? null, ""),
        cleanliness: textOrFallback(roommate?.cleanliness ?? null, ""),
        sleepSchedule: textOrFallback(roommate?.sleep_schedule ?? null, ""),
        socialEnergy: textOrFallback(roommate?.social_energy ?? null, ""),
        hostingExpectations: textOrFallback(roommate?.hosting_expectations ?? null, ""),
        conflictStyle: textOrFallback(roommate?.conflict_style ?? null, ""),
        dealbreakers: roommate?.dealbreakers ?? [],
        preferredAgeMin: roommate?.preferred_age_min ?? null,
        preferredAgeMax: roommate?.preferred_age_max ?? null,
        preferredAgeStrict: roommate?.preferred_age_strict ?? false,
      },
      linkedinProfile: professionalProfile,
      interview: {
        status: interview?.status ?? "not_started",
        channel: interview?.channel ?? "",
        completedAt: interview?.completed_at ?? "",
        summary: textOrFallback(interview?.summary ?? null, ""),
        extractionStatus: interview?.extraction_status ?? "not_started",
      },
      queue: queue.map(mapQueueItem),
      agentAccess: {
        activeConnections: consents.length,
        recentTool: lastAction?.tool_called ?? "",
        scopes: consents.flatMap((consent) => consent.granted_scopes),
        lastSummary: textOrFallback(lastAction?.result_summary ?? null, ""),
      },
    };

    return withCurrentUser(snapshot, identity, identityAvatarUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Supabase error";

    return emptyDashboardSnapshot(
      identity,
      {
        kind: "supabase",
        status: "error",
        detail: `Supabase dashboard query failed: ${message}`,
      },
      "failed",
      message,
    );
  }
});
