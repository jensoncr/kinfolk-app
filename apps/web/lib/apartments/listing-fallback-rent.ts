export type FallbackListingHouseholdPreference = {
  householdSizeMax?: number | null;
  householdSizeMin?: number | null;
};

export function fallbackBudgetQueryMax(
  budgetMax: number | null,
  householdPreference: FallbackListingHouseholdPreference,
) {
  if (budgetMax == null) {
    return null;
  }

  const householdSize =
    readPositiveInteger(householdPreference.householdSizeMax) ??
    readPositiveInteger(householdPreference.householdSizeMin) ??
    1;
  return Math.round(budgetMax * Math.max(1, householdSize));
}

export function fallbackPerPersonRentForListing(
  listing: {
    bedrooms: number | null;
    effective_monthly_rent: number | null;
    monthly_rent: number | null;
  },
  householdPreference: FallbackListingHouseholdPreference,
) {
  const rent = listing.effective_monthly_rent ?? listing.monthly_rent;
  const householdSize = fallbackHouseholdSizeForListing(
    listing,
    householdPreference,
  );

  if (rent == null || householdSize == null) {
    return { householdSize, rent: null };
  }

  return {
    householdSize,
    rent: householdSize > 1 ? Math.round(rent / householdSize) : rent,
  };
}

function fallbackHouseholdSizeForListing(
  listing: { bedrooms: number | null },
  householdPreference: FallbackListingHouseholdPreference,
) {
  // household_size_max is an UPPER bound on the group, not a requirement: a
  // group of "up to 5" should still see (and split) a 2-bed by 2. Split at the
  // unit's realistic occupancy — one person per bedroom — capped by the group's
  // max size. Never null out just because the unit holds fewer than the group's
  // stated minimum; that wrongly hid every under-bedroomed listing.
  const requestedMin =
    readPositiveInteger(householdPreference.householdSizeMin) ?? 1;
  const requestedMax =
    readPositiveInteger(householdPreference.householdSizeMax) ?? requestedMin;
  const bedroomLimit =
    typeof listing.bedrooms === "number" && Number.isFinite(listing.bedrooms)
      ? Math.max(1, Math.round(listing.bedrooms))
      : 1;

  return Math.max(1, Math.min(requestedMax, bedroomLimit));
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}
