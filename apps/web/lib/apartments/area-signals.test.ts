import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAreaSignalSummary,
  clearAreaSignalCachesForTests,
  fetchBuildingQualitySignals,
  nextWeekdayNineAmLosAngeles,
  parseSfBuildingAddress,
  resolveCommuteDestinationPreset,
  resolveTransit511Stop,
} from "./area-signals";

// Paid-API results are module-cached; without a reset, one test's routes/
// geocode result leaks into the next test with the same coords+destination.
beforeEach(() => {
  clearAreaSignalCachesForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function transitRouteResponse(departureStopName: string, lineShort: string) {
  return {
    routes: [
      {
        distanceMeters: 5200,
        duration: "1560s",
        legs: [
          {
            steps: [
              { staticDuration: "420s", travelMode: "WALK" },
              {
                staticDuration: "900s",
                transitDetails: {
                  stopDetails: {
                    arrivalStop: { name: "Montgomery St" },
                    departureStop: { name: departureStopName },
                  },
                  transitLine: {
                    name: "Bay Area Rapid Transit",
                    nameShort: lineShort,
                    vehicle: { type: "SUBWAY" },
                  },
                },
                travelMode: "TRANSIT",
              },
              { staticDuration: "240s", travelMode: "WALK" },
            ],
          },
        ],
      },
    ],
  };
}

function siri511Body({
  departures,
  wrapInSiri = false,
  withBom = true,
}: {
  departures: Array<{
    lineRef: string;
    minutesAway: number;
    stopPointName?: string;
  }>;
  wrapInSiri?: boolean;
  withBom?: boolean;
}) {
  const serviceDelivery = {
    ProducerRef: "BA",
    ResponseTimestamp: new Date().toISOString(),
    Status: true,
    StopMonitoringDelivery: {
      MonitoredStopVisit: departures.map(
        ({ lineRef, minutesAway, stopPointName }) => ({
          MonitoredVehicleJourney: {
            LineRef: lineRef,
            MonitoredCall: {
              ExpectedDepartureTime: new Date(
                Date.now() + minutesAway * 60_000 + 5_000,
              ).toISOString(),
              ...(stopPointName ? { StopPointName: stopPointName } : {}),
            },
            PublishedLineName: lineRef,
          },
          RecordedAtTime: new Date().toISOString(),
        }),
      ),
      Status: true,
      version: "1.4",
    },
  };
  const payload = wrapInSiri
    ? { Siri: { ServiceDelivery: serviceDelivery } }
    : { ServiceDelivery: serviceDelivery };
  return `${withBom ? "\uFEFF" : ""}${JSON.stringify(payload)}`;
}

function commute511FetchMock({
  routeLineShort,
  routeStopName,
  transit511Body,
}: {
  routeLineShort: string;
  routeStopName: string;
  transit511Body: Error | string;
}) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("routes.googleapis.com")) {
      return jsonResponse(transitRouteResponse(routeStopName, routeLineShort));
    }
    if (url.includes("511.org")) {
      if (transit511Body instanceof Error) throw transit511Body;
      return new Response(transit511Body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
    return jsonResponse({});
  });
}

describe("resolveCommuteDestinationPreset", () => {
  it("maps the well-known SF commute shorthands to anchored addresses", () => {
    expect(resolveCommuteDestinationPreset("FiDi")).toMatchObject({
      address: "555 California St, San Francisco, CA",
    });
    expect(resolveCommuteDestinationPreset("downtown")?.label).toContain(
      "FiDi",
    );
    expect(resolveCommuteDestinationPreset("the Caltrain station")).toMatchObject(
      { address: "700 4th St, San Francisco, CA" },
    );
    expect(resolveCommuteDestinationPreset("Salesforce tower")).toMatchObject({
      address: "415 Mission St, San Francisco, CA",
    });
    expect(resolveCommuteDestinationPreset("mission bay")).toMatchObject({
      address: "1700 Owens St, San Francisco, CA",
    });
    expect(resolveCommuteDestinationPreset("UCSF")).toMatchObject({
      address: "505 Parnassus Ave, San Francisco, CA",
    });
  });

  it("returns null for arbitrary destinations so the geocoder handles them", () => {
    expect(resolveCommuteDestinationPreset("Blue Bottle on Mint Plaza")).toBe(
      null,
    );
    expect(resolveCommuteDestinationPreset("")).toBe(null);
  });
});

