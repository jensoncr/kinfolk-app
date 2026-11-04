import { describe, expect, it } from "vitest";
import {
  addFutureCityChip,
  removeFutureCityChip,
} from "@/app/(app)/me/_components/plan-pane-state";
import type { LocationSuggestion } from "@/lib/shared/location-suggestions";

function suggestion(overrides: Partial<LocationSuggestion> = {}): LocationSuggestion {
  return {
    city: "Austin",
    id: "place.austin",
    label: "Austin, tx",
    state: "Texas",
    stateCode: "tx",
    ...overrides,
  };
}

describe("future city chips", () => {
  it("adds a selected city with normalized state casing", () => {
    expect(addFutureCityChip([], "Austin, tx", suggestion())).toEqual({
      values: ["Austin, TX"],
      error: null,
      clearInput: true,
    });
  });

  it("does not add duplicate cities with different casing", () => {
    const values = ["Austin, TX"];

    expect(
      addFutureCityChip(
        values,
        "austin, tx",
        suggestion({ id: "place.austin-2", label: "austin, tx" }),
      ),
    ).toEqual({
      values,
      error: null,
      clearInput: true,
    });
  });

  it("accepts an equivalent draft for the selected city suggestion", () => {
    expect(
      addFutureCityChip(
        [],
        "austin tx",
        suggestion({ label: "Austin, TX", stateCode: "TX" }),
      ),
    ).toEqual({
      values: ["Austin, TX"],
      error: null,
      clearInput: true,
    });
  });

  it("asks the user to choose a suggestion when draft text was not selected", () => {
    const values = ["San Francisco, CA"];

    expect(addFutureCityChip(values, "Seattle, WA", null)).toEqual({
      values,
      error: "Choose a city from the suggestions.",
      clearInput: false,
    });
  });

  it("asks the user to choose again when the draft changes after selection", () => {
    const values = ["San Francisco, CA"];

    expect(
      addFutureCityChip(
        values,
        "Seattle, WA",
        suggestion({
          city: "Portland",
          id: "place.portland",
          label: "Portland, OR",
          state: "Oregon",
          stateCode: "OR",
        }),
      ),
    ).toEqual({
      values,
      error: "Choose a city from the suggestions.",
      clearInput: false,
    });
  });

  it("rejects selected state or region suggestions with a specific city-only message", () => {
    const values = ["San Francisco, CA"];

    expect(
      addFutureCityChip(
        values,
        "California",
        suggestion({
          city: "",
          id: "region.california",
          label: "California",
          state: "California",
          stateCode: "CA",
        }),
      ),
    ).toEqual({
      values,
      error: "Choose a city, not a state or region.",
      clearInput: false,
    });
  });

  it("removes only the selected city chip", () => {
    expect(
      removeFutureCityChip(
        ["San Francisco, CA", "New York, NY", "Austin, TX"],
        "New York, NY",
      ),
    ).toEqual(["San Francisco, CA", "Austin, TX"]);
  });
});
