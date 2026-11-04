import { describe, expect, it } from "vitest";
import { findMatchingLocationSuggestion } from "./location-autocomplete-state";
import type { LocationSuggestion } from "@/lib/shared/location-suggestions";

function suggestion(
  label: string,
  overrides: Partial<LocationSuggestion> = {},
): LocationSuggestion {
  return {
    city: "San Francisco",
    id: `place.${label}`,
    label,
    state: "California",
    stateCode: "CA",
    ...overrides,
  };
}

describe("findMatchingLocationSuggestion", () => {
  it("matches selected datalist values despite harmless casing and punctuation differences", () => {
    const sanFrancisco = suggestion("San Francisco, CA");
    const austin = suggestion("Austin, TX", {
      city: "Austin",
      id: "place.austin",
      state: "Texas",
      stateCode: "TX",
    });

    expect(
      findMatchingLocationSuggestion(
        [sanFrancisco, austin],
        "  san   francisco ca  ",
      ),
    ).toBe(sanFrancisco);
  });

  it("does not select a different typed location", () => {
    expect(
      findMatchingLocationSuggestion(
        [suggestion("San Francisco, CA")],
        "Oakland, CA",
      ),
    ).toBeUndefined();
  });
});
