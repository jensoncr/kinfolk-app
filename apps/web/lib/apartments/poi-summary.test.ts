import { describe, expect, it } from "vitest";
import { parsePoiSummary } from "./poi-summary";

describe("parsePoiSummary", () => {
  it("reads parks from the park key used by enrichment scripts", () => {
    expect(
      parsePoiSummary({
        park: [{ name: "Dolores Park", distance: 0.2 }],
      }),
    ).toEqual({
      transit: [],
      restaurant: [],
      parks: [{ name: "Dolores Park", distance: 0.2 }],
      grocery: [],
    });
  });

  it("merges park and parks without duplicates", () => {
    expect(
      parsePoiSummary({
        park: [{ name: "Dolores Park", distance: 0.2 }],
        parks: [{ name: "Dolores Park", distance: 0.1 }],
      }),
    ).toEqual({
      transit: [],
      restaurant: [],
      parks: [{ name: "Dolores Park", distance: 0.2 }],
      grocery: [],
    });
  });
});
