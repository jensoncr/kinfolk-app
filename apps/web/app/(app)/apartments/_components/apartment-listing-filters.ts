import type { ApartmentListing } from "@/lib/apartments/types";

export type NeighborhoodFilterOption = {
  value: string;
  label: string;
  count: number;
};

export type ApartmentToolbarFilterCriteria = {
  search: string;
  minBeds: number | null;
  minBaths: number | null;
  neighborhoods: ReadonlySet<string>;
};

export function normalizeNeighborhoodFilterValue(value: string) {
  return value.trim().toLowerCase();
}

// A listing matches the bed/bath filter when it offers AT LEAST the requested
// counts. Bedrooms can span multiple floor plans, so the max available bedroom
// count qualifies; bathrooms are a single listing-level value.
function listingMatchesBedBath(
  listing: ApartmentListing,
  minBeds: number | null,
  minBaths: number | null,
): boolean {
  if (minBeds != null) {
    const bedroomsMax = listing.floorPlanBedroomMax ?? listing.bedrooms;
    if (bedroomsMax == null || bedroomsMax < minBeds) return false;
  }
  if (minBaths != null && (listing.bathrooms == null || listing.bathrooms < minBaths)) {
    return false;
  }
  return true;
}

export function neighborhoodFilterOptionsForListings(
  listings: readonly ApartmentListing[],
): NeighborhoodFilterOption[] {
  const byValue = new Map<string, { label: string; count: number }>();
  for (const listing of listings) {
    const label = listing.neighborhood.trim();
    if (!label) continue;
    const value = normalizeNeighborhoodFilterValue(label);
    const existing = byValue.get(value);
    if (existing) {
      existing.count += 1;
    } else {
      byValue.set(value, { label, count: 1 });
    }
  }

  // Surface the densest neighborhoods first so the common picks sit at the top
  // of a long list; fall back to alphabetical for stable ties.
  return Array.from(byValue, ([value, option]) => ({
    value,
    label: option.label,
    count: option.count,
  })).toSorted(
    (a, b) =>
      b.count - a.count ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

// Build the neighborhood dropdown options with counts that reflect the active
// filters, so each badge tells the user how many listings they'd actually see.
//
// `countingListings` must already have every OTHER filter applied (budget,
// beds/baths, fit, search) but NOT the neighborhood selection — a facet never
// constrains its own counts. With OR-semantics multi-select that lets each
// option report how many listings it would add, independent of the other
// neighborhoods already picked.
//
// `universe` carries the value/label for every neighborhood that exists at all
// (typically the unfiltered options). Neighborhoods that drop to zero under the
// current filters are hidden, EXCEPT any the user has currently selected —
// those stay visible (at 0) so they remain easy to un-check.
export function neighborhoodFilterOptionsWithCounts(
  countingListings: readonly ApartmentListing[],
  universe: readonly NeighborhoodFilterOption[],
  selected: ReadonlySet<string>,
): NeighborhoodFilterOption[] {
  const counts = new Map<string, number>();
  for (const listing of countingListings) {
    const value = normalizeNeighborhoodFilterValue(listing.neighborhood);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return universe
    .map((option) => ({ ...option, count: counts.get(option.value) ?? 0 }))
    .filter((option) => option.count > 0 || selected.has(option.value))
    .toSorted(
      (a, b) =>
        b.count - a.count ||
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
}

export function listingMatchesToolbarFilters(
  listing: ApartmentListing,
  filters: ApartmentToolbarFilterCriteria,
): boolean {
  if (!listingMatchesBedBath(listing, filters.minBeds, filters.minBaths)) return false;
  if (
    filters.neighborhoods.size > 0 &&
    !filters.neighborhoods.has(normalizeNeighborhoodFilterValue(listing.neighborhood))
  ) {
    return false;
  }
  if (filters.search) {
    const haystack = `${listing.neighborhood} ${listing.address} ${listing.city}`.toLowerCase();
    if (!haystack.includes(filters.search)) return false;
  }
  return true;
}
