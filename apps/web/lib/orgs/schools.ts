// Schools come from a bundled dataset rather than a brand-search vendor.
//
// Brand search is tuned for companies and returns junk for universities — a
// live check for "notre dame" returned the men's basketball site and a French
// cathedral before the university. The Hipo university-domains-list (MIT) maps
// institution name -> official domain for ~10k schools worldwide, which is
// both more accurate and free of a network hop.

import schoolRows from "./data/schools.json";
import { faviconUrl } from "./favicon";
import type { OrgSuggestion } from "./types";

type SchoolRow = {
  /** name */
  n: string;
  /** primary domain */
  d: string;
  /** ISO alpha-2 country code */
  c: string;
};

const rows = schoolRows as SchoolRow[];

/** Lowercased name cache so each keystroke is a scan over primitives. */
const searchIndex = rows.map((row) => row.n.toLowerCase());

/**
 * Rank a candidate against the query.
 *
 * Bucketing on prefix alone ranked badly: "notre dame" put Lebanon's "Notre
 * Dame University" above "University of Notre Dame", because only the former
 * starts with the query. Market and match-coverage have to count too — the
 * name a US user means is usually the one the query covers most of.
 */
function scoreSchool(row: SchoolRow, name: string, needle: string): number {
  const at = name.indexOf(needle);
  if (at < 0) return -1;

  let score = 4 * (needle.length / name.length);
  if (at === 0) score += 4;
  else if (name[at - 1] === " ") score += 2;
  if (row.c === "US") score += 3;
  if (name === needle) score += 10;
  // An institution whose domain root *is* a one-word query is almost always
  // the one meant: "berkeley" means berkeley.edu, not berkeleycollege.edu.
  // Restricted to single words — collapsing "notre dame" to "notredame" would
  // hand the top slot to notredame.ac.jp over nd.edu.
  if (!needle.includes(" ") && row.d.split(".")[0] === needle) score += 5;
  return score;
}

export function searchSchools(query: string, limit: number): OrgSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const scored: Array<{ index: number; score: number }> = [];
  for (let index = 0; index < rows.length; index += 1) {
    const score = scoreSchool(rows[index], searchIndex[index], needle);
    if (score >= 0) scored.push({ index, score });
  }

  scored.sort((a, b) => b.score - a.score || rows[a.index].n.length - rows[b.index].n.length);

  return scored.slice(0, limit).map(({ index }) => {
    const row = rows[index];
    return {
      name: row.n,
      domain: row.d,
      kind: "school",
      iconUrl: faviconUrl(row.d, 64),
    };
  });
}

/** Exact-domain lookup, used to name a school we already have a domain for. */
export function findSchoolByDomain(domain: string): OrgSuggestion | null {
  const needle = domain.trim().toLowerCase();
  if (!needle) return null;

  const row = rows.find((entry) => entry.d === needle);
  return row
    ? { name: row.n, domain: row.d, kind: "school", iconUrl: faviconUrl(row.d, 64) }
    : null;
}
