import { describe, expect, it } from "vitest";
import {
  findListingFeatureDefinition,
  listingMatchesFeatureMustHave,
} from "./listing-query-features";

describe("listing query features", () => {
  it("treats saved target-specific transit must-haves as POI-aware transit filters", () => {
    const listing = {
      amenities: ["Laundry in unit"],
      description: "",
      poi_summary: {
        transit: [
          { name: "Third Street and 20th Street", distance: 0.09 },
          { name: "22nd Street Caltrain Station", distance: 0.36 },
        ],
      },
    };

    expect(findListingFeatureDefinition("near Caltrain")?.key).toBe(
      "near transit",
    );
    expect(listingMatchesFeatureMustHave(listing, "near Caltrain")).toBe(true);
    expect(
      listingMatchesFeatureMustHave(
        { ...listing, poi_summary: { transit: [] } },
        "near Caltrain",
      ),
    ).toBe(false);
  });
});
