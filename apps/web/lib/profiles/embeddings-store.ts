import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consolidateProfileFactsForProjection,
  isInformativeProfileFactRow,
  mapFactForScoring,
  type ProfileFactForScoring,
  type ProfileImportProvider,
} from "./enrichment";
import {
  buildProfileEmbeddingCard,
  type ProfileEmbeddingCardFact,
} from "./embedding-card";
import {
  embedProfileCards,
  isProfileEmbeddingsConfigured,
  profileEmbeddingDimensions,
  profileEmbeddingModel,
} from "./embeddings-client";
import { mapWithConcurrency } from "@/lib/shared/concurrency";
import { clampInteger } from "@/lib/shared/numbers";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;

const aggregateProfileEmbeddingDimension = "profile";
const profileEmbeddingBackfillConcurrency = 4;

type ProfileEmbeddingPersistenceStatus =
  | "disabled"
  | "dry_run"
  | "empty"
  | "unchanged"
  | "upserted";

export type ProfileEmbeddingPersistenceResult = {
  contentHash?: string;
  embeddingModel: string;
  sourceFactIds?: string[];
  status: ProfileEmbeddingPersistenceStatus;
  userId: string;
};

export type ProfileEmbeddingCandidate = {
  cosineSimilarity: number;
  semanticRank: number;
  userId: string;
};

let warnedMissingEmbeddingConfig = false;

export async function upsertProfileEmbeddingForUser(
  supabase: SupabaseServiceClient,
  userId: string,
  options: {
    dryRun?: boolean;
    embedProfileCards?: typeof embedProfileCards;
    force?: boolean;
  } = {},
): Promise<ProfileEmbeddingPersistenceResult> {
  const [userResult, factsResult] = await Promise.all([
    supabase
      .from("kinfolk_users")
      .select("id,about_text,education_school,occupation_company,interests")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("profile_facts")
      .select("*")
      .eq("user_id", userId)
      .eq("matching_eligible", true)
      .in("user_review_state", ["approved", "edited"]),
  ]);

  if (userResult.error) {
    throw userResult.error;
  }

  if (factsResult.error) {
    throw factsResult.error;
  }

  if (!userResult.data) {
    return {
      embeddingModel: profileEmbeddingModel(),
      status: "empty",
      userId,
    };
  }

  const rows = (factsResult.data ?? []).filter(isInformativeProfileFactRow);
  const importProviders = await loadImportProviderMap(
    supabase,
    rows.map((row) => row.source_import_id),
  );
  const facts = consolidateProfileFactsForProjection(
    rows.map((row) => mapFactForScoring(row, importProviders.get(row.source_import_id))),
  );
  const card = buildProfileEmbeddingCard({
    facts: facts.map(profileFactToEmbeddingCardFact),
    user: {
      aboutText: userResult.data.about_text,
      educationSchool: userResult.data.education_school,
      interests: userResult.data.interests,
      occupationCompany: userResult.data.occupation_company,
    },
  });

  return persistProfileEmbeddingCard(supabase, userId, card, options);
}

export async function persistProfileEmbeddingCard(
  supabase: SupabaseServiceClient,
  userId: string,
  card: ReturnType<typeof buildProfileEmbeddingCard>,
  options: {
    dryRun?: boolean;
    embedProfileCards?: typeof embedProfileCards;
    force?: boolean;
  } = {},
): Promise<ProfileEmbeddingPersistenceResult> {
  const embeddingModel = profileEmbeddingModel();
  const existing = await supabase
    .from("profile_embeddings")
    .select("id,content_hash,embedding")
    .eq("user_id", userId)
    .eq("dimension", aggregateProfileEmbeddingDimension)
    .eq("embedding_model", embeddingModel)
    .is("fact_id", null)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (card.text === "# Roommate profile") {
    if (existing.data?.id) {
      if (options.dryRun) {
        return {
          contentHash: card.contentHash,
          embeddingModel,
          sourceFactIds: card.sourceFactIds,
          status: "dry_run",
          userId,
        };
      }

      const deleteResult = await supabase
        .from("profile_embeddings")
        .delete()
        .eq("id", existing.data.id);

      if (deleteResult.error) {
        throw deleteResult.error;
      }
    }

    return {
      contentHash: card.contentHash,
      embeddingModel,
      sourceFactIds: card.sourceFactIds,
      status: "empty",
      userId,
    };
  }

  if (
    !options.force &&
    existing.data?.content_hash === card.contentHash &&
    hasStoredEmbeddingDimension(existing.data.embedding, profileEmbeddingDimensions())
  ) {
    return {
      contentHash: card.contentHash,
      embeddingModel,
      sourceFactIds: card.sourceFactIds,
      status: "unchanged",
      userId,
    };
  }

  if (options.dryRun) {
    return {
      contentHash: card.contentHash,
      embeddingModel,
      sourceFactIds: card.sourceFactIds,
      status: "dry_run",
      userId,
    };
  }

  if (!shouldUseProfileEmbeddings()) {
    warnMissingEmbeddingConfigOnce();
    return {
      contentHash: card.contentHash,
      embeddingModel,
      sourceFactIds: card.sourceFactIds,
      status: "disabled",
      userId,
    };
  }

  const embed = options.embedProfileCards ?? embedProfileCards;
  const [embedding] = await embed([card.text], { model: embeddingModel });
  if (!embedding) {
    throw new Error("OpenRouter did not return a profile embedding.");
  }

  const payload = {
    content_hash: card.contentHash,
    dimension: aggregateProfileEmbeddingDimension,
    embedding: embedding as unknown as string,
    embedding_model: embeddingModel,
    embedding_text: card.text,
    fact_id: null,
    source_fact_ids: card.sourceFactIds,
    updated_at: new Date().toISOString(),
    user_id: userId,
  };
  const writeResult = existing.data?.id
    ? await supabase.from("profile_embeddings").update(payload).eq("id", existing.data.id)
    : await supabase.from("profile_embeddings").insert(payload);

  if (writeResult.error) {
    throw writeResult.error;
  }

  if (process.env.KINFOLK_MATCH_DEBUG === "true") {
    console.info("kinfolk.profile_embeddings.persist", {
      dimension: profileEmbeddingDimensions(),
      embeddingModel,
      sourceFactCount: card.sourceFactIds.length,
      status: "upserted",
      userId,
    });
  }

  return {
    contentHash: card.contentHash,
    embeddingModel,
    sourceFactIds: card.sourceFactIds,
    status: "upserted",
    userId,
  };
}

