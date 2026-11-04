import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeSearchQuery, stripNearPrefix } from "./search-geocode";

const BBOX = { west: -122.6, south: 37.6, east: -122.2, north: 37.9 };

function mockFetchResponse(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(payload),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stripNearPrefix", () => {
  it("strips a leading 'near'", () => {
    expect(stripNearPrefix("near Dolores Park")).toBe("Dolores Park");
    expect(stripNearPrefix("  NEAR   the Mission")).toBe("the Mission");
  });

  it("leaves other queries alone", () => {
    expect(stripNearPrefix("41-43 Barcelona Ave")).toBe("41-43 Barcelona Ave");
    // "near" only counts as a prefix keyword, not part of a name.
    expect(stripNearPrefix("Nearside Cafe")).toBe("Nearside Cafe");
  });
});

describe("geocodeSearchQuery", () => {
  it("resolves the first feature and passes market bbox + proximity", async () => {
    const fetchMock = mockFetchResponse({
      features: [
        {
          geometry: { coordinates: [-122.4275, 37.7596] },
          properties: {
            name: "Mission Dolores Park",
            full_address: "Dolores Street, San Francisco, California 94114",
            bbox: [-122.43, 37.757, -122.425, 37.762],
          },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const placed = await geocodeSearchQuery({
      query: "near Dolores Park",
      token: "pk.test",
      bbox: BBOX,
      proximity: [-122.44, 37.76],
    });

    expect(placed).toEqual({
      center: [-122.4275, 37.7596],
      label: "Dolores Street, San Francisco, California 94114",
      bbox: [-122.43, 37.757, -122.425, 37.762],
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/search/searchbox/v1/forward");
    expect(url.searchParams.get("q")).toBe("Dolores Park");
    expect(url.searchParams.get("bbox")).toBe("-122.6,37.6,-122.2,37.9");
    expect(url.searchParams.get("proximity")).toBe("-122.44,37.76");
    expect(url.searchParams.get("country")).toBe("US");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  // A storefront or a single address has a point but no extent — the caller
  // flies to it rather than fitting bounds, so bbox must come back null.
  it("returns a null bbox for a point feature like a restaurant", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse({
        features: [
          {
            geometry: { coordinates: [-122.4216, 37.7739] },
            properties: {
              name: "Zuni Cafe",
              full_address: "1658 Market St, San Francisco, California 94102",
            },
          },
        ],
      }),
    );

    expect(
      await geocodeSearchQuery({
        query: "Zuni Cafe",
        token: "pk.test",
        bbox: null,
        proximity: null,
      }),
    ).toEqual({
      center: [-122.4216, 37.7739],
      label: "1658 Market St, San Francisco, California 94102",
      bbox: null,
    });
  });

  it("falls back to the feature name when it carries no full address", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse({
        features: [
          {
            geometry: { coordinates: [-122.432, 37.7516] },
            properties: { name: "Noe Valley" },
          },
        ],
      }),
    );

    const placed = await geocodeSearchQuery({
      query: "Noe Valley",
      token: "pk.test",
      bbox: null,
      proximity: null,
    });
    expect(placed?.label).toBe("Noe Valley");
  });

  it("returns null when the feature carries no coordinates", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse({ features: [{ properties: { name: "Nowhere" } }] }),
    );

    expect(
      await geocodeSearchQuery({
        query: "nowhere",
        token: "pk.test",
        bbox: null,
        proximity: null,
      }),
    ).toBeNull();
  });

  it("returns null when nothing matches, the request fails, or the query is too short", async () => {
    vi.stubGlobal("fetch", mockFetchResponse({ features: [] }));
    expect(
      await geocodeSearchQuery({
        query: "somewhere",
        token: "pk.test",
        bbox: null,
        proximity: null,
      }),
    ).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(
      await geocodeSearchQuery({
        query: "somewhere",
        token: "pk.test",
        bbox: null,
        proximity: null,
      }),
    ).toBeNull();

    const fetchMock = mockFetchResponse({ features: [] });
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await geocodeSearchQuery({
        query: "near ok", // "ok" is under the 3-char minimum after stripping
        token: "pk.test",
        bbox: null,
        proximity: null,
      }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
