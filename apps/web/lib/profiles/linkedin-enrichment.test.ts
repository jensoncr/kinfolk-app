import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/clerk-user", () => ({ getCurrentClerkLinkedInIdentity: vi.fn() }));
vi.mock(
  "@/lib/profiles/linkedin-url",
  () => ({
    normalizeLinkedInProfileUrl: (value: unknown) =>
      typeof value === "string" && /^https?:\/\//.test(value) ? value : null,
  }),
);
vi.mock("@/lib/profiles/linkedin-trust-facts", () => ({ buildLinkedInTrustFacts: vi.fn() }));
vi.mock(
  "@/lib/profiles/enrichment-store",
  () => ({
    createProfileImportForUserId: vi.fn(),
    reviewProfileImportForUserId: vi.fn(),
  }),
);
vi.mock("@/lib/shared/users", () => ({ upsertKinfolkUserFromClerk: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ hasServerSupabaseConfig: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn() }));

import { getCurrentClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import { buildLinkedInTrustFacts } from "@/lib/profiles/linkedin-trust-facts";
import { upsertKinfolkUserFromClerk } from "@/lib/shared/users";
import { hasServerSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  classifyLinkedInProviderHttpFailure,
  normalizeExternalPayload,
  processLinkedInEnrichmentJobs,
  readLinkedInIdentityProfileImageUrl,
  runCurrentUserLinkedInEnrichment,
  runCurrentUserLinkedInEnrichmentFromUrl,
} from "./linkedin-enrichment";

const identity = {
  clerkUserId: "user_123",
  displayName: "Alex Rivera",
  email: "alex@example.com",
  avatarUrl: "",
  linkedin: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildLinkedInTrustFacts).mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("classifyLinkedInProviderHttpFailure", () => {
  it("treats provider authentication failures as non-retryable configuration failures", () => {
    for (const status of [401, 403]) {
      expect(
        classifyLinkedInProviderHttpFailure(status, "credentials rejected"),
      ).toMatchObject({
        kind: "source_not_configured",
        providerStatus: status,
        publicMessage:
          "LinkedIn enrichment is temporarily unavailable. Your profile URL was saved, so you can continue and try again later.",
      });
    }
  });

  it("keeps transient provider failures retryable", () => {
    expect(
      classifyLinkedInProviderHttpFailure(503, "upstream unavailable"),
    ).toMatchObject({
      kind: "retryable",
      providerStatus: 503,
      publicMessage:
        "LinkedIn enrichment is taking longer than expected. Your profile URL was saved and enrichment will retry automatically.",
    });
  });

  it("fails other permanent provider 4xx responses without retrying", () => {
    expect(
      classifyLinkedInProviderHttpFailure(422, "invalid dataset input"),
    ).toMatchObject({
      kind: "terminal",
      providerStatus: 422,
      publicMessage:
        "We couldn't enrich this LinkedIn profile right now. Your profile URL was saved, so you can continue and try again later.",
    });
  });
});

describe("processLinkedInEnrichmentJobs dry-run", () => {
  it("counts due queued jobs without claiming jobs or calling providers", async () => {
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    const writeMethods = {
      insert: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    };
    const query = {
      eq: vi.fn(() => query),
      insert: writeMethods.insert,
      limit: vi.fn(async () => ({
        data: [
          { id: "job-1", status: "queued" },
          { id: "job-2", status: "queued" },
        ],
        error: null,
      })),
      lte: vi.fn(() => query),
      order: vi.fn(() => query),
      select: vi.fn(() => query),
      update: writeMethods.update,
      upsert: writeMethods.upsert,
    };
    const supabase = {
      from: vi.fn(() => query),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      processLinkedInEnrichmentJobs(2, { dryRun: true }),
    ).resolves.toEqual({
      dryRun: true,
      failed: 0,
      processed: 0,
      queued: 2,
      ready: 0,
      skipped: 0,
    });

    expect(supabase.from).toHaveBeenCalledWith("linkedin_enrichment_jobs");
    expect(query.select).toHaveBeenCalledWith("*");
    expect(query.eq).toHaveBeenCalledWith("status", "queued");
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(writeMethods.insert).not.toHaveBeenCalled();
    expect(writeMethods.update).not.toHaveBeenCalled();
    expect(writeMethods.upsert).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("defaults malformed direct scheduler limits before reading queued jobs", async () => {
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    const { query } = createLinkedInJobsDryRunStub([
      { id: "job-1", status: "queued" },
    ]);

    await expect(
      processLinkedInEnrichmentJobs(Number.NaN, { dryRun: true }),
    ).resolves.toEqual({
      dryRun: true,
      failed: 0,
      processed: 0,
      queued: 1,
      ready: 0,
      skipped: 0,
    });

    expect(query.limit).toHaveBeenCalledWith(5);
  });

  it("clamps oversized direct scheduler limits before reading queued jobs", async () => {
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    const { query } = createLinkedInJobsDryRunStub([]);

    await processLinkedInEnrichmentJobs(999, { dryRun: true });

    expect(query.limit).toHaveBeenCalledWith(25);
  });

  it("requeues stale running jobs before reading the queued batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);

    const updatePayloads: Record<string, unknown>[] = [];
    const updateFilters: Array<[string, unknown]> = [];
    const updateLteFilters: Array<[string, unknown]> = [];
    const selectLteFilters: Array<[string, unknown]> = [];
    const updateQuery = {
      eq: vi.fn((column: string, value: unknown) => {
        updateFilters.push([column, value]);
        return updateQuery;
      }),
      lte: vi.fn(async (column: string, value: unknown) => {
        updateLteFilters.push([column, value]);
        return { data: null, error: null };
      }),
    };
    const selectQuery = {
      eq: vi.fn(() => selectQuery),
      limit: vi.fn(async () => ({ data: [], error: null })),
      lte: vi.fn((column: string, value: unknown) => {
        selectLteFilters.push([column, value]);
        return selectQuery;
      }),
      order: vi.fn(() => selectQuery),
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== "linkedin_enrichment_jobs") {
          throw new Error(`Unexpected table ${table}`);
        }
        return {
          select: vi.fn(() => selectQuery),
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return updateQuery;
          }),
        };
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    await expect(processLinkedInEnrichmentJobs(5)).resolves.toEqual({
      failed: 0,
      processed: 0,
      ready: 0,
      skipped: 0,
    });

    expect(updatePayloads).toEqual([
      {
        completed_at: null,
        last_error: "Retrying stale running LinkedIn enrichment job.",
        locked_at: null,
        next_attempt_at: "2026-06-24T12:00:00.000Z",
        status: "queued",
      },
    ]);
    expect(updateFilters).toEqual([["status", "running"]]);
    expect(updateLteFilters).toEqual([
      ["locked_at", "2026-06-24T11:30:00.000Z"],
    ]);
    expect(selectLteFilters).toEqual([
      ["next_attempt_at", "2026-06-24T12:00:00.000Z"],
    ]);
  });

  it("skips queued jobs that are no longer claimable before provider work", async () => {
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const job = {
      attempt_count: 0,
      clerk_user_id: "clerk-1",
      completed_at: null,
      created_at: "2026-06-23T18:00:00.000Z",
      display_name: "Jenson Cripps",
      email: "jenson@example.com",
      id: "job-1",
      idempotency_key: "linkedin:clerk-1:manual-url",
      image_url: null,
      last_error: null,
      linkedin_url: "https://www.linkedin.com/in/jensoncripps/",
      locked_at: null,
      next_attempt_at: "2026-06-23T18:00:00.000Z",
      provider_user_id: null,
      status: "queued",
      updated_at: "2026-06-23T18:00:00.000Z",
      user_id: "user-1",
    };
    const updatePayloads: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== "linkedin_enrichment_jobs") {
          throw new Error(`Unexpected table ${table}`);
        }
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [job],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            if (
              payload.last_error ===
              "Retrying stale running LinkedIn enrichment job."
            ) {
              return {
                eq: () => ({
                  lte: async () => ({ data: null, error: null }),
                }),
              };
            }

            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    await expect(processLinkedInEnrichmentJobs(1)).resolves.toEqual({
      failed: 0,
      processed: 0,
      ready: 0,
      skipped: 0,
    });

    expect(updatePayloads).toEqual([
      expect.objectContaining({
        last_error: "Retrying stale running LinkedIn enrichment job.",
        status: "queued",
      }),
      expect.objectContaining({
        attempt_count: 1,
        last_error: null,
        status: "running",
      }),
    ]);
    expect(supabase.from).toHaveBeenCalledTimes(3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the batch alive when one claimed job cannot record its failure", async () => {
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = {
      attempt_count: 1,
      clerk_user_id: "clerk-1",
      completed_at: null,
      created_at: "2026-06-23T18:00:00.000Z",
      display_name: "Jenson Cripps",
      email: "jenson@example.com",
      id: "job-1",
      idempotency_key: "linkedin:clerk-1:manual-url",
      image_url: null,
      last_error: null,
      linkedin_url: "https://www.linkedin.com/in/jensoncripps/",
      locked_at: null,
      next_attempt_at: "2026-06-23T18:00:00.000Z",
      provider_user_id: null,
      status: "queued",
      updated_at: "2026-06-23T18:00:00.000Z",
      user_id: "user-1",
    };
    const updatePayloads: unknown[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "linkedin_enrichment_jobs") {
          return {
            select: () => ({
              eq: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [job],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload);
              if (
                payload.last_error ===
                "Retrying stale running LinkedIn enrichment job."
              ) {
                return {
                  eq: () => ({
                    lte: async () => ({ data: null, error: null }),
                  }),
                };
              }
              if (payload.status === "running") {
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({
                          data: { ...job, attempt_count: 2, status: "running" },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                };
              }
              return {
                eq: () =>
                  Promise.resolve({
                    data: null,
                    error: new Error("failure marker unavailable"),
                  }),
              };
            },
          };
        }
        if (table === "professional_profiles") {
          return {
            upsert: async () => ({
              data: null,
              error: new Error("profile status unavailable"),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    await expect(processLinkedInEnrichmentJobs(1)).resolves.toEqual({
      failed: 1,
      processed: 1,
      ready: 0,
      skipped: 0,
    });

    expect(updatePayloads.slice(1)).toEqual([
      expect.objectContaining({ status: "running" }),
      expect.objectContaining({
        last_error: "profile status unavailable",
        status: "queued",
      }),
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "[LinkedIn enrichment] job processing failed",
      expect.objectContaining({
        error: "failure marker unavailable",
        jobId: "job-1",
        userId: "user-1",
      }),
    );
  });

  it("uses the default retry budget when max-attempts env is blank", async () => {
    vi.stubEnv("LINKEDIN_ENRICHMENT_MAX_ATTEMPTS", " ");
    vi.stubEnv("LINKEDIN_ENRICHMENT_ENDPOINT", "https://provider.example/linkedin");
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream unavailable", { status: 503 }),
    );
    const job = {
      attempt_count: 0,
      clerk_user_id: "clerk-1",
      completed_at: null,
      created_at: "2026-06-23T18:00:00.000Z",
      display_name: "Jenson Cripps",
      email: "jenson@example.com",
      id: "job-1",
      idempotency_key: "linkedin:clerk-1:manual-url",
      image_url: null,
      last_error: null,
      linkedin_url: "https://www.linkedin.com/in/jensoncripps/",
      locked_at: null,
      next_attempt_at: "2026-06-23T18:00:00.000Z",
      provider_user_id: null,
      status: "queued",
      updated_at: "2026-06-23T18:00:00.000Z",
      user_id: "user-1",
    };
    const updatePayloads: Record<string, unknown>[] = [];
    const profileUpserts: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "linkedin_enrichment_jobs") {
          return {
            select: () => ({
              eq: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [job],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload);
              if (
                payload.last_error ===
                "Retrying stale running LinkedIn enrichment job."
              ) {
                return {
                  eq: () => ({
                    lte: async () => ({ data: null, error: null }),
                  }),
                };
              }
              if (payload.status === "running") {
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({
                          data: { ...job, attempt_count: 1, status: "running" },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                };
              }
              return {
                eq: () =>
                  Promise.resolve({
                    data: null,
                    error: null,
                  }),
              };
            },
          };
        }
        if (table === "professional_profiles") {
          return {
            upsert: async (payload: Record<string, unknown>) => {
              profileUpserts.push(payload);
              return { data: null, error: null };
            },
          };
        }
        if (table === "kinfolk_users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "profile_facts") {
          const query = {
            eq: () => query,
            gte: () => query,
            in: () => query,
            select: () => query,
            then: (
              onFulfilled: (result: unknown) => unknown,
              onRejected?: (error: unknown) => unknown,
            ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
          };
          return query;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    await expect(processLinkedInEnrichmentJobs(1)).resolves.toEqual({
      failed: 0,
      processed: 1,
      ready: 0,
      skipped: 0,
    });

    expect(updatePayloads.slice(1)).toEqual([
      expect.objectContaining({ attempt_count: 1, status: "running" }),
      expect.objectContaining({
        completed_at: null,
        last_error: "LinkedIn enrichment provider returned 503.",
        status: "queued",
      }),
    ]);
    expect(profileUpserts).toEqual([
      expect.objectContaining({
        enrichment_status: "running",
        last_enrichment_error: null,
        user_id: "user-1",
      }),
      expect.objectContaining({
        enrichment_status: "queued",
        last_enrichment_error:
          "LinkedIn enrichment is taking longer than expected. Your profile URL was saved and enrichment will retry automatically.",
        user_id: "user-1",
      }),
    ]);
  });

  it("stops retrying provider authentication failures and exposes only a safe reason", async () => {
    vi.stubEnv("LINKEDIN_ENRICHMENT_ENDPOINT", "https://provider.example/linkedin");
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("credentials rejected", { status: 403 }),
    );
    const job = {
      attempt_count: 0,
      clerk_user_id: "clerk-1",
      completed_at: null,
      created_at: "2026-06-23T18:00:00.000Z",
      display_name: "Jenson Cripps",
      email: "jenson@example.com",
      id: "job-1",
      idempotency_key: "linkedin:clerk-1:manual-url",
      image_url: null,
      last_error: null,
      linkedin_url: "https://www.linkedin.com/in/jensoncripps/",
      locked_at: null,
      next_attempt_at: "2026-06-23T18:00:00.000Z",
      provider_user_id: null,
      status: "queued",
      updated_at: "2026-06-23T18:00:00.000Z",
      user_id: "user-1",
    };
    const updatePayloads: Record<string, unknown>[] = [];
    const profileUpserts: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "linkedin_enrichment_jobs") {
          return {
            select: () => ({
              eq: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({ data: [job], error: null }),
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload);
              if (
                payload.last_error ===
                "Retrying stale running LinkedIn enrichment job."
              ) {
                return {
                  eq: () => ({
                    lte: async () => ({ data: null, error: null }),
                  }),
                };
              }
              if (payload.status === "running") {
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({
                          data: { ...job, attempt_count: 1, status: "running" },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                };
              }
              return {
                eq: () => Promise.resolve({ data: null, error: null }),
              };
            },
          };
        }
        if (table === "professional_profiles") {
          return {
            upsert: async (payload: Record<string, unknown>) => {
              profileUpserts.push(payload);
              return { data: null, error: null };
            },
          };
        }
        if (table === "kinfolk_users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "profile_facts") {
          const query = {
            eq: () => query,
            gte: () => query,
            in: () => query,
            select: () => query,
            then: (
              onFulfilled: (result: unknown) => unknown,
              onRejected?: (error: unknown) => unknown,
            ) =>
              Promise.resolve({ data: [], error: null }).then(
                onFulfilled,
                onRejected,
              ),
          };
          return query;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    await expect(processLinkedInEnrichmentJobs(1)).resolves.toEqual({
      failed: 0,
      processed: 1,
      ready: 0,
      skipped: 1,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(updatePayloads.slice(1)).toEqual([
      expect.objectContaining({ attempt_count: 1, status: "running" }),
      expect.objectContaining({
        completed_at: expect.any(String),
        last_error: "LinkedIn enrichment provider returned 403.",
        status: "skipped",
      }),
    ]);
    expect(profileUpserts).toEqual([
      expect.objectContaining({ enrichment_status: "running" }),
      expect.objectContaining({
        enrichment_status: "source_not_configured",
        last_enrichment_error:
          "LinkedIn enrichment is temporarily unavailable. Your profile URL was saved, so you can continue and try again later.",
      }),
    ]);
    expect(updatePayloads.slice(1)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "queued" })]),
    );
  });
});

function createLinkedInJobsDryRunStub(rows: Array<Record<string, unknown>>) {
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(async () => ({
      data: rows,
      error: null,
    })),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
  };
  const supabase = {
    from: vi.fn(() => query),
  };
  vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);
  return { query, supabase };
}

describe("runCurrentUserLinkedInEnrichment", () => {
  it("requeues an existing connected-account job without replacing its avatar", async () => {
    const connectedIdentity = {
      ...identity,
      avatarUrl: "https://img.clerk.test/new.jpg",
      linkedin: {
        provider: "oauth_linkedin_oidc",
        providerUserId: "linkedin-user-1",
        externalAccountId: "external-account-1",
        emailAddress: "alex@linkedin.test",
        firstName: "Alex",
        lastName: "Rivera",
        imageUrl: "https://img.linkedin.test/new.jpg",
        username: "alex-rivera",
        profileUrl: "https://www.linkedin.com/in/alexrivera/",
        approvedScopes: ["openid", "profile", "email"],
      },
    };
    const existingJob = {
      attempt_count: 1,
      clerk_user_id: "user_123",
      completed_at: "2026-07-27T18:00:00.000Z",
      created_at: "2026-07-27T17:00:00.000Z",
      display_name: "Alex Rivera",
      email: "alex@example.com",
      id: "job-1",
      idempotency_key: "linkedin:user_123:linkedin-user-1",
      image_url:
        "https://project.supabase.co/storage/v1/object/public/profile-photos/user-1/linkedin-profile.jpg",
      last_error: null,
      linkedin_url: "https://www.linkedin.com/in/alexrivera/",
      locked_at: null,
      next_attempt_at: "2026-07-27T18:00:00.000Z",
      provider_user_id: "linkedin-user-1",
      status: "skipped",
      updated_at: "2026-07-27T18:00:00.000Z",
      user_id: "user-1",
    };
    const updatePayloads: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "professional_profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            upsert: async () => ({ data: null, error: null }),
          };
        }
        if (table === "linkedin_enrichment_jobs") {
          return {
            select: () => ({
              eq: (column: string) => ({
                maybeSingle: async () => ({
                  data:
                    column === "idempotency_key"
                      ? existingJob
                      : { ...existingJob, status: "queued", attempt_count: 0 },
                  error: null,
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload);
              if (payload.status === "running") {
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: { ...existingJob, ...payload },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(getCurrentClerkLinkedInIdentity).mockResolvedValue(
      connectedIdentity as never,
    );
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    vi.mocked(upsertKinfolkUserFromClerk).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    await expect(runCurrentUserLinkedInEnrichment()).resolves.toMatchObject({
      jobId: "job-1",
      processed: { status: "not_claimed" },
      status: "queued",
      userId: "user-1",
    });
    expect(updatePayloads[0]).not.toHaveProperty("image_url");
  });
});

describe("runCurrentUserLinkedInEnrichmentFromUrl", () => {
  it("returns signed_out when there is no Clerk identity", async () => {
    vi.mocked(getCurrentClerkLinkedInIdentity).mockResolvedValue(null);

    const result = await runCurrentUserLinkedInEnrichmentFromUrl(
      "https://www.linkedin.com/in/alexrivera/",
    );

    expect(result.status).toBe("signed_out");
  });

  it("rejects an invalid URL before touching Supabase", async () => {
    vi.mocked(getCurrentClerkLinkedInIdentity).mockResolvedValue(identity as never);
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    vi.mocked(createSupabaseServiceClient).mockClear();

    const result = await runCurrentUserLinkedInEnrichmentFromUrl("not a real url");

    expect(result.status).toBe("invalid_url");
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("refreshes an existing queued manual URL job before processing", async () => {
    vi.mocked(getCurrentClerkLinkedInIdentity).mockResolvedValue(identity as never);
    vi.mocked(hasServerSupabaseConfig).mockReturnValue(true);
    vi.mocked(upsertKinfolkUserFromClerk).mockResolvedValue({ id: "user-1" } as never);

    const newUrl = "https://www.linkedin.com/in/new-profile/";
    const oldJob = {
      attempt_count: 1,
      clerk_user_id: "user_123",
      completed_at: null,
      created_at: "2026-06-23T18:00:00.000Z",
      display_name: "Alex Rivera",
      email: "alex@example.com",
      id: "job-1",
      idempotency_key: "linkedin:user_123:manual-url",
      image_url: null,
      last_error: "LinkedIn profile not found",
      linkedin_url: "https://www.linkedin.com/in/old-profile/",
      locked_at: null,
      next_attempt_at: "2026-06-23T18:00:00.000Z",
      provider_user_id: null,
      status: "queued",
      updated_at: "2026-06-23T18:00:00.000Z",
      user_id: "user-1",
    };
    const updatedJob = {
      ...oldJob,
      attempt_count: 0,
      last_error: null,
      linkedin_url: newUrl,
    };
    const updatePayloads: Record<string, unknown>[] = [];
    const profileUpserts: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "linkedin_enrichment_jobs") {
          return {
            select: () => ({
              eq: (column: string) => ({
                maybeSingle: async () => ({
                  data: column === "idempotency_key" ? oldJob : updatedJob,
                  error: null,
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload);
              if (
                payload.last_error ===
                "Retrying stale running LinkedIn enrichment job."
              ) {
                return {
                  eq: () => ({
                    lte: async () => ({ data: null, error: null }),
                  }),
                };
              }
              if (payload.status === "running") {
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                  }),
                };
              }

              return {
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: { ...updatedJob, ...payload },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          };
        }
        if (table === "professional_profiles") {
          return {
            upsert: async (payload: Record<string, unknown>) => {
              profileUpserts.push(payload);
              return { data: null, error: null };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as never);

    await expect(runCurrentUserLinkedInEnrichmentFromUrl(newUrl)).resolves.toEqual({
      jobId: "job-1",
      processed: { status: "not_claimed" },
      status: "queued",
      userId: "user-1",
    });

    expect(updatePayloads[0]).toEqual(
      expect.objectContaining({
        attempt_count: 0,
        last_error: null,
        linkedin_url: newUrl,
        status: "queued",
      }),
    );
    expect(updatePayloads[0]).not.toHaveProperty("image_url");
    expect(profileUpserts[0]).toEqual(
      expect.objectContaining({
        last_enrichment_error: null,
        linkedin_url: newUrl,
        user_id: "user-1",
      }),
    );
  });
});

describe("LinkedIn enrichment work-history fallback", () => {
  it("uses the real current title instead of a placeholder", () => {
    const profile = normalizeExternalPayload(
      {
        profile: [
          {
            current_company: { name: "Alfa Laval" },
            position: "Supply chain professional",
          },
        ],
      },
      "custom_http",
    );

    expect(profile.workExperience).toHaveLength(1);
    expect(profile.workExperience[0]).toMatchObject({
      organization: "Alfa Laval",
      title: "Supply chain professional",
    });
  });
});

describe("LinkedIn enrichment image normalization", () => {
  it("accepts a valid public LinkedIn avatar", () => {
    const profile = normalizeExternalPayload(
      {
        profile: [
          {
            avatar: "https://media.licdn.com/dms/image/avatar-200.jpg",
            name: "Jenson Cripps",
          },
        ],
      },
      "custom_http",
    );

    expect(profile.profileImageUrl).toBe(
      "https://media.licdn.com/dms/image/avatar-200.jpg",
    );
  });

  it("rejects LinkedIn default avatars served from the static CDN", () => {
    const profile = normalizeExternalPayload(
      {
        profile: [
          {
            avatar: "https://static.licdn.com/aero-v1/sc/h/default-avatar",
            name: "Jenson Cripps",
          },
        ],
      },
      "custom_http",
    );

    expect(profile.profileImageUrl).toBeNull();
  });

  it.each([
    ["HTTP avatar", "http://media.licdn.com/dms/image/avatar.jpg"],
    ["localhost avatar", "https://localhost:3000/avatar.jpg"],
    ["loopback avatar", "https://127.0.0.1/avatar.jpg"],
    ["private network avatar", "https://192.168.1.10/avatar.jpg"],
    ["IPv4-mapped private avatar", "https://[::ffff:192.168.1.10]/avatar.jpg"],
    ["credentialed avatar", "https://user:pass@media.licdn.com/dms/image/avatar.jpg"],
  ])("rejects %s before profile-image caching can fetch it", (_label, avatar) => {
    const profile = normalizeExternalPayload(
      {
        profile: [
          {
            avatar,
            name: "Alex Rivera",
          },
        ],
      },
      "custom_http",
    );

    expect(profile.profileImageUrl).toBeNull();
  });

  it("reads LinkedIn Identity profile images from direct API payloads", () => {
    expect(
      readLinkedInIdentityProfileImageUrl({
        basicInfo: {
          profilePicture: {
            croppedImage: {
              downloadUrl: "https://media.licdn.com/dms/image/direct-800.png",
            },
          },
        },
      }),
    ).toBe("https://media.licdn.com/dms/image/direct-800.png");
  });
});