describe("nextWeekdayNineAmLosAngeles", () => {
  it("targets Monday 9am LA from a Friday evening", () => {
    const arrival = nextWeekdayNineAmLosAngeles(
      new Date("2026-06-12T20:00:00-07:00"),
    );
    expect(arrival.toISOString()).toBe("2026-06-15T16:00:00.000Z");
  });

  it("keeps the same morning when 9am has not passed yet", () => {
    const arrival = nextWeekdayNineAmLosAngeles(
      new Date("2026-06-15T05:00:00-07:00"),
    );
    expect(arrival.toISOString()).toBe("2026-06-15T16:00:00.000Z");
  });

  it("rolls to the next weekday once 9am is behind us", () => {
    const arrival = nextWeekdayNineAmLosAngeles(
      new Date("2026-06-15T10:00:00-07:00"),
    );
    expect(arrival.toISOString()).toBe("2026-06-16T16:00:00.000Z");
  });

  it("skips weekends", () => {
    const arrival = nextWeekdayNineAmLosAngeles(
      new Date("2026-06-13T08:00:00-07:00"),
    );
    expect(arrival.toISOString()).toBe("2026-06-15T16:00:00.000Z");
  });
});

describe("buildAreaSignalSummary commute purpose", () => {
  it("parses a transit route into duration, lines, transfers, and walk-to-stop", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubEnv("TRANSIT_511_API_KEY", "");
    const fetchMock = vi.fn(async () =>
      jsonResponse(transitRouteResponse("24th St Mission", "BART")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const summary = await buildAreaSignalSummary({
      commuteDestination: "fidi",
      label: "742 Green St",
      lat: 37.7989,
      lng: -122.4084,
      neighborhood: "North Beach",
      purpose: "commute",
    });

    expect(summary.commute).toMatchObject({
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
    });
    // Preset destination: exactly one call (computeRoutes), no geocode leg.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.travelMode).toBe("TRANSIT");
    expect(body.destination).toEqual({
      address: "555 California St, San Francisco, CA",
    });
    expect(typeof body.arrivalTime).toBe("string");
    expect(
      (init.headers as Record<string, string>)["X-Goog-FieldMask"],
    ).toContain("transitDetails");
  });

  it("degrades a PERMISSION_DENIED into routes_api_not_enabled and logs the marker", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 403,
              message: "Routes API has not been used in project ...",
              status: "PERMISSION_DENIED",
            },
          },
          403,
        ),
      ),
    );

    const summary = await buildAreaSignalSummary({
      commuteDestination: "caltrain",
      label: "Mission",
      lat: 37.7599,
      lng: -122.4148,
      purpose: "commute",
    });

    expect(summary.commute).toMatchObject({
      reason: "routes_api_not_enabled",
      status: "error",
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("GOOGLE_ROUTES_API_NOT_ENABLED"),
    );
  });

  it("skips honestly when no Google key is configured", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("GCP_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const summary = await buildAreaSignalSummary({
      commuteDestination: "ucsf",
      label: "Inner Sunset",
      lat: 37.7614,
      lng: -122.4661,
      purpose: "commute",
    });

    expect(summary.commute).toMatchObject({
      reason: "missing_api_key",
      status: "skipped",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failed lookup without throwing", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const summary = await buildAreaSignalSummary({
      commuteDestination: "salesforce",
      label: "Dogpatch",
      lat: 37.7605,
      lng: -122.3871,
      purpose: "commute",
    });

    expect(summary.commute).toMatchObject({
      reason: "lookup_failed",
      status: "error",
    });
  });
});

