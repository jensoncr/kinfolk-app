import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  dryRunMatchingDerivedStateForUserId: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
  mapWithConcurrency: vi.fn(),
  processQueuedProfileMatchingRefreshJobs: vi.fn(),
  recomputeCompatibilityForUserIdWithStatus: vi.fn(),
  revalidateProfileDependentPaths: vi.fn(),
}));

vi.mock("@/lib/shared/job-auth", () => ({
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}));

vi.mock("@/lib/shared/concurrency", () => ({
  mapWithConcurrency: mocks.mapWithConcurrency,
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  dryRunMatchingDerivedStateForUserId:
    mocks.dryRunMatchingDerivedStateForUserId,
  processQueuedProfileMatchingRefreshJobs:
    mocks.processQueuedProfileMatchingRefreshJobs,
  recomputeCompatibilityForUserIdWithStatus:
    mocks.recomputeCompatibilityForUserIdWithStatus,
}));

vi.mock("@/lib/profiles/route-cache", () => ({
  revalidateProfileDependentPaths: mocks.revalidateProfileDependentPaths,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

import { POST } from "./route";

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/profile-compatibility", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as NextRequest;
}

function rawJsonRequest(body: string): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/profile-compatibility", {
    body,
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  }) as NextRequest;
}

function makeUsersQuery(result: {
  data: Array<{ id: string }> | null;
  error: Error | null;
}) {
  const query = {
    limit: vi.fn(async () => result),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
  };
  const supabase = {
    from: vi.fn(() => query),
  };

  return { query, supabase };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/jobs/profile-compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.dryRunMatchingDerivedStateForUserId.mockResolvedValue({
      dryRun: true,
      edgeCandidates: 2,
      rerankedCandidates: 2,
      retrievedCandidates: 3,
      staleEdgeCandidates: 1,
      status: "computed",
      userId: "user-1",
    });
    mocks.recomputeCompatibilityForUserIdWithStatus.mockImplementation(
      async (userId: string) => ({
        result: { status: "computed", userId },
        snapshot: {},
      }),
    );
    mocks.processQueuedProfileMatchingRefreshJobs.mockResolvedValue({
      claimed: 2,
      completed: 1,
      failed: 0,
      retrying: 1,
      userIds: ["user-1"],
    });
    mocks.mapWithConcurrency.mockImplementation(
      async (
        userIds: string[],
        _concurrency: number,
        refreshUser: (userId: string) => Promise<unknown>,
      ) => {
        const results: unknown[] = [];
        for (const userId of userIds) {
          results.push(await refreshUser(userId));
        }
        return results;
      },
    );
  });

  it("rejects unauthorized requests before recalculating compatibility", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValueOnce(false);

    const response = await POST(jsonRequest({ userId: "user-1" }));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.dryRunMatchingDerivedStateForUserId).not.toHaveBeenCalled();
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
    expect(mocks.processQueuedProfileMatchingRefreshJobs).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("drains durable queued refreshes without scanning all users", async () => {
    const response = await POST(jsonRequest({ limit: 999, queuedOnly: true }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      claimed: 2,
      completed: 1,
      failed: 0,
      retrying: 1,
      userIds: ["user-1"],
    });
    expect(mocks.processQueuedProfileMatchingRefreshJobs).toHaveBeenCalledWith(200);
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
  });

  it("rejects dry-running the mutating queue drain", async () => {
    const response = await POST(
      jsonRequest({ dryRun: true, queuedOnly: "true" }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Queued refresh processing does not support dry-run.",
    });
    expect(mocks.processQueuedProfileMatchingRefreshJobs).not.toHaveBeenCalled();
  });

  it("refreshes one requested user without querying the batch user list", async () => {
    const response = await POST(jsonRequest({ limit: 999, userId: "user-1" }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      processed: 1,
      userIds: ["user-1"],
    });
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledWith(
      "user-1",
    );
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.mapWithConcurrency).not.toHaveBeenCalled();
  });

  it("dry-runs one requested user without refreshing or revalidating", async () => {
    const response = await POST(
      jsonRequest({ dryRun: "true", limit: 999, userId: "  user-1  " }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      dryRun: true,
      edgeCandidates: 2,
      processed: 1,
      rerankedCandidates: 2,
      retrievedCandidates: 3,
      staleEdgeCandidates: 1,
      userIds: ["user-1"],
    });
    expect(mocks.dryRunMatchingDerivedStateForUserId).toHaveBeenCalledWith(
      "user-1",
    );
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("parses numeric and numeric-string dry-run options before choosing mode", async () => {
    const dryRunResponse = await POST(
      jsonRequest({ dryRun: 1, userId: "  user-1  " }),
    );

    expect(dryRunResponse.status).toBe(200);
    await expect(readJson(dryRunResponse)).resolves.toEqual({
      dryRun: true,
      edgeCandidates: 2,
      processed: 1,
      rerankedCandidates: 2,
      retrievedCandidates: 3,
      staleEdgeCandidates: 1,
      userIds: ["user-1"],
    });
    expect(mocks.dryRunMatchingDerivedStateForUserId).toHaveBeenCalledWith(
      "user-1",
    );
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();

    vi.clearAllMocks();

    const mutatingResponse = await POST(
      jsonRequest({ dryRun: "0", userId: "user-1" }),
    );

    expect(mutatingResponse.status).toBe(200);
    await expect(readJson(mutatingResponse)).resolves.toEqual({
      processed: 1,
      userIds: ["user-1"],
    });
    expect(mocks.dryRunMatchingDerivedStateForUserId).not.toHaveBeenCalled();
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledWith(
      "user-1",
    );
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("trims requested user ids before running a single-user refresh", async () => {
    const response = await POST(jsonRequest({ userId: "  user-1  " }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      processed: 1,
      userIds: ["user-1"],
    });
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledWith(
      "user-1",
    );
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("reports a missing requested user without claiming a refresh", async () => {
    mocks.recomputeCompatibilityForUserIdWithStatus.mockResolvedValueOnce({
      result: { status: "missing_user", userId: "missing-user" },
      snapshot: {},
    });

    const response = await POST(jsonRequest({ userId: "missing-user" }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      processed: 0,
      userIds: [],
    });
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledWith(
      "missing-user",
    );
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("clamps a batch run limit and refreshes returned users with bounded concurrency", async () => {
    const { query, supabase } = makeUsersQuery({
      data: [{ id: "user-1" }, { id: "user-2" }],
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await POST(jsonRequest({ limit: 999 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 0,
      failures: [],
      processed: 2,
      userIds: ["user-1", "user-2"],
    });
    expect(supabase.from).toHaveBeenCalledWith("kinfolk_users");
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.order).toHaveBeenCalledWith("updated_at", {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(200);
    expect(mocks.mapWithConcurrency).toHaveBeenCalledWith(
      ["user-1", "user-2"],
      6,
      expect.any(Function),
    );
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledTimes(2);
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledWith(
      "user-1",
    );
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledWith(
      "user-2",
    );
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("dry-runs a batch with bounded concurrency and aggregates read-only counts", async () => {
    const { query, supabase } = makeUsersQuery({
      data: [{ id: "user-1" }, { id: "user-2" }],
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    mocks.dryRunMatchingDerivedStateForUserId.mockImplementation(
      async (userId: string) => ({
        dryRun: true,
        edgeCandidates: userId === "user-1" ? 2 : 1,
        rerankedCandidates: 1,
        retrievedCandidates: userId === "user-1" ? 3 : 2,
        staleEdgeCandidates: userId === "user-1" ? 1 : 0,
        status: "computed",
        userId,
      }),
    );

    const response = await POST(jsonRequest({ dryRun: true, limit: 2 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      dryRun: true,
      edgeCandidates: 3,
      failed: 0,
      failures: [],
      processed: 2,
      rerankedCandidates: 2,
      retrievedCandidates: 5,
      staleEdgeCandidates: 1,
      userIds: ["user-1", "user-2"],
    });
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(mocks.mapWithConcurrency).toHaveBeenCalledWith(
      ["user-1", "user-2"],
      6,
      expect.any(Function),
    );
    expect(mocks.dryRunMatchingDerivedStateForUserId).toHaveBeenCalledWith(
      "user-1",
    );
    expect(mocks.dryRunMatchingDerivedStateForUserId).toHaveBeenCalledWith(
      "user-2",
    );
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("does not count batch users that disappear before mutating recompute", async () => {
    const { supabase } = makeUsersQuery({
      data: [{ id: "user-1" }, { id: "deleted-user" }],
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    mocks.recomputeCompatibilityForUserIdWithStatus.mockImplementation(
      async (userId: string) => ({
        result: {
          status: userId === "deleted-user" ? "missing_user" : "computed",
          userId,
        },
        snapshot: {},
      }),
    );

    const response = await POST(jsonRequest({ limit: 2 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 0,
      failures: [],
      missingUserIds: ["deleted-user"],
      processed: 1,
      userIds: ["user-1"],
    });
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledTimes(2);
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("does not count batch users that disappear before dry-run recompute", async () => {
    const { supabase } = makeUsersQuery({
      data: [{ id: "user-1" }, { id: "deleted-user" }],
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    mocks.dryRunMatchingDerivedStateForUserId.mockImplementation(
      async (userId: string) =>
        userId === "deleted-user"
          ? {
              dryRun: true,
              edgeCandidates: 0,
              rerankedCandidates: 0,
              retrievedCandidates: 0,
              staleEdgeCandidates: 0,
              status: "missing_user",
              userId,
            }
          : {
              dryRun: true,
              edgeCandidates: 2,
              rerankedCandidates: 2,
              retrievedCandidates: 3,
              staleEdgeCandidates: 1,
              status: "computed",
              userId,
            },
    );

    const response = await POST(jsonRequest({ dryRun: true, limit: 2 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      dryRun: true,
      edgeCandidates: 2,
      failed: 0,
      failures: [],
      missingUserIds: ["deleted-user"],
      processed: 1,
      rerankedCandidates: 2,
      retrievedCandidates: 3,
      staleEdgeCandidates: 1,
      userIds: ["user-1"],
    });
    expect(mocks.dryRunMatchingDerivedStateForUserId).toHaveBeenCalledTimes(2);
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("continues batch refreshes and reports redacted failed users when one user fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { supabase } = makeUsersQuery({
      data: [{ id: "user-1" }, { id: "user-2" }, { id: "user-3" }],
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    const error = new Error("Could not refresh user-2: provider-token");
    mocks.recomputeCompatibilityForUserIdWithStatus.mockImplementation(
      async (userId: string) => {
        if (userId === "user-2") {
          throw error;
        }
        return {
          result: { status: "computed", userId },
          snapshot: {},
        };
      },
    );

    const response = await POST(jsonRequest({ limit: 3 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 1,
      failures: [
        {
          error: "Profile compatibility refresh failed.",
          status: "rejected",
          userId: "user-2",
        },
      ],
      processed: 2,
      userIds: ["user-1", "user-3"],
    });
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledTimes(3);
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).toHaveBeenCalledWith(
      "user-3",
    );
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[profile-compatibility-job] user refresh failed",
      {
        error,
        userId: "user-2",
      },
    );
    consoleError.mockRestore();
  });

  it("falls back to batch defaults for null, array, and primitive JSON bodies", async () => {
    for (const body of [null, [], "oops", 42, false]) {
      vi.clearAllMocks();
      mocks.isAuthorizedJobRequest.mockReturnValue(true);
      mocks.mapWithConcurrency.mockImplementation(
        async (
          userIds: string[],
          _concurrency: number,
          refreshUser: (userId: string) => Promise<unknown>,
        ) => {
          const results: unknown[] = [];
          for (const userId of userIds) {
            results.push(await refreshUser(userId));
          }
          return results;
        },
      );
      const { query, supabase } = makeUsersQuery({ data: [], error: null });
      mocks.createSupabaseServiceClient.mockReturnValue(supabase);

      const response = await POST(jsonRequest(body));

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        failed: 0,
        failures: [],
        processed: 0,
        userIds: [],
      });
      expect(query.limit).toHaveBeenCalledWith(50);
      expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
      expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    }
  });

  it("uses the default batch size for blank, nullish, boolean, and non-integer limits", async () => {
    for (const limit of ["", "   ", null, false, "12.5"]) {
      vi.clearAllMocks();
      mocks.isAuthorizedJobRequest.mockReturnValue(true);
      mocks.mapWithConcurrency.mockImplementation(
        async (
          userIds: string[],
          _concurrency: number,
          refreshUser: (userId: string) => Promise<unknown>,
        ) => {
          const results: unknown[] = [];
          for (const userId of userIds) {
            results.push(await refreshUser(userId));
          }
          return results;
        },
      );
      const { query, supabase } = makeUsersQuery({ data: [], error: null });
      mocks.createSupabaseServiceClient.mockReturnValue(supabase);

      const response = await POST(jsonRequest({ limit }));

      expect(response.status).toBe(200);
      expect(query.limit).toHaveBeenCalledWith(50);
      expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
      expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    }
  });

  it("treats blank user ids as a batch refresh instead of a single-user refresh", async () => {
    const { query, supabase } = makeUsersQuery({ data: [], error: null });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await POST(jsonRequest({ limit: 3, userId: "   " }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 0,
      failures: [],
      processed: 0,
      userIds: [],
    });
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before creating a service client", async () => {
    const response = await POST(rawJsonRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.dryRunMatchingDerivedStateForUserId).not.toHaveBeenCalled();
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
    expect(mocks.mapWithConcurrency).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("returns redacted JSON when the batch user query fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Could not load users: service-role-token");
    const { supabase } = makeUsersQuery({
      data: null,
      error,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await POST(jsonRequest({ limit: 10 }));

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({
      error: "Profile compatibility job failed.",
    });
    expect(JSON.stringify(json)).not.toContain("service-role-token");
    expect(consoleError).toHaveBeenCalledWith(
      "[profile-compatibility-job] batch failed",
      error,
    );
    expect(mocks.recomputeCompatibilityForUserIdWithStatus).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
