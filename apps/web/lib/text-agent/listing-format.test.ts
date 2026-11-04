import { describe, expect, it, vi } from "vitest";
import {
  decodeListingShortCode,
  encodeListingShortCode,
} from "../apartments/listing-shortlink";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/apartments/poi-summary", () => ({
  parsePoiSummary: () => null,
}));
vi.mock(
  "@/lib/apartments/listing-card",
  async () => await import("../apartments/listing-card"),
);
vi.mock(
  "@/lib/apartments/listing-shortlink",
  async () => await import("../apartments/listing-shortlink"),
);
vi.mock("@/lib/apartments/listing-query-features", () => ({
  findListingFeatureDefinition: () => undefined,
  listingMatchesFeatureMustHave: () => false,
}));
vi.mock("@/lib/apartments/listing-request-context", () => ({
  bestRequestedTransitPoi: () => null,
  listingMatchesRequestedNeighborhoodPreference: () => false,
  matchesRequestedNeighborhood: () => false,
  matchesRequestedTransitTargets: () => false,
}));
vi.mock("@/lib/text-agent/fact-utils", () => ({
  formatNaturalList: (values: string[]) => values.join(" and "),
}));
vi.mock("@/lib/text-agent/store-shared", () => ({
  escapeRegExp: (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  formatCurrency: (value: number) =>
    `$${Math.round(value).toLocaleString("en-US")}`,
}));

import { buildListingDetailWebUrl } from "./listing-format";

describe("buildListingDetailWebUrl", () => {
  it("builds a short /l/<code> link that decodes back to the listing", () => {
    const listingId = "8f14e45f-ceea-467f-a8d4-91b2c3d4e5f6";
    const url = buildListingDetailWebUrl("https://kinfolk.test/", listingId);

    expect(url).toBe(
      `https://kinfolk.test/l/${encodeListingShortCode(listingId)}`,
    );
    const code = url!.split("/l/")[1];
    expect(decodeListingShortCode(code)).toBe(listingId);
  });

  it("falls back to the full map URL when the id is not a uuid", () => {
    expect(
      buildListingDetailWebUrl("https://kinfolk.test", "listing-1"),
    ).toBe("https://kinfolk.test/apartments?listing=listing-1");
  });

  it("returns null without a base URL or listing id", () => {
    expect(buildListingDetailWebUrl("", "listing-1")).toBeNull();
    expect(buildListingDetailWebUrl("https://kinfolk.test", null)).toBeNull();
    expect(buildListingDetailWebUrl(null, "listing-1")).toBeNull();
  });
});
