// Shared copy + list formatting for apartment-fit evidence. The two fit scorers
// — the UI surface (apartment-match-surface.ts, snapshot-driven) and the DB
// matcher (apartment-listing-matches.ts, row-driven) — stay deliberately
// separate, but they must emit identical evidence wording. Keeping the strings
// here prevents them drifting.

function formatApartmentList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

export function neighborhoodInterestEvidence(neighborhood: string) {
  return {
    label: "Neighborhood",
    detail: `Matches your saved interest in ${neighborhood}.`,
  };
}

export function confirmedMustHavesEvidence(matched: string[]) {
  return {
    label: "Must-haves",
    detail: `Listing confirms ${formatApartmentList(matched.slice(0, 3))}.`,
  };
}

export function unconfirmedMustHavesTradeoff(unconfirmed: string[]) {
  return {
    label: "Must-haves",
    detail: `Listing data does not confirm ${formatApartmentList(unconfirmed.slice(0, 3))}.`,
  };
}
