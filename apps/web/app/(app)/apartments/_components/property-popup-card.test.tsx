import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ApartmentListing } from "@/lib/apartments/types";
import { PropertyPopupCard } from "./property-popup-card";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement("img", {
      alt: typeof props.alt === "string" ? props.alt : "",
      src: typeof props.src === "string" ? props.src : "",
    }),
}));

function listingWithPhotos(photoUrls: string[]): ApartmentListing {
  return {
    address: "77 Bruton St",
    amenities: [],
    availableAt: null,
    availableUnitCount: 2,
    bathrooms: 2,
    bedrooms: 2,
    city: "San Francisco",
    concessionLeaseMonths: 12,
    concessionMonths: 1,
    concessionNote: null,
    description: "Two-bedroom preview fixture.",
    effectiveMonthlyRent: 4437,
    effectivePerPersonRent: 2219,
    enriched: null,
    evidence: [],
    fitScore: 65,
    floorPlanBedroomMax: 2,
    floorPlanBedroomMin: 2,
    floorPlanMonthlyRent: 4437,
    floorPlanTypeCount: 2,
    formingGroups: [],
    householdSize: 2,
    id: "listing-77-bruton",
    latitude: 37.8193,
    leaseTerms: [],
    listingStatus: "active",
    longitude: -122.3715,
    monthlyRent: 4973,
    neighborhood: "Treasure Island",
    noFee: false,
    perPersonRent: 2487,
    photoUrl: photoUrls[0] ?? null,
    photoUrls,
    postalCode: null,
    providerMarket: "san-francisco-ca",
    roommateSplitLimit: 2,
    source: "redfin",
    sourceUrl: "https://redfin.test/listing",
    splitBreakdown: [],
    squareFeet: 1053,
    state: "CA",
    surfaceFitScore: 65,
    tradeoffs: [],
    unit: null,
    unitEffectiveRentMax: 4973,
    unitEffectiveRentMin: 4437,
    unitRentMax: 4973,
    unitRentMin: 4437,
  };
}

describe("PropertyPopupCard", () => {
  it("renders gallery navigation controls when a popup listing has multiple photos", () => {
    const html = renderToStaticMarkup(
      <PropertyPopupCard
        listing={listingWithPhotos(["https://images.test/0.jpg", "https://images.test/1.jpg"])}
        onClose={vi.fn()}
        onOpenDetails={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Apartment preview for 77 Bruton St"');
    expect(html).toContain('aria-label="Previous photo"');
    expect(html).toContain('aria-label="Next photo"');
    expect(html).toContain('src="https://images.test/0.jpg"');
  });

  it("hides gallery navigation controls for a single-photo popup listing", () => {
    const html = renderToStaticMarkup(
      <PropertyPopupCard
        listing={listingWithPhotos(["https://images.test/only.jpg"])}
        onClose={vi.fn()}
        onOpenDetails={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Apartment preview for 77 Bruton St"');
    expect(html).not.toContain('aria-label="Previous photo"');
    expect(html).not.toContain('aria-label="Next photo"');
    expect(html).toContain('src="https://images.test/only.jpg"');
  });
});
