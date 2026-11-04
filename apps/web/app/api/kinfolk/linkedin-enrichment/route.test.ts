import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  enforceApiUserRateLimit: vi.fn(),
  getCurrentClerkLinkedInIdentity: vi.fn(),
  runCurrentUserLinkedInEnrichment: vi.fn(),
  runCurrentUserLinkedInEnrichmentFromUrl: vi.fn(),
}));

vi.mock("@/lib/integrations/clerk-user", () => ({
  getCurrentClerkLinkedInIdentity: mocks.getCurrentClerkLinkedInIdentity,
}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("@/lib/profiles/linkedin-enrichment", () => ({
  runCurrentUserLinkedInEnrichment: mocks.runCurrentUserLinkedInEnrichment,
  runCurrentUserLinkedInEnrichmentFromUrl:
    mocks.runCurrentUserLinkedInEnrichmentFromUrl,
}));

function jsonRequest(body: unknown): Request {
  return new Request("https://kinfolk.test/api/kinfolk/linkedin-enrichment", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function rawJsonRequest(body: string): Request {
  return new Request("https://kinfolk.test/api/kinfolk/linkedin-enrichment", {
    body,
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  });
}

function plainRequest(): Request {
  return new Request("https://kinfolk.test/api/kinfolk/linkedin-enrichment", {
    method: "POST",
  });
}

function emptyJsonRequest(): Request {
  return new Request("https://kinfolk.test/api/kinfolk/linkedin-enrichment", {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/kinfolk/linkedin-enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.getCurrentClerkLinkedInIdentity.mockResolvedValue({
      clerkUserId: "clerk-1",
      displayName: "Ada",
    });
    mocks.runCurrentUserLinkedInEnrichment.mockResolvedValue({
      processed: { status: "ready" },
      status: "queued",
    });
    mocks.runCurrentUserLinkedInEnrichmentFromUrl.mockResolvedValue({
      processed: { status: "ready" },
      status: "queued",
    });
  });

  it("runs the current-user LinkedIn enrichment when no URL is supplied", async () => {
    const response = await POST(plainRequest());

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      processed: { status: "ready" },
      status: "queued",
    });
    expect(mocks.runCurrentUserLinkedInEnrichment).toHaveBeenCalledTimes(1);
    expect(mocks.runCurrentUserLinkedInEnrichmentFromUrl).not.toHaveBeenCalled();
  });

  it("runs current-user enrichment for empty JSON requests from background sync", async () => {
    const response = await POST(emptyJsonRequest());

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      processed: { status: "ready" },
      status: "queued",
    });
    expect(mocks.runCurrentUserLinkedInEnrichment).toHaveBeenCalledTimes(1);
    expect(mocks.runCurrentUserLinkedInEnrichmentFromUrl).not.toHaveBeenCalled();
  });

  it("trims a submitted LinkedIn URL and runs manual URL enrichment", async () => {
    const response = await POST(
      jsonRequest({ linkedinUrl: "  https://www.linkedin.com/in/ada/  " }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      processed: { status: "ready" },
      status: "queued",
    });
    expect(mocks.runCurrentUserLinkedInEnrichmentFromUrl).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/ada/",
    );
    expect(mocks.runCurrentUserLinkedInEnrichment).not.toHaveBeenCalled();
  });

  it("returns stable provider reason codes without provider response text", async () => {
    mocks.runCurrentUserLinkedInEnrichmentFromUrl.mockResolvedValueOnce({
      processed: {
        reason: "provider_not_configured",
        status: "skipped",
      },
      status: "queued",
    });

    const response = await POST(
      jsonRequest({ linkedinUrl: "https://www.linkedin.com/in/ada/" }),
    );
    const json = await readJson(response);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      processed: {
        reason: "provider_not_configured",
        status: "skipped",
      },
      status: "queued",
    });
    expect(JSON.stringify(json)).not.toContain("Customer is not active");
  });

  it("returns 400 when manual URL enrichment rejects the URL", async () => {
    mocks.runCurrentUserLinkedInEnrichmentFromUrl.mockResolvedValueOnce({
      error: "Enter a valid LinkedIn profile URL.",
      status: "invalid_url",
    });

    const response = await POST(jsonRequest({ linkedinUrl: "https://example.com/ada" }));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Enter a valid LinkedIn profile URL.",
      status: "invalid_url",
    });
  });

  it("rejects signed-out enrichment before parsing or running providers", async () => {
    mocks.getCurrentClerkLinkedInIdentity.mockResolvedValueOnce(null);

    const response = await POST(rawJsonRequest("{oops"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before enriching your LinkedIn profile.",
      status: "signed_out",
    });
    expect(mocks.runCurrentUserLinkedInEnrichment).not.toHaveBeenCalled();
    expect(mocks.runCurrentUserLinkedInEnrichmentFromUrl).not.toHaveBeenCalled();
  });

  it("maps helper signed-out results to 401 as a defensive fallback", async () => {
    mocks.runCurrentUserLinkedInEnrichment.mockResolvedValueOnce({
      status: "signed_out",
    });

    const response = await POST(plainRequest());

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      status: "signed_out",
    });
  });

  it("rejects malformed signed-in JSON before running enrichment", async () => {
    const response = await POST(rawJsonRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.enforceApiUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.runCurrentUserLinkedInEnrichment).not.toHaveBeenCalled();
    expect(mocks.runCurrentUserLinkedInEnrichmentFromUrl).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response without running enrichment", async () => {
    mocks.enforceApiUserRateLimit.mockResolvedValueOnce(
      Response.json(
        {
          error: "Too many requests. Please slow down and try again shortly.",
          status: "rate_limited",
        },
        { status: 429, headers: { "Retry-After": "1504" } },
      ),
    );

    const response = await POST(emptyJsonRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1504");
    await expect(readJson(response)).resolves.toEqual({
      error: "Too many requests. Please slow down and try again shortly.",
      status: "rate_limited",
    });
    expect(mocks.runCurrentUserLinkedInEnrichment).not.toHaveBeenCalled();
    expect(mocks.runCurrentUserLinkedInEnrichmentFromUrl).not.toHaveBeenCalled();
  });

  it("returns redacted JSON when enrichment throws", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("LinkedIn provider is unavailable: provider-secret");
    mocks.runCurrentUserLinkedInEnrichment.mockRejectedValueOnce(error);

    const response = await POST(plainRequest());

    expect(response.status).toBe(500);
    const json = await readJson(response);
    expect(json).toEqual({
      error: "LinkedIn enrichment failed.",
    });
    expect(JSON.stringify(json)).not.toContain("provider-secret");
    expect(consoleError).toHaveBeenCalledWith(
      "[linkedin-enrichment] current-user enrichment failed",
      error,
    );
    consoleError.mockRestore();
  });
});
