import { describe, expect, it } from "vitest";
import {
  formatCommuteAreaSignalReply,
  formatNoiseAreaSignalReply,
  formatRestaurantAreaSignalReply,
  formatSafetyAreaSignalReply,
} from "./area-signals";
import type {
  AreaSignalPlace,
  AreaSignalSummary,
} from "../apartments/area-signals";
import type { TableRow } from "./tools";

describe("formatRestaurantAreaSignalReply", () => {
  it("falls back to neighborhood profile POIs when live place lookups error out", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantSummary({ googleStatus: "error", mapboxStatus: "error" }),
      null,
      missionProfile(),
    );

    expect(reply).toContain("I do not have a live places lookup");
    expect(reply).toContain("the neighborhood profile lists");
    expect(reply).toContain("Tartine Bakery");
    expect(reply).toContain("Foreign Cinema");
    expect(reply).not.toContain("Google Places");
    expect(reply).not.toContain("Mapbox");
  });

  it("keeps the dining reply null on live API error when no profile data exists", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantSummary({ googleStatus: "error", mapboxStatus: "error" }),
      null,
      undefined,
    );

    expect(reply).toBeNull();
  });

  it("filters the profile POI fallback to cafe names for coffee work requests", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantSummary({ googleStatus: "skipped", mapboxStatus: "skipped" }),
      null,
      missionProfile([
        { distance: 0.1, name: "Dogpatch Saloon" },
        { distance: 0.2, name: "Daily Driver Coffee" },
        { distance: 0.3, name: "Plow" },
      ]),
      { requestKind: "coffee_work" },
    );

    expect(reply).toContain("the neighborhood profile lists");
    expect(reply).toContain("Daily Driver Coffee");
    expect(reply).toContain("verify seating and laptop-friendliness");
    expect(reply).not.toContain("Dogpatch Saloon");
    expect(reply).not.toContain("Plow");
  });

  it("fails closed for coffee work when neither live nor profile cafe data exists", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantSummary({ googleStatus: "error", mapboxStatus: "error" }),
      null,
      missionProfile([{ distance: 0.1, name: "Dogpatch Saloon" }]),
      { requestKind: "coffee_work" },
    );

    expect(reply).toContain(
      "do not have a grounded cafe or coffee-work signal",
    );
  });

  it("names Google Places as the source and dedupes profile mentions", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantSummary({
        googlePlaces: [
          place("Tartine Bakery", 0.1),
          place("Foreign Cinema", 0.2),
        ],
      }),
      null,
      missionProfile([
        { distance: 0.1, name: "Tartine Bakery" },
        { distance: 0.4, name: "Lazy Bear" },
      ]),
    );

    expect(reply).toContain(
      "Google Places shows the strongest restaurant and cafe/bar signals",
    );
    expect(reply).toContain(
      "The neighborhood profile also flags Lazy Bear nearby.",
    );
    expect(reply?.match(/Tartine Bakery/g)).toHaveLength(1);
  });

  it("names Mapbox as the source when Google has no results", () => {
    const reply = formatRestaurantAreaSignalReply(
      restaurantSummary({
        googleStatus: "error",
        mapboxPlaces: [place("Taqueria El Farolito", 0.2)],
      }),
      null,
      undefined,
    );

    expect(reply).toContain(
      "Mapbox shows the strongest restaurant and cafe/bar signals",
    );
    expect(reply).toContain("Taqueria El Farolito");
    expect(reply).not.toContain("Google Places");
  });
});

describe("formatSafetyAreaSignalReply", () => {
  it("attributes safety claims to DataSF and SFPD data", () => {
    const reply = formatSafetyAreaSignalReply(safetySummary());

    expect(reply).toContain(
      "DataSF shows recent reported-incident activity as below typical",
    );
    expect(reply).toContain(
      "Recent SFPD reports nearby are mostly Larceny Theft and Motor Vehicle Theft.",
    );
    expect(reply).toContain(
      "Recent 311 requests are mostly Street and Sidewalk Cleaning.",
    );
  });
});

