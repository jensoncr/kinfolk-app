import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  compatibilityEdgesIn: vi.fn(),
  compatibilityEdgesUpdate: vi.fn(),
  compatibilityEdgesUpsert: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  loadAggregateProfileEmbedding: vi.fn(),
  loadSavedPlacesForUsers: vi.fn(),
  retrieveProfileEmbeddingCandidates: vi.fn(),
  rerankCompatibilityCandidates: vi.fn(),
  shouldUseProfileEmbeddings: vi.fn(),
  upsertProfileEmbeddingForUser: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

vi.mock("@/lib/profiles/embeddings-store", () => ({
  loadAggregateProfileEmbedding: mocks.loadAggregateProfileEmbedding,
  retrieveProfileEmbeddingCandidates: mocks.retrieveProfileEmbeddingCandidates,
  shouldUseProfileEmbeddings: mocks.shouldUseProfileEmbeddings,
  upsertProfileEmbeddingForUser: mocks.upsertProfileEmbeddingForUser,
}));

vi.mock("@/lib/plan/saved-places-reader", () => ({
  loadSavedPlacesForUsers: mocks.loadSavedPlacesForUsers,
}));

vi.mock("@/lib/matching/profile-compatibility-rerank", () => ({
  rerankCompatibilityCandidates: mocks.rerankCompatibilityCandidates,
}));

import {
  dryRunMatchingDerivedStateForUserId,
  recomputeCompatibilityForUserId,
  recomputeCompatibilityForUserIdWithStatus,
} from "./enrichment-store";

type QueryOperation = {
  args: unknown[];
  name: string;
};

const now = "2026-06-23T12:00:00.000Z";
const observedQueryLimits: { table: string; value: unknown }[] = [];

