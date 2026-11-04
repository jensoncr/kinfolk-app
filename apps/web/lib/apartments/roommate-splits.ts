import type { ApartmentListing } from "./types";

export function roommateSplitLimitFromBedrooms(bedrooms: number | null | undefined) {
  if (typeof bedrooms !== "number" || !Number.isFinite(bedrooms)) {
    return 0;
  }
  return Math.max(0, Math.round(bedrooms) - 1);
}

export function householdSizeLimitFromBedrooms(bedrooms: number | null | undefined) {
  if (typeof bedrooms !== "number" || !Number.isFinite(bedrooms)) {
    return 1;
  }
  return Math.max(1, Math.round(bedrooms));
}

export function canSplitByRoommates(bedrooms: number | null | undefined) {
  return roommateSplitLimitFromBedrooms(bedrooms) > 0;
}

export function clampRoommateSplitSize(
  requestedSize: number | null | undefined,
  bedrooms: number | null | undefined,
) {
  const limit = householdSizeLimitFromBedrooms(bedrooms);
  if (typeof requestedSize !== "number" || !Number.isFinite(requestedSize)) {
    return limit;
  }
  return Math.max(1, Math.min(limit, Math.round(requestedSize)));
}

export function canShowRoommateSplitForListing(listing: ApartmentListing) {
  return listing.roommateSplitLimit > 0;
}

export function householdSizeForRoommates(
  listing: ApartmentListing,
  roommatesOverride?: number | null,
) {
  if (
    roommatesOverride != null &&
    roommatesOverride >= 1 &&
    listing.roommateSplitLimit > 0
  ) {
    const roommates = Math.min(Math.round(roommatesOverride), listing.roommateSplitLimit);
    return Math.max(1, roommates + 1);
  }
  return Math.max(1, listing.householdSize);
}

export function usesFloorPlanRentDisplay(listing: ApartmentListing) {
  return listing.floorPlanTypeCount > 0;
}

export function propertyMarkerRentForDisplay(
  listing: ApartmentListing,
  roommatesOverride?: number | null,
) {
  const total = usesFloorPlanRentDisplay(listing)
    ? listing.floorPlanMonthlyRent
    : (listing.effectiveMonthlyRent ?? listing.monthlyRent);
  if (roommatesOverride != null && roommatesOverride >= 1 && total != null) {
    const roommates = Math.min(Math.round(roommatesOverride), listing.roommateSplitLimit);
    if (roommates >= 1) {
      return Math.round(total / (roommates + 1));
    }
  }
  return total;
}

export function primaryListingRentForDisplay(
  listing: ApartmentListing,
  roommatesOverride?: number | null,
) {
  if (roommatesOverride != null && roommatesOverride >= 1) {
    return propertyMarkerRentForDisplay(listing, roommatesOverride);
  }
  const totalRent = propertyMarkerRentForDisplay(listing);
  if (usesFloorPlanRentDisplay(listing)) {
    return totalRent;
  }
  return canShowRoommateSplitForListing(listing)
    ? (listing.effectivePerPersonRent ?? totalRent)
    : totalRent;
}
