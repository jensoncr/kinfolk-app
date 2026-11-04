import { describe, expect, it } from "vitest";
import type { ApartmentListing } from "@/lib/apartments/types";
import {
  type ApartmentToolbarFilterCriteria,
  listingMatchesToolbarFilters,
  neighborhoodFilterOptionsForListings,
  neighborhoodFilterOptionsWithCounts,
} from "./apartment-listing-filters";

function listing(partial: Partial<ApartmentListing>): ApartmentListing {
  return {
    id: "listing",
    address: "1 Market St",
    city: "San Francisco",
    neighborhood: "SoMa",
    bedrooms: null,
    bathrooms: null,
    floorPlanBedroomMax: null,
    fitScore: 0,
    ...partial,
  } as ApartmentListing;
}

describe("apartment listing toolbar filters", () => {
  it("builds neighborhood filter options ordered by listing count", () => {
    expect(
      neighborhoodFilterOptionsForListings([
        listing({ neighborhood: "Nob Hill" }),
        listing({ neighborhood: "Mission District" }),
        listing({ neighborhood: "nob hill" }),
        listing({ neighborhood: "  " }),
      ]),
    ).toEqual([
      { value: "nob hill", label: "Nob Hill", count: 2 },
      { value: "mission district", label: "Mission District", count: 1 },
    ]);
  });

  it("breaks count ties alphabetically", () => {
    expect(
      neighborhoodFilterOptionsForListings([
        listing({ neighborhood: "Sunset" }),
        listing({ neighborhood: "Castro" }),
        listing({ neighborhood: "Bernal Heights" }),
      ]).map((option) => option.label),
    ).toEqual(["Bernal Heights", "Castro", "Sunset"]);
  });

  it("filters listings by selected neighborhoods", () => {
    const filters: ApartmentToolbarFilterCriteria = {
      search: "",
      minBeds: null,
      minBaths: null,
      neighborhoods: new Set(["nob hill", "russian hill"]),
    };

    expect(
      listingMatchesToolbarFilters(listing({ neighborhood: "Nob Hill" }), filters),
    ).toBe(true);
    expect(
      listingMatchesToolbarFilters(listing({ neighborhood: "Mission District" }), filters),
    ).toBe(false);
  });

  it("counts neighborhood options against the filtered source", () => {
    const universe = neighborhoodFilterOptionsForListings([
      listing({ neighborhood: "Nob Hill" }),
      listing({ neighborhood: "Nob Hill" }),
      listing({ neighborhood: "Mission District" }),
      listing({ neighborhood: "Sunset" }),
    ]);
    // Pretend budget/beds knocked out one Nob Hill listing and all of Sunset.
    const filtered = [
      listing({ neighborhood: "Nob Hill" }),
      listing({ neighborhood: "Mission District" }),
    ];

    expect(
      neighborhoodFilterOptionsWithCounts(filtered, universe, new Set()),
    ).toEqual([
      { value: "mission district", label: "Mission District", count: 1 },
      { value: "nob hill", label: "Nob Hill", count: 1 },
    ]);
  });

  it("keeps selected neighborhoods visible at zero but hides empty unselected ones", () => {
    const universe = neighborhoodFilterOptionsForListings([
      listing({ neighborhood: "Nob Hill" }),
      listing({ neighborhood: "Sunset" }),
      listing({ neighborhood: "Castro" }),
    ]);
    // Nothing matches the active filters in this corner case.
    const filtered: ReturnType<typeof listing>[] = [];

    expect(
      neighborhoodFilterOptionsWithCounts(filtered, universe, new Set(["sunset"])),
    ).toEqual([{ value: "sunset", label: "Sunset", count: 0 }]);
  });
});