describe("resolveTransit511Stop", () => {
  it("maps BART stop-name variants to a BA station-name resolution", () => {
    expect(
      resolveTransit511Stop({
        lineNames: ["BART"],
        stopName: "24th St. Mission BART Station",
      }),
    ).toEqual({ agency: "BA", stationName: "24th st mission" });
    expect(
      resolveTransit511Stop({ lineNames: [], stopName: "16th St Mission" }),
    ).toEqual({ agency: "BA", stationName: "16th st mission" });
    expect(
      resolveTransit511Stop({
        lineNames: ["Bay Area Rapid Transit"],
        stopName: "Civic Center / UN Plaza",
      }),
    ).toEqual({ agency: "BA", stationName: "civic center un plaza" });
  });

  it("uses the line names to split shared Market St stations between BART and Muni", () => {
    expect(
      resolveTransit511Stop({
        lineNames: ["BART"],
        stopName: "Embarcadero Station",
      }),
    ).toEqual({ agency: "BA", stationName: "embarcadero" });
    expect(
      resolveTransit511Stop({
        lineNames: ["N"],
        stopName: "Embarcadero Station",
      }),
    ).toEqual({ agency: "SF", stopCode: "16992" });
    expect(
      resolveTransit511Stop({ lineNames: [], stopName: "Embarcadero Station" }),
    ).toBe(null);
  });

  it("resolves Muni-only Metro stations without a line hint", () => {
    expect(
      resolveTransit511Stop({ lineNames: [], stopName: "Van Ness Station" }),
    ).toEqual({ agency: "SF", stopCode: "15419" });
    expect(
      resolveTransit511Stop({
        lineNames: ["J Church"],
        stopName: "Church St Station",
      }),
    ).toEqual({ agency: "SF", stopCode: "15726" });
  });

  it("returns null for unmapped stops and missing names", () => {
    expect(
      resolveTransit511Stop({
        lineNames: ["14"],
        stopName: "Mission St & 24th St",
      }),
    ).toBe(null);
    // A BART hint at a non-BART stop resolves by name and simply matches no
    // visits in the agency feed — no longer a hard null at resolution time.
    expect(
      resolveTransit511Stop({ lineNames: ["BART"], stopName: "Van Ness Station" }),
    ).toEqual({ agency: "BA", stationName: "van ness" });
    expect(resolveTransit511Stop({ lineNames: ["BART"], stopName: null })).toBe(
      null,
    );
  });
});

