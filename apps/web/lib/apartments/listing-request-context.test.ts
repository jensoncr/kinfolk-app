import { describe, expect, it } from "vitest";
import {
  bestRequestedTransitPoi,
  bestRequestedTransitMatch,
  emptyListingRequestContext,
  evaluateListingProximityConstraints,
  listingMatchesRequestedNeighborhoodPreference,
  listingRequestContextFromTypedPlan,
  matchesListingProximityConstraints,
  matchesRequestedBedrooms,
  matchesRequestedBudget,
  matchesRequestedNeighborhood,
  matchesRequestedTransitTargets,
  mergeListingRequestContextWithSavedPreferences,
  type ListingRequestContext,
} from "./listing-request-context";

describe("listing request context", () => {
  it("merges saved housing defaults into typed planner criteria", () => {
    expect(
      mergeListingRequestContextWithSavedPreferences(
        { ...emptyListingRequestContext, mustHaves: ["natural light"] },
        {
          budgetMin: 3000,
          budgetMax: 3800,
          mustHaves: ["in-unit laundry"],
          neighborhoods: ["Dogpatch", "Pacific Heights"],
        },
      ),
    ).toEqual({
      avoidTerms: [],
      bedroomsMax: null,
      bedroomsMin: null,
      budgetMin: 3000,
      budgetMax: 3800,
      excludedNeighborhoods: [],
      householdSize: null,
      mustHaves: ["in-unit laundry", "natural light"],
      neighborhoods: ["Dogpatch", "Pacific Heights"],
      proximityConstraints: [],
      transitTargets: [],
    });
  });

  it("preserves typed apartment transit targets from the planner", () => {
    expect(
      listingRequestContextFromTypedPlan({
        primaryDomain: "apartment",
        apartmentCriteria: {
          avoidTerms: ["party", "loud", "party"],
          desiredTerms: ["natural light"],
          neighborhoods: ["Dogpatch"],
          transitTargets: ["BART", "Muni", "BART"],
        },
      }),
    ).toEqual({
      avoidTerms: ["party", "loud"],
      bedroomsMax: null,
      bedroomsMin: null,
      budgetMin: null,
      budgetMax: null,
      excludedNeighborhoods: [],
      householdSize: null,
      mustHaves: ["natural light"],
      neighborhoods: ["Dogpatch"],
      proximityConstraints: [],
      transitTargets: ["BART", "Muni"],
    });
  });

  it("keeps explicit planner criteria ahead of saved preferences", () => {
    const request: ListingRequestContext = {
      ...emptyListingRequestContext,
      avoidTerms: ["party"],
      budgetMax: 3600,
      excludedNeighborhoods: ["Tenderloin"],
      householdSize: null,
      mustHaves: ["near transit"],
      neighborhoods: ["Hayes Valley"],
      transitTargets: ["Muni"],
    };

    expect(
      mergeListingRequestContextWithSavedPreferences(
        request,
        {
          budgetMin: 3000,
          budgetMax: 4200,
          excludedNeighborhoods: ["SoMa"],
          mustHaves: ["in-unit laundry"],
          neighborhoods: ["Dogpatch"],
        },
        { includeSavedMustHaves: false },
      ),
    ).toEqual({
      avoidTerms: ["party"],
      bedroomsMax: null,
      bedroomsMin: null,
      budgetMin: 3000,
      budgetMax: 3600,
      excludedNeighborhoods: ["Tenderloin", "SoMa"],
      householdSize: null,
      mustHaves: ["near transit"],
      neighborhoods: ["Hayes Valley"],
      proximityConstraints: [],
      transitTargets: ["Muni"],
    });
  });

  it("can merge explicit additive neighborhoods with saved neighborhoods", () => {
    expect(
      mergeListingRequestContextWithSavedPreferences(
        { ...emptyListingRequestContext, neighborhoods: ["North Beach"] },
        {
          budgetMax: 3500,
          neighborhoods: ["Dogpatch", "Potrero Hill"],
        },
        { mergeSavedNeighborhoods: true },
      ),
    ).toEqual({
      avoidTerms: [],
      bedroomsMax: null,
      bedroomsMin: null,
      budgetMin: null,
      budgetMax: 3500,
      excludedNeighborhoods: [],
      householdSize: null,
      mustHaves: [],
      neighborhoods: ["Dogpatch", "Potrero Hill", "North Beach"],
      proximityConstraints: [],
      transitTargets: [],
    });
  });

  it("can intentionally ignore saved preferences for relaxed searches", () => {
    expect(
      mergeListingRequestContextWithSavedPreferences(
        { ...emptyListingRequestContext, neighborhoods: ["Mission Bay"] },
        {
          budgetMin: 3000,
          budgetMax: 3800,
          mustHaves: ["in-unit laundry"],
          neighborhoods: ["Dogpatch"],
        },
        {
          includeSavedBudget: false,
          includeSavedMustHaves: false,
          includeSavedNeighborhoods: false,
        },
      ),
    ).toEqual({
      avoidTerms: [],
      bedroomsMax: null,
      bedroomsMin: null,
      budgetMin: null,
      budgetMax: null,
      excludedNeighborhoods: [],
      householdSize: null,
      mustHaves: [],
      neighborhoods: ["Mission Bay"],
      proximityConstraints: [],
      transitTargets: [],
    });
  });

  it("matches listings against typed budget, bedroom, and area constraints", () => {
    expect(
      matchesRequestedBudget(3500, { budgetMax: 3600, budgetMin: 3000 }),
    ).toBe(true);
    expect(
      matchesRequestedBudget(3800, { budgetMax: 3600, budgetMin: 3000 }),
    ).toBe(false);
    expect(
      matchesRequestedBedrooms(0, { bedroomsMax: 0, bedroomsMin: 0 }),
    ).toBe(true);
    expect(
      matchesRequestedBedrooms(1, { bedroomsMax: 0, bedroomsMin: 0 }),
    ).toBe(false);
    expect(matchesRequestedNeighborhood("Central Richmond", "Richmond")).toBe(
      true,
    );
    expect(matchesRequestedNeighborhood("Pacific Heights", "Richmond")).toBe(
      false,
    );
    expect(matchesRequestedNeighborhood("Nob Hill", "Lower Nob Hill")).toBe(
      false,
    );
    expect(matchesRequestedNeighborhood("Lower Nob Hill", "Nob Hill")).toBe(
      false,
    );
    expect(matchesRequestedNeighborhood("Nob Hill", "Nob Hill")).toBe(true);
  });

  it("does not treat a tagged lower district as a parent neighborhood preference", () => {
    expect(
      listingMatchesRequestedNeighborhoodPreference(
        {
          city: "San Francisco",
          description: "Walk to Nob Hill cafes and Grace Cathedral.",
          neighborhood: "Lower Nob Hill",
        },
        "Nob Hill",
      ),
    ).toBe(false);
    expect(
      listingMatchesRequestedNeighborhoodPreference(
        {
          city: "San Francisco",
          description: "Heart of Nob Hill.",
          neighborhood: "Nob Hill",
        },
        "Nob Hill",
      ),
    ).toBe(true);
    expect(
      listingMatchesRequestedNeighborhoodPreference(
        {
          city: "San Francisco",
          description: "Bright apartment in Nob Hill.",
          neighborhood: "San Francisco",
        },
        "Nob Hill",
      ),
    ).toBe(true);
  });

  it("matches and ranks requested transit targets from POI data", () => {
    const poiSummary = {
      transit: [
        { name: "Third Street and 20th Street", distance: 0.09 },
        { name: "22nd Street Caltrain Station", distance: 0.36 },
      ],
    };

    expect(
      matchesRequestedTransitTargets(
        { description: "", poi_summary: poiSummary },
        ["Muni"],
      ),
    ).toBe(true);
    expect(
      matchesRequestedTransitTargets(
        { description: "", poi_summary: poiSummary },
        ["BART"],
      ),
    ).toBe(false);
    expect(
      matchesRequestedTransitTargets(
        { description: "", poi_summary: poiSummary },
        ["Caltrain"],
      ),
    ).toBe(true);
    expect(bestRequestedTransitPoi(poiSummary, ["Muni"])).toEqual({
      name: "Third Street and 20th Street",
      distance: 0.09,
    });
    expect(bestRequestedTransitPoi(poiSummary, ["Caltrain"])).toEqual({
      name: "22nd Street Caltrain Station",
      distance: 0.36,
    });
  });

  it("recognizes Caltrain terminal aliases within the requested transit radius", () => {
    const poiSummary = {
      transit: [
        { name: "Mission Rock", distance: 0.11 },
        { name: "Fourth Street and King Street", distance: 0.19 },
        { name: "San Francisco Station", distance: 0.25 },
      ],
    };

    expect(
      matchesRequestedTransitTargets(
        { description: "", poi_summary: poiSummary },
        ["Caltrain"],
      ),
    ).toBe(true);
    expect(bestRequestedTransitPoi(poiSummary, ["Caltrain"])).toEqual({
      name: "Fourth Street and King Street",
      distance: 0.19,
    });
    expect(
      matchesRequestedTransitTargets(
        {
          description: "",
          poi_summary: {
            transit: [{ name: "22nd Street Caltrain Station", distance: 0.61 }],
          },
        },
        ["Caltrain"],
      ),
    ).toBe(false);
  });

  it("treats negative transit proximity as a dealbreaker constraint", () => {
    const notNearCaltrain = [
      {
        hardness: "dealbreaker" as const,
        kind: "proximity" as const,
        polarity: "avoid" as const,
        target: { name: "Caltrain", type: "transit" as const },
        threshold: { label: "near", maxMiles: 0.6 },
      },
    ];

    const northBeachListing = {
      description: "",
      poi_summary: {
        transit: [{ name: "Embarcadero Station", distance: 1.23 }],
      },
    };
    const potreroListing = {
      description: "",
      poi_summary: {
        transit: [{ name: "22nd Street Caltrain Station", distance: 0.55 }],
      },
    };

    expect(
      matchesListingProximityConstraints(northBeachListing, notNearCaltrain),
    ).toBe(true);
    expect(
      evaluateListingProximityConstraints(northBeachListing, notNearCaltrain)
        .evidence,
    ).toContain("Avoids Caltrain: no nearby match within 0.6 mi.");
    expect(
      matchesListingProximityConstraints(potreroListing, notNearCaltrain),
    ).toBe(false);
  });

  it("uses listing coordinates as a transit proximity fallback when POI enrichment is missing", () => {
    const mariposaNear22ndStreet = {
      description: "",
      latitude: 37.7641828,
      longitude: -122.3897226,
      poi_summary: null,
    };
    const northBeachFarFromCaltrain = {
      description: "",
      latitude: 37.8041754,
      longitude: -122.4144608,
      poi_summary: null,
    };
    const notNearCaltrain = [
      {
        hardness: "dealbreaker" as const,
        kind: "proximity" as const,
        polarity: "avoid" as const,
        target: { name: "Caltrain", type: "transit" as const },
        threshold: { label: "near", maxMiles: 0.6 },
      },
    ];

    expect(
      bestRequestedTransitMatch(mariposaNear22ndStreet, ["Caltrain"]),
    ).toEqual({
      distance: 0.49,
      name: "22nd Street Caltrain Station",
    });
    expect(
      matchesListingProximityConstraints(mariposaNear22ndStreet, notNearCaltrain),
    ).toBe(false);
    expect(
      matchesListingProximityConstraints(northBeachFarFromCaltrain, notNearCaltrain),
    ).toBe(true);
  });

  it("evaluates resolved named-place proximity from listing coordinates", () => {
    const nearComptons = [
      {
        hardness: "preference" as const,
        kind: "proximity" as const,
        polarity: "prefer" as const,
        resolvedTarget: {
          label: "Compton's Coffee House",
          latitude: 37.800614,
          longitude: -122.409568,
        },
        target: {
          area: "North Beach",
          name: "Compton's Coffee",
          type: "place" as const,
        },
        threshold: { label: "near", maxMiles: 0.6 },
      },
    ];

    const evaluation = evaluateListingProximityConstraints(
      {
        description: "",
        latitude: 37.8041754,
        longitude: -122.4144608,
        poi_summary: null,
      },
      nearComptons,
    );

    expect(evaluation.hardPass).toBe(true);
    expect(evaluation.preferredDistance).toBeLessThanOrEqual(0.4);
    expect(evaluation.evidence[0]).toBe(
      "Compton's Coffee: about a 7-min walk (0.36 mi) away.",
    );
  });
});
