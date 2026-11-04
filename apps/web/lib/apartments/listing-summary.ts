import type { ApartmentListing } from "./types";

/**
 * Strips the match-only rich arrays from a full ApartmentListing, returning
 * a slim listing that is safe to include in the search snapshot payload
 * (markers + list rows).
 *
 * evidence / tradeoffs / splitBreakdown and detail-only lease/concession
 * fields are lazily fetched per-listing via getApartmentListingDetail when the
 * detail modal opens.
 *
 * The byte win is achieved at runtime by stripping the arrays here.
 */
export function toListingSummary(listing: ApartmentListing): ApartmentListing {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { concessionNote, evidence, leaseTerms, tradeoffs, splitBreakdown, ...summary } = listing;
  return {
    ...summary,
    concessionNote: null,
    evidence: [],
    leaseTerms: [],
    tradeoffs: [],
    splitBreakdown: [],
  };
}
