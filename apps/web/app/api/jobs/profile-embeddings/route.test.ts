import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backfillProfileEmbeddings: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
}));

vi.mock("@/lib/shared/job-auth", () => ({
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}));

vi.mock("@/lib/profiles/embeddings-store", () => ({
  backfillProfileEmbeddings: mocks.backfillProfileEmbeddings,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

import { POST } from "./route";

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/profile-embeddings", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as NextRequest;
}

function rawJsonRequest(body: string): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/profile-embeddings", {
    body,
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  }) as NextRequest;
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/jobs/profile-embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.createSupabaseServiceClient.mockReturnValue("supabase-client");
    mocks.backfillProfileEmbeddings.mockResolvedValue({
      failed: 0,
      processed: 2,
    });
  });

  it("rejects unauthorized requests before creating a service client", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValueOnce(false);

    const response = await POST(jsonRequest({ limit: 5 }));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.backfillProfileEmbeddings).not.toHaveBeenCalled();
  });

  it("runs an authorized backfill with clamped limit, userId, and force options", async () => {
    const response = await POST(
      jsonRequest({ force: true, limit: 999, userId: "user-1" }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 0,
      processed: 2,
    });
    expect(mocks.createSupabaseServiceClient).toHaveBeenCalledTimes(1);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenCalledWith(
      "supabase-client",
      {
        force: true,
        limit: 200,
        userId: "user-1",
      },
    );
  });

  it("parses string force options from job dashboards and scripts", async () => {
    const forcedResponse = await POST(
      jsonRequest({ force: " true ", limit: 12, userId: "user-1" }),
    );

    expect(forcedResponse.status).toBe(200);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        force: true,
        limit: 12,
        userId: "user-1",
      },
    );

    const skippedForceResponse = await POST(
      jsonRequest({ force: "FALSE", limit: 12, userId: "user-1" }),
    );

    expect(skippedForceResponse.status).toBe(200);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        force: false,
        limit: 12,
        userId: "user-1",
      },
    );
  });

  it("rejects malformed JSON before creating a service client", async () => {
    const response = await POST(rawJsonRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.backfillProfileEmbeddings).not.toHaveBeenCalled();
  });

  it("falls back to default options for null, array, and primitive JSON bodies", async () => {
    for (const body of [null, [], "oops", 42, false]) {
      mocks.backfillProfileEmbeddings.mockClear();

      const response = await POST(jsonRequest(body));

      expect(response.status).toBe(200);
      expect(mocks.backfillProfileEmbeddings).toHaveBeenCalledWith(
        "supabase-client",
        {
          force: false,
          limit: 50,
          userId: null,
        },
      );
    }
  });

  it("uses the default batch size for blank, nullish, boolean, and non-integer limits", async () => {
    for (const limit of ["", "   ", null, false, "12.5"]) {
      mocks.backfillProfileEmbeddings.mockClear();

      const response = await POST(jsonRequest({ limit }));

      expect(response.status).toBe(200);
      expect(mocks.backfillProfileEmbeddings).toHaveBeenCalledWith(
        "supabase-client",
        {
          force: false,
          limit: 50,
          userId: null,
        },
      );
    }
  });

  it("trims valid user ids and ignores blank user ids", async () => {
    const trimmedResponse = await POST(
      jsonRequest({ limit: 5, userId: "  user-1  " }),
    );

    expect(trimmedResponse.status).toBe(200);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        force: false,
        limit: 5,
        userId: "user-1",
      },
    );

    const blankResponse = await POST(jsonRequest({ userId: "   " }));

    expect(blankResponse.status).toBe(200);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        force: false,
        limit: 50,
        userId: null,
      },
    );
  });

  it("passes explicit dry-run requests to the embedding backfill worker", async () => {
    const response = await POST(
      jsonRequest({
        dryRun: "true",
        limit: 5,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenCalledWith(
      "supabase-client",
      {
        dryRun: true,
        force: false,
        limit: 5,
        userId: null,
      },
    );
  });

  it("parses numeric and numeric-string boolean options from job dashboards and scripts", async () => {
    const dryRunResponse = await POST(
      jsonRequest({
        dryRun: 1,
        force: "1",
        limit: 5,
      }),
    );

    expect(dryRunResponse.status).toBe(200);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        dryRun: true,
        force: true,
        limit: 5,
        userId: null,
      },
    );

    const mutatingResponse = await POST(
      jsonRequest({
        dryRun: "0",
        force: 0,
        limit: 5,
      }),
    );

    expect(mutatingResponse.status).toBe(200);
    expect(mocks.backfillProfileEmbeddings).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        force: false,
        limit: 5,
        userId: null,
      },
    );
  });

  it("returns redacted JSON when the embedding backfill fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Embedding provider unavailable: openrouter-token");
    mocks.backfillProfileEmbeddings.mockRejectedValueOnce(error);

    const response = await POST(jsonRequest({ limit: 10 }));

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({
      error: "Profile embedding job failed.",
    });
    expect(JSON.stringify(json)).not.toContain("openrouter-token");
    expect(consoleError).toHaveBeenCalledWith(
      "[profile-embeddings-job] backfill failed",
      error,
    );
    consoleError.mockRestore();
  });
});