describe("formatNoiseAreaSignalReply", () => {
  it("attributes noise claims to HowLoud when a score exists", () => {
    const reply = formatNoiseAreaSignalReply(
      noiseSummary({
        airports: 90,
        airportsText: "Calm",
        local: 60,
        localText: "Calm",
        score: 72,
        scoreText: "Active",
        status: "ok",
        traffic: 55,
        trafficText: "Busy",
      }),
      null,
    );

    expect(reply).toContain("HowLoud SoundScore is 72 (active)");
    expect(reply).toContain("Traffic reads busy.");
  });

  it("admits a failed HowLoud lookup instead of guessing", () => {
    const reply = formatNoiseAreaSignalReply(
      noiseSummary({ ...emptySoundscore(), status: "error" }),
      null,
    );

    expect(reply).toContain(
      "I tried to pull a HowLoud SoundScore, but the lookup failed just now.",
    );
  });

  it("admits when no HowLoud score is configured", () => {
    const reply = formatNoiseAreaSignalReply(
      noiseSummary({ ...emptySoundscore(), status: "skipped" }),
      null,
    );

    expect(reply).toContain(
      "I do not have a HowLoud SoundScore for that address yet.",
    );
  });
});

describe("formatCommuteAreaSignalReply", () => {
  it("attributes a transit time to Google with walk, line, and transfer detail", () => {
    const reply = formatCommuteAreaSignalReply(
      commuteSummary({
        arrivalTime: "2026-06-15T16:00:00.000Z",
        destinationLabel: "FiDi (555 California St)",
        distanceMeters: 5200,
        durationMinutes: 26,
        reason: null,
        status: "ok",
        transit: {
          firstStopName: "24th St Mission",
          lineNames: ["BART"],
          transferCount: 0,
          walkToFirstStopMinutes: 7,
        },
        travelMode: "TRANSIT",
      }),
    );

    expect(reply).toContain(
      "Google says about 26 min door-to-door on transit from 742 Green St in North Beach to FiDi (555 California St) for a 9am weekday arrival",
    );
    expect(reply).toContain("7 min walk to 24th St Mission");
    expect(reply).toContain("via BART");
    expect(reply).toContain("no transfers");
  });

  it("phrases non-transit modes without arrival framing", () => {
    const reply = formatCommuteAreaSignalReply(
      commuteSummary({
        arrivalTime: null,
        destinationLabel: "UCSF Parnassus (505 Parnassus Ave)",
        distanceMeters: 3000,
        durationMinutes: 18,
        reason: null,
        status: "ok",
        transit: null,
        travelMode: "BICYCLE",
      }),
    );

    expect(reply).toContain("Google says about 18 min by bike");
    expect(reply).not.toContain("9am weekday arrival");
    expect(reply).not.toContain("transfers");
  });

  it("admits live transit times are not available when Routes is not enabled", () => {
    const reply = formatCommuteAreaSignalReply(
      commuteSummary({
        arrivalTime: null,
        destinationLabel: "Caltrain (700 4th St)",
        distanceMeters: null,
        durationMinutes: null,
        reason: "routes_api_not_enabled",
        status: "error",
        transit: null,
        travelMode: "TRANSIT",
      }),
    );

    expect(reply).toContain("I can't pull live transit times yet");
    expect(reply).toContain("check Google Maps");
    expect(reply).not.toContain("min door-to-door");
  });

  it("admits a failed lookup instead of guessing a number", () => {
    const reply = formatCommuteAreaSignalReply(
      commuteSummary({
        arrivalTime: null,
        destinationLabel: "Salesforce Tower (415 Mission St)",
        distanceMeters: null,
        durationMinutes: null,
        reason: "lookup_failed",
        status: "error",
        transit: null,
        travelMode: "TRANSIT",
      }),
    );

    expect(reply).toContain("the lookup failed just now");
    expect(reply).toContain("I would not guess a commute number");
  });

  it("stays null for non-commute summaries", () => {
    expect(formatCommuteAreaSignalReply(null)).toBe(null);
    expect(formatCommuteAreaSignalReply(safetySummary())).toBe(null);
  });

  it("appends a 511 realtime clause when departures are present", () => {
    const reply = formatCommuteAreaSignalReply(
      commuteSummary({
        ...okTransitCommute(),
        realtime: {
          agency: "BA",
          headwayMinutes: 8,
          lineRef: "Yellow-N",
          nextDepartureMinutes: [4, 12],
          source: "511.org",
          stopCode: "24TH",
          stopName: "24th St Mission",
        },
      }),
    );

    expect(reply).toContain("Google says about 26 min door-to-door on transit");
    expect(reply).toContain(
      "Right now 511 shows the next ones in 4 and 12 minutes — roughly every 8 min.",
    );
    expect(reply).toContain("I would still sanity-check");
  });

  it("phrases a single upcoming departure without a headway", () => {
    const reply = formatCommuteAreaSignalReply(
      commuteSummary({
        ...okTransitCommute(),
        realtime: {
          agency: "SF",
          headwayMinutes: null,
          lineRef: "N",
          nextDepartureMinutes: [9],
          source: "511.org",
          stopCode: "15419",
          stopName: "Van Ness Station",
        },
      }),
    );

    expect(reply).toContain(
      "Right now 511 shows the next one leaving in 9 minutes.",
    );
    expect(reply).not.toContain("roughly every");
  });

  it("keeps today's exact reply when no realtime data is present", () => {
    const expected =
      "Google says about 26 min door-to-door on transit from 742 Green St in North Beach to FiDi (555 California St) for a 9am weekday arrival — 7 min walk to 24th St Mission, via BART, no transfers. I would still sanity-check the exact departure window, since headways shift outside commute hours.";

    expect(formatCommuteAreaSignalReply(commuteSummary(okTransitCommute()))).toBe(
      expected,
    );
    expect(
      formatCommuteAreaSignalReply(
        commuteSummary({ ...okTransitCommute(), realtime: null }),
      ),
    ).toBe(expected);
    expect(
      formatCommuteAreaSignalReply(
        commuteSummary({
          ...okTransitCommute(),
          realtime: {
            agency: "BA",
            headwayMinutes: null,
            lineRef: null,
            nextDepartureMinutes: [],
            source: "511.org",
            stopCode: "24TH",
            stopName: "24th St Mission",
          },
        }),
      ),
    ).toBe(expected);
  });
});

