import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeMapboxLocationValue,
  searchMapboxLocationSuggestions,
} from "./mapbox-location";

vi.mock("server-only", () => ({}));

const indianapolisFeature = {
  id: "place.123",
  text: "Indianapolis",
  place_type: ["place"],
  context: [
    {
      id: "region.456",
      text: "Indiana",
      short_code: "US-IN",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MAPBOX_TOKEN;
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
});

describe("mapbox location normalization", () => {
  it("returns the same label shape as the location autocomplete", async () => {
    mockMapboxFeatures([indianapolisFeature]);
    process.env.MAPBOX_TOKEN = "test-token";

    await expect(searchMapboxLocationSuggestions("Indianapolis")).resolves.toEqual([
      {
        city: "Indianapolis",
        id: "place.123",
        label: "Indianapolis, IN",
        state: "Indiana",
        stateCode: "IN",
      },
    ]);
  });

  it("falls back to the public token when the server token is blank", async () => {
    const fetchMock = mockMapboxFeatures([indianapolisFeature]);
    process.env.MAPBOX_TOKEN = "   ";
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "public-test-token";

    await searchMapboxLocationSuggestions("Indianapolis");

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("access_token")).toBe("public-test-token");
  });

  it("skips provider lookup for impossible query lengths", async () => {
    const fetchMock = mockMapboxFeatures([indianapolisFeature]);

    await expect(searchMapboxLocationSuggestions("x")).resolves.toEqual([]);
    await expect(searchMapboxLocationSuggestions("a".repeat(121))).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes assistant city-only values to the top confident Mapbox suggestion", async () => {
    mockMapboxFeatures([indianapolisFeature]);
    process.env.MAPBOX_TOKEN = "test-token";

    await expect(
      normalizeMapboxLocationValue("Indianapolis", { allowTopTextMatch: true }),
    ).resolves.toBe("Indianapolis, IN");
  });

  it("requires exact Mapbox labels for profile writes", async () => {
    mockMapboxFeatures([indianapolisFeature]);
    process.env.MAPBOX_TOKEN = "test-token";

    await expect(
      normalizeMapboxLocationValue("Indianapolis, IN", { allowTopTextMatch: false }),
    ).resolves.toBe("Indianapolis, IN");
    await expect(
      normalizeMapboxLocationValue("Indianapolis", { allowTopTextMatch: false }),
    ).rejects.toThrow("Choose a city from the suggestions.");
  });

  it("rejects custom text that does not match the Mapbox suggestion", async () => {
    mockMapboxFeatures([indianapolisFeature]);
    process.env.MAPBOX_TOKEN = "test-token";

    await expect(
      normalizeMapboxLocationValue("not a real place", { allowTopTextMatch: true }),
    ).rejects.toThrow("Choose a city from the suggestions.");
  });
});

function mockMapboxFeatures(features: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return {
      json: async () => ({ features }),
      ok: true,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
