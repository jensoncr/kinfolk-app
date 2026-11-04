import { primaryListingRentForDisplay } from "@/lib/apartments/roommate-splits";
import type { ApartmentListing } from "@/lib/apartments/types";

export const APARTMENT_SORT_ORDERS = [
  "best-fit",
  "newest",
  "price-asc",
  "price-desc",
] as const;

export type ApartmentSortOrder = (typeof APARTMENT_SORT_ORDERS)[number];

export const APARTMENT_SORT_LABELS: Record<ApartmentSortOrder, string> = {
  "best-fit": "Best fit first",
  newest: "Newest first",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
};

type SortContext = {
  /** Signal score per listing id — the existing "best fit" ranking. */
  fitScores: ReadonlyMap<string, number>;
  /** Roommate split applied on the cards, so price sorting matches the rent shown. */
  roommates: number | null;
};

export function sortListingsForPanel<T extends ApartmentListing>(
  listings: readonly T[],
  order: ApartmentSortOrder,
  { fitScores, roommates }: SortContext,
): T[] {
  const fit = (listing: T) => fitScores.get(listing.id) ?? 0;
  const byFitDesc = (a: T, b: T) => fit(b) - fit(a);

  switch (order) {
    case "best-fit":
      return listings.toSorted(byFitDesc);
    case "newest":
      return listings.toSorted((a, b) => {
        const aTime = a.firstSeenAt ? Date.parse(a.firstSeenAt) : Number.NaN;
        const bTime = b.firstSeenAt ? Date.parse(b.firstSeenAt) : Number.NaN;
        // Listings without an ingest date sink to the bottom.
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
          if (Number.isNaN(aTime) && Number.isNaN(bTime)) return byFitDesc(a, b);
          return Number.isNaN(aTime) ? 1 : -1;
        }
        return bTime - aTime || byFitDesc(a, b);
      });
    case "price-asc":
    case "price-desc": {
      const direction = order === "price-asc" ? 1 : -1;
      return listings.toSorted((a, b) => {
        const aRent = primaryListingRentForDisplay(a, roommates);
        const bRent = primaryListingRentForDisplay(b, roommates);
        // Unpriced listings sink to the bottom in both directions.
        if (aRent == null || bRent == null) {
          if (aRent == null && bRent == null) return byFitDesc(a, b);
          return aRent == null ? 1 : -1;
        }
        return direction * (aRent - bRent) || byFitDesc(a, b);
      });
    }
  }
}
