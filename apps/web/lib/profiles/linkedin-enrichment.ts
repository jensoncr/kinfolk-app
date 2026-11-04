import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import type { ClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import { buildLinkedInIdentityJobKey } from "@/lib/profiles/linkedin-identity-snapshot";
import { normalizeLinkedInProfileUrl } from "@/lib/profiles/linkedin-url";
import { buildLinkedInTrustFacts } from "@/lib/profiles/linkedin-trust-facts";
import { looksLikeEducationInstitution } from "./education";
import {
  createProfileImportForUserId,
  reviewProfileImportForUserId,
} from "@/lib/profiles/enrichment-store";
import { clampInteger } from "@/lib/shared/numbers";
import { parsePublicHttpsUrl } from "@/lib/shared/public-url";
import type { LinkedInTimelineItem } from "@/lib/shared/types";
import { upsertKinfolkUserFromClerk } from "@/lib/shared/users";
import { hasServerSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

type LinkedInEnrichmentJob = TableRow<"linkedin_enrichment_jobs">;

type ProfileResolutionFact = {
  fact_key: string;
  normalized_value: string;
  confidence: number;
  user_review_state: string;
};

type ProfileResolutionSignals = {
  occupationTitle: string | null;
  occupationCompany: string | null;
  educationSchool: string | null;
  hometown: string | null;
  launchMarket: string | null;
  facts: ProfileResolutionFact[];
};

type NormalizedEnrichmentProfile = {
  headline: string | null;
  linkedinUrl: string | null;
  profileImageUrl: string | null;
  workExperience: LinkedInTimelineItem[];
  education: LinkedInTimelineItem[];
  sourceProvider: string;
  sourceConfidence: number | null;
  rawPayload: Json;
};

type ProviderResult =
  | { status: "ready"; profile: NormalizedEnrichmentProfile }
  | {
      status: "skipped";
      message: string;
      profileStatus: "skipped" | "source_not_configured";
      linkedinUrl?: string | null;
    };

type JobOutcome = "not_claimed" | "ready" | "skipped" | "retrying" | "failed";

type LinkedInEnrichmentJobResult = {
  status: JobOutcome;
  reason?: LinkedInEnrichmentReason;
};

type LinkedInEnrichmentReason =
  | "failed"
  | "profile_unreadable"
  | "provider_not_configured"
  | "retrying";

type LinkedInEnrichmentFailure = {
  kind: "retryable" | "source_not_configured" | "terminal";
  internalMessage: string;
  publicMessage: string;
  providerStatus: number | null;
};

class LinkedInProviderHttpError extends Error {
  constructor(
    readonly provider: "custom_http",
    readonly status: number,
    readonly responseBody: string,
    message: string,
  ) {
    super(message);
    this.name = "LinkedInProviderHttpError";
  }
}

const linkedInProviderUnavailableMessage =
  "LinkedIn enrichment is temporarily unavailable. Your profile URL was saved, so you can continue and try again later.";
const linkedInEnrichmentRetryingMessage =
  "LinkedIn enrichment is taking longer than expected. Your profile URL was saved and enrichment will retry automatically.";
const linkedInEnrichmentFailedMessage =
  "We couldn't enrich this LinkedIn profile right now. Your profile URL was saved, so you can continue and try again later.";

const refreshAfterMs = 1000 * 60 * 60 * 24 * 30;
const profilePhotoBucket = "profile-photos";
const profileImageMaxBytes = 8 * 1024 * 1024;

async function ensureCurrentUserLinkedInEnrichment() {
  const identity = await getCurrentClerkLinkedInIdentity();

  if (!identity) {
    return { status: "signed_out" as const };
  }

  if (!hasServerSupabaseConfig()) {
    return { status: "supabase_not_configured" as const };
  }

  const supabase = createSupabaseServiceClient();
  const user = await upsertKinfolkUserFromClerk(supabase, identity);

  if (!identity.linkedin) {
    return { status: "no_linkedin_account" as const, userId: user.id };
  }

  const existingProfile = await supabase
    .from("professional_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingProfile.error) {
    throw existingProfile.error;
  }

  if (isFreshProfile(existingProfile.data)) {
    return { status: "fresh" as const, userId: user.id };
  }

  const job = await enqueueLinkedInEnrichment(supabase, user.id, identity);
  await markProfessionalProfileStatus(supabase, job, "queued", null);

  return { status: "queued" as const, userId: user.id, jobId: job.id };
}

export async function processLinkedInEnrichmentJobs(
  limit = 5,
  options: { dryRun?: boolean } = {},
) {
  if (!hasServerSupabaseConfig()) {
    return {
      ...(options.dryRun ? { dryRun: true } : {}),
      processed: 0,
      ready: 0,
      skipped: 0,
      failed: 0,
      reason: "supabase_not_configured",
    };
  }

  const supabase = createSupabaseServiceClient();
  const safeLimit = clampInteger(limit, 5, 1, 25);
  const now = new Date();
  const nowIso = now.toISOString();

  if (!options.dryRun) {
    await recoverStaleLinkedInEnrichmentJobs(supabase, now);
  }

  const jobsResult = await supabase
    .from("linkedin_enrichment_jobs")
    .select("*")
    .eq("status", "queued")
    .lte("next_attempt_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(safeLimit);

  if (jobsResult.error) {
    throw jobsResult.error;
  }

  if (options.dryRun) {
    return {
      dryRun: true,
      processed: 0,
      queued: jobsResult.data?.length ?? 0,
      ready: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const outcomes = await Promise.all(
    (jobsResult.data ?? []).map(async (job) => {
      try {
        return await processLinkedInEnrichmentJob(supabase, job);
      } catch (error) {
        console.error("[LinkedIn enrichment] job processing failed", {
          error: error instanceof Error ? error.message : String(error),
          jobId: job.id,
          userId: job.user_id,
        });
        return { status: "failed" as const };
      }
    }),
  );

  return {
    processed: outcomes.filter((outcome) => outcome.status !== "not_claimed").length,
    ready: outcomes.filter((outcome) => outcome.status === "ready").length,
    skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
  };
}

export async function runCurrentUserLinkedInEnrichment() {
  const queued = await ensureCurrentUserLinkedInEnrichment();

  if (queued.status !== "queued") {
    return queued;
  }

  const processed = await processLinkedInEnrichmentJobById(queued.jobId);

  return {
    ...queued,
    processed,
  };
}

export async function runCurrentUserLinkedInEnrichmentFromUrl(linkedinUrl: string) {
  const identity = await getCurrentClerkLinkedInIdentity();

  if (!identity) {
    return { status: "signed_out" as const };
  }

  if (!hasServerSupabaseConfig()) {
    return { status: "supabase_not_configured" as const };
  }

  const normalizedUrl = normalizeLinkedInProfileUrl(linkedinUrl);

  if (!normalizedUrl) {
    return { status: "invalid_url" as const };
  }

  const supabase = createSupabaseServiceClient();
  const user = await upsertKinfolkUserFromClerk(supabase, identity);

  const job = await enqueueLinkedInEnrichmentFromUrl(supabase, user.id, identity, normalizedUrl);
  await markProfessionalProfileStatus(supabase, job, "queued", null);

  const processed = await processLinkedInEnrichmentJobById(job.id);

  return { status: "queued" as const, userId: user.id, jobId: job.id, processed };
}

async function processLinkedInEnrichmentJobById(jobId: string) {
  if (!hasServerSupabaseConfig()) {
    return { status: "supabase_not_configured" as const };
  }

  const supabase = createSupabaseServiceClient();
  const job = await supabase
    .from("linkedin_enrichment_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (job.error) {
    throw job.error;
  }

  if (!job.data) {
    return { status: "not_found" as const };
  }

  return processLinkedInEnrichmentJob(supabase, job.data);
}

async function processLinkedInEnrichmentJob(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
): Promise<LinkedInEnrichmentJobResult> {
  const claimed = await claimJob(supabase, job);

  if (!claimed) {
    return { status: "not_claimed" };
  }

  try {
    await markProfessionalProfileStatus(supabase, claimed, "running", null);

    const resolutionSignals = await readProfileResolutionSignals(supabase, claimed.user_id);
    const providerResult = await fetchProfessionalProfile(claimed, resolutionSignals);

    if (providerResult.status === "skipped") {
      const jobForSave = providerResult.linkedinUrl
        ? { ...claimed, linkedin_url: providerResult.linkedinUrl }
        : claimed;
      const profileMessage =
        providerResult.profileStatus === "source_not_configured"
          ? linkedInProviderUnavailableMessage
          : providerResult.message;
      await saveSkippedProfessionalProfile(
        supabase,
        jobForSave,
        profileMessage,
        providerResult.profileStatus,
      );
      await completeJob(supabase, claimed, "skipped", providerResult.message);
      return {
        status: "skipped",
        reason:
          providerResult.profileStatus === "source_not_configured"
            ? "provider_not_configured"
            : "profile_unreadable",
      };
    }

    await Promise.all([
      saveProfessionalProfile(supabase, claimed, providerResult.profile),
      projectLinkedInTrustFacts(
        claimed.user_id,
        providerResult.profile,
        !isManualUrlJob(claimed),
      ),
    ]);
    await completeJob(supabase, claimed, "ready", null);
    return { status: "ready" };
  } catch (error) {
    const failure = classifyLinkedInEnrichmentFailure(error);
    console.error("[LinkedIn enrichment] provider or persistence failure", {
      jobId: claimed.id,
      kind: failure.kind,
      providerStatus: failure.providerStatus,
      userId: claimed.user_id,
    });

    if (failure.kind === "source_not_configured") {
      await saveSkippedProfessionalProfile(
        supabase,
        claimed,
        failure.publicMessage,
        "source_not_configured",
      );
      await completeJob(supabase, claimed, "skipped", failure.internalMessage);
      return { status: "skipped", reason: "provider_not_configured" };
    }

    if (failure.kind === "terminal") {
      await failJob(
        supabase,
        claimed,
        failure.internalMessage,
        failure.publicMessage,
      );
      return { status: "failed", reason: "failed" };
    }

    const didFail = await failOrRetryJob(
      supabase,
      claimed,
      failure.internalMessage,
      failure.publicMessage,
    );

    return {
      status: didFail ? "failed" : "retrying",
      reason: didFail ? "failed" : "retrying",
    };
  }
}

function classifyLinkedInEnrichmentFailure(
  error: unknown,
): LinkedInEnrichmentFailure {
  const internalMessage =
    error instanceof Error ? error.message : "Unknown enrichment error";
  if (error instanceof LinkedInProviderHttpError) {
    return classifyLinkedInProviderHttpFailure(
      error.status,
      error.responseBody,
      internalMessage,
    );
  }

  return {
    kind: "retryable",
    internalMessage,
    providerStatus: null,
    publicMessage: linkedInEnrichmentRetryingMessage,
  };
}

export function classifyLinkedInProviderHttpFailure(
  status: number,
  responseBody: string,
  internalMessage = `LinkedIn enrichment provider returned ${status}.`,
): LinkedInEnrichmentFailure {
  if (status === 401 || status === 403) {
    return {
      kind: "source_not_configured",
      internalMessage,
      providerStatus: status,
      publicMessage: linkedInProviderUnavailableMessage,
    };
  }

  if (status === 408 || status === 429 || status >= 500) {
    return {
      kind: "retryable",
      internalMessage,
      providerStatus: status,
      publicMessage: linkedInEnrichmentRetryingMessage,
    };
  }

  return {
    kind: "terminal",
    internalMessage,
    providerStatus: status,
    publicMessage: linkedInEnrichmentFailedMessage,
  };
}

async function enqueueLinkedInEnrichment(
  supabase: SupabaseServiceClient,
  userId: string,
  identity: ClerkLinkedInIdentity,
) {
  const linkedin = identity.linkedin;

  if (!linkedin) {
    throw new Error("Cannot enqueue LinkedIn enrichment without a LinkedIn external account.");
  }

  const idempotencyKey = buildLinkedInIdentityJobKey(identity);
  if (!idempotencyKey) {
    throw new Error("Cannot enqueue LinkedIn enrichment without a LinkedIn identity key.");
  }

  const existing = await supabase
    .from("linkedin_enrichment_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data?.status === "running") {
    return existing.data;
  }

  const payload = {
    user_id: userId,
    clerk_user_id: identity.clerkUserId,
    provider_user_id: linkedin.providerUserId,
    linkedin_url: linkedin.profileUrl,
    email: identity.email ?? linkedin.emailAddress,
    display_name: identity.displayName,
    idempotency_key: idempotencyKey,
    status: "queued",
    last_error: null,
    locked_at: null,
    next_attempt_at: new Date().toISOString(),
    completed_at: null,
  };

  if (existing.data) {
    const updated = await supabase
      .from("linkedin_enrichment_jobs")
      .update({ ...payload, attempt_count: 0 })
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (updated.error) {
      throw updated.error;
    }

    return updated.data;
  }

  const inserted = await supabase
    .from("linkedin_enrichment_jobs")
    .insert({
      ...payload,
      image_url: identity.avatarUrl || linkedin.imageUrl,
      attempt_count: 0,
    })
    .select("*")
    .single();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data;
}

async function enqueueLinkedInEnrichmentFromUrl(
  supabase: SupabaseServiceClient,
  userId: string,
  identity: ClerkLinkedInIdentity,
  normalizedUrl: string,
) {
  const linkedin = identity.linkedin;
  const idempotencyKey = ["linkedin", identity.clerkUserId, "manual-url"].join(":");

  const existing = await supabase
    .from("linkedin_enrichment_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  // Don't disturb an in-flight job: resetting a running row to "queued" clears its
  // lock and lets a second processor race the first on the same job id.
  // Queued rows are safe to refresh in place so corrected manual URLs are honored.
  if (existing.data?.status === "running") {
    return existing.data;
  }

  const payload = {
    user_id: userId,
    clerk_user_id: identity.clerkUserId,
    provider_user_id: linkedin?.providerUserId ?? null,
    linkedin_url: normalizedUrl,
    email: identity.email ?? linkedin?.emailAddress ?? null,
    display_name: identity.displayName,
    idempotency_key: idempotencyKey,
    status: "queued",
    last_error: null,
    locked_at: null,
    next_attempt_at: new Date().toISOString(),
    completed_at: null,
  };

  if (existing.data) {
    const updated = await supabase
      .from("linkedin_enrichment_jobs")
      .update({ ...payload, attempt_count: 0 })
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (updated.error) {
      throw updated.error;
    }

    return updated.data;
  }

  const inserted = await supabase
    .from("linkedin_enrichment_jobs")
    .insert({
      ...payload,
      image_url: identity.avatarUrl || linkedin?.imageUrl || null,
      attempt_count: 0,
    })
    .select("*")
    .single();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data;
}

async function claimJob(supabase: SupabaseServiceClient, job: LinkedInEnrichmentJob) {
  const result = await supabase
    .from("linkedin_enrichment_jobs")
    .update({
      status: "running",
      locked_at: new Date().toISOString(),
      attempt_count: job.attempt_count + 1,
      last_error: null,
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function recoverStaleLinkedInEnrichmentJobs(
  supabase: SupabaseServiceClient,
  now: Date,
) {
  const staleCutoff = new Date(
    now.getTime() - linkedinEnrichmentStaleLockMs(),
  ).toISOString();
  const result = await supabase
    .from("linkedin_enrichment_jobs")
    .update({
      status: "queued",
      last_error: "Retrying stale running LinkedIn enrichment job.",
      locked_at: null,
      next_attempt_at: now.toISOString(),
      completed_at: null,
    })
    .eq("status", "running")
    .lte("locked_at", staleCutoff);

  if (result.error) {
    throw result.error;
  }
}

async function readProfileResolutionSignals(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<ProfileResolutionSignals> {
  const [userResult, factsResult] = await Promise.all([
    supabase
      .from("kinfolk_users")
      .select("occupation_title, occupation_company, education_school, hometown, launch_market")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("profile_facts")
      .select("fact_key, normalized_value, confidence, user_review_state")
      .eq("user_id", userId)
      .eq("sensitivity_level", "standard")
      .in("user_review_state", ["approved", "edited"])
      .gte("confidence", 0.65)
      .in("fact_key", [
        "current_role",
        "school_background",
        "professional_domain",
        "professional_network",
        "verified_work_or_school",
        "workplace_anchor",
        "institutional_overlap",
        "current_location",
        "target_market",
        "location",
      ]),
  ]);

  if (userResult.error) {
    throw userResult.error;
  }
  if (factsResult.error) {
    throw factsResult.error;
  }

  return {
    occupationTitle: userResult.data?.occupation_title ?? null,
    occupationCompany: userResult.data?.occupation_company ?? null,
    educationSchool: userResult.data?.education_school ?? null,
    hometown: userResult.data?.hometown ?? null,
    launchMarket: userResult.data?.launch_market ?? null,
    facts: factsResult.data ?? [],
  };
}

async function fetchProfessionalProfile(
  job: LinkedInEnrichmentJob,
  resolutionSignals: ProfileResolutionSignals,
): Promise<ProviderResult> {
  return fetchCustomProfessionalProfile(job, resolutionSignals);
}

async function fetchCustomProfessionalProfile(
  job: LinkedInEnrichmentJob,
  resolutionSignals: ProfileResolutionSignals,
): Promise<ProviderResult> {
  const endpoint = process.env.LINKEDIN_ENRICHMENT_ENDPOINT?.trim();

  if (!endpoint) {
    return {
      status: "skipped",
      profileStatus: "source_not_configured",
      message: "No LinkedIn enrichment source is configured. Set LINKEDIN_ENRICHMENT_ENDPOINT.",
    };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const apiKey = process.env.LINKEDIN_ENRICHMENT_API_KEY?.trim();

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version: "v1",
      identity: {
        clerkUserId: job.clerk_user_id,
        provider: "oauth_linkedin_oidc",
        providerUserId: job.provider_user_id,
        linkedinUrl: job.linkedin_url,
        email: job.email,
        displayName: job.display_name,
        imageUrl: job.image_url,
      },
      resolutionSignals,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new LinkedInProviderHttpError(
      "custom_http",
      response.status,
      responseBody,
      `LinkedIn enrichment provider returned ${response.status}.`,
    );
  }

  const payload = (await response.json()) as unknown;

  return {
    status: "ready",
    profile: normalizeExternalPayload(payload, "custom_http"),
  };
}

// Project the verified LinkedIn work/education signal into matchable
// trust_context facts. Runs through the normal import → approve → project →
// recompute pipeline, and is best-effort: a failure here must not fail the
// enrichment job, whose primary output is the professional_profiles row.
async function projectLinkedInTrustFacts(
  userId: string,
  profile: NormalizedEnrichmentProfile,
  autoApprove: boolean,
) {
  try {
    const facts = buildLinkedInTrustFacts({
      headline: profile.headline,
      workExperience: profile.workExperience,
      education: profile.education,
    });

    if (facts.length === 0) {
      return;
    }

    const { import: importRow } = await createProfileImportForUserId(userId, {
      provider: "other",
      method: "system",
      sourceLabel: "LinkedIn enrichment",
      payload: { source: "linkedin_enrichment", profile_facts: facts },
    });

    // Auth-confirmed LinkedIn (OIDC) facts are auto-approved so they feed the trust
    // bridge. A manually pasted URL is unverified — the account holder could paste
    // anyone's profile — so those facts wait for the user to approve them in the
    // Memories view before they count toward matching.
    if (autoApprove) {
      await reviewProfileImportForUserId(userId, importRow.id, "approve_all");
    }
  } catch (error) {
    console.error("Failed to project LinkedIn trust facts", { userId, error });
  }
}

// Manual jobs come from a user pasting a LinkedIn URL (see
// enqueueLinkedInEnrichmentFromUrl); their data is unverified vs. OIDC-derived jobs.
function isManualUrlJob(job: LinkedInEnrichmentJob) {
  return job.idempotency_key?.endsWith(":manual-url") ?? false;
}

async function saveProfessionalProfile(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
  profile: NormalizedEnrichmentProfile,
) {
  const now = new Date().toISOString();
  const linkedinUrl = normalizeLinkedInProfileUrl(profile.linkedinUrl ?? job.linkedin_url);
  const profileImageUrlPromise = cacheLinkedInProfileImage(
    supabase,
    job,
    profile.profileImageUrl,
  );

  const { profileImageUrl, result } = await profileImageUrlPromise.then(
    async (profileImageUrl) => ({
      profileImageUrl,
      result: await supabase.from("professional_profiles").upsert(
        {
          user_id: job.user_id,
          linkedin_provider_user_id: job.provider_user_id,
          linkedin_url: linkedinUrl,
          headline: profile.headline ?? job.display_name,
          experiences: profile.workExperience as unknown as Json,
          education: profile.education as unknown as Json,
          enrichment_status: "ready",
          review_status: "needs_review",
          source_provider: profile.sourceProvider,
          source_confidence: profile.sourceConfidence,
          last_enrichment_error: null,
          enriched_at: now,
        },
        { onConflict: "user_id" },
      ),
    }),
  );

  if (result.error) {
    throw result.error;
  }

  const jobUpdate: Partial<Pick<LinkedInEnrichmentJob, "linkedin_url" | "image_url">> = {};
  if (linkedinUrl) {
    jobUpdate.linkedin_url = linkedinUrl;
  }
  if (profileImageUrl) {
    jobUpdate.image_url = profileImageUrl;
  }

  const [userUpdate, jobUpdateResult] = await Promise.all([
    linkedinUrl
      ? supabase.from("kinfolk_users").update({ linkedin_url: linkedinUrl }).eq("id", job.user_id)
      : null,
    Object.keys(jobUpdate).length > 0
      ? supabase.from("linkedin_enrichment_jobs").update(jobUpdate).eq("id", job.id)
      : null,
  ]);

  if (userUpdate?.error) {
    throw userUpdate.error;
  }
  if (jobUpdateResult?.error) {
    throw jobUpdateResult.error;
  }

  const snapshot = await supabase.from("profile_source_snapshots").insert({
    user_id: job.user_id,
    job_id: job.id,
    provider: profile.sourceProvider,
    lookup_key_hash: hashLookupKey([
      job.provider_user_id,
      linkedinUrl ?? job.linkedin_url,
      job.email,
      job.display_name,
    ]),
    raw_payload: profile.rawPayload,
    payload_version: "v1",
  });

  if (snapshot.error) {
    throw snapshot.error;
  }
}

async function cacheLinkedInProfileImage(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
  value: string | null,
) {
  const imageUrl = normalizeProfileImageUrl(value);
  if (!imageUrl) {
    return null;
  }

  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      return imageUrl;
    }

    const contentType = normalizeProfileImageContentType(response.headers.get("content-type"));
    if (!contentType) {
      return imageUrl;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > profileImageMaxBytes) {
      return imageUrl;
    }

    const extension =
      contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const storagePath = `${job.user_id}/linkedin-profile-${job.id}.${extension}`;
    const uploaded = await supabase.storage.from(profilePhotoBucket).upload(storagePath, bytes, {
      cacheControl: "31536000",
      contentType,
      upsert: true,
    });

    if (uploaded.error) {
      throw uploaded.error;
    }

    const { data } = supabase.storage.from(profilePhotoBucket).getPublicUrl(storagePath);
    return data.publicUrl || imageUrl;
  } catch (error) {
    console.warn("[LinkedIn enrichment] Failed to cache LinkedIn profile image.", {
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    });
    return imageUrl;
  }
}

function normalizeProfileImageContentType(value: string | null) {
  const contentType = value?.split(";")[0]?.trim().toLowerCase();
  return contentType === "image/jpeg" ||
    contentType === "image/png" ||
    contentType === "image/webp"
    ? contentType
    : null;
}

async function saveSkippedProfessionalProfile(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
  message: string,
  profileStatus: "skipped" | "source_not_configured",
) {
  const result = await supabase.from("professional_profiles").upsert(
    {
      user_id: job.user_id,
      linkedin_provider_user_id: job.provider_user_id,
      linkedin_url: job.linkedin_url,
      headline: job.display_name ? `${job.display_name}'s LinkedIn profile` : "LinkedIn connected",
      experiences: [],
      education: [],
      enrichment_status: profileStatus,
      review_status: "needs_review",
      source_provider: null,
      source_confidence: null,
      last_enrichment_error: message,
      enriched_at: null,
    },
    { onConflict: "user_id" },
  );

  if (result.error) {
    throw result.error;
  }
}

async function markProfessionalProfileStatus(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
  status: "queued" | "running" | "failed",
  error: string | null,
) {
  const result = await supabase.from("professional_profiles").upsert(
    {
      user_id: job.user_id,
      linkedin_provider_user_id: job.provider_user_id,
      linkedin_url: job.linkedin_url,
      headline: job.display_name ? `${job.display_name}'s LinkedIn profile` : "LinkedIn connected",
      enrichment_status: status,
      last_enrichment_error: error,
    },
    { onConflict: "user_id" },
  );

  if (result.error) {
    throw result.error;
  }
}

async function completeJob(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
  status: "ready" | "skipped",
  message: string | null,
) {
  const result = await supabase
    .from("linkedin_enrichment_jobs")
    .update({
      status,
      last_error: message,
      locked_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (result.error) {
    throw result.error;
  }
}

async function failJob(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
  message: string,
  publicMessage: string,
) {
  const result = await supabase
    .from("linkedin_enrichment_jobs")
    .update({
      status: "failed",
      last_error: message,
      locked_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (result.error) {
    throw result.error;
  }

  await markProfessionalProfileStatus(supabase, job, "failed", publicMessage);
}

async function failOrRetryJob(
  supabase: SupabaseServiceClient,
  job: LinkedInEnrichmentJob,
  message: string,
  publicMessage: string,
) {
  const terminal = job.attempt_count >= linkedinEnrichmentMaxAttempts();
  const retryDelayMs = Math.min(1000 * 60 * 30, 1000 * 60 * Math.max(job.attempt_count, 1) ** 2);
  const result = await supabase
    .from("linkedin_enrichment_jobs")
    .update({
      status: terminal ? "failed" : "queued",
      last_error: message,
      locked_at: null,
      next_attempt_at: new Date(Date.now() + retryDelayMs).toISOString(),
      completed_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", job.id);

  if (result.error) {
    throw result.error;
  }

  await markProfessionalProfileStatus(
    supabase,
    job,
    terminal ? "failed" : "queued",
    terminal ? linkedInEnrichmentFailedMessage : publicMessage,
  );

  return terminal;
}

function linkedinEnrichmentMaxAttempts() {
  return readTrimmedInteger(
    process.env.LINKEDIN_ENRICHMENT_MAX_ATTEMPTS,
    3,
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

function linkedinEnrichmentStaleLockMs() {
  return (
    readTrimmedInteger(
      process.env.LINKEDIN_ENRICHMENT_STALE_LOCK_MINUTES,
      30,
      1,
      24 * 60,
    ) *
    60 *
    1000
  );
}

function readTrimmedInteger(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
) {
  const rawValue = value?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  return clampInteger(rawValue, defaultValue, min, max);
}

export function normalizeExternalPayload(
  payload: unknown,
  fallbackProvider: string,
): NormalizedEnrichmentProfile {
  const record = asRecord(payload) ?? {};
  const firstRecord = readFirstRecord(payload) ?? record;
  const profileRecord =
    readFirstRecord(firstRecord.profile) ?? asRecord(firstRecord.profile) ?? firstRecord;
  const workExperience = readWorkTimelineItems(profileRecord, record);
  const sourceProvider =
    readString(record.sourceProvider) ??
    readString(record.provider) ??
    readString(firstRecord.sourceProvider) ??
    readString(firstRecord.provider) ??
    readString(profileRecord.sourceProvider) ??
    fallbackProvider;

  return {
    headline:
      readString(profileRecord.headline) ??
      readString(profileRecord.position) ??
      readString(profileRecord.subtitle) ??
      readString(profileRecord.about) ??
      readString(record.headline),
    linkedinUrl:
      normalizeLinkedInProfileUrl(profileRecord.url) ??
      normalizeLinkedInProfileUrl(profileRecord.input_url) ??
      normalizeLinkedInProfileUrl(profileRecord.profile_link) ??
      normalizeLinkedInProfileUrl(profileRecord.linkedinUrl) ??
      normalizeLinkedInProfileUrl(profileRecord.linkedin_url) ??
      normalizeLinkedInProfileUrl(record.linkedinUrl) ??
      normalizeLinkedInProfileUrl(record.linkedin_url),
    profileImageUrl: readProfileImageUrl(payload, profileRecord, firstRecord, record),
    workExperience,
    education: readTimelineItems(
      profileRecord.education ??
        profileRecord.educations ??
        profileRecord.educations_details ??
        record.education ??
        record.educations ??
        record.educations_details,
      "education",
    ),
    sourceProvider,
    sourceConfidence: readNumber(record.sourceConfidence) ?? readNumber(record.confidence),
    rawPayload: toJson(payload),
  };
}

function readProfileImageUrl(
  payload: unknown,
  ...sources: Array<Record<string, unknown> | null | undefined>
) {
  const candidates = compactUnique([
    readLinkedInIdentityProfileImageUrl(payload),
    ...sources.flatMap((source) => readProfileImageUrlsFromRecord(source)),
    ...collectProfileImageUrlCandidates(payload),
  ]);

  return candidates.find(normalizeProfileImageUrl) ?? null;
}

export function readLinkedInIdentityProfileImageUrl(payload: unknown) {
  const candidates = compactUnique([
    readNestedString(payload, [
      "basicInfo",
      "profilePicture",
      "croppedImage",
      "downloadUrl",
    ]),
    readNestedString(payload, ["profilePicture", "croppedImage", "downloadUrl"]),
  ]);

  return candidates.find(normalizeProfileImageUrl) ?? null;
}

const PROFILE_IMAGE_URL_KEYS = [
  "profileImageUrl",
  "profile_image_url",
  "profilePictureUrl",
  "profile_picture_url",
  "profilePicture",
  "profile_picture",
  "profile_pic_url",
  "profile_pic",
  "avatar",
  "imageUrl",
  "image_url",
  "picture",
  "photo",
];

const PROFILE_IMAGE_REJECT_PATH_PATTERN =
  /(?:banner|background|cover|logo|company|school|education|experience|organization|institution|institute|employer)/i;

function readProfileImageUrlsFromRecord(source: Record<string, unknown> | null | undefined) {
  if (!source) {
    return [];
  }

  return PROFILE_IMAGE_URL_KEYS.flatMap((key) => readProfileImageUrlValue(source[key]));
}

function collectProfileImageUrlCandidates(
  value: unknown,
  path: string[] = [],
): string[] {
  if (path.length > 8 || isRejectedProfileImagePath(path)) {
    return [];
  }

  if (Array.isArray(value)) {
    return compactUnique(
      value.flatMap((item, index) =>
        collectProfileImageUrlCandidates(item, [...path, String(index)]),
      ),
    );
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const candidates: string[] = [];
  for (const [key, nested] of Object.entries(record)) {
    const nextPath = [...path, key];
    if (isProfileImageKey(key) && !isRejectedProfileImagePath(nextPath)) {
      candidates.push(...readProfileImageUrlValue(nested));
    }
    candidates.push(...collectProfileImageUrlCandidates(nested, nextPath));
  }

  return compactUnique(candidates);
}

function readProfileImageUrlValue(value: unknown) {
  return compactUnique([
    readString(value),
    readString(asRecord(value)?.url),
    readString(asRecord(value)?.downloadUrl),
    readNestedString(value, ["croppedImage", "downloadUrl"]),
  ]);
}

function isProfileImageKey(key: string) {
  return PROFILE_IMAGE_URL_KEYS.includes(key);
}

function isRejectedProfileImagePath(path: string[]) {
  return path.some((part) => PROFILE_IMAGE_REJECT_PATH_PATTERN.test(part));
}

// LinkedIn serves default/ghost avatars (blank silhouettes) from its static asset
// CDN, e.g. https://static.licdn.com/aero-v1/sc/h/<hash>. Real member photos live on
// media.licdn.com/dms/image/... — reject the placeholders so we don't persist them.
const GHOST_AVATAR_HOST_PATTERN = /(^|\.)static(-[a-z0-9]+)?\.licdn\.com$/i;

function normalizeProfileImageUrl(value: string | null | undefined) {
  const url = value?.trim();
  if (!url) {
    return null;
  }

  const parsed = parsePublicHttpsUrl(url);
  if (!parsed) {
    return null;
  }
  if (
    GHOST_AVATAR_HOST_PATTERN.test(parsed.hostname) ||
    parsed.pathname.includes("/aero-v1/sc/")
  ) {
    return null;
  }

  return parsed.toString();
}

function readNestedString(value: unknown, path: string[]) {
  let current = value;
  for (const part of path) {
    const record = asRecord(current);
    if (!record) {
      return null;
    }
    current = record[part];
  }
  return readString(current);
}

function readWorkTimelineItems(
  profileRecord: Record<string, unknown>,
  record: Record<string, unknown>,
) {
  const timelineItems = readTimelineItems(
    profileRecord.workExperience ??
      profileRecord.experience ??
      profileRecord.experiences ??
      record.workExperience ??
      record.experience ??
      record.experiences,
    "experience",
  );

  if (timelineItems.length > 0) {
    return timelineItems;
  }

  const currentCompany = asRecord(profileRecord.current_company) ?? asRecord(record.current_company);
  const currentCompanyName =
    readString(profileRecord.current_company_name) ??
    readString(record.current_company_name) ??
    readString(currentCompany?.name);

  if (!currentCompanyName) {
    return [];
  }

  // No full experience array — surface the current employer with a real title if one
  // is available. Never emit the literal "Current company" placeholder.
  const currentTitle =
    readString(currentCompany?.title) ??
    readString(profileRecord.position) ??
    readString(record.position) ??
    "";

  return [
    {
      id: `experience-current-${hashLookupKey([currentCompanyName])}`,
      title: currentTitle,
      organization: currentCompanyName,
      subtitle: readString(currentCompany?.location) ?? "",
      dateRange: "",
      logoUrl: readLogoUrl(currentCompany, profileRecord, record),
    },
  ];
}

function readTimelineItems(value: unknown, prefix: string): LinkedInTimelineItem[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? [{ organization: value }]
      : asRecord(value)
        ? [value]
        : [];

  if (values.length === 0) {
    return [];
  }

  return values.flatMap((item, index) => {
    const record = asRecord(item);

    if (!record) {
      return [];
    }

    const rawTitle =
      readString(record.title) ??
      readString(record.role) ??
      readString(record.position) ??
      readString(record.degree) ??
      readString(record.degreeName) ??
      readString(record.degree_name) ??
      readString(record.field_of_study) ??
      "";
    const currentCompany = asRecord(record.current_company);
    const companyName = currentCompany ? readString(currentCompany.name) : null;
    const schoolRecord = asRecord(record.school);
    const schoolName = schoolRecord ? readString(schoolRecord.name) : null;
    let title = rawTitle;
    let organization =
      readString(record.organization) ??
      readString(record.company) ??
      readString(record.companyName) ??
      readString(record.company_name) ??
      companyName ??
      schoolName ??
      readString(record.school) ??
      readString(record.schoolName) ??
      readString(record.school_name) ??
      readString(record.institution) ??
      "";

    if (prefix === "education" && !organization && looksLikeEducationInstitution(title)) {
      organization = title;
      title = "";
    }

    if (!title && !organization) {
      return [];
    }

    const subtitle =
      readString(record.subtitle) ??
      readString(record.location) ??
      readString(record.description) ??
      readString(record.description_html) ??
      readString(record.field) ??
      "";
    const dateRange =
      readString(record.dateRange) ??
      readString(record.date_range) ??
      readString(record.duration) ??
      [
        readString(record.startDate) ??
          readString(record.start_date) ??
          readString(record.startYear) ??
          readString(record.start_year),
        readString(record.endDate) ??
          readString(record.end_date) ??
          readString(record.endYear) ??
          readString(record.end_year),
      ]
        .filter(Boolean)
        .join(" - ");

    return [
      {
        id:
          readString(record.id) ??
          `${prefix}-${index}-${hashLookupKey([title, organization, dateRange])}`,
        title,
        organization,
        subtitle,
        dateRange,
        logoUrl: readLogoUrl(record, currentCompany, schoolRecord),
      },
    ];
  });
}

const LOGO_URL_KEYS = [
  "logoUrl",
  "logo_url",
  "company_logo_url",
  "companyLogoUrl",
  "company_logo",
  "companyLogo",
  "institute_logo_url",
  "instituteLogoUrl",
  "school_logo_url",
  "schoolLogoUrl",
  "logo",
  "image",
  "image_url",
];

function readLogoUrl(...sources: Array<Record<string, unknown> | null | undefined>): string | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of LOGO_URL_KEYS) {
      const value = readString(source[key]);
      if (value && /^https?:\/\//i.test(value)) {
        return value;
      }
    }
  }
  return null;
}

function readRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  for (const key of ["data", "result", "results", "input"]) {
    const nested = record[key];

    if (Array.isArray(nested)) {
      return nested.flatMap((item) => {
        const nestedRecord = asRecord(item);
        return nestedRecord ? [nestedRecord] : [];
      });
    }
  }

  return [record];
}

function readFirstRecord(value: unknown) {
  return readRecords(value)[0] ?? null;
}

function compactUnique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const normalized = value?.trim();

    if (!normalized) {
      return [];
    }

    const key = normalizeComparable(normalized);
    if (!key || seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [normalized];
  });
}

function normalizeComparable(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isFreshProfile(profile: TableRow<"professional_profiles"> | null) {
  if (!profile?.enriched_at || profile.enrichment_status !== "ready") {
    return false;
  }

  return Date.now() - new Date(profile.enriched_at).getTime() < refreshAfterMs;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function hashLookupKey(parts: Array<string | null>) {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 32);
}
