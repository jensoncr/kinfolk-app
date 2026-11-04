import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAuthorizedJobRequest: vi.fn(),
  notifyFounder: vi.fn(),
  processTextAgentRuns: vi.fn(),
}));

vi.mock("@/lib/shared/job-auth", () => ({
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}));

vi.mock("@/lib/shared/alerts", () => ({
  notifyFounder: mocks.notifyFounder,
}));

vi.mock("@/lib/text-agent/store", () => ({
  processTextAgentRuns: mocks.processTextAgentRuns,
}));

import { POST } from "./route";

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/text-agent", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as NextRequest;
}

function rawJsonRequest(body: string): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/text-agent", {
    body,
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  }) as NextRequest;
}

function emptyRequest(): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/text-agent", {
    method: "POST",
  }) as NextRequest;
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/jobs/text-agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.notifyFounder.mockResolvedValue(undefined);
    mocks.processTextAgentRuns.mockResolvedValue({
      failed: 0,
      processed: 2,
      skipped: 1,
    });
  });

  it("rejects unauthorized requests before draining the queue", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValueOnce(false);

    const response = await POST(jsonRequest({ limit: 3 }));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.processTextAgentRuns).not.toHaveBeenCalled();
    expect(mocks.notifyFounder).not.toHaveBeenCalled();
  });

  it("drains an authorized batch with a floored numeric limit", async () => {
    const response = await POST(jsonRequest({ limit: 7.8 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      failed: 0,
      ok: true,
      processed: 2,
      skipped: 1,
    });
    expect(mocks.processTextAgentRuns).toHaveBeenCalledWith(7);
    expect(mocks.notifyFounder).not.toHaveBeenCalled();
  });

  it("clamps numeric limits into the job range", async () => {
    await POST(jsonRequest({ limit: 999 }));
    await POST(jsonRequest({ limit: -10 }));

    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(1, 25);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(2, 1);
  });

  it("parses numeric string limits from job dashboards and scripts", async () => {
    await POST(jsonRequest({ limit: "12" }));
    await POST(jsonRequest({ limit: "999" }));
    await POST(jsonRequest({ limit: "-10" }));

    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(1, 12);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(2, 25);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(3, 1);
  });

  it("rejects malformed JSON before draining the queue", async () => {
    const response = await POST(rawJsonRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mocks.processTextAgentRuns).not.toHaveBeenCalled();
    expect(mocks.notifyFounder).not.toHaveBeenCalled();
  });

  it("uses the default batch size for non-numeric JSON limits", async () => {
    await POST(jsonRequest({ limit: "many" }));
    // Numeric strings floor like numeric literals (7.8 and "12.5" behave the
    // same) — the old reader arbitrarily floored one and defaulted the other.
    await POST(jsonRequest({ limit: "12.5" }));
    await POST(jsonRequest({ limit: "" }));
    await POST(jsonRequest({ limit: "   " }));
    await POST(jsonRequest({ limit: null }));
    await POST(jsonRequest({ limit: false }));

    expect(mocks.processTextAgentRuns).toHaveBeenCalledTimes(6);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(1, 5);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(2, 12);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(3, 5);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(4, 5);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(5, 5);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(6, 5);
  });

  it("uses the default batch size for empty and non-object request bodies", async () => {
    await POST(emptyRequest());
    await POST(rawJsonRequest("null"));
    await POST(rawJsonRequest("12"));
    await POST(jsonRequest([]));

    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(1, 5);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(2, 5);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(3, 5);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(4, 5);
  });

  it("passes explicit dry-run requests to the queue worker", async () => {
    mocks.processTextAgentRuns.mockResolvedValueOnce({
      claimed: 0,
      completed: 0,
      dryRun: true,
      failed: 0,
      queued: 3,
      skipped: 0,
      staleQueued: 1,
      superseded: 0,
      wouldAlertBacklog: false,
    });

    const response = await POST(jsonRequest({ dryRun: "true", limit: 4 }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      claimed: 0,
      completed: 0,
      dryRun: true,
      failed: 0,
      ok: true,
      queued: 3,
      skipped: 0,
      staleQueued: 1,
      superseded: 0,
      wouldAlertBacklog: false,
    });
    expect(mocks.processTextAgentRuns).toHaveBeenCalledWith(4, {
      dryRun: true,
    });
  });

  it("parses numeric and numeric-string dry-run flags from job dashboards and scripts", async () => {
    await POST(jsonRequest({ dryRun: 1, limit: 4 }));
    await POST(jsonRequest({ dryRun: "1", limit: 4 }));
    await POST(jsonRequest({ dryRun: 0, limit: 4 }));
    await POST(jsonRequest({ dryRun: "0", limit: 4 }));

    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(1, 4, {
      dryRun: true,
    });
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(2, 4, {
      dryRun: true,
    });
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(3, 4);
    expect(mocks.processTextAgentRuns).toHaveBeenNthCalledWith(4, 4);
  });

  it("notifies the founder and returns redacted JSON when queue draining fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("Queue drain failed: provider-token");
    mocks.processTextAgentRuns.mockRejectedValueOnce(error);

    const response = await POST(jsonRequest({ limit: 2 }));

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({
      error: "Text agent job failed.",
      ok: false,
    });
    expect(JSON.stringify(json)).not.toContain("provider-token");
    expect(consoleError).toHaveBeenCalledWith(
      "[text-agent-job] queue drain failed",
      error,
    );
    expect(mocks.notifyFounder).toHaveBeenCalledWith("text_agent_job_failed", {
      detail: "Queue drain failed: provider-token",
    });
    consoleError.mockRestore();
  });

  it("still returns 500 when the failure notification cannot be delivered", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.processTextAgentRuns.mockRejectedValueOnce(
      new Error("Queue drain failed: provider-token"),
    );
    mocks.notifyFounder.mockRejectedValueOnce(new Error("sms provider down"));

    const response = await POST(jsonRequest({ limit: 2 }));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Text agent job failed.",
      ok: false,
    });
    expect(mocks.notifyFounder).toHaveBeenCalledWith("text_agent_job_failed", {
      detail: "Queue drain failed: provider-token",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[text-agent-job] founder notification failed",
      { error: "sms provider down" },
    );
    consoleError.mockRestore();
  });
});
