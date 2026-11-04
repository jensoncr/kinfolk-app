import { describe, expect, it } from "vitest";
import {
  applyTextEdit,
  domainSurvivesEdit,
  isSearchableQuery,
  moveHighlight,
} from "./org-combobox-state";

describe("moveHighlight", () => {
  it("returns -1 for an empty list", () => {
    expect(moveHighlight(-1, 1, 0)).toBe(-1);
  });

  it("enters the list from either end", () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0);
    expect(moveHighlight(-1, -1, 3)).toBe(2);
  });

  it("wraps around both edges", () => {
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
  });
});

describe("domainSurvivesEdit", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(domainSurvivesEdit("Fifth Wall", "  fifth wall ")).toBe(true);
  });

  it("rejects any real change to the label", () => {
    expect(domainSurvivesEdit("Fifth Wall", "Fifth Walls")).toBe(false);
    expect(domainSurvivesEdit("Fifth Wall", "Acme")).toBe(false);
  });
});

describe("applyTextEdit", () => {
  it("drops the domain once the label stops matching the pick", () => {
    const edited = applyTextEdit({ label: "Fifth Wall", domain: "fifthwall.com" }, "Acme");
    expect(edited).toEqual({ label: "Acme", domain: null });
  });

  it("keeps the domain through a cosmetic edit", () => {
    const edited = applyTextEdit(
      { label: "Fifth Wall", domain: "fifthwall.com" },
      "Fifth Wall ",
    );
    expect(edited).toEqual({ label: "Fifth Wall ", domain: "fifthwall.com" });
  });

  it("leaves free text without a domain", () => {
    expect(applyTextEdit({ label: "Acm", domain: null }, "Acme")).toEqual({
      label: "Acme",
      domain: null,
    });
  });
});

describe("isSearchableQuery", () => {
  it("needs two non-space characters", () => {
    expect(isSearchableQuery(" a ")).toBe(false);
    expect(isSearchableQuery("nd")).toBe(true);
  });
});
