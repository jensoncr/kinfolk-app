import { describe, expect, it } from "vitest";
import {
  addressAlreadyNamesUnit,
  formatListingDisplayAddress,
} from "./listing-address";

describe("formatListingDisplayAddress", () => {
  it("appends a unit that equals the building number", () => {
    expect(formatListingDisplayAddress("8 Cypress St", "8")).toBe("8 Cypress St 8");
    expect(formatListingDisplayAddress("8 Cypress St", "Unit 8")).toBe(
      "8 Cypress St Unit 8",
    );
  });

  it("does not duplicate a unit already named in the address", () => {
    expect(formatListingDisplayAddress("123 Main St Apt 4", "Apt 4")).toBe(
      "123 Main St Apt 4",
    );
  });

  it("keeps a numeric unit that is only a substring of the house number", () => {
    expect(formatListingDisplayAddress("2155 Polk St", "5")).toBe("2155 Polk St 5");
  });

  it("returns the address alone when there is no unit", () => {
    expect(formatListingDisplayAddress("8 Cypress St", null)).toBe("8 Cypress St");
  });

  it("returns null without an address", () => {
    expect(formatListingDisplayAddress(null, "8")).toBeNull();
  });
});

describe("addressAlreadyNamesUnit", () => {
  it("treats a unit matching only the leading house number as not-yet-named", () => {
    expect(addressAlreadyNamesUnit("8 Cypress St", "8")).toBe(false);
  });

  it("detects a genuinely repeated unit token", () => {
    expect(addressAlreadyNamesUnit("123 Main St Apt 4", "Apt 4")).toBe(true);
  });
});
