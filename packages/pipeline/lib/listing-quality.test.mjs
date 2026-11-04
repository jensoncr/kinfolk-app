import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildListingQualityContext,
  evaluateListingQuality,
  partitionListingsByQuality,
  shouldAbortForQualityRejections,
} from "./listing-quality.mjs";

function listing(overrides) {
  return {
    external_id: overrides.external_id ?? randomUUID(),
    address_line: overrides.address_line ?? "100 Test St",
    monthly_rent: overrides.monthly_rent,
    rent_min: overrides.monthly_rent,
    bedrooms: overrides.bedrooms,
    bedrooms_min: overrides.bedrooms,
    bathrooms: overrides.bathrooms ?? 1,
  };
}

describe("listing quality", () => {
  const baseline = [
    listing({ monthly_rent: 2500, bedrooms: 1 }),
    listing({ monthly_rent: 2600, bedrooms: 1 }),
    listing({ monthly_rent: 4200, bedrooms: 2 }),
    listing({ monthly_rent: 4400, bedrooms: 2 }),
    listing({ monthly_rent: 5400, bedrooms: 3 }),
    listing({ monthly_rent: 5600, bedrooms: 3 }),
    listing({ monthly_rent: 6900, bedrooms: 4 }),
    listing({ monthly_rent: 7200, bedrooms: 4 }),
  ];

  it("rejects the bad Redfin-style high-bed low-rent listing", () => {
    const badListing = listing({
      external_id: "200440652",
      address_line: "1854 McAllister St Unit 6",
      monthly_rent: 1900,
      bedrooms: 10,
      bathrooms: 6,
    });
    const context = buildListingQualityContext([...baseline, badListing], {
      market: "san-francisco-ca",
    });

    const result = evaluateListingQuality(badListing, context, {
      market: "san-francisco-ca",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "rent_per_bedroom_below_floor",
        "rent_per_bedroom_batch_outlier",
      ]),
    );
  });

  it("keeps normal priced listings in the accepted partition", () => {
    const report = partitionListingsByQuality(baseline, {
      market: "san-francisco-ca",
    });

    expect(report.accepted).toHaveLength(baseline.length);
    expect(report.rejected).toHaveLength(0);
    expect(report.summary.medianRentPerBedroom).toBeGreaterThan(1500);
  });

  it("aborts when rejected rows suggest the provider payload is broken", () => {
    const badRows = Array.from({ length: 10 }, (_, index) =>
      listing({
        external_id: `bad-${index}`,
        monthly_rent: 1200,
        bedrooms: 8,
      }),
    );
    const report = partitionListingsByQuality([...baseline, ...badRows], {
      market: "san-francisco-ca",
    });

    expect(shouldAbortForQualityRejections(report, { maxRejectedRatio: 0.2 })).toBe(true);
  });
});
