import type { ApartmentListing, ApartmentSearchSnapshot } from "@/lib/apartments/types";
import type { BudgetRange } from "./budget-range/types";

type ActiveProfile = ApartmentSearchSnapshot["activeProfile"];

export type ApartmentFilterDefaults = {
  budgetRange: BudgetRange;
  roommates: number | null;
};

function positiveWholeNumber(value: number) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

export function budgetRangeFromProfile(profile: ActiveProfile): BudgetRange {
  const min = positiveWholeNumber(profile.budgetMin);
  const max = positiveWholeNumber(profile.budgetMax);

  if (min != null && max != null && min > max) {
    return { min: max, max: min };
  }

  return { min, max };
}

export function maxRoommatesForListings(listings: ApartmentListing[]) {
  return listings.reduce(
    (acc, listing) => Math.max(acc, listing.roommateSplitLimit),
    0,
  );
}

export function roommatesFromProfile(profile: ActiveProfile, maxRoommates: number) {
  // householdSizeMax counts the whole household including the user, so roommates
  // is one fewer. The toolbar adds the user back as the +1 for the household label.
  const householdSize = positiveWholeNumber(profile.householdSizeMax);
  if (householdSize == null || maxRoommates <= 0) {
    return null;
  }

  const roommates = householdSize - 1;
  if (roommates < 1) {
    return null;
  }

  return Math.min(roommates, maxRoommates);
}

export function apartmentFilterDefaultsFromProfile(
  profile: ActiveProfile,
  listings: ApartmentListing[],
): ApartmentFilterDefaults {
  const maxRoommates = maxRoommatesForListings(listings);
  return {
    budgetRange: budgetRangeFromProfile(profile),
    roommates: roommatesFromProfile(profile, maxRoommates),
  };
}

export function budgetRangesEqual(a: BudgetRange, b: BudgetRange) {
  return a.min === b.min && a.max === b.max;
}
