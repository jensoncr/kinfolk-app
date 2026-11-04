import type { FloorPlanGroup, FloorPlanType } from "./types";
import { calculateEffectiveMonthlyRent } from "./rent";

type ConcessionForEffectiveRent = {
  concessionMonths: number;
  concessionLeaseMonths: number;
};

function positiveRent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isAvailableStatus(value: string) {
  return /\bavailable\b/i.test(value);
}

export function displayFloorPlans(floorPlanGroups: FloorPlanGroup[]) {
  const all = floorPlanGroups.find((group) => /^all\b/i.test(group.bedroomTitle.trim()));
  return all
    ? all.availableUnitTypes
    : floorPlanGroups.flatMap((group) => group.availableUnitTypes);
}

function floorPlanMonthlyRent(floorPlan: FloorPlanType) {
  const availableUnitRents = floorPlan.units.flatMap((unit) => {
    if (!isAvailableStatus(unit.status)) return [];
    const rent = positiveRent(unit.rentPrice);
    return rent == null ? [] : [rent];
  });
  const availableUnitRent =
    availableUnitRents.length > 0 ? Math.min(...availableUnitRents) : null;

  return (
    availableUnitRent ??
    positiveRent(floorPlan.rentPriceMin) ??
    positiveRent(floorPlan.rentPriceMax)
  );
}

function effectiveRentFromConcession(
  rent: number | null | undefined,
  concession: ConcessionForEffectiveRent,
) {
  const baseRent = positiveRent(rent);
  if (baseRent == null) return null;
  return (
    positiveRent(
      calculateEffectiveMonthlyRent(
        baseRent,
        concession.concessionMonths,
        concession.concessionLeaseMonths,
      ),
    ) ?? baseRent
  );
}

export function floorPlanUnitEffectiveRent(
  unit: { rentPrice: number | null; effectiveRentPrice?: number | null },
  concession: ConcessionForEffectiveRent,
) {
  return positiveRent(unit.effectiveRentPrice) ?? effectiveRentFromConcession(unit.rentPrice, concession);
}

export function floorPlanEffectiveRentRange(
  floorPlan: FloorPlanType,
  concession: ConcessionForEffectiveRent,
) {
  const availableUnitRents = floorPlan.units.flatMap((unit) => {
    if (!isAvailableStatus(unit.status)) return [];
    const rent = floorPlanUnitEffectiveRent(unit, concession);
    return rent == null ? [] : [rent];
  });

  if (availableUnitRents.length > 0) {
    return {
      min: Math.min(...availableUnitRents),
      max: Math.max(...availableUnitRents),
    };
  }

  const min =
    positiveRent(floorPlan.effectiveRentPriceMin) ??
    effectiveRentFromConcession(floorPlan.rentPriceMin, concession);
  const max =
    positiveRent(floorPlan.effectiveRentPriceMax) ??
    effectiveRentFromConcession(floorPlan.rentPriceMax, concession);

  return { min, max };
}

export function floorPlanHasEffectiveDiscount(
  floorPlan: FloorPlanType,
  concession: ConcessionForEffectiveRent,
) {
  const effectiveRange = floorPlanEffectiveRentRange(floorPlan, concession);
  const grossRange = {
    min: positiveRent(floorPlan.rentPriceMin),
    max: positiveRent(floorPlan.rentPriceMax),
  };
  return (
    (effectiveRange.min != null && grossRange.min != null && effectiveRange.min < grossRange.min) ||
    (effectiveRange.max != null && grossRange.max != null && effectiveRange.max < grossRange.max)
  );
}

function floorPlanHasAvailability(floorPlan: FloorPlanType) {
  return (
    floorPlan.availableUnits > 0 ||
    floorPlan.units.some((unit) => isAvailableStatus(unit.status)) ||
    floorPlan.availableAt != null
  );
}

export function compareFloorPlansByAvailabilityAndPrice(
  a: FloorPlanType,
  b: FloorPlanType,
) {
  const aRent = floorPlanMonthlyRent(a);
  const bRent = floorPlanMonthlyRent(b);
  const aPriced = aRent != null;
  const bPriced = bRent != null;

  if (aPriced !== bPriced) return aPriced ? -1 : 1;
  if (aPriced && bPriced && aRent !== bRent) return aRent - bRent;

  const aAvailable = floorPlanHasAvailability(a);
  const bAvailable = floorPlanHasAvailability(b);
  if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;

  const aBedrooms = a.bedrooms ?? Number.MAX_SAFE_INTEGER;
  const bBedrooms = b.bedrooms ?? Number.MAX_SAFE_INTEGER;
  if (aBedrooms !== bBedrooms) return aBedrooms - bBedrooms;

  return a.name.localeCompare(b.name);
}

export function cheapestFloorPlanEffectiveMonthlyRent(
  floorPlanGroups: FloorPlanGroup[],
  concession: ConcessionForEffectiveRent,
) {
  let cheapest: number | null = null;
  for (const floorPlan of displayFloorPlans(floorPlanGroups)) {
    const range = floorPlanEffectiveRentRange(floorPlan, concession);
    const rent = range.min ?? range.max;
    if (rent == null) continue;
    cheapest = cheapest == null ? rent : Math.min(cheapest, rent);
  }
  return cheapest;
}

export function cheapestFloorPlanMonthlyRent(floorPlanGroups: FloorPlanGroup[]) {
  let cheapest: number | null = null;
  for (const floorPlan of displayFloorPlans(floorPlanGroups)) {
    const rent = floorPlanMonthlyRent(floorPlan);
    if (rent == null) continue;
    cheapest = cheapest == null ? rent : Math.min(cheapest, rent);
  }
  return cheapest;
}

export function floorPlanBedroomRange(floorPlanGroups: FloorPlanGroup[]) {
  const bedrooms = displayFloorPlans(floorPlanGroups).flatMap((floorPlan) =>
    typeof floorPlan.bedrooms === "number" && Number.isFinite(floorPlan.bedrooms)
      ? [floorPlan.bedrooms]
      : [],
  );

  if (bedrooms.length === 0) {
    return { min: null, max: null };
  }

  return {
    min: Math.min(...bedrooms),
    max: Math.max(...bedrooms),
  };
}
