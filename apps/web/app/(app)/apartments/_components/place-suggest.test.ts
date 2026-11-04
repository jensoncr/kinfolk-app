import { afterEach, describe, expect, it, vi } from "vitest";
import {
  newSearchSessionToken,
  retrievePlace,
  suggestPlaces,
} from "./place-suggest";

const BBOX = { west: -122.6, south: 37.6, east: -122.2, north: 37.9 };

function mockFetchResponse(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(payload) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suggestPlaces", () => {
  it("maps suggestions and sends session, bbox and proximity", async () => {
    const fetchMock = mockFetchResponse({
      suggestions: [
        {
          mapbox_id: "dXJuOm1i.1",
          name: "Zuni Cafe",
          full_address: "1658 Market St, San Francisco, California 94102",
          feature_type: "poi",
        },
        {
          mapbox_id: "dXJuOm1i.2",
          name: "Noe Valley",
          place_formatted: "San Francisco, California",
          feature_type: "neighborhood",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const suggestions = await suggestPlaces({
      query: "  zuni  ",
      token: "pk.test",
      sessionToken: "sess-1",
      bbox: BBOX,
      proximity: [-122.44, 37.76],
    });

    expect(suggestions).toEqual([
      {
        id: "dXJuOm1i.1",
        name: "Zuni Cafe",
        context: "1658 Market St, San Francisco, California 94102",
        featureType: "poi",
      },
      {
        id: "dXJuOm1i.2",
        name: "Noe Valley",
        context: "San Francisco, California",
        featureType: "neighborhood",
      },
    ]);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/search/searchbox/v1/suggest");
    expect(url.searchParams.get("q")).toBe("zuni");
    expect(url.searchParams.get("session_token")).toBe("sess-1");
    expect(url.searchParams.get("bbox")).toBe("-122.6,37.6,-122.2,37.9");
    expect(url.searchParams.get("proximity")).toBe("-122.44,37.76");
  });

  it("drops brand results, which are chains with no location to go to", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse({
        suggestions: [
          { mapbox_id: "b.1", name: "PacSun", place_formatted: "Brand", feature_type: "brand" },
          {
            mapbox_id: "n.1",
            name: "Pacific Heights",
            place_formatted: "San Francisco, California",
            feature_type: "neighborhood",
          },
        ],
      }),
    );

    const suggestions = await suggestPlaces({
      query: "pac",
      token: "pk.test",
      sessionToken: "s",
      bbox: null,
      proximity: null,
    });
    expect(suggestions.map((s) => s.name)).toEqual(["Pacific Heights"]);
  });

  it("drops suggestions with no id or name rather than rendering blanks", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse({
        suggestions: [
          { name: "No id here" },
          { mapbox_id: "x.1" },
          { mapbox_id: "x.2", name: "Keeps this one" },
        ],
      }),
    );

    const suggestions = await suggestPlaces({
      query: "anything",
      token: "pk.test",
      sessionToken: "sess-1",
      bbox: null,
      proximity: null,
    });
    expect(suggestions.map((s) => s.name)).toEqual(["Keeps this one"]);
  });

  it("returns nothing for a one-character query, a failed request, or an error", async () => {
    const fetchMock = mockFetchResponse({ suggestions: [] });
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await suggestPlaces({
        query: "z",
        token: "pk.test",
        sessionToken: "s",
        bbox: null,
        proximity: null,
      }),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", mockFetchResponse({}, false));
    expect(
      await suggestPlaces({
        query: "zuni",
        token: "pk.test",
        sessionToken: "s",
        bbox: null,
        proximity: null,
      }),
    ).toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(
      await suggestPlaces({
        query: "zuni",
        token: "pk.test",
        sessionToken: "s",
        bbox: null,
        proximity: null,
      }),
    ).toEqual([]);
  });
});

describe("retrievePlace", () => {
  it("exchanges an id for coordinates using the same session", async () => {
    const fetchMock = mockFetchResponse({
      features: [
        {
          geometry: { coordinates: [-122.4216, 37.7739] },
          properties: {
            name: "Zuni Cafe",
            full_address: "1658 Market St, San Francisco",
          },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await retrievePlace({
        id: "dXJuOm1i.1",
        token: "pk.test",
        sessionToken: "sess-1",
      }),
    ).toEqual({
      center: [-122.4216, 37.7739],
      label: "Zuni Cafe",
      bbox: null,
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toContain("/search/searchbox/v1/retrieve/");
    expect(url.searchParams.get("session_token")).toBe("sess-1");
  });

  it("carries a bbox through for features with extent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse({
        features: [
          {
            geometry: { coordinates: [-122.432, 37.7516] },
            properties: {
              name: "Noe Valley",
              bbox: [-122.4447, 37.7414, -122.4243, 37.755],
            },
          },
        ],
      }),
    );

    const placed = await retrievePlace({
      id: "x",
      token: "pk.test",
      sessionToken: "s",
    });
    expect(placed?.bbox).toEqual([-122.4447, 37.7414, -122.4243, 37.755]);
  });

  it("returns null when the feature carries no coordinates", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse({ features: [{ properties: { name: "Nowhere" } }] }),
    );
    expect(
      await retrievePlace({ id: "x", token: "pk.test", sessionToken: "s" }),
    ).toBeNull();
  });
});

describe("newSearchSessionToken", () => {
  it("returns a distinct token per call", () => {
    expect(newSearchSessionToken()).not.toBe(newSearchSessionToken());
  });
});