describe("buildAreaSignalSummary 511 realtime enrichment", () => {
  it("leaves realtime null and never calls 511 when TRANSIT_511_API_KEY is absent", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubEnv("TRANSIT_511_API_KEY", "");
    const fetchMock = vi.fn(async () =>
      jsonResponse(transitRouteResponse("16th St Mission", "BART")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const summary = await buildAreaSignalSummary({
      commuteDestination: "fidi",
      label: "Mission",
      lat: 37.7599,
      lng: -122.4148,
      purpose: "commute",
    });

    expect(summary.commute?.status).toBe("ok");
    expect(summary.commute?.realtime).toBe(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses BOM-prefixed 511 JSON into departures and a headway", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubEnv("TRANSIT_511_API_KEY", "test-511-key");
    const fetchMock = commute511FetchMock({
      routeLineShort: "BART",
      routeStopName: "24th St Mission",
      transit511Body: siri511Body({
        departures: [
          {
            lineRef: "Yellow-N",
            minutesAway: 4,
            stopPointName: "24th Street / Mission",
          },
          {
            lineRef: "Red-N",
            minutesAway: 12,
            stopPointName: "24th Street / Mission",
          },
          {
            lineRef: "Yellow-N",
            minutesAway: 2,
            stopPointName: "Embarcadero",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await buildAreaSignalSummary({
      commuteDestination: "fidi",
      label: "742 Green St",
      lat: 37.7989,
      lng: -122.4084,
      purpose: "commute",
    });

    expect(summary.commute?.realtime).toEqual({
      agency: "BA",
      headwayMinutes: 8,
      lineRef: "Yellow-N",
      nextDepartureMinutes: [4, 12],
      source: "511.org",
      stopCode: "24th st mission",
      stopName: "24th St Mission",
    });
    const transit511Url = new URL(
      fetchMock.mock.calls
        .map((call) => String(call[0]))
        .find((url) => url.includes("511.org")) ?? "",
    );
    expect(transit511Url.searchParams.get("agency")).toBe("BA");
    // BART pulls the agency-wide feed and filters by station name — the other
    // station's sooner train above must not leak into the departures.
    expect(transit511Url.searchParams.get("stopCode")).toBe(null);
    expect(transit511Url.searchParams.get("format")).toBe("json");
    expect(transit511Url.searchParams.get("api_key")).toBe("test-511-key");
  });

  it("filters departures to the routed Muni line and accepts the Siri wrapper", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubEnv("TRANSIT_511_API_KEY", "test-511-key");
    const fetchMock = commute511FetchMock({
      routeLineShort: "N",
      routeStopName: "Van Ness Station",
      transit511Body: siri511Body({
        departures: [
          { lineRef: "J", minutesAway: 3 },
          { lineRef: "N", minutesAway: 5 },
          { lineRef: "N", minutesAway: 13 },
        ],
        wrapInSiri: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await buildAreaSignalSummary({
      commuteDestination: "caltrain",
      label: "Hayes Valley",
      lat: 37.7767,
      lng: -122.4241,
      purpose: "commute",
    });

    expect(summary.commute?.realtime).toMatchObject({
      agency: "SF",
      headwayMinutes: 8,
      lineRef: "N",
      nextDepartureMinutes: [5, 13],
      stopCode: "15419",
    });
  });

  it("stays null without calling 511 for stops outside the static map", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubEnv("TRANSIT_511_API_KEY", "test-511-key");
    const fetchMock = commute511FetchMock({
      routeLineShort: "14",
      routeStopName: "Mission St & 24th St",
      transit511Body: siri511Body({ departures: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await buildAreaSignalSummary({
      commuteDestination: "fidi",
      label: "Mission",
      lat: 37.7599,
      lng: -122.4148,
      purpose: "commute",
    });

    expect(summary.commute?.status).toBe("ok");
    expect(summary.commute?.realtime).toBe(null);
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("511.org")),
    ).toBe(false);
  });

  it("serves repeat asks for the same stop from the 60s cache", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubEnv("TRANSIT_511_API_KEY", "test-511-key");
    const fetchMock = commute511FetchMock({
      routeLineShort: "BART",
      routeStopName: "Glen Park",
      transit511Body: siri511Body({
        departures: [
          { lineRef: "Yellow-S", minutesAway: 6, stopPointName: "Glen Park" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const ask = () =>
      buildAreaSignalSummary({
        commuteDestination: "fidi",
        label: "Glen Park",
        lat: 37.7338,
        lng: -122.4337,
        purpose: "commute",
      });
    const firstSummary = await ask();
    const secondSummary = await ask();

    expect(firstSummary.commute?.realtime?.nextDepartureMinutes).toEqual([6]);
    expect(secondSummary.commute?.realtime?.nextDepartureMinutes).toEqual([6]);
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).includes("511.org"))
        .length,
    ).toBe(1);
  });

  it("keeps the commute ok and realtime null when the 511 lookup fails", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-google-key");
    vi.stubEnv("TRANSIT_511_API_KEY", "test-511-key");
    const fetchMock = commute511FetchMock({
      routeLineShort: "BART",
      routeStopName: "Balboa Park",
      transit511Body: new Error("511 down"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await buildAreaSignalSummary({
      commuteDestination: "fidi",
      label: "Balboa Park",
      lat: 37.7216,
      lng: -122.4474,
      purpose: "commute",
    });

    expect(summary.commute).toMatchObject({
      durationMinutes: 26,
      realtime: null,
      reason: null,
      status: "ok",
    });
  });
});

describe("parseSfBuildingAddress", () => {
  it("splits a standard SF address into DBI and eviction query shapes", () => {
    expect(parseSfBuildingAddress("2525 Larkin St")).toEqual({
      blockAddress: "2500 BLOCK OF LARKIN STREET",
      streetName: "Larkin",
      streetNumber: "2525",
    });
  });

  it("zero-pads single-digit ordinals only for the eviction block address", () => {
    expect(parseSfBuildingAddress("700 4th St, San Francisco")).toEqual({
      blockAddress: "700 BLOCK OF 04TH STREET",
      streetName: "4th",
      streetNumber: "700",
    });
    expect(parseSfBuildingAddress("2100 24th Street")).toEqual({
      blockAddress: "2100 BLOCK OF 24TH STREET",
      streetName: "24th",
      streetNumber: "2100",
    });
  });

  it("strips units and expands suffixes", () => {
    expect(parseSfBuildingAddress("550 Larkin St #204")).toMatchObject({
      streetName: "Larkin",
      streetNumber: "550",
    });
    expect(parseSfBuildingAddress("1706 35th Ave Unit B")).toEqual({
      blockAddress: "1700 BLOCK OF 35TH AVENUE",
      streetName: "35th",
      streetNumber: "1706",
    });
  });

  it("returns null when there is no leading street number", () => {
    expect(parseSfBuildingAddress("Mission Street")).toBe(null);
    expect(parseSfBuildingAddress(null)).toBe(null);
    expect(parseSfBuildingAddress("")).toBe(null);
  });
});

describe("fetchBuildingQualitySignals", () => {
  function buildingFetchMock({
    complaintRows = [{ most_recent: "2026-06-09T00:00:00.000", total: "2" }],
    categoryRows = [
      { assigned_division: "Housing Inspection Services", count: "2" },
    ],
    evictionRows = [{ most_recent: "2026-02-19T00:00:00.000", total: "1" }],
  } = {}) {
    return vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.href.includes("gm2e-bten")) {
        return (url.searchParams.get("$select") ?? "").includes("count(*) as total")
          ? jsonResponse(complaintRows)
          : jsonResponse(categoryRows);
      }
      if (url.href.includes("5cei-gny5")) {
        return jsonResponse(evictionRows);
      }
      return jsonResponse([]);
    });
  }

  it("queries DBI by street number/name and evictions by block address", async () => {
    const fetchMock = buildingFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const signals = await fetchBuildingQualitySignals({
      addressLine: "2525 Larkin St",
    });

    expect(signals).toMatchObject({
      evictionNotices: {
        blockAddress: "2500 BLOCK OF LARKIN STREET",
        mostRecentDate: "2026-02-19",
        noticeCount: 1,
        status: "ok",
        windowMonths: 24,
      },
      openComplaints: {
        categories: [
          { count: 2, label: "Housing Inspection Services" },
        ],
        count: 2,
        mostRecentDate: "2026-06-09",
        status: "ok",
      },
    });

    const requestedUrls = fetchMock.mock.calls.map((call) =>
      String(call[0]),
    );
    const complaintWhere = new URL(
      requestedUrls.find((url) => url.includes("gm2e-bten")) ?? "",
    ).searchParams.get("$where");
    expect(complaintWhere).toContain("status = 'Active'");
    expect(complaintWhere).toContain("street_number = '2525'");
    expect(complaintWhere).toContain("upper(street_name) = 'LARKIN'");
    const evictionWhere = new URL(
      requestedUrls.find((url) => url.includes("5cei-gny5")) ?? "",
    ).searchParams.get("$where");
    expect(evictionWhere).toContain(
      "upper(address) = '2500 BLOCK OF LARKIN STREET'",
    );
    expect(evictionWhere).toContain("file_date >=");
  });

  it("serves repeat asks for the same building from the 12h cache", async () => {
    const fetchMock = buildingFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await fetchBuildingQualitySignals({ addressLine: "929 Pine St" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await fetchBuildingQualitySignals({ addressLine: "929 Pine St #12" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null for an address it cannot key on", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchBuildingQualitySignals({ addressLine: null })).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks sections as errored instead of throwing when DataSF fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socrata down");
      }),
    );

    const signals = await fetchBuildingQualitySignals({
      addressLine: "65 Fresno St",
    });

    expect(signals).toMatchObject({
      evictionNotices: { noticeCount: 0, status: "error" },
      openComplaints: { count: 0, status: "error" },
    });
  });
});
