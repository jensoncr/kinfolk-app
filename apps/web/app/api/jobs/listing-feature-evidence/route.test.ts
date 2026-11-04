import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backfillListingFeatureEvidence: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
}));

vi.mock("@/lib/apartments/listing-feature-assessments", () => ({
  backfillListingFeatureEvidence: mocks.backfillListingFeatureEvidence,
}));

vi.mock("@/lib/shared/job-auth", () => ({
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

import { POST } from "./route";

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/listing-feature-evidence", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as NextRequest;
}

function rawJsonRequest(body: string): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/listing-feature-evidence", {
    body,
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  }) as NextRequest;
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/jobs/listing-feature-evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.createSupabaseServiceClient.mockReturnValue("supabase-client");
    mocks.backfillListingFeatureEvidence.mockResolvedValue({
      failed: 0,
      processed: 2,
      skipped: 1,
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
    expect(mocks.backfillListingFeatureEvidence).not.toHaveBeenCalled();
  });

  it("runs an authorized backfill with clamped limits and explicit options", async () => {
    const response = await POST(
      jsonRequest({
        force: true,
        includeVision: true,
        limit: 999,
        listingId: "listing-1",
        maxPhotosPerListing: 99,
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 0,
      processed: 2,
      skipped: 1,
    });
    expect(mocks.createSupabaseServiceClient).toHaveBeenCalledTimes(1);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledWith(
      "supabase-client",
      {
        force: true,
        includeVision: true,
        limit: 500,
        listingId: "listing-1",
        maxPhotosPerListing: 8,
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
    expect(mocks.backfillListingFeatureEvidence).not.toHaveBeenCalled();
  });

  it("falls back to defaults for null, array, and primitive JSON bodies", async () => {
    const nullResponse = await POST(rawJsonRequest("null"));

    expect(nullResponse.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        force: false,
        includeVision: false,
        limit: 50,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );

    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.createSupabaseServiceClient.mockReturnValue("supabase-client");
    mocks.backfillListingFeatureEvidence.mockResolvedValue({
      failed: 0,
      processed: 1,
      skipped: 0,
    });

    const arrayResponse = await POST(rawJsonRequest("[]"));
    const primitiveResponse = await POST(rawJsonRequest("42"));

    expect(arrayResponse.status).toBe(200);
    expect(primitiveResponse.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledTimes(2);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenNthCalledWith(
      1,
      "supabase-client",
      {
        force: false,
        includeVision: false,
        limit: 50,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenNthCalledWith(
      2,
      "supabase-client",
      {
        force: false,
        includeVision: false,
        limit: 50,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );
  });

  it("uses default numeric options for blank, nullish, boolean, and non-integer limits", async () => {
    for (const value of ["", "   ", null, false, "12.5"]) {
      mocks.backfillListingFeatureEvidence.mockClear();

      const response = await POST(
        jsonRequest({
          limit: value,
          maxPhotosPerListing: value,
        }),
      );

      expect(response.status).toBe(200);
      expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledWith(
        "supabase-client",
        {
          force: false,
          includeVision: false,
          limit: 50,
          listingId: null,
          maxPhotosPerListing: 3,
        },
      );
    }
  });

  it("trims valid listing ids and ignores blank listing ids", async () => {
    const response = await POST(
      jsonRequest({
        listingId: "  listing-1  ",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledWith(
      "supabase-client",
      {
        force: false,
        includeVision: false,
        limit: 50,
        listingId: "listing-1",
        maxPhotosPerListing: 3,
      },
    );

    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.createSupabaseServiceClient.mockReturnValue("supabase-client");
    mocks.backfillListingFeatureEvidence.mockResolvedValue({
      failed: 0,
      processed: 1,
      skipped: 0,
    });

    const blankResponse = await POST(jsonRequest({ listingId: "   " }));

    expect(blankResponse.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledWith(
      "supabase-client",
      {
        force: false,
        includeVision: false,
        limit: 50,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );
  });

  it("parses string boolean backfill options before calling the worker", async () => {
    const response = await POST(
      jsonRequest({
        force: "true",
        includeVision: "true",
        limit: "7",
        maxPhotosPerListing: "4",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledWith(
      "supabase-client",
      {
        force: true,
        includeVision: true,
        limit: 7,
        listingId: null,
        maxPhotosPerListing: 4,
      },
    );

    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.createSupabaseServiceClient.mockReturnValue("supabase-client");
    mocks.backfillListingFeatureEvidence.mockResolvedValue({
      failed: 0,
      processed: 1,
      skipped: 0,
    });

    const falseResponse = await POST(
      jsonRequest({
        force: "false",
        includeVision: "false",
      }),
    );

    expect(falseResponse.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledWith(
      "supabase-client",
      {
        force: false,
        includeVision: false,
        limit: 50,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );
  });

  it("passes explicit dry-run requests to the backfill worker", async () => {
    const response = await POST(
      jsonRequest({
        dryRun: "true",
        limit: 5,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenCalledWith(
      "supabase-client",
      {
        dryRun: true,
        force: false,
        includeVision: false,
        limit: 5,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );
  });

  it("parses numeric and numeric-string boolean options from job dashboards and scripts", async () => {
    const dryRunResponse = await POST(
      jsonRequest({
        dryRun: 1,
        force: "1",
        includeVision: 0,
        limit: 5,
      }),
    );

    expect(dryRunResponse.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        dryRun: true,
        force: true,
        includeVision: false,
        limit: 5,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );

    const mutatingResponse = await POST(
      jsonRequest({
        dryRun: "0",
        force: 0,
        includeVision: "1",
        limit: 5,
      }),
    );

    expect(mutatingResponse.status).toBe(200);
    expect(mocks.backfillListingFeatureEvidence).toHaveBeenLastCalledWith(
      "supabase-client",
      {
        force: false,
        includeVision: true,
        limit: 5,
        listingId: null,
        maxPhotosPerListing: 3,
      },
    );
  });

  it("returns redacted JSON when the feature evidence backfill fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Vision provider unavailable: openrouter-token");
    mocks.backfillListingFeatureEvidence.mockRejectedValueOnce(error);

    const response = await POST(jsonRequest({ limit: 10 }));

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({
      error: "Listing feature evidence job failed.",
    });
    expect(JSON.stringify(json)).not.toContain("openrouter-token");
    expect(consoleError).toHaveBeenCalledWith(
      "[listing-feature-evidence-job] worker failed",
      error,
    );
    consoleError.mockRestore();
  });
});
