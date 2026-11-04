import { describe, expect, it } from "vitest";
import {
  locationLabelsMatch,
  normalizeMapboxLocationLabel,
} from "./location-suggestions";

describe("location suggestion labels", () => {
  it("normalizes Mapbox city labels to canonical state-code casing", () => {
    expect(normalizeMapboxLocationLabel("  Austin, tx  ")).toBe("Austin, TX");
  });

  it("matches selected location labels despite harmless casing and punctuation differences", () => {
    expect(locationLabelsMatch("Austin, TX", "austin tx")).toBe(true);
    expect(locationLabelsMatch("San   Francisco, ca", "san francisco ca")).toBe(
      true,
    );
  });

  it("does not match blank or different city labels", () => {
    expect(locationLabelsMatch("", "Austin, TX")).toBe(false);
    expect(locationLabelsMatch("Austin, TX", "Boston, MA")).toBe(false);
  });
});
