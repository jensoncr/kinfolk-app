import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { processQueuedProfileMatchingRefreshJobs } from "./enrichment-store";

function fluentQuery(result: { data: unknown; error: Error | null }) {
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "limit", "order", "select", "update"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query as {
    eq: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

describe("processQueuedProfileMatchingRefreshJobs", () => {
  it("returns without touching tables when no durable work is due", async () => {
    const supabase = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    await expect(
      processQueuedProfileMatchingRefreshJobs(25, supabase as never),
    ).resolves.toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      retrying: 0,
      userIds: [],
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "claim_profile_matching_refresh_jobs",
      { p_limit: 25 },
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    { attemptCount: 1, expectedStatus: "queued", outcome: "retrying" },
    { attemptCount: 5, expectedStatus: "failed", outcome: "failed" },
  ])(
    "persists $outcome state after attempt $attemptCount",
    async ({ attemptCount, expectedStatus, outcome }) => {
      const projectionFailure = new Error("projection unavailable");
      const importQuery = fluentQuery({ data: null, error: projectionFailure });
      const jobQuery = fluentQuery({ data: null, error: null });
      const supabase = {
        from: vi.fn((table: string) => {
          if (table === "profile_imports") return importQuery;
          if (table === "profile_matching_refresh_jobs") return jobQuery;
          throw new Error(`Unexpected table: ${table}`);
        }),
        rpc: vi.fn().mockResolvedValue({
          data: [
            {
              attempt_count: attemptCount,
              requested_at: "2026-07-11T20:00:00.000Z",
              user_id: "user-1",
            },
          ],
          error: null,
        }),
      };

      const result = await processQueuedProfileMatchingRefreshJobs(
        1,
        supabase as never,
      );

      expect(result).toEqual({
        claimed: 1,
        completed: 0,
        failed: outcome === "failed" ? 1 : 0,
        retrying: outcome === "retrying" ? 1 : 0,
        userIds: [],
      });
      expect(jobQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          last_error: "Error: projection unavailable",
          locked_at: null,
          status: expectedStatus,
        }),
      );
      expect(jobQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(jobQuery.eq).toHaveBeenCalledWith("status", "running");
      expect(jobQuery.eq).toHaveBeenCalledWith(
        "requested_at",
        "2026-07-11T20:00:00.000Z",
      );
    },
  );
});
