import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/shared/api-error";
import {
  consolidateProfileFactsForProjection,
  detectProfileFactConflicts,
  extractProfileFacts,
  extractProfileImportMetadata,
  filterFactsForImportProvider,
  isInformativeProfileFact,
  isInformativeProfileFactRow,
  isAssistantImportProvider,
  mapFactForScoring,
  normalizeProfileImportPayload,
  parseProfileImportText,
  profileImportStatusForFactReviewStates,
  readBudgetNumbersFromText,
  reconcileProfileFactImport,
  resolveCanonicalFactKey,
  assistantAutoApproveConfidenceThresholdForFact,
  shouldAutoApproveCrossProviderCorroboration,
  searchProfileFactKeys,
  type ExtractedProfileFact,
  type ProfileFactForScoring,
  type ProfileFactReviewState,
  type ProfileImportMetadata,
  type ProfileImportMethod,
  type ProfileImportProvider,
} from "@/lib/profiles/enrichment";
import { scoreCompatibility } from "@/lib/matching/compatibility-scoring";
import { foldScoreMetaIntoComponents } from "@/lib/matching/score-meta";
import { parseEvidencePoints } from "@/lib/shared/evidence";
import {
  isWebEditableListKey,
  isWebEditablePreferenceKey,
  normalizeEditablePreferenceList,
  structuredFactOptions,
} from "@/lib/profiles/fact-normalization";
import { recomputeApartmentListingMatchesForUser } from "@/lib/matching/apartment-listing-matches";
import {
  loadAggregateProfileEmbedding,
  retrieveProfileEmbeddingCandidates,
  shouldUseProfileEmbeddings,
  upsertProfileEmbeddingForUser,
} from "@/lib/profiles/embeddings-store";
import { rerankCompatibilityCandidates } from "@/lib/matching/profile-compatibility-rerank";
import { loadSavedPlacesForUsers } from "@/lib/plan/saved-places-reader";
import { countSavedAreaOverlap, countSavedListingOverlap } from "@/lib/matching/saved-place-taste";
import { topReasonLabels } from "@/lib/apartments/persisted-roommate-groups";
import { validateSanFranciscoNeighborhoodValues } from "@/lib/text-agent/neighborhoods";
import type {
  CompatibilityEdgeSummary,
  ProfileEnrichmentSnapshot,
} from "@/lib/shared/types";
import { hasServerSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { revalidateProfileDependentPaths } from "@/lib/profiles/route-cache";
import { normalizeMapboxLocationValue } from "@/lib/integrations/mapbox-location";
import { normalizeMapboxLocationLabel } from "@/lib/shared/location-suggestions";
import { mapWithConcurrency } from "@/lib/shared/concurrency";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export type ProfileCompatibilityDryRunResult = {
  dryRun: true;
  edgeCandidates: number;
  rerankedCandidates: number;
  retrievedCandidates: number;
  staleEdgeCandidates: number;
  status: "computed" | "empty" | "missing_user";
  userId: string;
};

export type ProfileCompatibilityRecomputeResult = {
  status: "computed" | "empty" | "missing_user";
  userId: string;
};

const approvedProfileFactReviewStates = new Set(["approved", "edited"]);
const PROFILE_MATCHING_REFRESH_CONCURRENCY = 4;
const PROFILE_MATCHING_REFRESH_MAX_ATTEMPTS = 5;

type ImportArgs = {
  provider: ProfileImportProvider;
  method: ProfileImportMethod;
  sourceLabel?: string | null;
  payload: unknown;
};

type ProfileFactInsertCandidate = {
  fact: ExtractedProfileFact;
  reviewState: ProfileFactReviewState;
};

type RetrievedCompatibilityCandidate = {
  cosineSimilarity?: number | null;
  semanticRank?: number | null;
  userId: string;
};

export type MatchingSetupFactPatch = {
  budgetMin?: number | null;
  budgetMax?: number | null;
  moveInStart?: string | null;
  moveInEnd?: string | null;
  householdSizeMin?: number | null;
  householdSizeMax?: number | null;
};

export type ProfileMatchingReviewState = {
  pendingFactCount: number;
  pendingBehavioralCount: number;
  approvedBehavioralCount: number;
  hasPendingImports: boolean;
};

const behavioralFactKeys = new Set([
  "sleep_schedule",
  "work_from_home",
  "work_hours",
  "routine_regularity",
  "noise_tolerance",
  "cleanliness",
  "chores",
  "guests",
  "overnight_guests",
  "social_energy",
  "privacy",
  "communication_style",
  "conflict_repair",
  "planning_style",
  "response_time",
  "house_meetings",
  "rent_tradeoff",
  "interests",
]);

type FactPatch = {
  reviewState?: ProfileFactReviewState;
  value?: unknown;
  reviewNote?: string | null;
};

type ProfileMutationOptions = {
  refreshMatchingState?: boolean | "deferred";
  snapshotMode?: "full" | "summary" | "none";
};

type ProfileSlotEditArgs = {
  facts: Array<Record<string, Json>>;
  method?: ProfileImportMethod;
  payload?: unknown;
  provider: ProfileImportProvider;
  revokeKeys: string[];
  sourceLabel?: string | null;
};

type ProfileMutationResult = {
  snapshot: ProfileEnrichmentSnapshot | null;
  userId: string;
};

export async function getProfileEnrichmentSnapshot(): Promise<ProfileEnrichmentSnapshot> {
  if (!hasServerSupabaseConfig()) {
    return emptyProfileEnrichmentSnapshot(
      "unavailable",
      "Supabase is not configured.",
    );
  }

  const { identity, user } = await ensureCurrentKinfolkUser();

  if (!identity) {
    return emptyProfileEnrichmentSnapshot(
      "connected",
      "Sign in to load profile enrichment.",
    );
  }

  if (!user) {
    return emptyProfileEnrichmentSnapshot(
      "unavailable",
      "Supabase is not configured.",
    );
  }

  return getProfileEnrichmentSnapshotForUser(
    createSupabaseServiceClient(),
    user.id,
  );
}

/**
 * Lightweight snapshot used by profile/settings surfaces. Only fetches imports + facts
 * (the inputs to `summarizeEnrichmentForProfile`) — no conflict, compatibility,
 * or gap calculation — so memory review mutations can return quickly.
 */
export async function getProfileSummarySnapshot(): Promise<ProfileEnrichmentSnapshot> {
  if (!hasServerSupabaseConfig()) {
    return emptyProfileEnrichmentSnapshot(
      "unavailable",
      "Supabase is not configured.",
    );
  }

  const { identity, user } = await ensureCurrentKinfolkUser();

  if (!identity) {
    return emptyProfileEnrichmentSnapshot(
      "connected",
      "Sign in to load profile enrichment.",
    );
  }

  if (!user) {
    return emptyProfileEnrichmentSnapshot(
      "unavailable",
      "Supabase is not configured.",
    );
  }

  return getProfileSummarySnapshotForUser(
    createSupabaseServiceClient(),
    user.id,
  );
}

async function getProfileSummarySnapshotForUser(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<ProfileEnrichmentSnapshot> {
  const [importsResult, factsResult] = await Promise.all([
    supabase
      .from("profile_imports")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("profile_facts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const firstError = [importsResult.error, factsResult.error].find(Boolean);

  if (firstError) {
    return emptyProfileEnrichmentSnapshot(
      "error",
      `Profile summary query failed: ${firstError.message}`,
    );
  }

  const imports = (importsResult.data ?? []).filter(
    (row) => row.status !== "deleted",
  );
  const facts = profileFactRowsForSnapshot(factsResult.data ?? []);
  const factCounts = countFactsByImport(facts);

  return {
    source: {
      kind: "supabase",
      status: "connected",
      detail: "Reading profile summary from Supabase.",
    },
    imports: imports.map((row) => {
      const counts = factCounts.get(row.id);
      return {
        id: row.id,
        provider: row.provider,
        method: row.method,
        sourceLabel: row.source_label ?? row.provider,
        status: row.status,
        schemaVersion: row.schema_version,
        factCount: counts?.total ?? 0,
        pendingFactCount: counts?.pending ?? 0,
        approvedFactCount: counts?.approved ?? 0,
        sensitiveFactCount: counts?.sensitive ?? 0,
        createdAt: row.created_at,
        processedAt: row.processed_at,
        errorMessage: row.error_message,
      };
    }),
    facts: facts.map((row) => ({
      id: row.id,
      importId: row.source_import_id,
      dimension: row.dimension,
      factKey: row.fact_key,
      value: jsonToDisplay(row.value_json),
      confidence: row.confidence,
      importance: row.importance,
      sensitivityLevel: row.sensitivity_level,
      matchingEligible: row.matching_eligible,
      evidenceExcerpt: row.evidence_excerpt ?? "",
      reviewState: row.user_review_state,
      createdAt: row.created_at,
    })),
    conflicts: [],
    compatibility: [],
    gaps: [],
  };
}

function getProfileMutationSnapshot(
  supabase: SupabaseServiceClient,
  userId: string,
  mode: ProfileMutationOptions["snapshotMode"] = "full",
) {
  if (mode === "none") {
    return Promise.resolve(null);
  }

  return mode === "summary"
    ? getProfileSummarySnapshotForUser(supabase, userId)
    : getProfileEnrichmentSnapshotForUser(supabase, userId);
}

async function refreshProfileMatchingStateForMutation(
  supabase: SupabaseServiceClient,
  userId: string,
  mode: ProfileMutationOptions["refreshMatchingState"] = true,
) {
  if (mode === false) {
    return;
  }

  if (mode === "deferred") {
    await enqueueProfileMatchingRefresh(supabase, userId);
    revalidateProfileDependentPaths();
    after(async () => {
      try {
        await processQueuedProfileMatchingRefreshJobs(10, supabase);
      } catch (error) {
        console.error("Deferred profile projection queue drain failed", {
          error,
          userId,
        });
      }
    });
    return;
  }

  try {
    await refreshProjectedMatchingStateForUser(supabase, userId);
  } catch (error) {
    await enqueueProfileMatchingRefresh(supabase, userId);
    throw error;
  }
}

async function getProfileEnrichmentSnapshotForUser(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<ProfileEnrichmentSnapshot> {
  const [importsResult, factsResult, conflictsResult, edgesResult] =
    await Promise.all([
      supabase
        .from("profile_imports")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("profile_facts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("profile_fact_conflicts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("compatibility_edges")
        .select("*")
        .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
        .eq("status", "active")
        .order("score", { ascending: false })
        .limit(8),
    ]);

  const firstError = [
    importsResult.error,
    factsResult.error,
    conflictsResult.error,
    edgesResult.error,
  ].find(Boolean);

  if (firstError) {
    return emptyProfileEnrichmentSnapshot(
      "error",
      `Profile enrichment query failed: ${firstError.message}`,
    );
  }

  const imports = (importsResult.data ?? []).filter(
    (row) => row.status !== "deleted",
  );
  const facts = profileFactRowsForSnapshot(factsResult.data ?? []);
  const factCounts = countFactsByImport(facts);
  const compatibility = await mapCompatibilityEdges(
    supabase,
    userId,
    edgesResult.data ?? [],
  );

  return {
    source: {
      kind: "supabase",
      status: "connected",
      detail: "Reading profile enrichment data from Supabase.",
    },
    imports: imports.map((row) => {
      const counts = factCounts.get(row.id);
      return {
        id: row.id,
        provider: row.provider,
        method: row.method,
        sourceLabel: row.source_label ?? row.provider,
        status: row.status,
        schemaVersion: row.schema_version,
        factCount: counts?.total ?? 0,
        pendingFactCount: counts?.pending ?? 0,
        approvedFactCount: counts?.approved ?? 0,
        sensitiveFactCount: counts?.sensitive ?? 0,
        createdAt: row.created_at,
        processedAt: row.processed_at,
        errorMessage: row.error_message,
      };
    }),
    facts: facts.map((row) => ({
      id: row.id,
      importId: row.source_import_id,
      dimension: row.dimension,
      factKey: row.fact_key,
      value: jsonToDisplay(row.value_json),
      confidence: row.confidence,
      importance: row.importance,
      sensitivityLevel: row.sensitivity_level,
      matchingEligible: row.matching_eligible,
      evidenceExcerpt: row.evidence_excerpt ?? "",
      reviewState: row.user_review_state,
      createdAt: row.created_at,
    })),
    conflicts: (conflictsResult.data ?? []).map((row) => ({
      id: row.id,
      importId: row.source_import_id,
      conflictType: row.conflict_type,
      resolutionState: row.resolution_state,
    })),
    compatibility,
    gaps: computeProfileGaps(facts.map((row) => mapFactForScoring(row))),
  };
}

export async function createProfileImportForCurrentUser(args: ImportArgs) {
  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!identity || !user) {
    throw new ApiError("Sign in before importing profile data.", 401);
  }

  await createProfileImportForUser(supabase, user.id, args);
  return getProfileEnrichmentSnapshotForUser(supabase, user.id);
}

export async function createProfileImportForUserId(
  userId: string,
  args: ImportArgs,
  options: Pick<ProfileMutationOptions, "snapshotMode"> = {},
) {
  const supabase = createSupabaseServiceClient();
  const importRow = await createProfileImportForUser(supabase, userId, args);
  return {
    import: importRow,
    snapshot: await getProfileMutationSnapshot(
      supabase,
      userId,
      options.snapshotMode,
    ),
  };
}

export async function syncMatchingSetupFactsForUserId(
  userId: string,
  patch: MatchingSetupFactPatch,
) {
  const slots = matchingSetupSlotsForPatch(patch);
  if (slots.size === 0) {
    return;
  }

  const supabase = createSupabaseServiceClient();
  const profile = await getLatestMatchingProfile(supabase, userId);
  const { facts, revokeKeys } = matchingSetupFactsFromProfile(profile, slots);
  await applyWebPreferenceEdit(supabase, userId, revokeKeys, facts);
}

export async function applyProfileSlotEditForUserId(
  userId: string,
  args: ProfileSlotEditArgs,
  options: ProfileMutationOptions = {},
) {
  const supabase = createSupabaseServiceClient();
  await applyProfileSlotEdit(supabase, userId, args, options);
  return getProfileMutationSnapshot(supabase, userId, options.snapshotMode);
}

// Applies a web profile-editor edit for a preference slot. Prior facts for the
// given keys are superseded (revoked) so the explicit edit is the only active
// value, then the new facts are written through the normal extraction → approve
// → project → recompute pipeline. Revoked facts are excluded from
// reconciliation, so re-selecting any value (even a previous one) reliably takes
// effect. Passing no facts clears the slot. The "web" provider is a projection
// override, symmetric to the SMS transports, so web and conversation edits stay
// consistent — the most recent edit wins.
async function applyWebPreferenceEdit(
  supabase: SupabaseServiceClient,
  userId: string,
  revokeKeys: string[],
  facts: Array<Record<string, Json>>,
) {
  await applyProfileSlotEdit(
    supabase,
    userId,
    {
      facts,
      method: "system",
      payload: {
        source: "profile_editor",
        recorded_at: new Date().toISOString(),
        profile_facts: facts,
      },
      provider: "web",
      revokeKeys,
      sourceLabel: "Profile editor",
    },
    { refreshMatchingState: "deferred" },
  );
}

async function applyProfileSlotEdit(
  supabase: SupabaseServiceClient,
  userId: string,
  {
    facts,
    method = "system",
    payload,
    provider,
    revokeKeys,
    sourceLabel,
  }: ProfileSlotEditArgs,
  options: ProfileMutationOptions = {},
) {
  const revoked = await supabase
    .from("profile_facts")
    .update({ user_review_state: "revoked", matching_eligible: false })
    .eq("user_id", userId)
    .in("fact_key", revokeKeys)
    .in("user_review_state", ["pending", "approved", "edited"]);

  if (revoked.error) {
    throw revoked.error;
  }

  if (facts.length === 0) {
    // Cleared the slot: reproject and rescore without the revoked facts.
    await refreshProfileMatchingStateForMutation(
      supabase,
      userId,
      options.refreshMatchingState,
    );
    return;
  }

  const importRow = await createProfileImportForUser(supabase, userId, {
    method,
    payload:
      payload ?? {
        source: "profile_slot_edit",
        recorded_at: new Date().toISOString(),
        profile_facts: facts,
      },
    provider,
    sourceLabel,
  });

  await reviewProfileImport(supabase, userId, importRow.id, "approve_all", options);
}

function matchingSetupSlotsForPatch(patch: MatchingSetupFactPatch) {
  const slots = new Set<"budget" | "move_in" | "household_size">();

  if (patch.budgetMin !== undefined || patch.budgetMax !== undefined) {
    slots.add("budget");
  }
  if (patch.moveInStart !== undefined || patch.moveInEnd !== undefined) {
    slots.add("move_in");
  }
  if (
    patch.householdSizeMin !== undefined ||
    patch.householdSizeMax !== undefined
  ) {
    slots.add("household_size");
  }

  return slots;
}

function matchingSetupFactsFromProfile(
  profile: TableRow<"matching_profiles"> | null,
  slots: Set<"budget" | "move_in" | "household_size">,
) {
  const facts: Array<Record<string, Json>> = [];
  const revokeKeys: string[] = [];

  if (slots.has("budget")) {
    revokeKeys.push("budget", "budget_min", "budget_max");
    const min = positiveIntegerOrNull(profile?.budget_min ?? null);
    const max = positiveIntegerOrNull(profile?.budget_max ?? null);

    if (min != null && max != null) {
      facts.push(webPreferenceFact("budget", { min, max }));
    } else if (min != null) {
      facts.push(webPreferenceFact("budget_min", min));
    } else if (max != null) {
      facts.push(webPreferenceFact("budget_max", max));
    }
  }

  if (slots.has("move_in")) {
    revokeKeys.push("move_in_window");
    const start = isoDateOrNull(profile?.move_in_start ?? null);
    const end = isoDateOrNull(profile?.move_in_end ?? null);

    if (start || end) {
      facts.push(
        webPreferenceFact("move_in_window", {
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
        }),
      );
    }
  }

  if (slots.has("household_size")) {
    revokeKeys.push("household_size", "group_size_flexibility");
    const min = positiveIntegerOrNull(profile?.household_size_min ?? null);
    const max = positiveIntegerOrNull(profile?.household_size_max ?? null);
    const household = householdOpennessValue(min, max);

    if (household) {
      facts.push(webPreferenceFact("household_size", household));
    }
  }

  return {
    facts,
    revokeKeys: [...new Set(revokeKeys)],
  };
}

function positiveIntegerOrNull(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function householdOpennessValue(
  min: number | null,
  max: number | null,
): { min: number; max: number } | null {
  const upper = max ?? min;
  if (upper == null) {
    return null;
  }
  if (upper <= 1) {
    return { min: 1, max: 1 };
  }

  return { min: 2, max: upper };
}

function isoDateOrNull(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

function webPreferenceFact(factKey: string, value: Json): Record<string, Json> {
  return {
    fact_key: factKey,
    value,
    assertion_type: "user_confirmed",
    confidence: 0.97,
    sensitivity_level: "standard",
    evidence: "Set in the Kinfolk profile editor",
  };
}

// Records an explicit web choice for a single-value structured preference (the
// value must be a canonical token for the key). Returns the updated snapshot.
export async function saveStructuredPreferenceForCurrentUser(
  factKey: string,
  value: string,
) {
  if (!isWebEditablePreferenceKey(factKey)) {
    throw new ApiError("Unsupported preference field.");
  }
  const options = structuredFactOptions(factKey) ?? [];
  if (!options.includes(value)) {
    throw new ApiError("Unsupported preference value.");
  }

  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);
  if (!identity || !user) {
    throw new ApiError("Sign in before updating preferences.", 401);
  }

  await applyWebPreferenceEdit(supabase, user.id, [factKey], [
    webPreferenceFact(factKey, value),
  ]);
  return getProfileEnrichmentSnapshotForUser(supabase, user.id);
}

// Records an explicit web edit for an additive free-text list preference
// (neighborhoods, must_haves, dealbreakers). The full current list is written as
// one fact, mirroring how the SMS agent updates these — so the conversation
// agent can still edit them afterwards. An empty list clears the slot.
export async function saveListPreferenceForCurrentUser(
  factKey: string,
  values: string[],
) {
  if (!isWebEditableListKey(factKey)) {
    throw new ApiError("Unsupported preference field.");
  }

  const capped = normalizeEditablePreferenceList(values);

  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);
  if (!identity || !user) {
    throw new ApiError("Sign in before updating preferences.", 401);
  }

  await applyWebPreferenceEdit(
    supabase,
    user.id,
    [factKey],
    capped.length > 0 ? [webPreferenceFact(factKey, capped)] : [],
  );
  return getProfileEnrichmentSnapshotForUser(supabase, user.id);
}

async function createProfileImportForUser(
  supabase: SupabaseServiceClient,
  userId: string,
  args: ImportArgs,
) {
  const normalized =
    typeof args.payload === "string"
      ? parseProfileImportText(args.payload)
      : normalizeProfileImportPayload(args.payload);

  const existing = await supabase
    .from("profile_imports")
    .select("*")
    .eq("user_id", userId)
    .eq("payload_hash", normalized.payloadHash)
    .neq("status", "deleted")
    .neq("status", "failed")
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data) {
    if (existing.data.status === "approved") {
      try {
        await refreshProfileMatchingStateForMutation(supabase, userId, "deferred");
      } catch (error) {
        console.error("Existing profile import refresh enqueue failed", {
          error,
          importId: existing.data.id,
          userId,
        });
      }
    }
    return existing.data;
  }

  const now = new Date().toISOString();
  const importMetadata = extractProfileImportMetadata(normalized.payload);
  const importResult = await supabase
    .from("profile_imports")
    .insert({
      user_id: userId,
      provider: args.provider,
      method: args.method,
      source_label: args.sourceLabel ?? null,
      status: "processed",
      raw_payload: normalized.payload,
      payload_hash: normalized.payloadHash,
      schema_version: "profile-import-v1",
      import_metadata: importMetadata as Json,
      consent_recorded_at: now,
      processed_at: now,
      error_message: null,
    })
    .select("*")
    .single();

  if (importResult.error) {
    throw importResult.error;
  }

  const importRow = importResult.data;

  let insertedFacts: TableRow<"profile_facts">[] = [];
  let duplicateMatches: ReturnType<
    typeof reconcileProfileFactImport
  >["duplicateMatches"] = [];
  let statusRow = importRow;

  try {
    const extractedFacts = await normalizeMapboxLocationFacts(
      filterFactsForImportProvider(
        extractProfileFacts(normalized.payload),
        args.provider,
      ),
    );
    await normalizeStoredHometownFactsForUser(supabase, userId);
    const reconciledFacts = reconcileProfileFactImport(
      extractedFacts,
      await loadProfileFactsForImportReconciliation(supabase, userId),
    );
    duplicateMatches = reconciledFacts.duplicateMatches;
    const insertCandidates = reconciledFacts.factsToInsert.map((candidate) => ({
      fact: candidate.fact,
      reviewState: reviewStateForImportedProfileFact(candidate, args.provider),
    }));
    insertedFacts = await insertProfileFacts(
      supabase,
      userId,
      importRow.id,
      insertCandidates,
    );
    await insertProfileConflicts(
      supabase,
      userId,
      importRow.id,
      insertCandidates.map((candidate) => candidate.fact),
      insertedFacts,
    );
    await insertCrossImportConflicts(
      supabase,
      userId,
      importRow.id,
      reconciledFacts.factsToInsert,
      insertedFacts,
    );
    const statusResult = await supabase
      .from("profile_imports")
      .update({
        status: importStatusForInsertedFacts(insertedFacts),
      })
      .eq("id", importRow.id)
      .select("*")
      .single();

    if (statusResult.error) {
      throw statusResult.error;
    }

    statusRow = statusResult.data;
  } catch (error) {
    const message = readableProfileImportError(error);
    const rejectedFacts = await supabase
      .from("profile_facts")
      .update({ user_review_state: "rejected", matching_eligible: false })
      .eq("source_import_id", importRow.id)
      .eq("user_id", userId)
      .in("user_review_state", ["pending", "approved", "edited"]);
    const failedImport = await supabase
      .from("profile_imports")
      .update({ status: "failed", error_message: message })
      .eq("id", importRow.id);
    if (rejectedFacts.error) {
      console.error("Failed to quarantine partially imported profile facts", {
        error: rejectedFacts.error,
        importId: importRow.id,
        userId,
      });
    }
    if (failedImport.error) {
      console.error("Failed to mark profile import failed", {
        error: failedImport.error,
        importId: importRow.id,
        userId,
      });
    }
    throw error;
  }

  let didAutoApproveCorroboration = false;
  try {
    const corroboration = await applyDuplicateFactCorroboration(
      supabase,
      userId,
      duplicateMatches,
      args.provider,
    );
    didAutoApproveCorroboration = corroboration.didAutoApprove;
    await Promise.all(
      corroboration.affectedImportIds.map((importId) =>
        syncProfileImportStatus(supabase, userId, importId),
      ),
    );
  } catch (error) {
    console.error("Profile import corroboration update failed", {
      error,
      importId: importRow.id,
      userId,
    });
  }

  if (
    didAutoApproveCorroboration ||
    insertedFacts.some((fact) =>
      ["approved", "edited"].includes(fact.user_review_state),
    )
  ) {
    try {
      await refreshProfileMatchingStateForMutation(supabase, userId, "deferred");
    } catch (error) {
      console.error("Profile import refresh enqueue failed", {
        error,
        importId: importRow.id,
        userId,
      });
    }
  }

  return statusRow;
}

function readableProfileImportError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function normalizeMapboxLocationFacts(
  facts: ExtractedProfileFact[],
): Promise<ExtractedProfileFact[]> {
  const normalized = await Promise.all(
    facts.map(async (fact) => {
      if (resolveCanonicalFactKey(fact.factKey) !== "hometown") {
        return fact;
      }

      if (typeof fact.value !== "string") {
        return null;
      }

      try {
        const label = await normalizeMapboxLocationValue(fact.value, {
          allowTopTextMatch: true,
        });
        if (!label) {
          return null;
        }
        return {
          ...fact,
          value: label,
          normalizedValue: label.toLowerCase(),
        };
      } catch {
        return null;
      }
    }),
  );

  return normalized.filter((fact): fact is ExtractedProfileFact => fact !== null);
}

async function normalizeStoredHometownFactsForUser(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("profile_facts")
    .select("id,value_json,normalized_value")
    .eq("user_id", userId)
    .eq("fact_key", "hometown")
    .in("user_review_state", ["pending", "approved", "edited"]);

  if (result.error) {
    throw result.error;
  }

  for (const row of result.data ?? []) {
    if (typeof row.value_json !== "string") {
      continue;
    }

    const displayLabel = normalizeMapboxLocationLabel(row.value_json);
    if (
      displayLabel &&
      displayLabel === row.value_json &&
      row.normalized_value === displayLabel.toLowerCase()
    ) {
      continue;
    }

    let label: string | null;
    try {
      label = await normalizeMapboxLocationValue(row.value_json, {
        allowTopTextMatch: true,
      });
    } catch {
      // Leave legacy/raw rows untouched if Mapbox cannot confidently resolve them.
      continue;
    }

    if (!label) {
      continue;
    }

    const update = await supabase
      .from("profile_facts")
      .update({
        value_json: label,
        normalized_value: label.toLowerCase(),
      })
      .eq("id", row.id)
      .eq("user_id", userId);

    if (update.error) {
      throw update.error;
    }
  }
}

export async function reviewProfileImportMutationForCurrentUser(
  importId: string,
  action: "approve_all" | "reject_all",
  options: ProfileMutationOptions = {},
): Promise<ProfileMutationResult> {
  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!identity || !user) {
    throw new ApiError("Sign in before reviewing profile imports.", 401);
  }

  await reviewProfileImport(supabase, user.id, importId, action, options);
  return {
    snapshot: await getProfileMutationSnapshot(
      supabase,
      user.id,
      options.snapshotMode,
    ),
    userId: user.id,
  };
}

export async function reviewProfileImportForUserId(
  userId: string,
  importId: string,
  action: "approve_all" | "reject_all",
  options: ProfileMutationOptions = {},
) {
  const supabase = createSupabaseServiceClient();
  await reviewProfileImport(supabase, userId, importId, action, options);
  return getProfileMutationSnapshot(supabase, userId, options.snapshotMode);
}

async function reviewProfileImport(
  supabase: SupabaseServiceClient,
  userId: string,
  importId: string,
  action: "approve_all" | "reject_all",
  options: ProfileMutationOptions = {},
) {
  const importResult = await supabase
    .from("profile_imports")
    .select("*")
    .eq("id", importId)
    .eq("user_id", userId)
    .single();

  if (importResult.error) {
    throw importResult.error;
  }

  if (action === "reject_all") {
    const rejected = await supabase
      .from("profile_facts")
      .update({ user_review_state: "rejected", matching_eligible: false })
      .eq("source_import_id", importId)
      .eq("user_id", userId);

    if (rejected.error) {
      throw rejected.error;
    }

    await syncProfileImportStatus(supabase, userId, importId);
    await refreshProfileMatchingStateForMutation(supabase, userId, options.refreshMatchingState);
    return;
  }

  const approved = await supabase
    .from("profile_facts")
    .update({ user_review_state: "approved", matching_eligible: true })
    .eq("source_import_id", importId)
    .eq("user_id", userId)
    .eq("sensitivity_level", "standard")
    .in("user_review_state", ["pending", "edited", "revoked"]);

  if (approved.error) {
    throw approved.error;
  }

  const quarantined = await supabase
    .from("profile_facts")
    .update({ user_review_state: "rejected", matching_eligible: false })
    .eq("source_import_id", importId)
    .eq("user_id", userId)
    .neq("sensitivity_level", "standard");

  if (quarantined.error) {
    throw quarantined.error;
  }

  await syncProfileImportStatus(supabase, userId, importId);
  await refreshProfileMatchingStateForMutation(supabase, userId, options.refreshMatchingState);
}

async function syncProfileImportStatus(
  supabase: SupabaseServiceClient,
  userId: string,
  importId: string,
) {
  const facts = await supabase
    .from("profile_facts")
    .select("user_review_state")
    .eq("source_import_id", importId)
    .eq("user_id", userId);

  if (facts.error) {
    throw facts.error;
  }

  const status = profileImportStatusForFactReviewStates(
    (facts.data ?? []).map((fact) => fact.user_review_state),
  );
  const updated = await supabase
    .from("profile_imports")
    .update({ error_message: null, status })
    .eq("id", importId)
    .eq("user_id", userId);

  if (updated.error) {
    throw updated.error;
  }

  return status;
}

export async function updateProfileFactMutationForCurrentUser(
  factId: string,
  patch: FactPatch,
  options: ProfileMutationOptions = {},
): Promise<ProfileMutationResult> {
  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!identity || !user) {
    throw new ApiError("Sign in before editing profile facts.", 401);
  }

  await updateProfileFact(supabase, user.id, factId, patch);
  await refreshProfileMatchingStateForMutation(supabase, user.id, options.refreshMatchingState);
  return {
    snapshot: await getProfileMutationSnapshot(
      supabase,
      user.id,
      options.snapshotMode,
    ),
    userId: user.id,
  };
}

async function updateProfileFact(
  supabase: SupabaseServiceClient,
  userId: string,
  factId: string,
  patch: FactPatch,
) {
  const current = await supabase
    .from("profile_facts")
    .select("*")
    .eq("id", factId)
    .eq("user_id", userId)
    .single();

  if (current.error) {
    throw current.error;
  }

  const update: Partial<TableRow<"profile_facts">> = {};

  if (patch.value !== undefined) {
    const value = normalizeProfileImportPayload({ value: patch.value }).payload;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError("Fact value must be JSON-compatible.");
    }
    const nextValue = value.value ?? null;
    update.value_json = nextValue;
    update.normalized_value =
      typeof nextValue === "string"
        ? nextValue.toLowerCase().trim()
        : jsonToDisplay(nextValue).toLowerCase();
    update.user_review_state = "edited";
  }

  if (patch.reviewState) {
    update.user_review_state = patch.reviewState;
    update.matching_eligible =
      ["approved", "edited"].includes(patch.reviewState) &&
      current.data.sensitivity_level === "standard";
  }

  if (patch.reviewNote !== undefined) {
    update.review_note = patch.reviewNote;
  }

  if (Object.keys(update).length === 0) {
    return;
  }

  const result = await supabase
    .from("profile_facts")
    .update(update)
    .eq("id", factId)
    .eq("user_id", userId);

  if (result.error) {
    throw result.error;
  }

  await syncProfileImportStatus(
    supabase,
    userId,
    current.data.source_import_id,
  );
}

export async function deleteProfileImportForCurrentUser(importId: string) {
  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!identity || !user) {
    throw new ApiError("Sign in before deleting profile imports.", 401);
  }

  await deleteProfileImport(supabase, user.id, importId);
  return getProfileEnrichmentSnapshotForUser(supabase, user.id);
}

async function deleteProfileImport(
  supabase: SupabaseServiceClient,
  userId: string,
  importId: string,
) {
  const revoked = await supabase
    .from("profile_facts")
    .update({ user_review_state: "revoked", matching_eligible: false })
    .eq("user_id", userId)
    .eq("source_import_id", importId);

  if (revoked.error) {
    throw revoked.error;
  }

  const importResult = await supabase
    .from("profile_imports")
    .update({ status: "deleted" })
    .eq("id", importId)
    .eq("user_id", userId);

  if (importResult.error) {
    throw importResult.error;
  }

  await refreshProjectedMatchingStateForUser(supabase, userId);
}

async function refreshProjectedMatchingStateForUser(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  await projectApprovedFacts(supabase, userId);
  await recomputeCompatibilityForUser(supabase, userId);
}

async function enqueueProfileMatchingRefresh(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase.rpc("enqueue_profile_matching_refresh", {
    p_user_id: userId,
  });

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

export type ProfileMatchingRefreshQueueResult = {
  claimed: number;
  completed: number;
  failed: number;
  retrying: number;
  userIds: string[];
};

export async function processQueuedProfileMatchingRefreshJobs(
  requestedLimit = 25,
  suppliedClient?: SupabaseServiceClient,
): Promise<ProfileMatchingRefreshQueueResult> {
  const supabase = suppliedClient ?? createSupabaseServiceClient();
  const limit = Math.max(1, Math.min(200, Math.trunc(requestedLimit) || 25));
  const claimed = await supabase.rpc("claim_profile_matching_refresh_jobs", {
    p_limit: limit,
  });

  if (claimed.error) {
    throw claimed.error;
  }

  const jobs = claimed.data ?? [];
  const outcomes = await mapWithConcurrency(
    jobs,
    PROFILE_MATCHING_REFRESH_CONCURRENCY,
    async (job) => {
      try {
        await refreshProjectedMatchingStateForUser(supabase, job.user_id);
        const completedAt = new Date().toISOString();
        const completed = await supabase
          .from("profile_matching_refresh_jobs")
          .update({
            completed_at: completedAt,
            last_error: null,
            locked_at: null,
            next_attempt_at: completedAt,
            status: "succeeded",
          })
          .eq("user_id", job.user_id)
          .eq("status", "running")
          .eq("requested_at", job.requested_at);

        if (completed.error) {
          throw completed.error;
        }

        return { status: "completed" as const, userId: job.user_id };
      } catch (error) {
        const terminal = job.attempt_count >= PROFILE_MATCHING_REFRESH_MAX_ATTEMPTS;
        const retryDelayMs = Math.min(
          30 * 60_000,
          60_000 * 2 ** Math.max(0, job.attempt_count - 1),
        );
        const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
        const lastError = readableProfileImportError(error).slice(0, 1000);
        const failed = await supabase
          .from("profile_matching_refresh_jobs")
          .update({
            completed_at: null,
            last_error: lastError,
            locked_at: null,
            next_attempt_at: retryAt,
            status: terminal ? "failed" : "queued",
          })
          .eq("user_id", job.user_id)
          .eq("status", "running")
          .eq("requested_at", job.requested_at);

        if (failed.error) {
          console.error("Profile matching refresh retry update failed", {
            error: failed.error,
            userId: job.user_id,
          });
        }

        console.error("Profile matching refresh job failed", {
          attemptCount: job.attempt_count,
          error,
          terminal,
          userId: job.user_id,
        });
        return {
          status: terminal ? ("failed" as const) : ("retrying" as const),
          userId: job.user_id,
        };
      }
    },
  );

  const userIds = outcomes
    .filter((outcome) => outcome.status === "completed")
    .map((outcome) => outcome.userId);
  if (userIds.length > 0) {
    revalidateProfileDependentPaths();
  }

  return {
    claimed: jobs.length,
    completed: userIds.length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    retrying: outcomes.filter((outcome) => outcome.status === "retrying").length,
    userIds,
  };
}

async function loadProfileFactsForImportReconciliation(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("profile_facts")
    .select("*")
    .eq("user_id", userId)
    .in("user_review_state", ["pending", "approved", "edited"]);

  if (result.error) {
    throw result.error;
  }

  const sourceImportIds = Array.from(
    new Set(
      (result.data ?? []).flatMap((row) =>
        row.source_import_id ? [row.source_import_id] : [],
      ),
    ),
  );
  const providerByImportId = await loadProfileImportProviderMap(
    supabase,
    sourceImportIds,
  );

  return (result.data ?? []).flatMap((row) =>
    isInformativeProfileFactRow(row)
      ? [
          mapFactForScoring(
            row,
            row.source_import_id ? providerByImportId.get(row.source_import_id) : null,
          ),
        ]
      : [],
  );
}

async function loadProfileImportProviderMap(
  supabase: SupabaseServiceClient,
  importIds: string[],
) {
  const providerById = new Map<string, ProfileImportProvider | string | null>();
  if (importIds.length === 0) {
    return providerById;
  }

  const result = await supabase
    .from("profile_imports")
    .select("id,provider")
    .in("id", importIds);

  if (result.error) {
    throw result.error;
  }

  for (const row of result.data ?? []) {
    providerById.set(row.id, row.provider);
  }

  return providerById;
}

async function applyDuplicateFactCorroboration(
  supabase: SupabaseServiceClient,
  userId: string,
  duplicateMatches: ReturnType<typeof reconcileProfileFactImport>["duplicateMatches"],
  incomingProvider: ProfileImportProvider,
): Promise<{ affectedImportIds: string[]; didAutoApprove: boolean }> {
  const strongestByFactId = new Map<
    string,
    { confidence: number; importance: number; autoApprove: boolean }
  >();
  let didAutoApprove = false;
  const affectedImportIds = new Set<string>();

  for (const match of duplicateMatches) {
    const factId = match.existingFact.id;
    if (!factId || factId.startsWith("incoming:")) {
      continue;
    }

    const current = strongestByFactId.get(factId) ?? {
      confidence: match.existingFact.confidence,
      importance: match.existingFact.importance,
      autoApprove: false,
    };
    const combinedConfidence = Math.max(
      current.confidence,
      match.fact.confidence,
    );
    const autoApprove =
      current.autoApprove ||
      shouldAutoApproveCrossProviderCorroboration(
        match.existingFact,
        match.fact,
        incomingProvider,
      );

    if (autoApprove) {
      didAutoApprove = true;
      if (match.existingFact.sourceImportId) {
        affectedImportIds.add(match.existingFact.sourceImportId);
      }
    }

    strongestByFactId.set(factId, {
      confidence: combinedConfidence,
      importance: Math.max(current.importance, match.fact.importance),
      autoApprove,
    });
  }

  const updateResults = await Promise.all(
    [...strongestByFactId].map(([factId, values]) =>
      supabase
        .from("profile_facts")
        .update({
          confidence: values.confidence,
          importance: values.importance,
          ...(values.autoApprove
            ? { user_review_state: "approved", matching_eligible: true }
            : {}),
        })
        .eq("id", factId)
        .eq("user_id", userId),
    ),
  );

  for (const result of updateResults) {
    if (result.error) {
      throw result.error;
    }
  }

  return {
    affectedImportIds: [...affectedImportIds],
    didAutoApprove,
  };
}

export async function recomputeCompatibilityForUserId(userId: string) {
  const { snapshot } = await recomputeCompatibilityForUserIdWithStatus(userId);
  return snapshot;
}

export async function recomputeCompatibilityForUserIdWithStatus(userId: string) {
  const normalizedUserId = readRequiredProfileUserId(userId);
  const supabase = createSupabaseServiceClient();
  const result = await recomputeCompatibilityForUser(supabase, normalizedUserId);
  return {
    result,
    snapshot: await getProfileEnrichmentSnapshotForUser(supabase, normalizedUserId),
  };
}

export async function dryRunMatchingDerivedStateForUserId(
  userId: string,
): Promise<ProfileCompatibilityDryRunResult> {
  const normalizedUserId = readRequiredProfileUserId(userId);
  const supabase = createSupabaseServiceClient();
  const result = await recomputeCompatibilityForUser(supabase, normalizedUserId, {
    dryRun: true,
  });
  if (!("dryRun" in result)) {
    throw new Error("Profile compatibility dry-run did not return a result.");
  }
  return result;
}

function readRequiredProfileUserId(userId: string) {
  const normalized = userId.trim();
  if (!normalized) {
    throw new Error("Profile compatibility user id is required.");
  }
  return normalized;
}

async function recomputeCompatibilityForUser(
  supabase: SupabaseServiceClient,
  userId: string,
  options: { dryRun?: boolean } = {},
): Promise<ProfileCompatibilityDryRunResult | ProfileCompatibilityRecomputeResult> {
  const dryRun = options.dryRun === true;
  const [currentUserResult, currentFactsByUser] = await Promise.all([
    supabase.from("kinfolk_users").select("*").eq("id", userId).maybeSingle(),
    loadScoringFactsForUsers(supabase, [userId]),
  ]);

  if (currentUserResult.error) {
    throw currentUserResult.error;
  }

  const currentUser = currentUserResult.data;
  if (!currentUser) {
    if (dryRun) {
      return {
        dryRun: true,
        edgeCandidates: 0,
        rerankedCandidates: 0,
        retrievedCandidates: 0,
        staleEdgeCandidates: 0,
        status: "missing_user",
        userId,
      };
    }
    return {
      status: "missing_user",
      userId,
    };
  }

  const currentFacts = currentFactsByUser.get(userId)?.facts ?? [];

  if (currentFacts.length === 0) {
    const computedAt = new Date().toISOString();
    if (dryRun) {
      const staleEdgeCandidates = await markDroppedCompatibilityEdgesStale(
        supabase,
        userId,
        [],
        computedAt,
        { dryRun: true },
      );
      return {
        dryRun: true,
        edgeCandidates: 0,
        rerankedCandidates: 0,
        retrievedCandidates: 0,
        staleEdgeCandidates,
        status: "empty",
        userId,
      };
    }

    const staleEdges = await supabase
      .from("compatibility_edges")
      .update({ status: "stale", computed_at: computedAt })
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

    if (staleEdges.error) {
      throw staleEdges.error;
    }

    return {
      status: "empty",
      userId,
    };
  }

  try {
    await upsertProfileEmbeddingForUser(supabase, userId, dryRun ? { dryRun } : {});
  } catch (error) {
    console.warn("Profile embedding refresh failed; using rules-only fallback.", {
      error,
      userId,
    });
  }

  const retrievalLimit = matchRetrievalLimit();
  const rerankLimit = matchRerankLimit();
  const retrievedCandidates = await retrieveCompatibilityCandidateIds(supabase, {
    currentFacts,
    minCosine: matchMinCosine(),
    retrievalLimit,
    userId,
  });
  const candidateIds = retrievedCandidates.map((candidate) => candidate.userId);
  const candidateFactsByUser =
    candidateIds.length > 0
      ? await loadScoringFactsForUsers(supabase, candidateIds)
      : new Map<string, { displayName: string; facts: ProfileFactForScoring[] }>();
  const metadataByUser = new Map(
    retrievedCandidates.map((candidate) => [candidate.userId, candidate]),
  );
  const candidates = candidateIds
    .map((candidateId) => {
      const entry = candidateFactsByUser.get(candidateId);
      const metadata = metadataByUser.get(candidateId);
      if (!entry || entry.facts.length === 0) {
        return null;
      }

      return {
        cosineSimilarity: metadata?.cosineSimilarity ?? null,
        displayName: entry.displayName,
        facts: entry.facts,
        semanticRank: metadata?.semanticRank ?? null,
        userId: candidateId,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    );

  // Batch-load saved places for the viewer + all candidates (ONE query, not per-candidate).
  const allIds = [userId, ...candidates.map((c) => c.userId)];
  const savedPlacesByUser = await loadSavedPlacesForUsers(supabase, allIds);
  const viewerSaved = savedPlacesByUser.get(userId) ?? { savedAreaLabels: [], savedListingIds: [] };
  const savedOverlapByUserId = new Map(
    candidates.map((c) => {
      const candidateSaved = savedPlacesByUser.get(c.userId) ?? { savedAreaLabels: [], savedListingIds: [] };
      return [
        c.userId,
        {
          sharedAreaCount: countSavedAreaOverlap(viewerSaved.savedAreaLabels, candidateSaved.savedAreaLabels),
          sharedListingCount: countSavedListingOverlap(viewerSaved.savedListingIds, candidateSaved.savedListingIds),
        },
      ];
    }),
  );

  const rankedCandidates = rerankCompatibilityCandidates(
    {
      displayName: currentUser.display_name,
      facts: currentFacts,
      userId,
    },
    candidates,
    rerankLimit,
    savedOverlapByUserId,
  );
  const computedAt = new Date().toISOString();
  const edgeRows = rankedCandidates.map((candidate) => {
    const [userAId, userBId] = [userId, candidate.userId].sort();

    return {
      computed_at: computedAt,
      evidence: candidate.score.evidence,
      risks: candidate.score.risks,
      score: candidate.score.score,
      score_components: foldScoreMetaIntoComponents(candidate.score),
      status: "active",
      user_a_id: userAId,
      user_b_id: userBId,
    };
  });

  if (edgeRows.length > 0 && !dryRun) {
    const result = await supabase
      .from("compatibility_edges")
      .upsert(edgeRows, { onConflict: "user_a_id,user_b_id" });
    if (result.error) {
      throw result.error;
    }
  }

  const staleEdgeCandidates = await markDroppedCompatibilityEdgesStale(
    supabase,
    userId,
    rankedCandidates.map((candidate) => candidate.userId),
    computedAt,
    { dryRun },
  );

  if (process.env.KINFOLK_MATCH_DEBUG === "true") {
    console.info("kinfolk.compatibility.recompute", {
      candidateCount: retrievedCandidates.length,
      rerankedCount: rankedCandidates.length,
      retrievalLimit,
      userId,
    });
  }

  if (dryRun) {
    return {
      dryRun: true,
      edgeCandidates: edgeRows.length,
      rerankedCandidates: rankedCandidates.length,
      retrievedCandidates: retrievedCandidates.length,
      staleEdgeCandidates,
      status: "computed",
      userId,
    };
  }

  return {
    status: "computed",
    userId,
  };
}

// Assemble the full scoring fact set for a set of users, the same way
// `recomputeCompatibilityForUser` does for the current user and candidates:
// approved/edited profile_facts plus derived facts from the user row, matching
// profile, and roommate preferences.
async function loadScoringFactsForUsers(
  supabase: SupabaseServiceClient,
  userIds: string[],
): Promise<Map<string, { displayName: string; facts: ProfileFactForScoring[] }>> {
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  const out = new Map<string, { displayName: string; facts: ProfileFactForScoring[] }>();
  if (ids.length === 0) return out;

  const [usersResult, factsResult, profilesResult, preferencesResult] = await Promise.all([
    supabase.from("kinfolk_users").select("*").in("id", ids),
    supabase
      .from("profile_facts")
      .select("*")
      .in("user_id", ids)
      .eq("matching_eligible", true)
      .in("user_review_state", ["approved", "edited"]),
    supabase
      .from("matching_profiles")
      .select("*")
      .in("user_id", ids)
      .order("updated_at", { ascending: false }),
    supabase
      .from("roommate_preferences")
      .select("*")
      .in("user_id", ids)
      .order("updated_at", { ascending: false }),
  ]);

  const firstError = [
    usersResult.error,
    factsResult.error,
    profilesResult.error,
    preferencesResult.error,
  ].find(Boolean);
  if (firstError) throw firstError;

  const users = usersResult.data ?? [];
  const profileByUser = latestMatchingProfileByUser(profilesResult.data ?? []);
  const preferenceByUser = latestRoommatePreferenceByUser(preferencesResult.data ?? []);
  const factsByUser = groupFactsByUser([
    ...(factsResult.data ?? []).flatMap((row) =>
      isInformativeProfileFactRow(row) ? [mapFactForScoring(row)] : [],
    ),
    ...users.flatMap((user) => profileFactsForCompatibilityScoring(user)),
    ...users.flatMap((user) =>
      matchingProfileFactsForCompatibilityScoring(profileByUser.get(user.id) ?? null),
    ),
    ...users.flatMap((user) =>
      roommatePreferenceFactsForCompatibilityScoring(
        preferenceByUser.get(user.id) ?? null,
      ),
    ),
  ]);

  for (const user of users) {
    out.set(user.id, {
      displayName: user.display_name,
      facts: factsByUser.get(user.id) ?? [],
    });
  }
  return out;
}

/**
 * Ensure an active compatibility edge exists between `viewerId` and each
 * `candidateId`, computing and persisting any that are missing, then returning
 * the viewer↔candidate scores (existing + freshly computed).
 *
 * The nightly recompute only scores a user's retrieved candidate set, so a
 * prospective roommate the viewer is browsing in the group-join flow often has
 * no edge — leaving the fit score blank. This fills that gap on demand and
 * caches the result. Best-effort: any failure returns what we have so the join
 * flow still renders.
 */

export async function ensureCompatibilityEdgesForPairs(
  supabase: SupabaseServiceClient,
  viewerId: string,
  candidateIds: string[],
): Promise<{ userAId: string; userBId: string; score: number; reasons: string[] }[]> {
  const targets = Array.from(new Set(candidateIds)).filter(
    (id) => id && id !== viewerId,
  );
  if (targets.length === 0) return [];

  try {
    const existingResult = await supabase
      .from("compatibility_edges")
      .select("user_a_id,user_b_id,score,evidence")
      .eq("status", "active")
      .or(`user_a_id.eq.${viewerId},user_b_id.eq.${viewerId}`);
    if (existingResult.error) throw existingResult.error;

    const targetSet = new Set(targets);
    const byOther = new Map<string, { score: number; reasons: string[] }>();
    for (const edge of existingResult.data ?? []) {
      const other = edge.user_a_id === viewerId ? edge.user_b_id : edge.user_a_id;
      if (targetSet.has(other)) {
        byOther.set(other, {
          score: Number(edge.score),
          reasons: topReasonLabels(edge.evidence),
        });
      }
    }

    const missing = targets.filter((id) => !byOther.has(id));
    if (missing.length > 0) {
      const factsByUser = await loadScoringFactsForUsers(supabase, [viewerId, ...missing]);
      const viewer = factsByUser.get(viewerId);
      // No eligible facts on the viewer → nothing to score against; the join
      // flow falls back to its low-data state.
      if (viewer && viewer.facts.length > 0) {
        // Batch-load saved places ONCE for viewer + candidates (no N+1).
        const missingSavedPlaces = await loadSavedPlacesForUsers(supabase, [viewerId, ...missing]);
        const missingViewerSaved = missingSavedPlaces.get(viewerId) ?? { savedAreaLabels: [], savedListingIds: [] };
        const computedAt = new Date().toISOString();
        const edgeRows = [];
        for (const candidateId of missing) {
          const candidate = factsByUser.get(candidateId);
          if (!candidate || candidate.facts.length === 0) continue;
          const candidateSaved = missingSavedPlaces.get(candidateId) ?? { savedAreaLabels: [], savedListingIds: [] };
          const savedOverlap = {
            sharedAreaCount: countSavedAreaOverlap(missingViewerSaved.savedAreaLabels, candidateSaved.savedAreaLabels),
            sharedListingCount: countSavedListingOverlap(missingViewerSaved.savedListingIds, candidateSaved.savedListingIds),
          };
          const score = scoreCompatibility(
            { userId: viewerId, displayName: viewer.displayName, facts: viewer.facts },
            { userId: candidateId, displayName: candidate.displayName, facts: candidate.facts },
            savedOverlap,
          );
          const [userAId, userBId] = [viewerId, candidateId].sort();
          edgeRows.push({
            computed_at: computedAt,
            evidence: score.evidence,
            risks: score.risks,
            score: score.score,
            score_components: foldScoreMetaIntoComponents(score),
            status: "active",
            user_a_id: userAId,
            user_b_id: userBId,
          });
          byOther.set(candidateId, {
            score: score.score,
            reasons: topReasonLabels(score.evidence),
          });
        }
        if (edgeRows.length > 0) {
          const result = await supabase
            .from("compatibility_edges")
            .upsert(edgeRows, { onConflict: "user_a_id,user_b_id" });
          if (result.error) throw result.error;
        }
      }
    }

    return targets.flatMap((id) => {
      const entry = byOther.get(id);
      return entry
        ? [{ userAId: viewerId, userBId: id, score: entry.score, reasons: entry.reasons }]
        : [];
    });
  } catch (error) {
    console.warn("Unable to ensure compatibility edges for group members", {
      viewerId,
      error,
    });
    return [];
  }
}

async function retrieveCompatibilityCandidateIds(
  supabase: SupabaseServiceClient,
  {
    currentFacts,
    minCosine,
    retrievalLimit,
    userId,
  }: {
    currentFacts: ProfileFactForScoring[];
    minCosine: number;
    retrievalLimit: number;
    userId: string;
  },
): Promise<RetrievedCompatibilityCandidate[]> {
  const [embeddingCandidates, fallbackCandidates] = await Promise.all([
    loadEmbeddingCompatibilityCandidates(supabase, {
      minCosine,
      retrievalLimit,
      userId,
    }),
    loadFallbackCompatibilityCandidates(supabase, {
      currentFacts,
      limit: matchRerankLimit(),
      userId,
    }),
  ]);

  return unionRetrievedCompatibilityCandidates(
    embeddingCandidates,
    fallbackCandidates,
  );
}

async function loadEmbeddingCompatibilityCandidates(
  supabase: SupabaseServiceClient,
  {
    minCosine,
    retrievalLimit,
    userId,
  }: {
    minCosine: number;
    retrievalLimit: number;
    userId: string;
  },
): Promise<RetrievedCompatibilityCandidate[]> {
  if (shouldUseProfileEmbeddings()) {
    try {
      const embedding = await loadAggregateProfileEmbedding(supabase, userId);
      if (embedding?.embedding) {
        return await retrieveProfileEmbeddingCandidates(supabase, {
          limit: retrievalLimit,
          minCosine,
          queryEmbedding: embedding.embedding,
          viewerId: userId,
        });
      }
    } catch (error) {
      console.warn("Profile embedding retrieval failed; using fallback candidates.", {
        error,
        userId,
      });
    }
  }

  return [];
}

function unionRetrievedCompatibilityCandidates(
  embeddingCandidates: RetrievedCompatibilityCandidate[],
  fallbackCandidates: RetrievedCompatibilityCandidate[],
) {
  const byUserId = new Map<string, RetrievedCompatibilityCandidate>();
  const orderedUserIds: string[] = [];
  const addCandidate = (candidate: RetrievedCompatibilityCandidate) => {
    if (!candidate.userId) {
      return;
    }

    const existing = byUserId.get(candidate.userId);
    if (!existing) {
      orderedUserIds.push(candidate.userId);
    }

    byUserId.set(candidate.userId, {
      userId: candidate.userId,
      cosineSimilarity:
        candidate.cosineSimilarity ?? existing?.cosineSimilarity ?? null,
      semanticRank: candidate.semanticRank ?? existing?.semanticRank ?? null,
    });
  };

  for (const candidate of embeddingCandidates) {
    addCandidate(candidate);
  }
  for (const candidate of fallbackCandidates) {
    addCandidate(candidate);
  }

  return orderedUserIds.flatMap((userId) => {
    const candidate = byUserId.get(userId);
    return candidate ? [candidate] : [];
  });
}

async function loadFallbackCompatibilityCandidates(
  supabase: SupabaseServiceClient,
  {
    currentFacts,
    limit,
    userId,
  }: {
    currentFacts: ProfileFactForScoring[];
    limit: number;
    userId: string;
  },
): Promise<RetrievedCompatibilityCandidate[]> {
  const candidateIds: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidateId: string) => {
    if (
      candidateId !== userId &&
      !seen.has(candidateId) &&
      candidateIds.length < limit
    ) {
      seen.add(candidateId);
      candidateIds.push(candidateId);
    }
  };
  const declaredMarkets = readTargetMarkets(currentFacts);
  const targetMarkets =
    declaredMarkets.length > 0 ? declaredMarkets : DEFAULT_TARGET_MARKETS;

  if (targetMarkets.length > 0) {
    const marketResult = await supabase
      .from("matching_profiles")
      .select("user_id,updated_at")
      .neq("user_id", userId)
      .in("status", ["active", "draft"])
      .overlaps("target_markets", targetMarkets)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (marketResult.error) {
      throw marketResult.error;
    }

    for (const profile of marketResult.data ?? []) {
      addCandidate(profile.user_id);
    }
  }

  if (candidateIds.length < limit) {
    // Keep the no-key fallback capped so local/dev still works without
    // returning to the previous unbounded scan-everyone path.
    const factsResult = await supabase
      .from("profile_facts")
      .select("user_id,created_at")
      .neq("user_id", userId)
      .eq("matching_eligible", true)
      .in("user_review_state", ["approved", "edited"])
      .order("created_at", { ascending: false })
      .limit(limit * 4);

    if (factsResult.error) {
      throw factsResult.error;
    }

    for (const fact of factsResult.data ?? []) {
      addCandidate(fact.user_id);
    }
  }

  return candidateIds.map((candidateId) => ({ userId: candidateId }));
}

async function markDroppedCompatibilityEdgesStale(
  supabase: SupabaseServiceClient,
  userId: string,
  activeCandidateIds: string[],
  computedAt: string,
  options: { dryRun?: boolean } = {},
) {
  const edgesResult = await supabase
    .from("compatibility_edges")
    .select("id,user_a_id,user_b_id,status")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .eq("status", "active");

  if (edgesResult.error) {
    throw edgesResult.error;
  }

  const active = new Set(activeCandidateIds);
  const staleIds = (edgesResult.data ?? []).flatMap((edge) => {
    if (edge.status !== "active") {
      return [];
    }
    const otherUserId =
      edge.user_a_id === userId ? edge.user_b_id : edge.user_a_id;
    return active.has(otherUserId) ? [] : [edge.id];
  });

  if (staleIds.length === 0) {
    return 0;
  }

  if (options.dryRun) {
    return staleIds.length;
  }

  const staleResult = await supabase
    .from("compatibility_edges")
    .update({ computed_at: computedAt, status: "stale" })
    .in("id", staleIds);

  if (staleResult.error) {
    throw staleResult.error;
  }

  return staleIds.length;
}

function matchRetrievalLimit() {
  return readIntegerEnv("KINFOLK_MATCH_RETRIEVAL_LIMIT", 150, 1, 500);
}

function matchRerankLimit() {
  return readIntegerEnv("KINFOLK_MATCH_RERANK_LIMIT", 80, 1, 200);
}

function matchMinCosine() {
  const rawValue = process.env.KINFOLK_MATCH_MIN_COSINE?.trim();
  if (!rawValue) {
    return 0.25;
  }

  const raw = Number(rawValue);
  return Number.isFinite(raw) ? Math.min(1, Math.max(-1, raw)) : 0.25;
}

function readIntegerEnv(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
) {
  const rawValue = process.env[key]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const raw = Number(rawValue);
  if (!Number.isInteger(raw)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, raw));
}

async function insertProfileFacts(
  supabase: SupabaseServiceClient,
  userId: string,
  importId: string,
  candidates: ProfileFactInsertCandidate[],
) {
  if (candidates.length === 0) {
    return [];
  }

  const result = await supabase
    .from("profile_facts")
    .insert(
      candidates.map(({ fact, reviewState }) => ({
        user_id: userId,
        source_import_id: importId,
        dimension: fact.dimension,
        fact_key: fact.factKey,
        value_json: fact.value,
        normalized_value: fact.normalizedValue,
        assertion_type: fact.assertionType,
        confidence: fact.confidence,
        importance: fact.importance,
        sensitivity_level: fact.sensitivityLevel,
        matching_eligible:
          fact.matchingEligible && ["approved", "edited"].includes(reviewState),
        evidence_excerpt: fact.evidenceExcerpt,
        source_type: fact.sourceType ?? null,
        observed_vs_self_reported: fact.observedVsSelfReported ?? null,
        recency_hint: fact.recencyHint ?? null,
        recency_at: fact.recencyAt ?? null,
        user_review_state: reviewState,
      })),
    )
    .select("*");

  if (result.error) {
    throw result.error;
  }

  return result.data ?? [];
}

function reviewStateForImportedProfileFact(
  candidate: ReturnType<typeof reconcileProfileFactImport>["factsToInsert"][number],
  provider: ProfileImportProvider,
): ProfileFactReviewState {
  if (!isAssistantImportProvider(provider)) {
    return "pending";
  }

  if (candidate.conflictingExistingFacts.length > 0) {
    return "pending";
  }

  const threshold = assistantAutoApproveConfidenceThresholdForFact(
    candidate.fact,
  );

  return candidate.fact.confidence >= threshold ? "approved" : "pending";
}

function importStatusForInsertedFacts(facts: TableRow<"profile_facts">[]) {
  return profileImportStatusForFactReviewStates(
    facts.map((fact) => fact.user_review_state),
  );
}

function isSearchProfileFact(
  fact: ExtractedProfileFact | ProfileFactForScoring,
) {
  const haystack =
    `${fact.dimension} ${fact.factKey} ${fact.normalizedValue} ${fact.evidenceExcerpt ?? ""}`.replaceAll(
      "_",
      " ",
    );
  return (
    searchProfileFactKeys.has(fact.factKey) ||
    /\b(accessibility|apartment|budget|city|commute|dealbreaker|housing search|lease|location|market|move[ -]?in|must[ -]?have|neighborhood|pet|rent|room group|smoking|target)\b/i.test(
      haystack,
    )
  );
}

function isUserInputSearchProfileFact(fact: ProfileFactForScoring) {
  return (
    !isAssistantImportProvider(fact.sourceImportProvider) &&
    isSearchProfileFact(fact)
  );
}

async function insertProfileConflicts(
  supabase: SupabaseServiceClient,
  userId: string,
  importId: string,
  extractedFacts: ExtractedProfileFact[],
  insertedFacts: TableRow<"profile_facts">[],
) {
  const conflicts = detectProfileFactConflicts(extractedFacts);

  if (conflicts.length === 0) {
    return;
  }

  const result = await supabase.from("profile_fact_conflicts").insert(
    conflicts.map((conflict) => ({
      user_id: userId,
      source_import_id: importId,
      fact_a_id: insertedFacts[conflict.factAIndex]?.id ?? null,
      fact_b_id: insertedFacts[conflict.factBIndex]?.id ?? null,
      conflict_type: conflict.conflictType,
      resolution_state: "open",
    })),
  );

  if (result.error) {
    throw result.error;
  }
}

async function insertCrossImportConflicts(
  supabase: SupabaseServiceClient,
  userId: string,
  importId: string,
  factsToInsert: ReturnType<typeof reconcileProfileFactImport>["factsToInsert"],
  insertedFacts: TableRow<"profile_facts">[],
) {
  const conflictRows = factsToInsert.flatMap((candidate, insertedIndex) => {
    const insertedFact = insertedFacts[insertedIndex];
    if (!insertedFact) {
      return [];
    }

    return candidate.conflictingExistingFacts.flatMap((existingFact) =>
      existingFact.id && !existingFact.id.startsWith("incoming:")
        ? [
            {
              user_id: userId,
              source_import_id: importId,
              fact_a_id: existingFact.id ?? null,
              fact_b_id: insertedFact.id,
              conflict_type: "contradiction",
              resolution_state: "open",
            },
          ]
        : [],
    );
  });

  if (conflictRows.length === 0) {
    return;
  }

  const result = await supabase.from("profile_fact_conflicts").insert(conflictRows);

  if (result.error) {
    throw result.error;
  }
}

async function applyProfileImportMetadata(
  supabase: SupabaseServiceClient,
  userId: string,
  metadata: ProfileImportMetadata,
) {
  const shortSelfSummary = metadata.profileSummary?.shortSelfSummary?.trim();
  const livingWithMeIsLike = metadata.profileSummary?.livingWithMeIsLike?.trim();

  if (shortSelfSummary) {
    const userResult = await supabase
      .from("kinfolk_users")
      .select("about_text")
      .eq("id", userId)
      .single();

    if (userResult.error) {
      throw userResult.error;
    }

    const currentAbout = userResult.data?.about_text?.trim() ?? "";
    if (!currentAbout) {
      const updated = await supabase
        .from("kinfolk_users")
        .update({ about_text: shortSelfSummary })
        .eq("id", userId);

      if (updated.error) {
        throw updated.error;
      }
    }
  }

  if (!livingWithMeIsLike) {
    return;
  }

  const existing = await supabase
    .from("roommate_preferences")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const currentNotes = existing.data?.lifestyle_notes?.trim() ?? "";
  const nextNotes = !currentNotes
    ? livingWithMeIsLike
    : currentNotes.includes(livingWithMeIsLike)
      ? currentNotes
      : `${currentNotes}; ${livingWithMeIsLike}`;

  if (existing.data) {
    const updated = await supabase
      .from("roommate_preferences")
      .update({ lifestyle_notes: nextNotes })
      .eq("id", existing.data.id);

    if (updated.error) {
      throw updated.error;
    }
    return;
  }

  const profile = await getLatestMatchingProfile(supabase, userId);
  const inserted = await supabase.from("roommate_preferences").insert({
    user_id: userId,
    profile_id: profile?.id ?? null,
    lifestyle_notes: nextNotes,
  });

  if (inserted.error) {
    throw inserted.error;
  }
}

async function projectApprovedFacts(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  await applyLatestApprovedProfileImportMetadata(supabase, userId);
  const factsResult = await supabase
    .from("profile_facts")
    .select("*")
    .eq("user_id", userId)
    .eq("matching_eligible", true)
    .in("user_review_state", ["approved", "edited"]);

  if (factsResult.error) {
    throw factsResult.error;
  }

  const rows = (factsResult.data ?? []).filter(isInformativeProfileFactRow);
  const importProviders = await loadImportProviderMap(
    supabase,
    rows.map((row) => row.source_import_id),
  );
  const facts = rows.map((row) =>
    mapFactForScoring(row, importProviders.get(row.source_import_id)),
  );
  const unifiedFacts = consolidateProfileFactsForProjection(facts);
  await projectUserAgeFromFacts(supabase, userId, unifiedFacts);
  const userInputSearchFacts = unifiedFacts.filter(isUserInputSearchProfileFact);
  const profile =
    userInputSearchFacts.length > 0
      ? await upsertMatchingProfileFromFacts(
          supabase,
          userId,
          userInputSearchFacts,
          unifiedFacts,
        )
      : await getLatestMatchingProfile(supabase, userId);

  if (userInputSearchFacts.length > 0) {
    await upsertHousingPreferencesFromFacts(
      supabase,
      userId,
      profile?.id ?? null,
      userInputSearchFacts,
    );
  }

  await upsertRoommatePreferencesFromFacts(
    supabase,
    userId,
    profile?.id ?? null,
    unifiedFacts,
  );

  try {
    await upsertProfileEmbeddingForUser(supabase, userId);
  } catch (error) {
    console.warn("Failed to refresh profile embedding after fact projection", {
      error,
      userId,
    });
  }

  if (profile?.id) {
    try {
      await recomputeApartmentListingMatchesForUser(supabase, userId);
    } catch (error) {
      console.error("Failed to recompute apartment listing matches", {
        error,
        userId,
      });
      throw error;
    }
  }
}

async function applyLatestApprovedProfileImportMetadata(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const imports = await supabase
    .from("profile_imports")
    .select("raw_payload")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(20);

  if (imports.error) {
    throw imports.error;
  }

  for (const profileImport of imports.data ?? []) {
    const metadata = extractProfileImportMetadata(profileImport.raw_payload);
    if (metadata.profileSummary) {
      await applyProfileImportMetadata(supabase, userId, metadata);
      return;
    }
  }
}

async function loadImportProviderMap(
  supabase: SupabaseServiceClient,
  importIds: string[],
) {
  const ids = [...new Set(importIds)].filter(Boolean);
  const providers = new Map<string, ProfileImportProvider | string>();

  if (ids.length === 0) {
    return providers;
  }

  const result = await supabase
    .from("profile_imports")
    .select("id, provider")
    .in("id", ids);
  if (result.error) {
    throw result.error;
  }

  for (const row of result.data ?? []) {
    providers.set(row.id, row.provider);
  }

  return providers;
}

async function getLatestMatchingProfile(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("matching_profiles")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function upsertMatchingProfileFromFacts(
  supabase: SupabaseServiceClient,
  userId: string,
  facts: ProfileFactForScoring[],
  completenessFacts: ProfileFactForScoring[] = facts,
) {
  const existing = await supabase
    .from("matching_profiles")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const targetMarkets = readTargetMarkets(facts).slice(0, 4);
  const nextTargetMarkets =
    targetMarkets.length > 0
      ? targetMarkets
      : existing.data?.target_markets?.length
        ? existing.data.target_markets
        : DEFAULT_TARGET_MARKETS;
  const budget = readBudgetRange(facts);
  const moveInWindow = readMoveInWindowRange(facts);
  const householdSize = readHouseholdSizeRange(facts);
  const completenessScore = computeCompletenessScore(completenessFacts);
  const payload = {
    user_id: userId,
    status: completenessScore > 45 ? "active" : "draft",
    target_markets: nextTargetMarkets,
    budget_min: budget ? budget.min : (existing.data?.budget_min ?? null),
    budget_max: budget ? budget.max : (existing.data?.budget_max ?? null),
    move_in_start: moveInWindow
      ? moveInWindow.start
      : (existing.data?.move_in_start ?? null),
    move_in_end: moveInWindow
      ? moveInWindow.end
      : (existing.data?.move_in_end ?? null),
    household_size_min:
      householdSize?.min ?? existing.data?.household_size_min ?? 0,
    household_size_max:
      householdSize?.max ?? existing.data?.household_size_max ?? 0,
    // visibility_mode is deliberately absent: only the settings write path
    // (lib/profiles/store.ts) writes it. Carrying a read-back value here would
    // let a concurrent settings change be silently reverted — fail-open on the
    // one column where that is unacceptable. Inserts get the column default.
    completeness_score: completenessScore,
  };

  if (existing.data) {
    const updated = await supabase
      .from("matching_profiles")
      .update(payload)
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (updated.error) {
      throw updated.error;
    }
    return updated.data;
  }

  const inserted = await supabase
    .from("matching_profiles")
    .insert(payload)
    .select("*")
    .single();
  if (inserted.error) {
    throw inserted.error;
  }
  return inserted.data;
}

async function upsertHousingPreferencesFromFacts(
  supabase: SupabaseServiceClient,
  userId: string,
  profileId: string | null,
  facts: ProfileFactForScoring[],
) {
  const existing = await supabase
    .from("housing_preferences")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const validatedNeighborhoods = validateSanFranciscoNeighborhoodValues(
    readStringList(facts, ["neighborhoods"]),
  );
  const payload = {
    user_id: userId,
    profile_id: profileId,
    neighborhoods: validatedNeighborhoods.accepted.slice(0, 10),
    commute_notes: readJoined(facts, ["commute"]),
    pets: readJoined(facts, ["pets"]),
    must_haves: readStringList(facts, ["must_haves"]).slice(0, 10),
    dealbreakers: readStringList(facts, ["dealbreakers"]).slice(0, 10),
    flexibility_notes: readJoined(facts, [
      "location_tradeoff",
      "rent_tradeoff",
    ]),
  };

  if (existing.data) {
    const updated = await supabase
      .from("housing_preferences")
      .update(payload)
      .eq("id", existing.data.id);
    if (updated.error) {
      throw updated.error;
    }
    return;
  }

  const inserted = await supabase.from("housing_preferences").insert(payload);
  if (inserted.error) {
    throw inserted.error;
  }
}

async function projectUserAgeFromFacts(
  supabase: SupabaseServiceClient,
  userId: string,
  facts: ProfileFactForScoring[],
) {
  const age = readAgeFromProjectionFacts(facts);
  if (age === null) {
    return;
  }

  const updated = await supabase
    .from("kinfolk_users")
    .update({ birth_year: new Date().getFullYear() - age })
    .eq("id", userId);

  if (updated.error) {
    throw updated.error;
  }
}

async function upsertRoommatePreferencesFromFacts(
  supabase: SupabaseServiceClient,
  userId: string,
  profileId: string | null,
  facts: ProfileFactForScoring[],
) {
  const existing = await supabase
    .from("roommate_preferences")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const preferredAgeRange = readPreferredAgeRangeFromProjectionFacts(facts);
  const payload = {
    user_id: userId,
    profile_id: profileId,
    lifestyle_notes: readJoined(facts, ["lifestyle", "work_from_home"]),
    cleanliness: readJoined(facts, ["cleanliness", "chores"]),
    sleep_schedule: readJoined(facts, ["sleep_schedule"]),
    social_energy: readJoined(facts, ["social_energy"]),
    hosting_expectations: readJoined(facts, ["guests"]),
    conflict_style: readJoined(facts, [
      "communication_style",
      "conflict_repair",
    ]),
    dealbreakers: readStringList(facts, ["dealbreakers"]).slice(0, 10),
    ...(preferredAgeRange
      ? {
          preferred_age_max: preferredAgeRange.max,
          preferred_age_min: preferredAgeRange.min,
          preferred_age_strict: preferredAgeRange.strict,
        }
      : {}),
  };

  if (existing.data) {
    const updated = await supabase
      .from("roommate_preferences")
      .update(payload)
      .eq("id", existing.data.id);
    if (updated.error) {
      throw updated.error;
    }
    return;
  }

  const inserted = await supabase.from("roommate_preferences").insert(payload);
  if (inserted.error) {
    throw inserted.error;
  }
}

async function mapCompatibilityEdges(
  supabase: SupabaseServiceClient,
  userId: string,
  edges: TableRow<"compatibility_edges">[],
): Promise<CompatibilityEdgeSummary[]> {
  const otherIds = [
    ...new Set(
      edges.map((edge) =>
        edge.user_a_id === userId ? edge.user_b_id : edge.user_a_id,
      ),
    ),
  ];
  const users =
    otherIds.length > 0
      ? await supabase.from("kinfolk_users").select("*").in("id", otherIds)
      : { data: [], error: null };

  if (users.error) {
    throw users.error;
  }

  const userNames = new Map(
    (users.data ?? []).map((user) => [user.id, user.display_name]),
  );

  return edges.map((edge) => {
    const otherUserId =
      edge.user_a_id === userId ? edge.user_b_id : edge.user_a_id;
    return {
      id: edge.id,
      otherUserId,
      otherDisplayName: userNames.get(otherUserId) ?? "Kinfolk member",
      score: edge.score,
      components: jsonObjectToNumberMap(edge.score_components),
      evidence: parseEvidencePoints(edge.evidence),
      risks: parseEvidencePoints(edge.risks),
      computedAt: edge.computed_at,
    };
  });
}

function emptyProfileEnrichmentSnapshot(
  status: ProfileEnrichmentSnapshot["source"]["status"],
  detail: string,
): ProfileEnrichmentSnapshot {
  return {
    source: {
      kind: "supabase",
      status,
      detail,
    },
    imports: [],
    facts: [],
    conflicts: [],
    compatibility: [],
    gaps: [],
  };
}

function countFactsByImport(facts: TableRow<"profile_facts">[]) {
  const counts = new Map<
    string,
    { total: number; pending: number; approved: number; sensitive: number }
  >();

  for (const fact of facts) {
    const next = counts.get(fact.source_import_id) ?? {
      total: 0,
      pending: 0,
      approved: 0,
      sensitive: 0,
    };
    next.total += 1;
    if (fact.user_review_state === "pending") {
      next.pending += 1;
    }
    if (approvedProfileFactReviewStates.has(fact.user_review_state)) {
      next.approved += 1;
    }
    if (fact.sensitivity_level !== "standard") {
      next.sensitive += 1;
    }
    counts.set(fact.source_import_id, next);
  }

  return counts;
}

function profileFactRowsForSnapshot(rows: TableRow<"profile_facts">[]) {
  const activeRows = rows.filter(
    (row) =>
      !["deleted", "revoked"].includes(row.user_review_state) &&
      isInformativeProfileFactRow(row),
  );
  const approvedIds = new Set(
    consolidateProfileFactsForProjection(
      activeRows.flatMap((row) =>
        isApprovedProfileFactRow(row) ? [mapFactForScoring(row)] : [],
      ),
    ).map((fact) => fact.id),
  );

  return activeRows.filter(
    (row) => !isApprovedProfileFactRow(row) || approvedIds.has(row.id),
  );
}

function isApprovedProfileFactRow(row: TableRow<"profile_facts">) {
  return approvedProfileFactReviewStates.has(row.user_review_state);
}

function profileFactsForCompatibilityScoring(
  user: TableRow<"kinfolk_users">,
): ProfileFactForScoring[] {
  const facts: ProfileFactForScoring[] = [];
  const addFact = (
    factKey: string,
    dimension: string,
    value: string | string[] | null,
    importance: number,
  ) => {
    const normalizedValue = Array.isArray(value)
      ? value
          .flatMap((entry) => {
            const cleaned = cleanProfileSignal(entry);
            return cleaned ? [cleaned] : [];
          })
          .join(", ")
      : cleanProfileSignal(value);
    if (!normalizedValue) return;
    facts.push({
      id: `profile:${user.id}:${factKey}:${facts.length}`,
      userId: user.id,
      sourceImportProvider: "profile",
      dimension,
      factKey,
      value: normalizedValue,
      normalizedValue,
      confidence: 0.92,
      importance,
      sensitivityLevel: "standard",
      matchingEligible: true,
      reviewState: "approved",
      evidenceExcerpt: "Confirmed profile field",
      createdAt: user.updated_at ?? user.created_at,
    });
  };

  addFact(
    "verified_work_or_school",
    "trust_context",
    user.education_school,
    0.82,
  );
  addFact(
    "verified_work_or_school",
    "trust_context",
    user.occupation_company,
    0.76,
  );
  addFact("interests", "rapport_taste", user.interests ?? [], 0.46);

  const age = ageForKinfolkUser(user);
  if (age != null) {
    facts.push({
      id: `profile:${user.id}:age:${facts.length}`,
      userId: user.id,
      sourceImportProvider: "profile",
      dimension: "roommate_safety",
      factKey: "age",
      value: age,
      normalizedValue: String(age),
      confidence: 0.96,
      importance: 0.82,
      sensitivityLevel: "standard",
      matchingEligible: true,
      reviewState: "approved",
      evidenceExcerpt: "Confirmed profile field",
      createdAt: user.updated_at ?? user.created_at,
    });
  }

  return facts;
}

function roommatePreferenceFactsForCompatibilityScoring(
  preference: TableRow<"roommate_preferences"> | null,
): ProfileFactForScoring[] {
  if (!preference) {
    return [];
  }

  const min = boundedAge(preference.preferred_age_min);
  const max = boundedAge(preference.preferred_age_max);
  if (min == null && max == null) {
    return [];
  }
  if (min != null && max != null && min > max) {
    return [];
  }

  const value: Json = {
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
    strict: preference.preferred_age_strict === true,
  };

  return [
    {
      id: `roommate-preferences:${preference.id}:preferred-age-range`,
      userId: preference.user_id,
      sourceImportProvider: "profile",
      dimension: "roommate_safety",
      factKey: "preferred_age_range",
      value,
      normalizedValue: JSON.stringify(value),
      confidence: 0.96,
      importance: 0.88,
      sensitivityLevel: "standard",
      matchingEligible: true,
      reviewState: "approved",
      evidenceExcerpt: "Confirmed roommate preference field",
      createdAt: preference.updated_at ?? preference.created_at,
    },
  ];
}

export function ageForKinfolkUser(
  user: Pick<TableRow<"kinfolk_users">, "birth_year" | "date_of_birth">,
) {
  const birthYear = boundedBirthYear(user.birth_year);
  if (birthYear != null) {
    return boundedAge(new Date().getFullYear() - birthYear);
  }

  if (!user.date_of_birth) {
    return null;
  }

  const birthDate = new Date(`${user.date_of_birth}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayThisYear = Date.UTC(
    today.getUTCFullYear(),
    birthDate.getUTCMonth(),
    birthDate.getUTCDate(),
  );
  if (Date.now() < birthdayThisYear) {
    age -= 1;
  }

  return boundedAge(age);
}

function boundedBirthYear(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return rounded >= 1900 && rounded <= 2100 ? rounded : null;
}

function boundedAge(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return rounded >= 18 && rounded <= 100 ? rounded : null;
}

function latestMatchingProfileByUser(
  profiles: readonly TableRow<"matching_profiles">[],
) {
  const byUser = new Map<string, TableRow<"matching_profiles">>();
  for (const profile of profiles) {
    if (!byUser.has(profile.user_id)) {
      byUser.set(profile.user_id, profile);
    }
  }
  return byUser;
}

function latestRoommatePreferenceByUser(
  preferences: readonly TableRow<"roommate_preferences">[],
) {
  const byUser = new Map<string, TableRow<"roommate_preferences">>();
  for (const preference of preferences) {
    if (!byUser.has(preference.user_id)) {
      byUser.set(preference.user_id, preference);
    }
  }
  return byUser;
}

function matchingProfileFactsForCompatibilityScoring(
  profile: TableRow<"matching_profiles"> | null,
): ProfileFactForScoring[] {
  if (!profile) {
    return [];
  }

  const facts: ProfileFactForScoring[] = [];
  const createdAt = profile.updated_at ?? profile.created_at;
  const addFact = (
    factKey: string,
    value: Json,
    normalizedValue: string,
    importance: number,
  ) => {
    const normalized = normalizedValue.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    facts.push({
      id: `matching-profile:${profile.id}:${factKey}`,
      userId: profile.user_id,
      sourceImportProvider: "web",
      dimension: "feasibility",
      factKey,
      value,
      normalizedValue: normalized,
      confidence: 0.96,
      importance,
      sensitivityLevel: "standard",
      matchingEligible: true,
      reviewState: "approved",
      evidenceExcerpt: "Canonical matching profile field",
      createdAt,
    });
  };

  if (profile.target_markets.length > 0) {
    addFact(
      "target_market",
      profile.target_markets,
      profile.target_markets.join(", "),
      0.95,
    );
  }

  const budgetMin = positiveIntegerOrNull(profile.budget_min);
  const budgetMax = positiveIntegerOrNull(profile.budget_max);
  if (budgetMin != null || budgetMax != null) {
    const value = {
      ...(budgetMin != null ? { min: budgetMin } : {}),
      ...(budgetMax != null ? { max: budgetMax } : {}),
    };
    addFact("budget", value, JSON.stringify(value), 1);
  }

  if (profile.move_in_start || profile.move_in_end) {
    const value = {
      ...(profile.move_in_start ? { start: profile.move_in_start } : {}),
      ...(profile.move_in_end ? { end: profile.move_in_end } : {}),
    };
    addFact("move_in_window", value, JSON.stringify(value), 0.9);
  }

  const householdMin = positiveIntegerOrNull(profile.household_size_min);
  const householdMax = positiveIntegerOrNull(profile.household_size_max);
  const household = householdOpennessValue(householdMin, householdMax);
  if (household) {
    addFact(
      "household_size",
      household,
      JSON.stringify(household),
      0.9,
    );
  }

  return facts;
}

function cleanProfileSignal(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : "";
}

function groupFactsByUser(facts: ProfileFactForScoring[]) {
  const grouped = new Map<string, ProfileFactForScoring[]>();

  for (const fact of facts) {
    grouped.set(fact.userId, [...(grouped.get(fact.userId) ?? []), fact]);
  }

  for (const [userId, userFacts] of grouped) {
    grouped.set(userId, consolidateProfileFactsForProjection(userFacts));
  }

  return grouped;
}

function computeProfileGaps(facts: ProfileFactForScoring[]) {
  const approved = facts.filter((fact) =>
    ["approved", "edited"].includes(fact.reviewState),
  );
  const approvedKeys = new Set(
    approved.map((fact) => resolveCanonicalFactKey(fact.factKey)),
  );
  const needed: Array<[string[], string]> = [
    [["sleep_schedule"], "Sleep window"],
    [["work_from_home"], "Work from home"],
    [["noise_tolerance"], "Noise tolerance"],
    [["cleanliness"], "Cleaning threshold"],
    [["guests"], "Guest expectations"],
    [["overnight_guests"], "Overnight guests"],
    [["communication_style"], "Communication style"],
    [["conflict_repair"], "Conflict repair"],
    [["social_energy"], "Social energy"],
    [["rent_tradeoff"], "Rent/location flexibility"],
    [
      [
        "verified_work_or_school",
        "shared_communities",
        "mutuals",
        "references",
        "prior_roommate_context",
      ],
      "Trust context",
    ],
    [["interests", "music_taste", "media_taste", "aesthetic_taste"], "Interests"],
  ];

  return needed.flatMap(([keys, label]) =>
    keys.some((key) => approvedKeys.has(resolveCanonicalFactKey(key))) ? [] : [label],
  );
}

export async function getProfileMatchingReviewState(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<ProfileMatchingReviewState> {
  const [factsResult, importsResult] = await Promise.all([
    supabase
      .from("profile_facts")
      .select(
        "fact_key,user_review_state,matching_eligible,sensitivity_level,assertion_type,confidence,value_json,normalized_value,evidence_excerpt",
      )
      .eq("user_id", userId)
      .in("user_review_state", ["pending", "approved", "edited"]),
    supabase
      .from("profile_imports")
      .select("status")
      .eq("user_id", userId)
      .in("provider", ["claude", "chatgpt"])
      .neq("status", "deleted"),
  ]);

  if (factsResult.error) {
    throw factsResult.error;
  }
  if (importsResult.error) {
    throw importsResult.error;
  }

  const facts = factsResult.data ?? [];
  // Only count pending facts that the Memories page would actually surface for
  // approval. Hedged / non-informative inferences (e.g. a low-confidence
  // "moderate" cleanliness default) are filtered out there, so counting raw
  // pending rows here made the banner claim facts were waiting when nothing was.
  const pendingFacts = facts.filter(
    (fact) =>
      fact.user_review_state === "pending" &&
      isInformativeProfileFact({
        assertionType: fact.assertion_type,
        confidence: fact.confidence,
        factKey: fact.fact_key,
        value: fact.value_json,
        normalizedValue: fact.normalized_value,
        evidenceExcerpt: fact.evidence_excerpt ?? "",
      }),
  );
  const approvedBehavioral = facts.filter(
    (fact) =>
      ["approved", "edited"].includes(fact.user_review_state) &&
      behavioralFactKeys.has(resolveCanonicalFactKey(fact.fact_key)),
  );
  const pendingBehavioral = pendingFacts.filter((fact) =>
    behavioralFactKeys.has(resolveCanonicalFactKey(fact.fact_key)),
  );

  return {
    pendingFactCount: pendingFacts.length,
    pendingBehavioralCount: pendingBehavioral.length,
    approvedBehavioralCount: approvedBehavioral.length,
    // An import is only "waiting" if it still has an approvable fact — an import
    // stuck in needs_review whose facts are all hedged should not raise a banner.
    hasPendingImports:
      pendingFacts.length > 0 &&
      (importsResult.data ?? []).some((row) => row.status === "needs_review"),
  };
}

function computeCompletenessScore(facts: ProfileFactForScoring[]) {
  const requiredKeyGroups = [
    ["target_market", "neighborhoods"],
    ["budget", "budget_min", "budget_max"],
    ["sleep_schedule"],
    ["work_from_home"],
    ["noise_tolerance"],
    ["cleanliness"],
    ["guests"],
    ["social_energy"],
    ["communication_style"],
    ["conflict_repair", "conflict_style", "communication_style"],
    ["rent_tradeoff"],
    [
      "verified_work_or_school",
      "shared_communities",
      "mutuals",
      "references",
      "prior_roommate_context",
    ],
    ["interests", "music_taste", "media_taste", "aesthetic_taste"],
  ];
  const present = requiredKeyGroups.filter((keys) =>
    facts.some((fact) => keys.includes(fact.factKey)),
  ).length;
  return Math.round((present / requiredKeyGroups.length) * 100);
}

function readStringList(facts: ProfileFactForScoring[], keys: string[]) {
  const values = facts
    .reduce<ProfileFactForScoring[]>((projectionFacts, fact) => {
      if (isProjectionFact(fact) && keys.includes(fact.factKey)) {
        projectionFacts.push(fact);
      }
      return projectionFacts;
    }, [])
    .sort(compareProjectionFacts)
    .flatMap((fact) =>
      valueToStrings(fact.value).flatMap((value) => {
        const cleaned = cleanProjectionString(value);
        return cleaned ? [cleaned] : [];
      }),
    );

  return dedupeProjectionValues(values);
}

// SF-only launch phase: everyone matches within San Francisco, so an empty
// target-market list defaults here rather than dropping the user out of
// market-scoped candidate pools (an empty array overlaps nothing). When we
// expand geographies, remove this default and let per-user markets stand alone.
const DEFAULT_TARGET_MARKETS = ["san-francisco-ca"];

function readTargetMarkets(facts: ProfileFactForScoring[]) {
  return readStringList(facts, ["target_market"]).filter(isConciseMarketValue);
}

function isProjectionFact(fact: ProfileFactForScoring) {
  return (
    fact.matchingEligible &&
    fact.sensitivityLevel === "standard" &&
    ["approved", "edited"].includes(fact.reviewState)
  );
}

function compareProjectionFacts(
  a: ProfileFactForScoring,
  b: ProfileFactForScoring,
) {
  const scoreA = a.confidence * 2 + a.importance;
  const scoreB = b.confidence * 2 + b.importance;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

function cleanProjectionString(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeProjectionValues(values: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const key = normalizeProjectionValueKey(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function normalizeProjectionValueKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\barea\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isConciseMarketValue(value: string) {
  if (value.length > 60) {
    return false;
  }

  return !/\b(comfortable|roots|trajectory|previously|willingness|commute|budget|filter|importance|unknown)\b/i.test(
    value,
  );
}

function readJoined(facts: ProfileFactForScoring[], keys: string[]) {
  return readStringList(facts, keys).join("; ");
}

function readBudgetRange(facts: ProfileFactForScoring[]) {
  const budgetFacts = facts
    .reduce<ProfileFactForScoring[]>((projectionFacts, fact) => {
      if (
        isProjectionFact(fact) &&
        ["budget", "budget_preferred_max", "budget_min", "budget_max"].includes(
          fact.factKey,
        )
      ) {
        projectionFacts.push(fact);
      }
      return projectionFacts;
    }, [])
    .sort(compareProjectionFacts);
  const minValues: BudgetProjectionValue[] = [];
  const maxValues: BudgetProjectionValue[] = [];

  for (const fact of budgetFacts) {
    const range = readBudgetRangeFromFact(fact);
    if (typeof range.min === "number") {
      minValues.push({ fact, value: range.min });
    }
    if (typeof range.max === "number") {
      maxValues.push({ fact, value: range.max });
    }
  }

  if (minValues.length === 0 && maxValues.length === 0) {
    return null;
  }

  let min = minValues.length > 0
    ? Math.min(...minValues.map((entry) => entry.value))
    : null;
  let max = maxValues.length > 0
    ? Math.max(...maxValues.map((entry) => entry.value))
    : null;

  if (min != null && max != null && min > max) {
    const newestMin = newestBudgetProjectionValue(minValues);
    const newestMax = newestBudgetProjectionValue(maxValues);
    if (
      !newestMax ||
      (newestMin?.fact.createdAt ?? "") >= (newestMax.fact.createdAt ?? "")
    ) {
      max = null;
      min = newestMin?.value ?? min;
    } else {
      min = null;
      max = newestMax.value;
    }
  }

  return { min, max };
}

type BudgetProjectionValue = {
  fact: ProfileFactForScoring;
  value: number;
};

function newestBudgetProjectionValue(values: BudgetProjectionValue[]) {
  return values.reduce<BudgetProjectionValue | null>((newest, value) => {
    if (newest === null) return value;
    const newestCreatedAt = newest.fact.createdAt ?? "";
    const valueCreatedAt = value.fact.createdAt ?? "";
    return valueCreatedAt.localeCompare(newestCreatedAt) > 0 ? value : newest;
  }, null);
}

function readBudgetRangeFromFact(fact: ProfileFactForScoring) {
  const value = fact.value;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = value as Record<string, Json>;
    return {
      min: readBudgetNumber(entries.min ?? entries.minimum ?? null),
      max: readBudgetNumber(entries.max ?? entries.maximum ?? null),
    };
  }

  const numbers = valueToStrings(value).flatMap(readBudgetNumbersFromText);

  if (numbers.length === 0) {
    return { min: null, max: null };
  }

  if (fact.factKey === "budget_min") {
    return { min: Math.min(...numbers), max: null };
  }

  if (fact.factKey === "budget_preferred_max" || fact.factKey === "budget_max") {
    return { min: null, max: Math.max(...numbers) };
  }

  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function readBudgetNumber(value: Json | undefined) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    return readBudgetNumbersFromText(value)[0] ?? null;
  }

  return null;
}

type ProjectionAgeRange = {
  max: number | null;
  min: number | null;
  strict: boolean;
};

function readAgeFromProjectionFacts(facts: ProfileFactForScoring[]) {
  const ageFacts = facts
    .reduce<ProfileFactForScoring[]>((projectionFacts, fact) => {
      if (isProjectionFact(fact) && fact.factKey === "age") {
        projectionFacts.push(fact);
      }
      return projectionFacts;
    }, [])
    .sort(compareProjectionFacts);

  for (const fact of ageFacts) {
    const age = readProjectionAgeValue(fact.value) ?? readProjectionAgeValue(fact.normalizedValue);
    if (age !== null) {
      return age;
    }
  }

  return null;
}

function readPreferredAgeRangeFromProjectionFacts(
  facts: ProfileFactForScoring[],
): ProjectionAgeRange | null {
  const ageFacts = facts
    .reduce<ProfileFactForScoring[]>((projectionFacts, fact) => {
      if (isProjectionFact(fact) && fact.factKey === "preferred_age_range") {
        projectionFacts.push(fact);
      }
      return projectionFacts;
    }, [])
    .sort(compareProjectionFacts);

  for (const fact of ageFacts) {
    const range =
      readProjectionAgeRangeValue(fact.value) ??
      readProjectionAgeRangeValue(fact.normalizedValue);
    if (range) {
      return range;
    }
  }

  return null;
}

function readProjectionAgeRangeValue(
  value: Json | string | null | undefined,
): ProjectionAgeRange | null {
  const record =
    typeof value === "string"
      ? parseProjectionJsonObject(value)
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

  if (record) {
    const min = readProjectionAgeValue(
      record.min ?? record.minimum ?? record.preferred_age_min,
    );
    const max = readProjectionAgeValue(
      record.max ?? record.maximum ?? record.preferred_age_max,
    );
    if (min === null && max === null) {
      return null;
    }
    if (min !== null && max !== null && min > max) {
      return null;
    }

    return {
      max,
      min,
      strict: readBooleanLikeProjectionValue(
        record.strict ?? record.preferred_age_strict ?? record.hard,
      ),
    };
  }

  if (typeof value !== "string") {
    return null;
  }

  const ages = [...value.matchAll(/\b(1[89]|[2-9]\d|100)\b/g)]
    .map((match) => readProjectionAgeValue(match[1]))
    .filter((age): age is number => age !== null);
  if (ages.length === 0) {
    return null;
  }

  return {
    max: Math.max(...ages),
    min: Math.min(...ages),
    strict: /\b(?:only|strict|hard|must|need)\b/i.test(value),
  };
}

function readProjectionAgeValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.round(parsed);
  return rounded >= 18 && rounded <= 100 ? rounded : null;
}

function readBooleanLikeProjectionValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return /^(true|yes|y|strict|hard)$/i.test(value.trim());
  }

  return false;
}

function parseProjectionJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readMoveInWindowRange(facts: ProfileFactForScoring[]) {
  const values = readStringList(facts, ["move_in_window"]).join(" ");
  const dates = parseMoveInDateHints(values);

  if (dates.length === 0) {
    return null;
  }

  const [earliest, latest] = dates.reduce<[string, string]>(
    ([currentEarliest, currentLatest], date) => [
      date < currentEarliest ? date : currentEarliest,
      date > currentLatest ? date : currentLatest,
    ],
    [dates[0], dates[0]],
  );
  if (
    dates.length === 1 &&
    /\b(?:asap|by|before|through|until|no later than)\b/i.test(values)
  ) {
    return {
      start: firstDayOfCurrentUtcMonth(),
      end: earliest,
    };
  }

  return {
    start: earliest,
    end: latest,
  };
}

function firstDayOfCurrentUtcMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function readHouseholdSizeRange(facts: ProfileFactForScoring[]) {
  const householdFacts = facts
    .reduce<ProfileFactForScoring[]>((projectionFacts, fact) => {
      if (
        isProjectionFact(fact) &&
        ["group_size_flexibility", "household_size"].includes(fact.factKey)
      ) {
        projectionFacts.push(fact);
      }
      return projectionFacts;
    }, [])
    .sort(compareProjectionFacts);
  const explicitHouseholdFacts = householdFacts.filter(
    (fact) => fact.factKey === "household_size",
  );
  const factsForRange =
    explicitHouseholdFacts.length > 0 ? explicitHouseholdFacts : householdFacts;
  const minValues: number[] = [];
  const maxValues: number[] = [];

  for (const fact of factsForRange) {
    const range = readHouseholdSizeRangeFromFact(fact);
    if (typeof range.min === "number") {
      minValues.push(range.min);
    }
    if (typeof range.max === "number") {
      maxValues.push(range.max);
    }
  }

  if (minValues.length === 0 && maxValues.length === 0) {
    return null;
  }

  return {
    min: minValues.length > 0 ? Math.min(...minValues) : 1,
    max: maxValues.length > 0 ? Math.max(...maxValues) : Math.max(...minValues),
  };
}

function readHouseholdSizeRangeFromFact(fact: ProfileFactForScoring) {
  const value = fact.value;
  const text = valueToStrings(value).join(" ");

  if (fact.factKey === "group_size_flexibility") {
    if (
      /\b(solo|alone|no roommates?|not open to roommates?|without roommates?)\b/i.test(
        text,
      )
    ) {
      return { min: 1, max: 1 };
    }

    if (/\b(open|yes|roommates?|flexible|shared)\b/i.test(text)) {
      return { min: 1, max: 4 };
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = value as Record<string, Json>;
    return {
      min: readSmallWholeNumber(entries.min ?? entries.minimum ?? null),
      max: readSmallWholeNumber(entries.max ?? entries.maximum ?? null),
    };
  }

  const values = valueToStrings(value);
  const mentionsRoommateCount =
    /\broommates?\b/i.test(text) &&
    !/\b(household|people|person)\b/i.test(text);
  const numbers = values.flatMap((entry) => {
    const parsedNumbers: number[] = [];
    for (const match of entry.matchAll(/\b([1-8])\b/g)) {
      const parsed = Number(match[1]);
      const adjusted = mentionsRoommateCount ? parsed + 1 : parsed;
      if (Number.isFinite(adjusted) && adjusted > 0) {
        parsedNumbers.push(adjusted);
      }
    }
    return parsedNumbers;
  });

  if (
    /\b(solo|alone|no roommates?|not open to roommates?|without roommates?)\b/i.test(
      text,
    )
  ) {
    return { min: 1, max: 1 };
  }

  if (numbers.length === 0) {
    return { min: null, max: null };
  }

  const firstValue = Math.min(...numbers);
  const lastValue = Math.max(...numbers);

  if (/\b(up to|max|maximum|at most)\b/i.test(text)) {
    return { min: 1, max: lastValue };
  }

  return { min: firstValue, max: lastValue };
}

function readSmallWholeNumber(value: Json | undefined) {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 8
  ) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.match(/\b([1-8])\b/)?.[1] ?? value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 8
      ? parsed
      : null;
  }

  return null;
}

function parseMoveInDateHints(value: string) {
  const dates: string[] = [];

  if (/\basap\b|as soon as possible/i.test(value)) {
    dates.push(new Date().toISOString().slice(0, 10));
  }

  for (const match of value.matchAll(
    /\b(20\d{2})-(0[1-9]|1[0-2])(?:-\d{2})?\b/g,
  )) {
    dates.push(match[0].length === 10 ? match[0] : `${match[1]}-${match[2]}-01`);
  }

  const monthPattern =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi;
  for (const match of value.matchAll(monthPattern)) {
    const month = monthNameToNumber(match[1]);
    if (month) {
      dates.push(`${match[2]}-${month}-01`);
    }
  }

  const monthDayPattern =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:,\s*(20\d{2}))?\b/gi;
  for (const match of value.matchAll(monthDayPattern)) {
    const month = monthNameToNumber(match[1]);
    const day = Number(match[2]);
    if (!month || !Number.isInteger(day) || day < 1 || day > 31) {
      continue;
    }

    const monthIndex = Number(month) - 1;
    const year = Number(match[3]) || inferYearForMonthDay(monthIndex, day);
    const date = new Date(Date.UTC(year, monthIndex, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === monthIndex &&
      date.getUTCDate() === day
    ) {
      dates.push(date.toISOString().slice(0, 10));
    }
  }

  const seasonPattern = /\b(spring|summer|fall|autumn|winter)\s+(20\d{2})\b/gi;
  for (const match of value.matchAll(seasonPattern)) {
    dates.push(`${match[2]}-${seasonToMonth(match[1])}-01`);
  }

  return [...new Set(dates)];
}

function inferYearForMonthDay(monthIndex: number, day: number) {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const candidate = Date.UTC(now.getUTCFullYear(), monthIndex, day);

  return candidate < today ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

function monthNameToNumber(value: string) {
  const month = value.slice(0, 3).toLowerCase();
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  return months[month] ?? null;
}

function seasonToMonth(value: string) {
  switch (value.toLowerCase()) {
    case "spring":
      return "03";
    case "summer":
      return "06";
    case "fall":
    case "autumn":
      return "09";
    default:
      return "12";
  }
}

function valueToStrings(value: Json): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(valueToStrings);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) =>
      valueToStrings(entry ?? null),
    );
  }

  if (value === null) {
    return [];
  }

  return [String(value)];
}

function jsonToDisplay(value: Json) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function jsonObjectToNumberMap(value: Json) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "number" ? [[key, entry]] : [],
    ),
  );
}
