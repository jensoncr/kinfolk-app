import { describe, expect, it } from "vitest";
import {
  cheapestFloorPlanEffectiveMonthlyRent,
  floorPlanEffectiveRentRange,
  floorPlanUnitEffectiveRent,
} from "./floor-plan-pricing";
import type { FloorPlanGroup, FloorPlanType } from "./types";

function plan(partial: Partial<FloorPlanType>): FloorPlanType {
  return {
    id: "b6",
    name: "B6",
    bedrooms: 2,
    bathrooms: 2,
    sqftMin: 1053,
    sqftMax: 1053,
    rentPriceMin: 4840,
    rentPriceMax: 4840,
    availableAt: null,
    totalUnits: 1,
    availableUnits: 1,
    units: [],
    specificAmenities: [],
    leaseTerms: [],
    imageUrl: null,
    groups: [],
    ...partial,
  };
}

function group(availableUnitTypes: FloorPlanType[]): FloorPlanGroup {
  return { bedroomTitle: "2 Bed", availableUnitTypes };
}

describe("floor plan effective pricing", () => {
  const concession = { concessionMonths: 1, concessionLeaseMonths: 12 };

  it("uses synced unit effective rent before calculating from gross rent", () => {
    const unit = {
      name: "617",
      sqft: 1053,
      bedrooms: 2,
      bathrooms: 2,
      rentPrice: 4840,
      effectiveRentPrice: 4437,
      status: "available",
      availableAt: null,
      specificAmenities: [],
    };

    expect(floorPlanUnitEffectiveRent(unit, concession)).toBe(4437);
  });

  it("returns effective floor-plan ranges for map/list display", () => {
    const floorPlan = plan({
      rentPriceMin: 4840,
      rentPriceMax: 5425,
      units: [
        {
          name: "617",
          sqft: 1053,
          bedrooms: 2,
          bathrooms: 2,
          rentPrice: 4840,
          effectiveRentPrice: 4437,
          status: "available",
          availableAt: null,
          specificAmenities: [],
        },
      ],
    });

    expect(floorPlanEffectiveRentRange(floorPlan, concession)).toEqual({
      min: 4437,
      max: 4437,
    });
    expect(cheapestFloorPlanEffectiveMonthlyRent([group([floorPlan])], concession)).toBe(4437);
  });
});
