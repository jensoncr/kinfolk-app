import { describe, expect, it } from "vitest";
import type { ApartmentListing } from "@/lib/apartments/types";
import { sortListingsForPanel } from "./listing-sort";

function listing(partial: Partial<ApartmentListing>): ApartmentListing {
  return {
    id: "listing",
    monthlyRent: null,
    effectiveMonthlyRent: null,
    floorPlanTypeCount: 0,
    floorPlanMonthlyRent: null,
    roommateSplitLimit: 0,
    effectivePerPersonRent: null,
    firstSeenAt: null,
    fitScore: 0,
    ...partial,
  } as ApartmentListing;
}

const fitScores = new Map([
  ["a", 0.9],
  ["b", 0.5],
  ["c", 0.7],
]);
const context = { fitScores, roommates: null };

describe("sortListingsForPanel", () => {
  it("sorts by fit score descending for best-fit", () => {
    const sorted = sortListingsForPanel(
      [listing({ id: "b" }), listing({ id: "a" }), listing({ id: "c" })],
      "best-fit",
      context,
    );
    expect(sorted.map((l) => l.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by first-seen date descending for newest, unseen last", () => {
    const sorted = sortListingsForPanel(
      [
        listing({ id: "a", firstSeenAt: "2026-07-01T00:00:00Z" }),
        listing({ id: "b", firstSeenAt: "2026-07-20T00:00:00Z" }),
        listing({ id: "c", firstSeenAt: null }),
      ],
      "newest",
      context,
    );
    expect(sorted.map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks newest ties by fit score", () => {
    const sameDay = "2026-07-20T00:00:00Z";
    const sorted = sortListingsForPanel(
      [
        listing({ id: "b", firstSeenAt: sameDay }),
        listing({ id: "a", firstSeenAt: sameDay }),
      ],
      "newest",
      context,
    );
    expect(sorted.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("sorts by displayed rent, unpriced last in both directions", () => {
    const listings = [
      listing({ id: "a", monthlyRent: 3000 }),
      listing({ id: "b", monthlyRent: null }),
      listing({ id: "c", monthlyRent: 1500 }),
    ];
    expect(
      sortListingsForPanel(listings, "price-asc", context).map((l) => l.id),
    ).toEqual(["c", "a", "b"]);
    expect(
      sortListingsForPanel(listings, "price-desc", context).map((l) => l.id),
    ).toEqual(["a", "c", "b"]);
  });

  it("prefers effective rent over asking rent, matching the cards", () => {
    const sorted = sortListingsForPanel(
      [
        listing({ id: "a", monthlyRent: 2000, effectiveMonthlyRent: 1800 }),
        listing({ id: "b", monthlyRent: 1900 }),
      ],
      "price-asc",
      context,
    );
    expect(sorted.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("sorts price by the per-person split when roommates are set", () => {
    const sorted = sortListingsForPanel(
      [
        // $3000 across 2 people = $1500/ea; beats the $1600 studio.
        listing({ id: "a", monthlyRent: 3000, roommateSplitLimit: 1 }),
        listing({ id: "b", monthlyRent: 1600 }),
      ],
      "price-asc",
      { fitScores, roommates: 1 },
    );
    expect(sorted.map((l) => l.id)).toEqual(["a", "b"]);
  });
});