function okTransitCommute(): NonNullable<AreaSignalSummary["commute"]> {
  return {
    arrivalTime: "2026-06-15T16:00:00.000Z",
    destinationLabel: "FiDi (555 California St)",
    distanceMeters: 5200,
    durationMinutes: 26,
    reason: null,
    status: "ok",
    transit: {
      firstStopName: "24th St Mission",
      lineNames: ["BART"],
      transferCount: 0,
      walkToFirstStopMinutes: 7,
    },
    travelMode: "TRANSIT",
  };
}

function commuteSummary(
  commute: NonNullable<AreaSignalSummary["commute"]>,
): AreaSignalSummary {
  return {
    commute,
    credentials: {
      dataSf: "optional:not_configured",
      googlePlaces: "present:GCP_API_KEY",
      howLoud: "present:HOW_LOUD_API_KEY",
      mapbox: "present:NEXT_PUBLIC_MAPBOX_TOKEN",
    },
    generatedAt: "2026-06-12T00:00:00.000Z",
    purpose: "commute",
    status: "ok",
    target: {
      label: "742 Green St",
      lat: 37.7989,
      lng: -122.4084,
      neighborhood: "North Beach",
      radiusMeters: 805,
    },
  };
}

function place(name: string, distanceMiles: number): AreaSignalPlace {
  return {
    address: null,
    distanceMiles,
    name,
    primaryType: "restaurant",
    rating: 4.5,
    types: ["restaurant", "food"],
    userRatingCount: 250,
  };
}

function restaurantSummary({
  googlePlaces = [],
  googleStatus = "ok",
  mapboxPlaces = [],
  mapboxStatus = "ok",
}: {
  googlePlaces?: AreaSignalPlace[];
  googleStatus?: "error" | "ok" | "skipped";
  mapboxPlaces?: AreaSignalPlace[];
  mapboxStatus?: "error" | "ok" | "skipped";
} = {}): AreaSignalSummary {
  return {
    credentials: {
      dataSf: "optional:not_configured",
      googlePlaces: "present:GCP_API_KEY",
      howLoud: "present:HOW_LOUD_API_KEY",
      mapbox: "present:NEXT_PUBLIC_MAPBOX_TOKEN",
    },
    generatedAt: "2026-06-11T00:00:00.000Z",
    purpose: "restaurants",
    restaurants: {
      googlePlaces: { places: googlePlaces, status: googleStatus },
      mapbox: { places: mapboxPlaces, status: mapboxStatus },
    },
    status: "ok",
    target: missionTarget(),
  };
}

