import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceApiUserRateLimit: vi.fn(),
  searchMapboxLocationSuggestions: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("@/lib/integrations/mapbox-location", () => ({
  searchMapboxLocationSuggestions: mocks.searchMapboxLocationSuggestions,
}));

import { GET } from "./route";

function searchRequest(query: string): NextRequest {
  return new NextRequest(`https://kinfolk.test/api/locations/search${query}`);
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/locations/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.searchMapboxLocationSuggestions.mockResolvedValue([
      {
        city: "San Francisco",
        id: "place.sf",
        label: "San Francisco, CA",
        state: "California",
        stateCode: "CA",
      },
    ]);
  });

  it("rejects unauthenticated requests before searching Mapbox", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null });

    const response = await GET(searchRequest("?q=San%20Francisco"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.searchMapboxLocationSuggestions).not.toHaveBeenCalled();
  });

  it("returns an empty result set for missing or too-short queries", async () => {
    const missing = await GET(searchRequest(""));
    const short = await GET(searchRequest("?q=%20s%20"));

    expect(missing.status).toBe(200);
    expect(short.status).toBe(200);
    await expect(readJson(missing)).resolves.toEqual({ results: [] });
    await expect(readJson(short)).resolves.toEqual({ results: [] });
    expect(mocks.searchMapboxLocationSuggestions).not.toHaveBeenCalled();
  });

  it("trims and forwards authenticated queries to the Mapbox suggestion helper", async () => {
    const response = await GET(searchRequest("?q=%20San%20Francisco%20"));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      results: [
        {
          city: "San Francisco",
          id: "place.sf",
          label: "San Francisco, CA",
          state: "California",
          stateCode: "CA",
        },
      ],
    });
    expect(mocks.searchMapboxLocationSuggestions).toHaveBeenCalledWith(
      "San Francisco",
    );
  });

  it("rejects overlong queries before searching Mapbox", async () => {
    const response = await GET(searchRequest(`?q=${"a".repeat(121)}`));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Location search must be 120 characters or fewer.",
    });
    expect(mocks.searchMapboxLocationSuggestions).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response without touching Mapbox when throttled", async () => {
    mocks.enforceApiUserRateLimit.mockResolvedValueOnce(
      Response.json({ error: "Too many requests." }, { status: 429 }),
    );

    const response = await GET(searchRequest("?q=San%20Francisco"));

    expect(response.status).toBe(429);
    expect(mocks.searchMapboxLocationSuggestions).not.toHaveBeenCalled();
  });

  it("returns 503 for missing Mapbox configuration errors", async () => {
    mocks.searchMapboxLocationSuggestions.mockRejectedValueOnce(
      new Error("Location search is not configured."),
    );

    const response = await GET(searchRequest("?q=Oakland"));

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toEqual({
      error: "Location search is not configured.",
    });
  });

  it("returns 502 for configured Mapbox lookup failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.searchMapboxLocationSuggestions.mockRejectedValueOnce(
      new Error("Mapbox token sk-live-secret failed."),
    );

    try {
      const response = await GET(searchRequest("?q=Oakland"));
      const body = await readJson(response);

      expect(response.status).toBe(502);
      expect(body).toEqual({
        error: "Mapbox lookup failed.",
      });
      expect(JSON.stringify(body)).not.toContain("sk-live-secret");
      expect(consoleError).toHaveBeenCalledWith("[locations] search failed", {
        error: expect.any(Error),
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
