import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAuthorizedJobRequest: vi.fn(),
  processLinkedInEnrichmentJobs: vi.fn(),
}));

vi.mock("@/lib/shared/job-auth", () => ({
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}));

vi.mock("@/lib/profiles/linkedin-enrichment", () => ({
  processLinkedInEnrichmentJobs: mocks.processLinkedInEnrichmentJobs,
}));

import { POST } from "./route";

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/linkedin-enrichment", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as NextRequest;
}

function rawJsonRequest(body: string): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/linkedin-enrichment", {
    body,
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  }) as NextRequest;
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/jobs/linkedin-enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.processLinkedInEnrichmentJobs.mockResolvedValue({
      failed: 0,
      processed: 2,
      queued: 1,
    });
  });

  it("rejects unauthorized requests before processing jobs", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValueOnce(false);

    const response = await POST(jsonRequest({ limit: 10 }));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.processLinkedInEnrichmentJobs).not.toHaveBeenCalled();
  });

  it("runs an authorized batch with an explicit numeric limit", async () => {
    const response = await POST(jsonRequest({ limit: 8 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 0,
      processed: 2,
      queued: 1,
    });
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenCalledWith(8);
  });

  it("passes explicit dry-run requests to the LinkedIn enrichment worker", async () => {
    mocks.processLinkedInEnrichmentJobs.mockResolvedValueOnce({
      dryRun: true,
      failed: 0,
      processed: 0,
      queued: 2,
      ready: 0,
      skipped: 0,
    });

    const response = await POST(
      jsonRequest({
        dryRun: "true",
        limit: 8,
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      dryRun: true,
      failed: 0,
      processed: 0,
      queued: 2,
      ready: 0,
      skipped: 0,
    });
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenCalledWith(8, {
      dryRun: true,
    });
  });

  it("parses numeric and numeric-string dry-run options before choosing scheduler mode", async () => {
    mocks.processLinkedInEnrichmentJobs
      .mockResolvedValueOnce({
        dryRun: true,
        failed: 0,
        processed: 0,
        queued: 2,
        ready: 0,
        skipped: 0,
      })
      .mockResolvedValueOnce({
        failed: 0,
        processed: 2,
        queued: 1,
      });

    const dryRunResponse = await POST(jsonRequest({ dryRun: 1, limit: 4 }));
    const mutatingResponse = await POST(jsonRequest({ dryRun: "0", limit: 4 }));

    expect(dryRunResponse.status).toBe(200);
    await expect(readJson(dryRunResponse)).resolves.toEqual({
      dryRun: true,
      failed: 0,
      processed: 0,
      queued: 2,
      ready: 0,
      skipped: 0,
    });
    expect(mutatingResponse.status).toBe(200);
    await expect(readJson(mutatingResponse)).resolves.toEqual({
      failed: 0,
      processed: 2,
      queued: 1,
    });
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(1, 4, {
      dryRun: true,
    });
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(2, 4);
  });

  it("clamps numeric limits into the scheduler range", async () => {
    await POST(jsonRequest({ limit: 999 }));
    await POST(jsonRequest({ limit: -10 }));

    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(1, 25);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(2, 1);
  });

  it("parses numeric string limits from job dashboards and scripts", async () => {
    await POST(jsonRequest({ limit: "12" }));
    await POST(jsonRequest({ limit: "999" }));

    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(1, 12);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(2, 25);
  });

  it("rejects malformed JSON before processing jobs", async () => {
    const response = await POST(rawJsonRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mocks.processLinkedInEnrichmentJobs).not.toHaveBeenCalled();
  });

  it("uses the default batch size for non-numeric or non-integer limits", async () => {
    await POST(jsonRequest({ limit: "many" }));
    await POST(jsonRequest({ limit: "12.5" }));
    await POST(jsonRequest({ limit: "" }));
    await POST(jsonRequest({ limit: "   " }));
    await POST(jsonRequest({ limit: null }));
    await POST(jsonRequest({ limit: false }));

    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(1, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(2, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(3, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(4, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(5, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(6, 5);
  });

  it("uses the default batch size for empty, null, array, and primitive bodies", async () => {
    await POST(rawJsonRequest("   "));
    await POST(jsonRequest(null));
    await POST(jsonRequest([{ limit: 12 }]));
    await POST(jsonRequest(12));

    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(1, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(2, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(3, 5);
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenNthCalledWith(4, 5);
  });

  it("returns redacted JSON when the scheduler fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error(
      "LinkedIn scheduler unavailable: provider-secret",
    );
    mocks.processLinkedInEnrichmentJobs.mockRejectedValueOnce(error);

    const response = await POST(jsonRequest({ limit: 3 }));

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({
      error: "LinkedIn enrichment job failed.",
      ok: false,
    });
    expect(JSON.stringify(json)).not.toContain("provider-secret");
    expect(mocks.processLinkedInEnrichmentJobs).toHaveBeenCalledWith(3);
    expect(consoleError).toHaveBeenCalledWith(
      "[linkedin-enrichment-job] scheduler failed",
      error,
    );
    consoleError.mockRestore();
  });
});
