import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRentCastRentEstimate, isRentCastConfigured } from "./rentcast";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const avmResponse = {
  comparables: [
    {
      correlation: 0.98,
      distance: 0.123,
      formattedAddress: "2520 Larkin St, San Francisco, CA 94109",
      price: 4050,
    },
    {
      distance: 0.41,
      formattedAddress: "1200 Union St, San Francisco, CA 94109",
      price: 4200.4,
    },
    { distance: 0.5, formattedAddress: "No rent here", price: null },
    {
      distance: 0.62,
      formattedAddress: "900 Hyde St, San Francisco, CA 94109",
      price: 3950,
    },
    {
      distance: 0.7,
      formattedAddress: "1800 Polk St, San Francisco, CA 94109",
      price: 4400,
    },
  ],
  latitude: 37.7989,
  longitude: -122.4214,
  rent: 4100.4,
  rentRangeHigh: 4400.6,
  rentRangeLow: 3800.2,
};

describe("fetchRentCastRentEstimate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("quietly does nothing without the API key, logging one debug line total", async () => {
    vi.resetModules();
    vi.stubEnv("RENTCAST_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const fresh = await import("./rentcast");
    expect(fresh.isRentCastConfigured()).toBe(false);
    expect(
      await fresh.fetchRentCastRentEstimate({
        bedrooms: 2,
        latitude: 37.7989,
        longitude: -122.4214,
      }),
    ).toBe(null);
    expect(
      await fresh.fetchRentCastRentEstimate({
        bedrooms: 1,
        latitude: 37.76,
        longitude: -122.41,
      }),
    ).toBe(null);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    debug.mockRestore();
  });

  it("queries the AVM by coordinates and unit facts and parses up to 3 comps", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    const fetchMock = vi.fn<
      (input: URL, init?: RequestInit) => Promise<Response>
    >(async () => jsonResponse(avmResponse));
    vi.stubGlobal("fetch", fetchMock);

    const estimate = await fetchRentCastRentEstimate({
      address: "2525 Larkin St, San Francisco, CA, 94109",
      bathrooms: 1,
      bedrooms: 2,
      latitude: 37.7989,
      longitude: -122.4214,
      squareFootage: 700,
    });

    expect(estimate).toEqual({
      compCount: 4,
      comps: [
        {
          address: "2520 Larkin St, San Francisco, CA 94109",
          distanceMiles: 0.12,
          rent: 4050,
        },
        {
          address: "1200 Union St, San Francisco, CA 94109",
          distanceMiles: 0.41,
          rent: 4200,
        },
        {
          address: "900 Hyde St, San Francisco, CA 94109",
          distanceMiles: 0.62,
          rent: 3950,
        },
      ],
      rentEstimate: 4100,
      rentRangeHigh: 4401,
      rentRangeLow: 3800,
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    const url = String(requestUrl);
    expect(url).toContain("https://api.rentcast.io/v1/avm/rent/long-term");
    expect(url).toContain("latitude=37.7989");
    expect(url).toContain("longitude=-122.4214");
    expect(url).toContain("bedrooms=2");
    expect(url).toContain("bathrooms=1");
    expect(url).toContain("squareFootage=700");
    // Coordinates win over the address; only one anchor goes out.
    expect(url).not.toContain("address=");
    expect(requestInit?.headers).toMatchObject({ "X-Api-Key": "rc-test-key" });
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to the address when coordinates are missing", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    const fetchMock = vi.fn<
      (input: URL, init?: RequestInit) => Promise<Response>
    >(async () => jsonResponse(avmResponse));
    vi.stubGlobal("fetch", fetchMock);

    const estimate = await fetchRentCastRentEstimate({
      address: "2525 Larkin St, San Francisco, CA, 94109",
      bedrooms: 2,
      latitude: null,
      longitude: null,
    });

    expect(estimate).toMatchObject({ rentEstimate: 4100 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("address")).toBe(
      "2525 Larkin St, San Francisco, CA, 94109",
    );
    expect(url.searchParams.get("latitude")).toBe(null);
  });

  it("returns null without calling out when there is no address or coordinates", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fetchRentCastRentEstimate({ bedrooms: 2, latitude: 37.7989 }),
    ).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on a no-data response (genuine, cacheable miss)", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "not found" }, 404)),
    );
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    expect(
      await fetchRentCastRentEstimate({
        latitude: 37.7989,
        longitude: -122.4214,
      }),
    ).toBe(null);
    debug.mockRestore();
  });

  it("throws RentCastUnavailableError on quota/outage responses so callers don't cache a miss", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "over quota" }, 429)),
    );
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    await expect(
      fetchRentCastRentEstimate({
        latitude: 37.7989,
        longitude: -122.4214,
      }),
    ).rejects.toMatchObject({ name: "RentCastUnavailableError" });
    debug.mockRestore();
  });

  it("throws RentCastUnavailableError when the request times out or rejects", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );

    await expect(
      fetchRentCastRentEstimate({
        latitude: 37.7989,
        longitude: -122.4214,
      }),
    ).rejects.toMatchObject({ name: "RentCastUnavailableError" });
  });

  it("returns null when the payload has no usable rent", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ comparables: [], rent: 0 })),
    );

    expect(
      await fetchRentCastRentEstimate({
        latitude: 37.7989,
        longitude: -122.4214,
      }),
    ).toBe(null);
  });
});

describe("isRentCastConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the env var lazily at call time", () => {
    vi.stubEnv("RENTCAST_API_KEY", "");
    expect(isRentCastConfigured()).toBe(false);
    vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
    expect(isRentCastConfigured()).toBe(true);
  });
});
