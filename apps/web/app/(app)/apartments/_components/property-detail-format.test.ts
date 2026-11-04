import { describe, expect, it } from "vitest";
import { buildAmenityChipItems } from "./property-detail-format";

describe("buildAmenityChipItems", () => {
  it("keeps property amenities neutral before a floor plan or unit is selected", () => {
    expect(
      buildAmenityChipItems({
        hasActiveSelection: false,
        selectedAmenities: [],
        propertyAmenities: ["Dishwasher", "Conference Room"],
      }),
    ).toEqual([
      { amenity: "Dishwasher", highlighted: false },
      { amenity: "Conference Room", highlighted: false },
    ]);
  });

  it("keeps property amenities visible but neutral for a selected unit", () => {
    expect(
      buildAmenityChipItems({
        hasActiveSelection: true,
        selectedAmenities: ["Dishwasher", "Washer"],
        propertyAmenities: ["Dishwasher", "Conference Room", "Fitness Center"],
      }),
    ).toEqual([
      { amenity: "Dishwasher", highlighted: true },
      { amenity: "Washer", highlighted: true },
      { amenity: "Conference Room", highlighted: false },
      { amenity: "Fitness Center", highlighted: false },
    ]);
  });

  it("dedupes selected and property amenities case-insensitively", () => {
    expect(
      buildAmenityChipItems({
        hasActiveSelection: true,
        selectedAmenities: ["  Washer  ", "washer"],
        propertyAmenities: ["WASHER", "", "Package Receiving"],
      }),
    ).toEqual([
      { amenity: "Washer", highlighted: true },
      { amenity: "Package Receiving", highlighted: false },
    ]);
  });
});
