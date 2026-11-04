import type { ApartmentListing } from "@/lib/apartments/types";
import { propertyMarkerRentForDisplay } from "@/lib/apartments/roommate-splits";
import { formatCurrency } from "@/lib/shared/currency";

export type BudgetRange = {
  min: number | null;
  max: number | null;
};

export const BUDGET_FLOOR = 0;
export const BUDGET_CEILING = 10000;
export const BUDGET_STEP = 100;

export function isBudgetRangeActive(range: BudgetRange): boolean {
  return range.min != null || range.max != null;
}

export function listingMatchesBudgetRange(
  listing: ApartmentListing,
  range: BudgetRange,
  includeUnpriced: boolean,
  roommatesOverride?: number | null,
): boolean {
  // With no budget filter set, everything shows — including "Ask" pricing.
  // (Checking includeUnpriced first hid ask-priced inventory by default even
  // when the user never touched the budget control.)
  if (!isBudgetRangeActive(range)) return true;
  const rent = propertyMarkerRentForDisplay(listing, roommatesOverride);
  if (rent == null) return includeUnpriced;
  if (range.min != null && rent < range.min) return false;
  if (range.max != null && rent > range.max) return false;
  return true;
}

export function formatBudgetShort(value: number): string {
  if (value >= BUDGET_CEILING) return `${formatCurrency(BUDGET_CEILING)}+`;
  return formatCurrency(value);
}

export function formatBudgetRangeLabel(range: BudgetRange): string {
  if (!isBudgetRangeActive(range)) return "Budget";
  const min = range.min ?? BUDGET_FLOOR;
  const max = range.max ?? BUDGET_CEILING;
  if (range.min == null) return `Up to ${formatBudgetShort(max)}`;
  if (range.max == null) return `${formatBudgetShort(min)}+`;
  return `${formatBudgetShort(min)}–${formatBudgetShort(max)}`;
}

export type BudgetHistogramBucket = {
  start: number;
  end: number;
  count: number;
};

export function buildBudgetHistogram(
  listings: ApartmentListing[],
  roommatesOverride?: number | null,
  bucketCount = 24,
): BudgetHistogramBucket[] {
  const bucketSize = (BUDGET_CEILING - BUDGET_FLOOR) / bucketCount;
  const buckets: BudgetHistogramBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    start: BUDGET_FLOOR + index * bucketSize,
    end: BUDGET_FLOOR + (index + 1) * bucketSize,
    count: 0,
  }));
  for (const listing of listings) {
    const rent = propertyMarkerRentForDisplay(listing, roommatesOverride);
    if (rent == null || rent < 0) continue;
    const clamped = Math.min(rent, BUDGET_CEILING - 1);
    const index = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((clamped - BUDGET_FLOOR) / bucketSize)),
    );
    buckets[index].count += 1;
  }
  return buckets;
}
