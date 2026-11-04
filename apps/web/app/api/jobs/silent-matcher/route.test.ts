import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
  runSilentMatcherSweep: vi.fn(),
}));

vi.mock("@/lib/shared/job-auth", () => ({
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}));

vi.mock("@/lib/matching/silent-matcher", () => ({
  runSilentMatcherSweep: mocks.runSilentMatcherSweep,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

import { POST } from "./route";

function jobRequest(): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/silent-matcher", {
    method: "POST",
  }) as unknown as NextRequest;
}

describe("POST /api/jobs/silent-matcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServiceClient.mockReturnValue({ client: true });
  });

  it("rejects unauthorized requests", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(false);

    const response = await POST(jobRequest());

    expect(response.status).toBe(401);
    expect(mocks.runSilentMatcherSweep).not.toHaveBeenCalled();
  });

  it("runs the sweep and returns counts only", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.runSilentMatcherSweep.mockResolvedValue({
      scannedUsers: 3,
      pairsConsidered: 2,
      candidatesWritten: 2,
    });

    const response = await POST(jobRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scannedUsers: 3,
      pairsConsidered: 2,
      candidatesWritten: 2,
    });
    expect(mocks.runSilentMatcherSweep).toHaveBeenCalledWith({ client: true });
  });

  it("returns 500 when the sweep throws", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.runSilentMatcherSweep.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(jobRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Silent matcher sweep failed." });
    consoleError.mockRestore();
  });
});