describe("dryRunMatchingDerivedStateForUserId", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    observedQueryLimits.length = 0;
    mocks.compatibilityEdgesUpdate.mockReturnValue(undefined);
    mocks.compatibilityEdgesUpsert.mockResolvedValue({ data: null, error: null });
    mocks.createSupabaseServiceClient.mockReturnValue(makeDryRunSupabase());
    mocks.loadAggregateProfileEmbedding.mockResolvedValue(null);
    mocks.loadSavedPlacesForUsers.mockImplementation(async (
      _supabase: unknown,
      ids: string[],
    ) => {
      return new Map(
        ids.map((id) => [
          id,
          { savedAreaLabels: [], savedListingIds: [] },
        ]),
      );
    });
    mocks.retrieveProfileEmbeddingCandidates.mockResolvedValue([]);
    mocks.rerankCompatibilityCandidates.mockReturnValue([
      {
        score: {
          components: { lifestyle: 88 },
          evidence: [{ label: "Shared timing", weight: 0.8 }],
          risks: [],
          score: 88,
        },
        userId: "candidate-1",
      },
    ]);
    mocks.shouldUseProfileEmbeddings.mockReturnValue(false);
    mocks.upsertProfileEmbeddingForUser.mockResolvedValue({
      dryRun: true,
      status: "dry_run",
      userId: "viewer-1",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("computes candidate totals without writing compatibility edges", async () => {
    await expect(
      dryRunMatchingDerivedStateForUserId("viewer-1"),
    ).resolves.toMatchObject({
      dryRun: true,
      edgeCandidates: 1,
      rerankedCandidates: 1,
      retrievedCandidates: 1,
      staleEdgeCandidates: 1,
      status: "computed",
      userId: "viewer-1",
    });

    expect(mocks.upsertProfileEmbeddingForUser).toHaveBeenCalledWith(
      expect.anything(),
      "viewer-1",
      { dryRun: true },
    );
    expect(mocks.rerankCompatibilityCandidates).toHaveBeenCalledTimes(1);
    expect(mocks.compatibilityEdgesUpsert).not.toHaveBeenCalled();
    expect(mocks.compatibilityEdgesUpdate).not.toHaveBeenCalled();
  });

  it("upserts active edges and marks dropped edges stale during mutating recompute", async () => {
    await expect(
      recomputeCompatibilityForUserId("viewer-1"),
    ).resolves.toMatchObject({
      source: {
        status: "connected",
      },
    });

    expect(mocks.upsertProfileEmbeddingForUser).toHaveBeenCalledWith(
      expect.anything(),
      "viewer-1",
      {},
    );
    expect(mocks.compatibilityEdgesUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          score: 88,
          status: "active",
          user_a_id: "candidate-1",
          user_b_id: "viewer-1",
        }),
      ],
      { onConflict: "user_a_id,user_b_id" },
    );
    expect(mocks.compatibilityEdgesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        computed_at: expect.any(String),
        status: "stale",
      }),
    );
    expect(mocks.compatibilityEdgesIn).toHaveBeenCalledWith("id", [
      "stale-edge-1",
    ]);
  });

  it("reports missing users without writing compatibility edges", async () => {
    await expect(
      recomputeCompatibilityForUserIdWithStatus("missing-user"),
    ).resolves.toMatchObject({
      result: {
        status: "missing_user",
        userId: "missing-user",
      },
      snapshot: {
        source: {
          status: "connected",
        },
      },
    });

    expect(mocks.upsertProfileEmbeddingForUser).not.toHaveBeenCalled();
    expect(mocks.compatibilityEdgesUpsert).not.toHaveBeenCalled();
    expect(mocks.compatibilityEdgesUpdate).not.toHaveBeenCalled();
  });

  it("normalizes direct compatibility user ids before reading and writing match state", async () => {
    await expect(
      recomputeCompatibilityForUserIdWithStatus("  viewer-1  "),
    ).resolves.toMatchObject({
      result: {
        status: "computed",
        userId: "viewer-1",
      },
    });

    expect(mocks.upsertProfileEmbeddingForUser).toHaveBeenCalledWith(
      expect.anything(),
      "viewer-1",
      {},
    );
    expect(mocks.compatibilityEdgesUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          status: "active",
          user_b_id: "viewer-1",
        }),
      ],
      { onConflict: "user_a_id,user_b_id" },
    );
    expect(mocks.compatibilityEdgesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "stale",
      }),
    );
    expect(mocks.compatibilityEdgesIn).toHaveBeenCalledWith("id", [
      "stale-edge-1",
    ]);
  });

  it("rejects blank direct compatibility user ids before creating a service client", async () => {
    await expect(dryRunMatchingDerivedStateForUserId("   ")).rejects.toThrow(
      "Profile compatibility user id is required.",
    );

    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.upsertProfileEmbeddingForUser).not.toHaveBeenCalled();
    expect(mocks.compatibilityEdgesUpsert).not.toHaveBeenCalled();
    expect(mocks.compatibilityEdgesUpdate).not.toHaveBeenCalled();
  });

  it("uses default candidate limits when compatibility limit env is blank", async () => {
    vi.stubEnv("KINFOLK_MATCH_RERANK_LIMIT", " ");

    await expect(
      dryRunMatchingDerivedStateForUserId("viewer-1"),
    ).resolves.toMatchObject({
      dryRun: true,
      status: "computed",
      userId: "viewer-1",
    });

    expect(observedQueryLimits).toEqual(
      expect.arrayContaining([
        { table: "matching_profiles", value: 80 },
        { table: "profile_facts", value: 320 },
      ]),
    );
  });

  it("uses the default embedding similarity floor when min-cosine env is blank", async () => {
    vi.stubEnv("KINFOLK_MATCH_MIN_COSINE", " ");
    mocks.shouldUseProfileEmbeddings.mockReturnValue(true);
    mocks.loadAggregateProfileEmbedding.mockResolvedValue({
      embedding: [0.12, 0.34, 0.56],
    });

    await expect(
      dryRunMatchingDerivedStateForUserId("viewer-1"),
    ).resolves.toMatchObject({
      dryRun: true,
      status: "computed",
      userId: "viewer-1",
    });

    expect(mocks.retrieveProfileEmbeddingCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        minCosine: 0.25,
        queryEmbedding: [0.12, 0.34, 0.56],
        viewerId: "viewer-1",
      }),
    );
  });

  it("falls back to rule candidates when profile embedding retrieval fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.shouldUseProfileEmbeddings.mockReturnValue(true);
    mocks.loadAggregateProfileEmbedding.mockResolvedValue({
      embedding: [0.12, 0.34, 0.56],
    });
    mocks.retrieveProfileEmbeddingCandidates.mockRejectedValueOnce(
      new Error("Embedding RPC unavailable."),
    );

    await expect(
      dryRunMatchingDerivedStateForUserId("viewer-1"),
    ).resolves.toMatchObject({
      dryRun: true,
      edgeCandidates: 1,
      rerankedCandidates: 1,
      retrievedCandidates: 1,
      status: "computed",
      userId: "viewer-1",
    });

    expect(mocks.retrieveProfileEmbeddingCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        queryEmbedding: [0.12, 0.34, 0.56],
        viewerId: "viewer-1",
      }),
    );
    expect(mocks.rerankCompatibilityCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "viewer-1" }),
      [
        expect.objectContaining({
          cosineSimilarity: null,
          semanticRank: null,
          userId: "candidate-1",
        }),
      ],
      80,
      expect.any(Map),
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      "Profile embedding retrieval failed; using fallback candidates.",
      expect.objectContaining({
        error: expect.any(Error),
        userId: "viewer-1",
      }),
    );
    expect(mocks.compatibilityEdgesUpsert).not.toHaveBeenCalled();
    expect(mocks.compatibilityEdgesUpdate).not.toHaveBeenCalled();
  });
});