export async function loadAggregateProfileEmbedding(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("profile_embeddings")
    .select("embedding,embedding_model,content_hash")
    .eq("user_id", userId)
    .eq("dimension", aggregateProfileEmbeddingDimension)
    .eq("embedding_model", profileEmbeddingModel())
    .is("fact_id", null)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

export async function retrieveProfileEmbeddingCandidates(
  supabase: SupabaseServiceClient,
  {
    limit,
    minCosine,
    queryEmbedding,
    viewerId,
  }: {
    limit: number;
    minCosine: number;
    queryEmbedding: string;
    viewerId: string;
  },
): Promise<ProfileEmbeddingCandidate[]> {
  const result = await supabase.rpc("match_roommates_by_embedding", {
    p_embedding_model: profileEmbeddingModel(),
    p_match_count: limit,
    p_min_cosine: minCosine,
    p_query_embedding: queryEmbedding,
    p_viewer_id: viewerId,
  });

  if (result.error) {
    throw result.error;
  }

  return (result.data ?? [])
    .map((row) => ({
      cosineSimilarity: Number(row.cosine_similarity ?? 0),
      userId: row.user_id,
    }))
    .sort((a, b) => b.cosineSimilarity - a.cosineSimilarity)
    .map((row, index) => ({
      ...row,
      semanticRank: index + 1,
    }));
}

export async function backfillProfileEmbeddings(
  supabase: SupabaseServiceClient,
  {
    dryRun = false,
    force = false,
    limit = 50,
    upsertProfileEmbeddingForUser: refreshProfileEmbedding = upsertProfileEmbeddingForUser,
    userId,
  }: {
    dryRun?: boolean;
    force?: boolean;
    limit?: unknown;
    upsertProfileEmbeddingForUser?: typeof upsertProfileEmbeddingForUser;
    userId?: string | null;
  } = {},
) {
  const safeLimit = clampInteger(limit, 50, 1, 200);
  const safeUserId =
    typeof userId === "string" && userId.trim() ? userId.trim() : null;
  const usersResult = safeUserId
    ? await supabase.from("kinfolk_users").select("id").eq("id", safeUserId).limit(1)
    : await supabase
        .from("kinfolk_users")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(safeLimit);

  if (usersResult.error) {
    throw usersResult.error;
  }

  const totals = {
    disabled: 0,
    dryRun: 0,
    empty: 0,
    failed: 0,
    processed: 0,
    unchanged: 0,
    upserted: 0,
  };
  const failures: Array<{ error: string; userId: string }> = [];

  const results = await mapWithConcurrency(
    usersResult.data ?? [],
    profileEmbeddingBackfillConcurrency,
    async (user) => {
      try {
        const result = await refreshProfileEmbedding(supabase, user.id, {
          dryRun,
          force,
        });
        return { result, status: "fulfilled" as const, userId: user.id };
      } catch (error) {
        return { error, status: "rejected" as const, userId: user.id };
      }
    },
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.result.status === "dry_run") {
        totals.dryRun += 1;
      } else {
        totals[result.result.status] += 1;
      }
      totals.processed += 1;
    } else {
      totals.failed += 1;
      failures.push({
        error: result.error instanceof Error ? result.error.message : String(result.error),
        userId: result.userId,
      });
    }
  }

  return {
    failures,
    ...totals,
  };
}

export function shouldUseProfileEmbeddings() {
  return (
    process.env.KINFOLK_MATCH_USE_EMBEDDINGS?.trim().toLowerCase() !== "false" &&
    isProfileEmbeddingsConfigured()
  );
}

function warnMissingEmbeddingConfigOnce() {
  if (warnedMissingEmbeddingConfig) {
    return;
  }

  warnedMissingEmbeddingConfig = true;
  console.warn(
    "Profile embeddings are disabled; set OPENROUTER_API_KEY or KINFOLK_MATCH_USE_EMBEDDINGS=false to make this explicit.",
  );
}

function hasStoredEmbeddingDimension(value: unknown, dimensions: number) {
  if (Array.isArray(value)) {
    return value.length === dimensions;
  }

  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) && parsed.length === dimensions;
  } catch {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(",").length === dimensions : dimensions === 0;
  }
}

function profileFactToEmbeddingCardFact(
  fact: ProfileFactForScoring,
): ProfileEmbeddingCardFact {
  return {
    createdAt: fact.createdAt,
    dimension: fact.dimension,
    factKey: fact.factKey,
    id: fact.id,
    matchingEligible: fact.matchingEligible,
    normalizedValue: fact.normalizedValue,
    reviewState: fact.reviewState,
    sensitivityLevel: fact.sensitivityLevel,
    value: fact.value,
  };
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
