/**
 * Apartment-match statuses that should surface to the user (everything except
 * dismissed/archived rows). Shared by the matches snapshot, the listing-match
 * recompute, and the apartment search so the visible set stays consistent.
 */
export const VISIBLE_APARTMENT_MATCH_STATUSES = [
  "suggested",
  "saved",
  "touring",
  "applied",
] as const;