function safetySummary(): AreaSignalSummary {
  const targetArea = {
    incidentTotal: 160,
    label: "Mission District",
    lat: 37.7599,
    lng: -122.4148,
    percentile: 30,
    personSafetyIncidents: 12,
    propertyIncidents: 90,
    publicSafetyScore: 184,
    rankFromHighest: 15,
    rankFromLowest: 8,
    serviceRequest311Total: 80,
    signalLevel: "below_typical" as const,
  };

  return {
    credentials: {
      dataSf: "optional:not_configured",
      googlePlaces: "present:GCP_API_KEY",
      howLoud: "present:HOW_LOUD_API_KEY",
      mapbox: "present:NEXT_PUBLIC_MAPBOX_TOKEN",
    },
    dataSf: {
      baseline: {
        highestPublicSafetySignal: [],
        lowestPublicSafetySignal: [],
        radiusMeters: 805,
        referenceAreaCount: 22,
        source: "sf_reference_areas",
        status: "ok",
        target: targetArea,
        windowStart: "2025-12-13T00:00:00",
      },
      incidentReports: {
        neighborhoodTopCategories: [],
        radiusTopCategories: [
          { count: 120, label: "Larceny Theft" },
          { count: 40, label: "Motor Vehicle Theft" },
        ],
      },
      serviceRequests311: {
        neighborhoodTopCategories: [],
        radiusTopCategories: [
          { count: 80, label: "Street and Sidewalk Cleaning" },
        ],
      },
      status: "ok",
      windowStart: "2025-12-13T00:00:00",
    },
    generatedAt: "2026-06-11T00:00:00.000Z",
    purpose: "safety",
    status: "ok",
    target: missionTarget(),
  };
}

function noiseSummary(
  soundscore: NonNullable<AreaSignalSummary["soundscore"]>,
): AreaSignalSummary {
  return {
    credentials: {
      dataSf: "optional:not_configured",
      googlePlaces: "present:GCP_API_KEY",
      howLoud: "present:HOW_LOUD_API_KEY",
      mapbox: "present:NEXT_PUBLIC_MAPBOX_TOKEN",
    },
    generatedAt: "2026-06-11T00:00:00.000Z",
    purpose: "noise",
    soundscore,
    status: "ok",
    target: missionTarget(),
  };
}

function emptySoundscore() {
  return {
    airports: null,
    airportsText: null,
    local: null,
    localText: null,
    score: null,
    scoreText: null,
    traffic: null,
    trafficText: null,
  };
}

function missionTarget() {
  return {
    label: "Mission District",
    lat: 37.7599,
    lng: -122.4148,
    neighborhood: "Mission District",
    radiusMeters: 805,
  };
}

function missionProfile(
  restaurants: Array<{ distance: number; name: string }> = [
    { distance: 0.1, name: "Tartine Bakery" },
    { distance: 0.2, name: "Foreign Cinema" },
  ],
): TableRow<"neighborhood_profiles"> {
  return {
    bedroom_distribution: {},
    common_amenities: [],
    created_at: "2026-05-23T00:00:00.000Z",
    display_name: "Mission District",
    id: "profile-mission-district",
    latitude: 37.7599,
    longitude: -122.4148,
    listing_count: 30,
    market: "san-francisco-ca",
    median_rent: 3695,
    name: "mission-district",
    poi_summary: {
      grocery: [],
      park: [],
      restaurant: restaurants,
      transit: [],
    },
    poi_enriched_at: null,
    rent_max: 4695,
    rent_min: 2400,
    stats_computed_at: "2026-05-23T00:00:00.000Z",
    updated_at: "2026-05-23T00:00:00.000Z",
  };
}
