import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { brandNameMatches } from "./org-logo";
import { findSchoolByDomain, searchSchools } from "./schools";

describe("searchSchools", () => {
  it("ignores queries too short to be meaningful", () => {
    expect(searchSchools("s", 6)).toEqual([]);
  });

  it("ranks prefix matches ahead of substring matches", () => {
    const results = searchSchools("stanford", 6);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name.toLowerCase().startsWith("stanford")).toBe(true);
    expect(results[0].domain).toBe("stanford.edu");
  });

  it("carries a domain and preview icon on every suggestion", () => {
    const [first] = searchSchools("notre dame", 6);
    expect(first.kind).toBe("school");
    expect(first.domain).toMatch(/\./);
    expect(first.iconUrl).toContain(first.domain);
  });

  it("respects the requested limit", () => {
    expect(searchSchools("university", 3)).toHaveLength(3);
  });

  // Bucketing on prefix alone ranked Lebanon's "Notre Dame University" above
  // the school a US user typing "notre dame" means.
  it("ranks the US institution the query covers above foreign prefix matches", () => {
    expect(searchSchools("notre dame", 6)[0].domain).toBe("nd.edu");
  });

  it("prefers the institution whose domain root is the query", () => {
    expect(searchSchools("berkeley", 6)[0].domain).toBe("berkeley.edu");
  });
});

describe("findSchoolByDomain", () => {
  it("resolves a known domain", () => {
    expect(findSchoolByDomain("stanford.edu")?.name).toContain("Stanford");
  });

  it("returns null for anything unknown", () => {
    expect(findSchoolByDomain("not-a-school.example")).toBeNull();
  });
});

describe("brandNameMatches", () => {
  it("accepts a record naming the same organization", () => {
    expect(brandNameMatches("Blue Harbor", "Blue Harbor Ventures")).toBe(true);
    expect(brandNameMatches("UC Berkeley", "Berkeley")).toBe(true);
  });

  // Brand search keyed by domain is not always right: nd.edu resolves to an
  // unrelated "Sclova Health" record, and that logo must never reach a profile.
  it("rejects a record describing something else", () => {
    expect(brandNameMatches("University of Notre Dame", "Sclova Health")).toBe(false);
  });

  it("does not match on legal-form or filler words alone", () => {
    expect(brandNameMatches("Acme Inc", "Globex Inc")).toBe(false);
    expect(brandNameMatches("Boston College", "Denver College")).toBe(false);
  });
});

describe("logo reuse corroboration", () => {
  // A cache keyed on the domain alone drops the half that made the logo
  // correct. Brand search maps nd.edu to an unrelated "Sclova Health" record,
  // so reusing the first answer for that domain would pin a stranger's mark on
  // every later Notre Dame student, permanently and with no repair path.
  it("refuses a peer logo whose label describes a different organization", () => {
    expect(brandNameMatches("University of Notre Dame", "Sclova Health")).toBe(false);
  });

  it("accepts a peer logo whose label describes the same organization", () => {
    expect(brandNameMatches("University of Notre Dame", "Notre Dame")).toBe(true);
  });
});