function makeDryRunSupabase() {
  return {
    from: vi.fn((table: string) => makeQuery(table)),
  };
}

function makeQuery(table: string) {
  const operations: QueryOperation[] = [];
  const query = {
    eq: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "eq" });
      return query;
    }),
    in: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "in" });
      if (table === "compatibility_edges") {
        mocks.compatibilityEdgesIn(...args);
      }
      return query;
    }),
    limit: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "limit" });
      observedQueryLimits.push({ table, value: args[0] });
      return Promise.resolve(resolveResult(table, operations));
    }),
    maybeSingle: vi.fn(() =>
      Promise.resolve(resolveMaybeSingle(table, operations)),
    ),
    neq: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "neq" });
      return query;
    }),
    or: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "or" });
      return query;
    }),
    order: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "order" });
      return query;
    }),
    overlaps: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "overlaps" });
      return query;
    }),
    select: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "select" });
      return query;
    }),
    then: (
      onFulfilled: (result: unknown) => unknown,
      onRejected?: (error: unknown) => unknown,
    ) => Promise.resolve(resolveResult(table, operations)).then(onFulfilled, onRejected),
    update: vi.fn((...args: unknown[]) => {
      operations.push({ args, name: "update" });
      if (table === "compatibility_edges") {
        mocks.compatibilityEdgesUpdate(...args);
      }
      return query;
    }),
    upsert: vi.fn((...args: unknown[]) => {
      if (table === "compatibility_edges") {
        mocks.compatibilityEdgesUpsert(...args);
      }
      return Promise.resolve({ data: null, error: null });
    }),
  };

  return query;
}

function resolveMaybeSingle(table: string, operations: QueryOperation[]) {
  if (table === "kinfolk_users") {
    const userId = findOperationValue(operations, "eq", "id");
    return {
      data: userId === "viewer-1" ? userRow("viewer-1") : null,
      error: null,
    };
  }
  return { data: null, error: null };
}

function resolveResult(table: string, operations: QueryOperation[]) {
  if (table === "kinfolk_users") {
    return { data: usersForOperations(operations), error: null };
  }
  if (table === "profile_facts") {
    return { data: [], error: null };
  }
  if (table === "matching_profiles") {
    if (hasOperation(operations, "neq", "user_id")) {
      return { data: [matchingProfileRow("candidate-1")], error: null };
    }
    return { data: profilesForOperations(operations), error: null };
  }
  if (table === "roommate_preferences") {
    return { data: [], error: null };
  }
  if (table === "compatibility_edges") {
    return {
      data: [
        {
          computed_at: now,
          evidence: [],
          id: "stale-edge-1",
          risks: [],
          score: 42,
          score_components: { lifestyle: 42 },
          status: "active",
          user_a_id: "viewer-1",
          user_b_id: "stale-user",
        },
        {
          computed_at: now,
          evidence: [],
          id: "already-stale-edge",
          risks: [],
          score: 41,
          score_components: { lifestyle: 41 },
          status: "stale",
          user_a_id: "viewer-1",
          user_b_id: "already-stale-user",
        },
        {
          computed_at: now,
          evidence: [],
          id: "hidden-edge",
          risks: [],
          score: 40,
          score_components: { lifestyle: 40 },
          status: "hidden",
          user_a_id: "viewer-1",
          user_b_id: "hidden-user",
        },
      ],
      error: null,
    };
  }

  return { data: [], error: null };
}

function usersForOperations(operations: QueryOperation[]) {
  const ids = findOperationValue(operations, "in", "id") as string[] | null;
  return (ids ?? []).map((id) => userRow(id));
}

function profilesForOperations(operations: QueryOperation[]) {
  const ids = findOperationValue(operations, "in", "user_id") as
    | string[]
    | null;
  return (ids ?? []).map((id) => matchingProfileRow(id));
}

function hasOperation(
  operations: QueryOperation[],
  name: string,
  column: string,
) {
  return operations.some(
    (operation) => operation.name === name && operation.args[0] === column,
  );
}

function findOperationValue(
  operations: QueryOperation[],
  name: string,
  column: string,
) {
  return operations.find(
    (operation) => operation.name === name && operation.args[0] === column,
  )?.args[1] ?? null;
}

function userRow(id: string) {
  return {
    about_text: null,
    birth_year: null,
    created_at: now,
    date_of_birth: null,
    display_name: id === "viewer-1" ? "Viewer" : "Candidate",
    education_school: null,
    id,
    interests: [],
    occupation_company: null,
    updated_at: now,
  };
}

function matchingProfileRow(userId: string) {
  return {
    budget_max: 4200,
    budget_min: 2500,
    created_at: now,
    household_size_max: 3,
    household_size_min: 2,
    id: `profile-${userId}`,
    move_in_end: null,
    move_in_start: null,
    target_markets: ["san-francisco-ca"],
    updated_at: now,
    user_id: userId,
  };
}
