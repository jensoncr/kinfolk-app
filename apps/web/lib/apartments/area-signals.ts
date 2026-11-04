import { setTimeout as delay } from "node:timers/promises";
import { safeJsonParse } from "../shared/safe-json";

type AreaSignalPurpose = "commute" | "noise" | "restaurants" | "safety";

export type CommuteTravelMode = "BICYCLE" | "DRIVE" | "TRANSIT" | "WALK";

export type CommuteRealtimeSignal = {
  agency: "BA" | "SF";
  headwayMinutes: number | null;
  lineRef: string | null;
  nextDepartureMinutes: number[];
  source: "511.org";
  stopCode: string;
  stopName: string;
};

export type CommuteSignal = {
  arrivalTime: string | null;
  destinationLabel: string;
  distanceMeters: number | null;
  durationMinutes: number | null;
  realtime?: CommuteRealtimeSignal | null;
  reason:
    | "lookup_failed"
    | "missing_api_key"
    | "no_route_found"
    | "routes_api_not_enabled"
    | null;
  status: "error" | "ok" | "skipped";
  transit: {
    firstStopName: string | null;
    lineNames: string[];
    transferCount: number;
    walkToFirstStopMinutes: number | null;
  } | null;
  travelMode: CommuteTravelMode;
};

export type BuildingQualitySignals = {
  evictionNotices: {
    blockAddress: string;
    mostRecentDate: string | null;
    noticeCount: number;
    status: "error" | "ok";
    windowMonths: number;
  };
  openComplaints: {
    categories: AreaSignalCount[];
    count: number;
    mostRecentDate: string | null;
    status: "error" | "ok";
  };
  source: string;
};

export type AreaSignalPlace = {
  address: string | null;
  distanceMiles: number | null;
  name: string;
  primaryType?: string | null;
  rating?: number | null;
  types?: string[];
  userRatingCount?: number | null;
};

type AreaSignalCount = {
  count: number;
  label: string;
};

type DataSfSafetySignalLevel =
  | "above_typical"
  | "below_typical"
  | "elevated"
  | "low"
  | "typical";

type DataSfSafetyAreaMetrics = {
  incidentTotal: number;
  personSafetyIncidents: number;
  propertyIncidents: number;
  publicSafetyScore: number;
  serviceRequest311Total: number;
};

type DataSfSafetyScoredArea = DataSfSafetyAreaMetrics & {
  label: string;
  lat: number;
  lng: number;
  percentile: number;
  rankFromHighest: number;
  rankFromLowest: number;
  signalLevel: DataSfSafetySignalLevel;
};

export type DataSfSafetyBaseline =
  | {
      highestPublicSafetySignal: DataSfSafetyScoredArea[];
      lowestPublicSafetySignal: DataSfSafetyScoredArea[];
      radiusMeters: number;
      referenceAreaCount: number;
      source: "sf_reference_areas";
      status: "ok";
      target: DataSfSafetyScoredArea;
      windowStart: string;
    }
  | {
      highestPublicSafetySignal: [];
      lowestPublicSafetySignal: [];
      message: string;
      radiusMeters: number;
      referenceAreaCount: 0;
      source: "sf_reference_areas";
      status: "error";
      target: null;
      windowStart: string;
    };

export type AreaSignalSummary = {
  commute?: CommuteSignal;
  credentials: {
    dataSf: string;
    googlePlaces: string;
    howLoud: string;
    mapbox: string;
  };
  dataSf?: {
    baseline?: DataSfSafetyBaseline;
    incidentReports: {
      neighborhoodTopCategories: AreaSignalCount[];
      radiusTopCategories: AreaSignalCount[];
      radiusTotals?: DataSfSafetyAreaMetrics;
    };
    serviceRequests311: {
      neighborhoodTopCategories: AreaSignalCount[];
      radiusTopCategories: AreaSignalCount[];
      radiusTotal?: number;
    };
    status: "error" | "ok";
    windowStart: string;
  };
  generatedAt: string;
  purpose: AreaSignalPurpose;
  restaurants?: {
    googlePlaces: {
      places: AreaSignalPlace[];
      status: "error" | "ok" | "skipped";
    };
    mapbox: {
      places: AreaSignalPlace[];
      status: "error" | "ok" | "skipped";
    };
  };
  soundscore?: {
    airports: number | null;
    airportsText: string | null;
    local: number | null;
    localText: string | null;
    score: number | null;
    scoreText: string | null;
    status: "error" | "ok" | "skipped";
    traffic: number | null;
    trafficText: string | null;
  };
  status: "ok";
  target: {
    label: string;
    lat: number;
    lng: number;
    neighborhood: string | null;
    radiusMeters: number;
  };
};

type AreaSignalArgs = {
  commuteDestination?: string | null;
  commuteTravelMode?: CommuteTravelMode;
  days?: number;
  includeDataSfBaseline?: boolean;
  label: string;
  lat: number;
  limit?: number;
  lng: number;
  neighborhood?: string | null;
  purpose: AreaSignalPurpose;
  radiusMeters?: number;
  restaurantPlaceKind?: "coffee" | "dining";
};

const dataSfIncidentsUrl = "https://data.sfgov.org/resource/wg3w-h783.json";
const dataSf311Url = "https://data.sfgov.org/resource/vw6y-z8j6.json";
// DBI building complaints + Rent Board eviction notices (field names verified
// against the Socrata metadata at data.sfgov.org/api/views/<id>.json).
const dataSfDbiComplaintsUrl = "https://data.sfgov.org/resource/gm2e-bten.json";
const dataSfEvictionNoticesUrl =
  "https://data.sfgov.org/resource/5cei-gny5.json";
const googleNearbySearchUrl =
  "https://places.googleapis.com/v1/places:searchNearby";
const googleTextSearchUrl =
  "https://places.googleapis.com/v1/places:searchText";
const googleRoutesUrl =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const googleRoutesFieldMask =
  "routes.duration,routes.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails";
const howLoudScoreUrl = "https://api.howloud.com/v2/score";
const mapboxCategoryUrl = "https://api.mapbox.com/search/searchbox/v1/category";
const transit511StopMonitoringUrl =
  "https://api.511.org/transit/StopMonitoring";
// 511 free tokens default to ~60 requests/hour, so realtime departures are
// cached per stop for a minute rather than fetched per ask.
const transit511CacheTtlMs = 60_000;
const transit511MaxDepartures = 3;
const transit511MaxLookaheadMinutes = 90;
const maxDataSfCategoryGroups = 500;
const dataSfReferenceConcurrency = 5;
const dataSfSafetyReferenceCacheTtlMs = 12 * 60 * 60 * 1000;
const buildingQualityCacheTtlMs = 12 * 60 * 60 * 1000;
const evictionNoticeWindowMonths = 24;
const externalLookupTimeoutMs = 4_500;
const losAngelesTimeZone = "America/Los_Angeles";

type DataSfSafetyReferenceSnapshot = {
  rankedReferenceAreas: DataSfSafetyScoredArea[];
  referenceScores: number[];
};

const dataSfSafetyReferenceCache = new Map<
  string,
  { expiresAt: number; promise: Promise<DataSfSafetyReferenceSnapshot> }
>();

// ---------------------------------------------------------------------------
// Paid-API TTL cache (Google Places/Routes, HowLoud, Mapbox category).
// Neighborhood coordinates are static, so identical asks inside the TTL must
// not re-bill — previously only the FREE providers (DataSF, 511) had caches.
// Promise-valued so concurrent asks share one in-flight call; rejected loads
// evict so an outage is never cached. Bounded for the long-lived server.
// ---------------------------------------------------------------------------

const HOWLOUD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PLACES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ROUTES_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAID_SIGNAL_CACHE_MAX_ENTRIES = 500;

const paidSignalCache = new Map<
  string,
  { expiresAt: number; value: Promise<unknown> }
>();

function cachedPaidSignal<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = paidSignalCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as Promise<T>;
  }
  if (paidSignalCache.size >= PAID_SIGNAL_CACHE_MAX_ENTRIES) {
    for (const [entryKey, entry] of paidSignalCache) {
      if (entry.expiresAt <= now) paidSignalCache.delete(entryKey);
    }
    if (paidSignalCache.size >= PAID_SIGNAL_CACHE_MAX_ENTRIES) {
      paidSignalCache.clear();
    }
  }
  const value = load();
  paidSignalCache.set(key, { expiresAt: now + ttlMs, value });
  value.catch(() => {
    if (paidSignalCache.get(key)?.value === value) {
      paidSignalCache.delete(key);
    }
  });
  return value;
}

function evictPaidSignal(key: string) {
  paidSignalCache.delete(key);
}

/** Test hook: the module-level caches persist across a vitest file. */
export function clearAreaSignalCachesForTests() {
  paidSignalCache.clear();
  transit511DepartureCache.clear();
  dataSfSafetyReferenceCache.clear();
  buildingQualityCache.clear();
}

/** ~11m precision — coarse enough to hit for one neighborhood centroid. */
function roundCoord(value: number) {
  return value.toFixed(4);
}

const personSafetyIncidentCategories = new Set(
  [
    "Assault",
    "Homicide",
    "Human Trafficking",
    "Rape",
    "Robbery",
    "Sex Offense",
    "Sex Offense, Forcible",
    "Sex Offense, Non Forcible",
    "Weapons Carrying Etc",
    "Weapons Offence",
    "Weapons Offense",
  ].map(normalizeDataSfLabel),
);

const propertyIncidentCategories = new Set(
  [
    "Arson",
    "Burglary",
    "Larceny Theft",
    "Malicious Mischief",
    "Motor Vehicle Theft",
    "Stolen Property",
    "Vandalism",
  ].map(normalizeDataSfLabel),
);

const sfSafetyReferenceAreas = [
  { label: "Bayview", lat: 37.7297, lng: -122.3926 },
  { label: "Bernal Heights", lat: 37.7386, lng: -122.4165 },
  { label: "Castro", lat: 37.7609, lng: -122.435 },
  { label: "Civic Center", lat: 37.7793, lng: -122.4193 },
  { label: "Cow Hollow", lat: 37.7971, lng: -122.4359 },
  { label: "Dogpatch", lat: 37.7605, lng: -122.3871 },
  { label: "Financial District", lat: 37.7946, lng: -122.3999 },
  { label: "Hayes Valley", lat: 37.7767, lng: -122.4241 },
  { label: "Inner Richmond", lat: 37.7799, lng: -122.4654 },
  { label: "Inner Sunset", lat: 37.7614, lng: -122.4661 },
  { label: "Marina", lat: 37.8036, lng: -122.4368 },
  { label: "Mission", lat: 37.7599, lng: -122.4148 },
  { label: "Mission Bay", lat: 37.7706, lng: -122.3911 },
  { label: "Nob Hill", lat: 37.793, lng: -122.4161 },
  { label: "Noe Valley", lat: 37.7516, lng: -122.4337 },
  { label: "North Beach", lat: 37.8024, lng: -122.4058 },
  { label: "Pacific Heights", lat: 37.7925, lng: -122.4382 },
  { label: "Potrero Hill", lat: 37.759, lng: -122.4009 },
  { label: "SoMa", lat: 37.7785, lng: -122.4056 },
  { label: "Tenderloin", lat: 37.7843, lng: -122.4142 },
  { label: "Telegraph Hill", lat: 37.8021, lng: -122.4058 },
  { label: "Western Addition", lat: 37.7824, lng: -122.4325 },
] as const;

export async function buildAreaSignalSummary({
  commuteDestination,
  commuteTravelMode = "TRANSIT",
  days = 180,
  includeDataSfBaseline = true,
  label,
  lat,
  limit = 3,
  lng,
  neighborhood,
  purpose,
  radiusMeters = 805,
  restaurantPlaceKind = "dining",
}: AreaSignalArgs): Promise<AreaSignalSummary> {
  const keys = resolveAreaSignalKeys();
  const windowStart = toSocrataDate(days);
  const target = {
    label,
    lat,
    lng,
    neighborhood: neighborhood ?? null,
    radiusMeters,
  };
  const wantsSafetyData = purpose === "safety";
  // Noise (HowLoud) is PAID: fire it for noise and safety asks only — a
  // restaurants ask has no use for a SoundScore.
  const wantsNoiseData = purpose === "safety" || purpose === "noise";
  const wantsRestaurantData = purpose === "restaurants";
  const wantsCommuteData = purpose === "commute" && Boolean(commuteDestination);

  const [dataSf, soundscore, googleRestaurants, mapboxRestaurants, commute] =
    await Promise.all([
      wantsSafetyData
        ? fetchDataSfAreaSummary({
            appToken: keys.dataSf?.value,
            includeBaseline: includeDataSfBaseline,
            label,
            lat,
            limit,
            lng,
            neighborhood,
            radiusMeters,
            windowStart,
          })
        : undefined,
      wantsNoiseData
        ? cachedPaidSignal(
            `howloud:${roundCoord(lat)}:${roundCoord(lng)}`,
            HOWLOUD_CACHE_TTL_MS,
            () => fetchHowLoudSignal({ apiKey: keys.howLoud?.value, lat, lng }),
          )
        : undefined,
      wantsRestaurantData
        ? cachedPaidSignal(
            `places:${roundCoord(lat)}:${roundCoord(lng)}:${restaurantPlaceKind}:${radiusMeters}:${limit}`,
            PLACES_CACHE_TTL_MS,
            () =>
              fetchGoogleRestaurants({
                apiKey: keys.google?.value,
                lat,
                limit,
                lng,
                placeKind: restaurantPlaceKind,
                radiusMeters,
              }),
          )
        : undefined,
      wantsRestaurantData
        ? cachedPaidSignal(
            `mapbox-category:${roundCoord(lat)}:${roundCoord(lng)}:${limit}`,
            PLACES_CACHE_TTL_MS,
            () =>
              fetchMapboxRestaurants({
                lat,
                limit,
                lng,
                token: keys.mapbox?.value,
              }),
          )
        : undefined,
      wantsCommuteData
        ? fetchCommuteSignalWithRealtime({
            apiKey: keys.google?.value,
            destination: commuteDestination ?? "",
            lat,
            lng,
            travelMode: commuteTravelMode,
          })
        : undefined,
    ]);

  return {
    ...(commute ? { commute } : {}),
    credentials: {
      dataSf: keys.dataSf
        ? `present:${keys.dataSf.name}`
        : "optional:not_configured",
      googlePlaces: keys.google ? `present:${keys.google.name}` : "missing",
      howLoud: keys.howLoud ? `present:${keys.howLoud.name}` : "missing",
      mapbox: keys.mapbox ? `present:${keys.mapbox.name}` : "missing",
    },
    ...(dataSf ? { dataSf } : {}),
    generatedAt: new Date().toISOString(),
    purpose,
    ...(purpose === "restaurants"
      ? {
          restaurants: {
            googlePlaces: googleRestaurants ?? {
              places: [],
              status: "skipped",
            },
            mapbox: mapboxRestaurants ?? { places: [], status: "skipped" },
          },
        }
      : {}),
    ...(soundscore ? { soundscore } : {}),
    status: "ok",
    target,
  };
}

function resolveAreaSignalKeys(env = process.env) {
  return {
    dataSf: getFirstEnv(["DATASF_APP_TOKEN", "SOCRATA_APP_TOKEN"], env),
    google: getFirstEnv(
      ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "GCP_API_KEY"],
      env,
    ),
    howLoud: getFirstEnv(
      [
        "HOWLOUD_API_KEY",
        "HOW_LOUD_API_KEY",
        "SOUNDSCORE_API_KEY",
        "SOUND_SCORE_API_KEY",
      ],
      env,
    ),
    // Server token first (matches lib/integrations/mapbox-location): the
    // public token can be URL-restricted, which silently breaks server-side
    // category search.
    mapbox: getFirstEnv(["MAPBOX_TOKEN", "NEXT_PUBLIC_MAPBOX_TOKEN"], env),
  };
}

function getFirstEnv(names: string[], env: NodeJS.ProcessEnv) {
  for (const name of names) {
    const value = env[name];
    if (value?.trim()) return { name, value: value.trim() };
  }
  return null;
}

async function fetchDataSfAreaSummary({
  appToken,
  includeBaseline,
  label,
  lat,
  limit,
  lng,
  neighborhood,
  radiusMeters,
  windowStart,
}: {
  appToken?: string;
  includeBaseline: boolean;
  label: string;
  lat: number;
  limit: number;
  lng: number;
  neighborhood?: string | null;
  radiusMeters: number;
  windowStart: string;
}) {
  const headers = appToken ? { "X-App-Token": appToken } : undefined;
  const neighborhoodClause = neighborhood
    ? ` AND analysis_neighborhood = '${escapeSocrataString(neighborhood)}'`
    : "";
  const radiusIncidentWhere = `incident_datetime >= '${windowStart}' AND within_circle(point, ${lat}, ${lng}, ${radiusMeters})`;
  const radiusServiceRequestWhere = `requested_datetime >= '${windowStart}' AND within_circle(point_geom, ${lat}, ${lng}, ${radiusMeters})`;

  try {
    const [
      neighborhoodIncidents,
      radiusIncidents,
      neighborhoodServiceRequests,
      radiusServiceRequests,
    ] = await Promise.all([
      fetchDataSfCounts({
        headers,
        labelColumn: "incident_category",
        limit,
        url: dataSfIncidentsUrl,
        where: `incident_datetime >= '${windowStart}'${neighborhoodClause}`,
      }),
      fetchDataSfCounts({
        headers,
        labelColumn: "incident_category",
        limit: maxDataSfCategoryGroups,
        url: dataSfIncidentsUrl,
        where: radiusIncidentWhere,
      }),
      fetchDataSfCounts({
        headers,
        labelColumn: "service_name",
        limit,
        url: dataSf311Url,
        where: `requested_datetime >= '${windowStart}'${neighborhoodClause}`,
      }),
      fetchDataSfCounts({
        headers,
        labelColumn: "service_name",
        limit: maxDataSfCategoryGroups,
        url: dataSf311Url,
        where: radiusServiceRequestWhere,
      }),
    ]);
    const targetMetrics = buildDataSfSafetyMetrics(
      radiusIncidents,
      radiusServiceRequests,
    );
    const baseline = includeBaseline
      ? await fetchDataSfSafetyBaseline({
          headers,
          radiusMeters,
          target: {
            label: neighborhood ?? label,
            lat,
            lng,
            metrics: targetMetrics,
          },
          windowStart,
        })
      : undefined;

    return {
      ...(baseline ? { baseline } : {}),
      incidentReports: {
        neighborhoodTopCategories: neighborhoodIncidents,
        radiusTopCategories: radiusIncidents.slice(0, limit),
        radiusTotals: targetMetrics,
      },
      serviceRequests311: {
        neighborhoodTopCategories: neighborhoodServiceRequests,
        radiusTopCategories: radiusServiceRequests.slice(0, limit),
        radiusTotal: targetMetrics.serviceRequest311Total,
      },
      status: "ok" as const,
      windowStart,
    };
  } catch {
    return {
      incidentReports: {
        neighborhoodTopCategories: [],
        radiusTopCategories: [],
        radiusTotals: emptyDataSfSafetyMetrics(),
      },
      serviceRequests311: {
        neighborhoodTopCategories: [],
        radiusTopCategories: [],
        radiusTotal: 0,
      },
      status: "error" as const,
      windowStart,
    };
  }
}

async function fetchDataSfSafetyBaseline({
  headers,
  radiusMeters,
  target,
  windowStart,
}: {
  headers?: Record<string, string>;
  radiusMeters: number;
  target: {
    label: string;
    lat: number;
    lng: number;
    metrics: DataSfSafetyAreaMetrics;
  };
  windowStart: string;
}): Promise<DataSfSafetyBaseline> {
  try {
    const { rankedReferenceAreas, referenceScores } =
      await getDataSfSafetyReferenceSnapshot({
        headers,
        radiusMeters,
        windowStart,
      });
    const targetArea = scoreDataSfSafetyArea({
      label: target.label,
      lat: target.lat,
      lng: target.lng,
      metrics: target.metrics,
      referenceScores,
    });
    const rankPool = [...rankedReferenceAreas, targetArea].sort(
      (a, b) => a.publicSafetyScore - b.publicSafetyScore,
    );
    const targetRankFromLowest =
      rankPool.findIndex(
        (area) =>
          area.label === targetArea.label &&
          area.lat === targetArea.lat &&
          area.lng === targetArea.lng,
      ) + 1;
    const targetWithRank = {
      ...targetArea,
      rankFromHighest: rankPool.length - targetRankFromLowest + 1,
      rankFromLowest: targetRankFromLowest,
    };

    return {
      highestPublicSafetySignal: rankedReferenceAreas.slice(-5).reverse(),
      lowestPublicSafetySignal: rankedReferenceAreas.slice(0, 5),
      radiusMeters,
      referenceAreaCount: rankedReferenceAreas.length,
      source: "sf_reference_areas",
      status: "ok",
      target: targetWithRank,
      windowStart,
    };
  } catch (error) {
    return {
      highestPublicSafetySignal: [],
      lowestPublicSafetySignal: [],
      message:
        error instanceof Error
          ? error.message
          : "Unknown DataSF baseline error",
      radiusMeters,
      referenceAreaCount: 0,
      source: "sf_reference_areas",
      status: "error",
      target: null,
      windowStart,
    };
  }
}

async function getDataSfSafetyReferenceSnapshot({
  headers,
  radiusMeters,
  windowStart,
}: {
  headers?: Record<string, string>;
  radiusMeters: number;
  windowStart: string;
}) {
  const cacheKey = `${windowStart.slice(0, 10)}:${radiusMeters}`;
  const cached = dataSfSafetyReferenceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = buildDataSfSafetyReferenceSnapshot({
    headers,
    radiusMeters,
    windowStart,
  }).catch((error) => {
    dataSfSafetyReferenceCache.delete(cacheKey);
    throw error;
  });
  dataSfSafetyReferenceCache.set(cacheKey, {
    expiresAt: Date.now() + dataSfSafetyReferenceCacheTtlMs,
    promise,
  });
  return promise;
}

async function buildDataSfSafetyReferenceSnapshot({
  headers,
  radiusMeters,
  windowStart,
}: {
  headers?: Record<string, string>;
  radiusMeters: number;
  windowStart: string;
}): Promise<DataSfSafetyReferenceSnapshot> {
  const referenceMetrics = await mapWithConcurrency(
    sfSafetyReferenceAreas,
    dataSfReferenceConcurrency,
    async (area) => {
      const metrics = await fetchDataSfSafetyMetricsForPoint({
        headers,
        lat: area.lat,
        lng: area.lng,
        radiusMeters,
        windowStart,
      });
      return { ...area, metrics };
    },
  );
  const referenceScores = referenceMetrics.map(
    (area) => area.metrics.publicSafetyScore,
  );
  const referenceAreas = referenceMetrics
    .map((area) =>
      scoreDataSfSafetyArea({
        label: area.label,
        lat: area.lat,
        lng: area.lng,
        metrics: area.metrics,
        referenceScores,
      }),
    )
    .sort((a, b) => a.publicSafetyScore - b.publicSafetyScore);
  const rankedReferenceAreas = referenceAreas.map((area, index) => ({
    ...area,
    rankFromHighest: referenceAreas.length - index,
    rankFromLowest: index + 1,
  }));

  return { rankedReferenceAreas, referenceScores };
}

async function fetchDataSfSafetyMetricsForPoint({
  headers,
  lat,
  lng,
  radiusMeters,
  windowStart,
}: {
  headers?: Record<string, string>;
  lat: number;
  lng: number;
  radiusMeters: number;
  windowStart: string;
}) {
  const incidentCounts = await fetchDataSfCounts({
    headers,
    labelColumn: "incident_category",
    limit: maxDataSfCategoryGroups,
    url: dataSfIncidentsUrl,
    where: `incident_datetime >= '${windowStart}' AND within_circle(point, ${lat}, ${lng}, ${radiusMeters})`,
  });

  return buildDataSfSafetyMetrics(incidentCounts, []);
}

function buildDataSfSafetyMetrics(
  incidentCounts: AreaSignalCount[],
  serviceRequestCounts: AreaSignalCount[],
): DataSfSafetyAreaMetrics {
  const incidentTotal = sumCounts(incidentCounts);
  const personSafetyIncidents = sumCounts(
    incidentCounts.filter((count) =>
      personSafetyIncidentCategories.has(normalizeDataSfLabel(count.label)),
    ),
  );
  const propertyIncidents = sumCounts(
    incidentCounts.filter((count) =>
      propertyIncidentCategories.has(normalizeDataSfLabel(count.label)),
    ),
  );

  return {
    incidentTotal,
    personSafetyIncidents,
    propertyIncidents,
    publicSafetyScore: roundScore(incidentTotal + personSafetyIncidents * 2),
    serviceRequest311Total: sumCounts(serviceRequestCounts),
  };
}

function scoreDataSfSafetyArea({
  label,
  lat,
  lng,
  metrics,
  referenceScores,
}: {
  label: string;
  lat: number;
  lng: number;
  metrics: DataSfSafetyAreaMetrics;
  referenceScores: number[];
}): DataSfSafetyScoredArea {
  const percentile = percentileRank(referenceScores, metrics.publicSafetyScore);

  return {
    ...metrics,
    label,
    lat,
    lng,
    percentile,
    rankFromHighest: 0,
    rankFromLowest: 0,
    signalLevel: classifyDataSfSafetyPercentile(percentile),
  };
}

function classifyDataSfSafetyPercentile(
  percentile: number,
): DataSfSafetySignalLevel {
  if (percentile >= 85) return "elevated";
  if (percentile >= 65) return "above_typical";
  if (percentile >= 35) return "typical";
  if (percentile >= 15) return "below_typical";
  return "low";
}

function percentileRank(referenceValues: number[], value: number) {
  if (referenceValues.length === 0) return 50;
  const below = referenceValues.filter(
    (referenceValue) => referenceValue < value,
  ).length;
  const equal = referenceValues.filter(
    (referenceValue) => referenceValue === value,
  ).length;
  return Math.round(((below + equal * 0.5) / referenceValues.length) * 100);
}

function emptyDataSfSafetyMetrics(): DataSfSafetyAreaMetrics {
  return {
    incidentTotal: 0,
    personSafetyIncidents: 0,
    propertyIncidents: 0,
    publicSafetyScore: 0,
    serviceRequest311Total: 0,
  };
}

async function fetchDataSfCounts({
  headers,
  labelColumn,
  limit,
  url,
  where,
}: {
  headers?: Record<string, string>;
  labelColumn: string;
  limit: number;
  url: string;
  where: string;
}): Promise<AreaSignalCount[]> {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("$select", `${labelColumn},count(*)`);
  requestUrl.searchParams.set("$where", where);
  requestUrl.searchParams.set("$group", labelColumn);
  requestUrl.searchParams.set("$order", "count DESC");
  requestUrl.searchParams.set("$limit", String(limit));

  const data = await fetchJson<Array<Record<string, unknown>>>(requestUrl, {
    headers,
    provider: "DataSF",
  });

  return data.map((row) => ({
    count: Number(row.count ?? 0),
    label: String(row[labelColumn] ?? "Unknown"),
  }));
}

async function fetchGoogleRestaurants({
  apiKey,
  lat,
  limit,
  lng,
  placeKind,
  radiusMeters,
}: {
  apiKey?: string;
  lat: number;
  limit: number;
  lng: number;
  placeKind: "coffee" | "dining";
  radiusMeters: number;
}) {
  if (!apiKey) return { places: [], status: "skipped" as const };

  try {
    const data = await fetchJson<{ places?: GooglePlace[] }>(
      googleNearbySearchUrl,
      {
        body: JSON.stringify({
          includedTypes:
            placeKind === "coffee"
              ? [
                  "cafe",
                  "bakery",
                  "coffee_shop",
                  "bagel_shop",
                  "donut_shop",
                  "juice_shop",
                  "tea_house",
                ]
              : ["restaurant", "bar", "cafe"],
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: radiusMeters,
            },
          },
          maxResultCount: Math.min(Math.max(limit * 3, limit), 10),
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.rating,places.userRatingCount",
        },
        method: "POST",
        provider: "Google Places",
      },
    );

    return {
      places: (data.places ?? []).flatMap((place) =>
        isRestaurantLikeGooglePlace(place)
          ? [
              {
                address: place.formattedAddress ?? null,
                distanceMiles:
                  place.location?.latitude != null && place.location.longitude != null
                    ? roundDistance(
                        haversineDistance(
                          lat,
                          lng,
                          place.location.latitude,
                          place.location.longitude,
                        ),
                      )
                    : null,
                name: place.displayName?.text ?? "Unknown",
                primaryType: place.primaryType ?? null,
                rating: numberOrNull(place.rating),
                types: Array.isArray(place.types)
                  ? place.types.filter(
                      (type): type is string => typeof type === "string",
                    )
                  : [],
                userRatingCount: numberOrNull(place.userRatingCount),
              },
            ]
          : [],
      ),
      status: "ok" as const,
    };
  } catch {
    return { places: [], status: "error" as const };
  }
}

async function fetchMapboxRestaurants({
  lat,
  limit,
  lng,
  token,
}: {
  lat: number;
  limit: number;
  lng: number;
  token?: string;
}) {
  if (!token) return { places: [], status: "skipped" as const };

  try {
    const url = new URL(`${mapboxCategoryUrl}/restaurant`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("language", "en");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("proximity", `${lng},${lat}`);

    const data = await fetchJson<{ features?: MapboxFeature[] }>(url, {
      provider: "Mapbox",
    });

    return {
      places: (data.features ?? []).map((feature) => {
        const coordinates = feature.geometry?.coordinates ?? [];
        const placeLat = coordinates.length === 2 ? coordinates[1] : null;
        const placeLng = coordinates.length === 2 ? coordinates[0] : null;
        return {
          address:
            feature.properties?.full_address ??
            feature.properties?.place_formatted ??
            feature.properties?.address ??
            null,
          distanceMiles:
            placeLat != null && placeLng != null
              ? roundDistance(haversineDistance(lat, lng, placeLat, placeLng))
              : null,
          name: feature.properties?.name ?? "Unknown",
        };
      }),
      status: "ok" as const,
    };
  } catch {
    return { places: [], status: "error" as const };
  }
}

async function fetchHowLoudSignal({
  apiKey,
  lat,
  lng,
}: {
  apiKey?: string;
  lat: number;
  lng: number;
}) {
  if (!apiKey) {
    return skippedSoundscore();
  }

  try {
    const url = new URL(howLoudScoreUrl);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lng", String(lng));
    const data = await fetchJson<{
      result?: HowLoudResult | Array<HowLoudResult | HowLoudBatchResult>;
    }>(url, {
      headers: { "x-api-key": apiKey },
      provider: "HowLoud",
    });
    const result = unwrapHowLoudResult(data.result);

    return {
      airports: numberOrNull(result?.airports),
      airportsText: result?.airportstext ?? null,
      local: numberOrNull(result?.local),
      localText: result?.localtext ?? null,
      score: numberOrNull(result?.score),
      scoreText: result?.scoretext ?? null,
      status: "ok" as const,
      traffic: numberOrNull(result?.traffic),
      trafficText: result?.traffictext ?? null,
    };
  } catch {
    return { ...skippedSoundscore(), status: "error" as const };
  }
}

// Preset commute destinations the agent can hit without a geocode round-trip.
// Each address anchors a well-known SF commute target.
const commuteDestinationPresets: Array<{
  address: string;
  label: string;
  pattern: RegExp;
}> = [
  {
    address: "555 California St, San Francisco, CA",
    label: "FiDi (555 California St)",
    pattern: /\b(?:fidi|financial district|downtown)\b/i,
  },
  {
    address: "700 4th St, San Francisco, CA",
    label: "Caltrain (700 4th St)",
    pattern: /\bcaltrain\b/i,
  },
  {
    address: "415 Mission St, San Francisco, CA",
    label: "Salesforce Tower (415 Mission St)",
    pattern: /\bsalesforce\b/i,
  },
  {
    address: "1700 Owens St, San Francisco, CA",
    label: "Mission Bay (1700 Owens St)",
    pattern: /\bmission\s+bay\b/i,
  },
  {
    address: "505 Parnassus Ave, San Francisco, CA",
    label: "UCSF Parnassus (505 Parnassus Ave)",
    pattern: /\bucsf\b|\bparnassus\b/i,
  },
];

export function resolveCommuteDestinationPreset(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const preset = commuteDestinationPresets.find((candidate) =>
    candidate.pattern.test(trimmed),
  );
  return preset ? { address: preset.address, label: preset.label } : null;
}

// The next weekday 9:00am wall-clock in Los Angeles strictly after `now`,
// returned as the UTC instant. Used as the Routes API transit arrival target.
export function nextWeekdayNineAmLosAngeles(now = new Date()): Date {
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const candidate = new Date(now.getTime() + dayOffset * 86_400_000);
    const parts = losAngelesDateParts(candidate);
    if (parts.weekday === "Sat" || parts.weekday === "Sun") continue;
    const arrival = losAngelesWallClockToUtc(
      parts.year,
      parts.month,
      parts.day,
      9,
    );
    if (arrival.getTime() > now.getTime()) return arrival;
  }
  return new Date(now.getTime() + 86_400_000);
}

function losAngelesDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: losAngelesTimeZone,
    weekday: "short",
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    weekday: String(parts.weekday ?? ""),
    year: Number(parts.year),
  };
}

function losAngelesWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
) {
  const desired = Date.UTC(year, month - 1, day, hour);
  let timestamp = desired;
  // Two passes converge across DST boundaries: read the LA wall-clock for the
  // guess, then shift by the difference to the desired wall-clock.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = losAngelesDateParts(new Date(timestamp));
    const wallClock = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    timestamp += desired - wallClock;
  }
  return new Date(timestamp);
}

type GoogleRouteStep = {
  staticDuration?: string;
  transitDetails?: {
    stopDetails?: {
      arrivalStop?: { name?: string };
      departureStop?: { name?: string };
    };
    transitLine?: {
      name?: string;
      nameShort?: string;
      vehicle?: { type?: string };
    };
  };
  travelMode?: string;
};

type GoogleRoutesResponse = {
  error?: { code?: number; message?: string; status?: string };
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    legs?: Array<{ steps?: GoogleRouteStep[] }>;
  }>;
};

type CommuteDestinationWaypoint =
  | { address: string }
  | { location: { latLng: { latitude: number; longitude: number } } };

// Routes is paid; the cached core excludes 511 realtime (departures must stay
// fresh) — the wrapper reattaches realtime per ask through 511's own 60s cache.
async function fetchCommuteSignalWithRealtime(args: {
  apiKey?: string;
  destination: string;
  lat: number;
  lng: number;
  travelMode: CommuteTravelMode;
}): Promise<CommuteSignal> {
  const cacheKey = `routes:${roundCoord(args.lat)}:${roundCoord(args.lng)}:${args.destination.trim().toLowerCase()}:${args.travelMode}`;
  const core = await cachedPaidSignal(cacheKey, ROUTES_CACHE_TTL_MS, () =>
    fetchGoogleCommuteSignal(args),
  );
  if (core.status !== "ok") {
    // A transient routing failure must not occupy the cache for the TTL.
    evictPaidSignal(cacheKey);
    return core;
  }
  if (!core.transit) {
    return core;
  }
  return {
    ...core,
    realtime: await fetchTransit511Realtime({
      lineNames: core.transit.lineNames,
      stopName: core.transit.firstStopName,
    }),
  };
}

async function fetchGoogleCommuteSignal({
  apiKey,
  destination,
  lat,
  lng,
  travelMode,
}: {
  apiKey?: string;
  destination: string;
  lat: number;
  lng: number;
  travelMode: CommuteTravelMode;
}): Promise<CommuteSignal> {
  const resolved = await resolveCommuteDestination({
    apiKey,
    query: destination,
  });
  const base = {
    arrivalTime: null,
    destinationLabel: resolved.label,
    distanceMeters: null,
    durationMinutes: null,
    transit: null,
    travelMode,
  };

  if (!apiKey) {
    return { ...base, reason: "missing_api_key", status: "skipped" };
  }

  // arrivalTime is only valid for TRANSIT; other modes route immediately.
  const arrival =
    travelMode === "TRANSIT" ? nextWeekdayNineAmLosAngeles() : null;

  try {
    const response = await fetch(googleRoutesUrl, {
      body: JSON.stringify({
        ...(arrival ? { arrivalTime: arrival.toISOString() } : {}),
        computeAlternativeRoutes: false,
        destination: resolved.waypoint,
        origin: { location: { latLng: { latitude: lat, longitude: lng } } },
        travelMode,
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": googleRoutesFieldMask,
      },
      method: "POST",
      signal: AbortSignal.timeout(externalLookupTimeoutMs),
    });
    const text = await response.text();
    const data = (text ? safeJsonParse(text) : {}) as GoogleRoutesResponse;

    if (
      response.status === 403 ||
      data.error?.status === "PERMISSION_DENIED"
    ) {
      // Distinct marker: the Routes API toggle has not been flipped on for the
      // GCP project that owns the Google key. Flip it at
      // https://console.cloud.google.com/apis/library/routes.googleapis.com
      console.error(
        "[area-signals] GOOGLE_ROUTES_API_NOT_ENABLED: computeRoutes returned PERMISSION_DENIED — enable the Routes API in the GCP console for the project behind the configured Google key.",
      );
      return {
        ...base,
        arrivalTime: arrival?.toISOString() ?? null,
        reason: "routes_api_not_enabled",
        status: "error",
      };
    }
    if (!response.ok) {
      return { ...base, reason: "lookup_failed", status: "error" };
    }

    const route = data.routes?.[0];
    const durationSeconds = parseGoogleDurationSeconds(route?.duration);
    if (route == null || durationSeconds == null) {
      return { ...base, reason: "no_route_found", status: "error" };
    }

    const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []);
    const transit = travelMode === "TRANSIT" ? readCommuteTransit(steps) : null;
    return {
      ...base,
      arrivalTime: arrival?.toISOString() ?? null,
      distanceMeters: numberOrNull(route.distanceMeters),
      durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
      // Attached by fetchCommuteSignalWithRealtime so the cached route core
      // never freezes live departures.
      realtime: null,
      reason: null,
      status: "ok",
      transit,
    };
  } catch {
    return { ...base, reason: "lookup_failed", status: "error" };
  }
}

function readCommuteTransit(steps: GoogleRouteStep[]) {
  const transitSteps = steps.filter((step) => step.transitDetails);
  let walkToFirstStopSeconds = 0;
  for (const step of steps) {
    if (step.transitDetails) break;
    if (step.travelMode === "WALK") {
      walkToFirstStopSeconds += parseGoogleDurationSeconds(step.staticDuration) ?? 0;
    }
  }
  const lineNames = transitSteps.flatMap((step) => {
    const line = step.transitDetails?.transitLine;
    const name = line?.nameShort ?? line?.name;
    return name ? [name] : [];
  });

  return {
    firstStopName:
      transitSteps[0]?.transitDetails?.stopDetails?.departureStop?.name ?? null,
    lineNames,
    transferCount: Math.max(0, transitSteps.length - 1),
    walkToFirstStopMinutes:
      walkToFirstStopSeconds > 0
        ? Math.max(1, Math.round(walkToFirstStopSeconds / 60))
        : null,
  };
}

async function resolveCommuteDestination({
  apiKey,
  query,
}: {
  apiKey?: string;
  query: string;
}): Promise<{ label: string; waypoint: CommuteDestinationWaypoint }> {
  const preset = resolveCommuteDestinationPreset(query);
  if (preset) {
    return { label: preset.label, waypoint: { address: preset.address } };
  }

  const geocoded = apiKey
    ? await geocodeCommuteDestination({ apiKey, query })
    : null;
  if (geocoded) {
    return {
      label: geocoded.label,
      waypoint: {
        location: {
          latLng: { latitude: geocoded.lat, longitude: geocoded.lng },
        },
      },
    };
  }

  // Routes can geocode an address string itself; keep the SF hint so a bare
  // place name does not resolve to another city.
  return {
    label: query.trim(),
    waypoint: { address: `${query.trim()}, San Francisco, CA` },
  };
}

async function geocodeCommuteDestination({
  apiKey,
  query,
}: {
  apiKey: string;
  query: string;
}): Promise<{ label: string; lat: number; lng: number } | null> {
  return cachedPaidSignal(
    `geocode:${query.trim().toLowerCase()}`,
    GEOCODE_CACHE_TTL_MS,
    () => geocodeCommuteDestinationUncached({ apiKey, query }),
  );
}

async function geocodeCommuteDestinationUncached({
  apiKey,
  query,
}: {
  apiKey: string;
  query: string;
}): Promise<{ label: string; lat: number; lng: number } | null> {
  try {
    const response = await fetch(googleTextSearchUrl, {
      body: JSON.stringify({
        locationBias: {
          circle: {
            center: { latitude: 37.7749, longitude: -122.4194 },
            radius: 15000,
          },
        },
        maxResultCount: 1,
        textQuery: `${query}, San Francisco CA`,
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.location",
      },
      method: "POST",
      signal: AbortSignal.timeout(externalLookupTimeoutMs),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { places?: GooglePlace[] };
    const place = data.places?.[0];
    const lat = numberOrNull(place?.location?.latitude);
    const lng = numberOrNull(place?.location?.longitude);
    if (lat == null || lng == null) return null;

    return {
      label: place?.displayName?.text ?? place?.formattedAddress ?? query,
      lat,
      lng,
    };
  } catch {
    return null;
  }
}

function parseGoogleDurationSeconds(value: string | undefined) {
  if (typeof value !== "string") return null;
  const seconds = Number(value.replace(/s$/i, ""));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// --- 511 SF Bay realtime departures (SIRI StopMonitoring) ---

// Muni platforms keyed by Google Routes departure-stop name — the downtown-
// bound sign codes (DataSF stop id + 10000) for the Market St subway, live-
// verified against 511. BART has no code map: 511 keys BART platforms on
// opaque numeric refs (e.g. 901501/901502 for 16th St Mission), so BART
// departures are resolved by station-NAME match against the agency-wide feed
// instead. Stops that resolve to neither stay null, so the reply simply
// carries no realtime line.
const transit511MuniStopsByName: Record<string, { muniStopCode: string }> = {
  castro: { muniStopCode: "15728" },
  "church st": { muniStopCode: "15726" },
  "civic center": { muniStopCode: "15727" },
  "civic center un plaza": { muniStopCode: "15727" },
  embarcadero: { muniStopCode: "16992" },
  "forest hill": { muniStopCode: "15730" },
  montgomery: { muniStopCode: "15731" },
  "montgomery st": { muniStopCode: "15731" },
  powell: { muniStopCode: "15417" },
  "powell st": { muniStopCode: "15417" },
  "van ness": { muniStopCode: "15419" },
  "west portal": { muniStopCode: "16740" },
};

// BART stations 511 covers in the SF corridor — used only to disambiguate a
// shared station name when Google's line names carry no BART/Muni hint.
const transit511BartStationNames = new Set([
  "16th st mission",
  "24th st mission",
  "balboa park",
  "civic center",
  "civic center un plaza",
  "daly city",
  "embarcadero",
  "glen park",
  "montgomery",
  "montgomery st",
  "powell",
  "powell st",
]);

const transit511DepartureCache = new Map<
  string,
  { expiresAt: number; promise: Promise<CommuteRealtimeSignal | null> }
>();

let transit511MissingKeyLogged = false;

type Transit511MonitoredCall = {
  AimedArrivalTime?: string | null;
  AimedDepartureTime?: string | null;
  ExpectedArrivalTime?: string | null;
  ExpectedDepartureTime?: string | null;
  StopPointName?: string | null;
  StopPointRef?: number | string | null;
};

type Transit511StopVisit = {
  MonitoredVehicleJourney?: {
    LineRef?: number | string;
    MonitoredCall?: Transit511MonitoredCall;
    PublishedLineName?: number | string;
  };
};

type Transit511Delivery = {
  MonitoredStopVisit?: Transit511StopVisit | Transit511StopVisit[];
};

type Transit511ServiceDelivery = {
  StopMonitoringDelivery?: Transit511Delivery | Transit511Delivery[];
};

type Transit511Response = {
  ServiceDelivery?: Transit511ServiceDelivery;
  Siri?: { ServiceDelivery?: Transit511ServiceDelivery };
};

export type Transit511StopResolution =
  | { agency: "BA"; stationName: string }
  | { agency: "SF"; stopCode: string };

export function resolveTransit511Stop({
  lineNames,
  stopName,
}: {
  lineNames: string[];
  stopName: string | null;
}): Transit511StopResolution | null {
  if (!stopName) return null;
  const normalized = normalizeTransit511StopName(stopName);
  if (!normalized) return null;
  const muniEntry = transit511MuniStopsByName[normalized];
  const isBartStation = transit511BartStationNames.has(normalized);

  const joinedLines = lineNames.join(" ");
  const looksBart =
    /\bbart\b|bay area rapid/i.test(joinedLines) ||
    lineNames.some((name) => /\b(?:yellow|blue|green|red|orange|beige)\b/i.test(name));
  const looksMuni =
    /\bmuni\b/i.test(joinedLines) ||
    lineNames.some((name) => /^(?:[jklmnt]|kt)\b/i.test(name.trim()));

  if (looksBart) {
    return { agency: "BA", stationName: normalized };
  }
  if (looksMuni) {
    return muniEntry
      ? { agency: "SF", stopCode: muniEntry.muniStopCode }
      : null;
  }
  if (isBartStation && !muniEntry) {
    return { agency: "BA", stationName: normalized };
  }
  if (muniEntry && !isBartStation) {
    return { agency: "SF", stopCode: muniEntry.muniStopCode };
  }
  return null;
}

function normalizeTransit511StopName(name: string) {
  return name
    .toLowerCase()
    .replace(/[./&]/g, " ")
    .replace(/\bstreet\b/g, "st")
    .replace(/\b(?:bart|muni|metro|station|stop)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchTransit511Realtime({
  lineNames,
  stopName,
}: {
  lineNames: string[];
  stopName: string | null;
}): Promise<CommuteRealtimeSignal | null> {
  const apiKey = process.env.TRANSIT_511_API_KEY?.trim();
  if (!apiKey) {
    if (!transit511MissingKeyLogged) {
      transit511MissingKeyLogged = true;
      console.debug(
        "[area-signals] TRANSIT_511_API_KEY not set; commute replies skip 511 realtime departures.",
      );
    }
    return null;
  }

  const stop = resolveTransit511Stop({ lineNames, stopName });
  if (!stop || !stopName) return null;

  // The line token matters: the cached promise resolves departures filtered
  // by the requesting commute's lines, so two commutes boarding the same stop
  // on different lines must not share an entry.
  const lineKey = lineNames
    .map((name) => name.trim().toLowerCase())
    .sort()
    .join("|");
  const cacheKey =
    stop.agency === "BA"
      ? `BA:${stop.stationName}:${lineKey}`
      : `SF:${stop.stopCode}:${lineKey}`;
  const cached = transit511DepartureCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = fetchTransit511Departures({
    apiKey,
    lineNames,
    stop,
    stopName,
  });
  transit511DepartureCache.set(cacheKey, {
    expiresAt: Date.now() + transit511CacheTtlMs,
    promise,
  });
  return promise;
}

async function fetchTransit511Departures({
  apiKey,
  lineNames,
  stop,
  stopName,
}: {
  apiKey: string;
  lineNames: string[];
  stop: Transit511StopResolution;
  stopName: string;
}): Promise<CommuteRealtimeSignal | null> {
  try {
    const url = new URL(transit511StopMonitoringUrl);
    url.searchParams.set("agency", stop.agency);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("format", "json");
    // BART platforms use opaque numeric refs, so the BA branch pulls the
    // agency-wide feed (cached) and matches on station name below.
    if (stop.agency === "SF") {
      url.searchParams.set("stopCode", stop.stopCode);
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(externalLookupTimeoutMs),
    });
    if (!response.ok) return null;

    // 511 serves JSON with a UTF-8 byte-order mark that breaks a naive
    // response.json(); strip it before parsing.
    const text = (await response.text()).replace(/^\uFEFF/, "");
    const data = JSON.parse(text) as Transit511Response;
    const serviceDelivery = data.Siri?.ServiceDelivery ?? data.ServiceDelivery;
    const allVisits = siriToArray(
      serviceDelivery?.StopMonitoringDelivery,
    ).flatMap((delivery) => siriToArray(delivery?.MonitoredStopVisit));
    const visits =
      stop.agency === "BA"
        ? allVisits.filter((visit) =>
            transit511StopNameMatches(
              visit?.MonitoredVehicleJourney?.MonitoredCall?.StopPointName,
              stop.stationName,
            ),
          )
        : allVisits;
    const departures = visits.flatMap((visit) => {
      const journey = visit?.MonitoredVehicleJourney;
      const call = journey?.MonitoredCall;
      const timestamp =
        call?.ExpectedDepartureTime ??
        call?.ExpectedArrivalTime ??
        call?.AimedDepartureTime ??
        call?.AimedArrivalTime;
      const departureAt = timestamp ? Date.parse(timestamp) : Number.NaN;
      if (!Number.isFinite(departureAt)) return [];
      const minutesAway = Math.round((departureAt - Date.now()) / 60_000);
      if (minutesAway < 1 || minutesAway > transit511MaxLookaheadMinutes) {
        return [];
      }
      return [
        {
          lineRef: siriLineLabel(journey?.LineRef ?? journey?.PublishedLineName),
          minutesAway,
        },
      ];
    });
    // Prefer departures on the line Google routed; a generic name like "BART"
    // matches nothing, so fall back to everything leaving the stop.
    const lineMatched = departures.filter((departure) =>
      matchesCommuteLine(departure.lineRef, lineNames),
    );
    const relevant = (lineMatched.length > 0 ? lineMatched : departures).sort(
      (a, b) => a.minutesAway - b.minutesAway,
    );
    if (relevant.length === 0) return null;

    const nextDepartureMinutes = relevant
      .slice(0, transit511MaxDepartures)
      .map((departure) => departure.minutesAway);
    const first = nextDepartureMinutes[0];
    const last = nextDepartureMinutes[nextDepartureMinutes.length - 1];

    return {
      agency: stop.agency,
      headwayMinutes:
        nextDepartureMinutes.length >= 2
          ? Math.max(
              1,
              Math.round((last - first) / (nextDepartureMinutes.length - 1)),
            )
          : null,
      lineRef: relevant[0].lineRef,
      nextDepartureMinutes,
      source: "511.org",
      stopCode: stop.agency === "SF" ? stop.stopCode : stop.stationName,
      stopName,
    };
  } catch {
    return null;
  }
}

function transit511StopNameMatches(
  stopPointName: string | null | undefined,
  stationName: string,
) {
  if (!stopPointName) return false;
  const candidate = normalizeTransit511StopName(stopPointName);
  if (!candidate) return false;
  return (
    candidate === stationName ||
    candidate.includes(stationName) ||
    stationName.includes(candidate)
  );
}

function matchesCommuteLine(lineRef: string | null, lineNames: string[]) {
  if (!lineRef) return false;
  const reference = normalizeCommuteLineToken(lineRef);
  if (!reference) return false;
  return lineNames.some((name) => {
    const candidate = normalizeCommuteLineToken(name);
    if (!candidate) return false;
    if (candidate === reference) return true;
    return candidate.split(" ")[0] === reference.split(" ")[0];
  });
}

function normalizeCommuteLineToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function siriLineLabel(value: number | string | undefined) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function siriToArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

// --- Building quality (DataSF: DBI complaints + eviction notices) ---

const streetSuffixExpansions: Record<string, string> = {
  aly: "Alley",
  alley: "Alley",
  av: "Avenue",
  ave: "Avenue",
  avenue: "Avenue",
  blvd: "Boulevard",
  boulevard: "Boulevard",
  cir: "Circle",
  circle: "Circle",
  ct: "Court",
  court: "Court",
  dr: "Drive",
  drive: "Drive",
  hwy: "Highway",
  highway: "Highway",
  ln: "Lane",
  lane: "Lane",
  pl: "Place",
  place: "Place",
  plz: "Plaza",
  plaza: "Plaza",
  rd: "Road",
  road: "Road",
  sq: "Square",
  square: "Square",
  st: "Street",
  street: "Street",
  ter: "Terrace",
  terrace: "Terrace",
  way: "Way",
};

// Normalizes a listing address_line into the shapes the two DataSF datasets
// key on: DBI complaints use street_number + bare street_name ("2525" +
// "Larkin"); eviction notices use a block-level address ("2500 Block Of
// Larkin Street", with single-digit ordinals zero-padded: "04th Street").
export function parseSfBuildingAddress(
  addressLine: string | null | undefined,
) {
  const head = (addressLine ?? "")
    .split(/[,#]/)[0]
    .replace(/\b(?:apt|apartment|unit|suite|ste|floor|fl)\b.*$/i, "")
    .trim();
  const match = head.match(/^(\d+)[a-z]?\s+(.+)$/i);
  if (!match) return null;

  const streetNumber = String(Number(match[1]));
  const tokens = match[2]
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/\.$/, ""));
  const lastToken = tokens[tokens.length - 1]?.toLowerCase() ?? "";
  const suffix =
    tokens.length > 1 ? (streetSuffixExpansions[lastToken] ?? null) : null;
  const nameTokens = suffix ? tokens.slice(0, -1) : tokens;
  const streetName = nameTokens.join(" ");
  if (!streetName) return null;

  const blockNumber = Math.floor(Number(match[1]) / 100) * 100;
  const evictionStreetName = nameTokens
    .map((token) => (/^\d(?:st|nd|rd|th)$/i.test(token) ? `0${token}` : token))
    .join(" ");

  return {
    blockAddress:
      `${blockNumber} Block Of ${evictionStreetName} ${suffix ?? "Street"}`.toUpperCase(),
    streetName,
    streetNumber,
  };
}

const buildingQualityCache = new Map<
  string,
  { expiresAt: number; promise: Promise<BuildingQualitySignals> }
>();

export async function fetchBuildingQualitySignals({
  addressLine,
}: {
  addressLine: string | null | undefined;
}): Promise<BuildingQualitySignals | null> {
  const parsed = parseSfBuildingAddress(addressLine);
  if (!parsed) return null;

  const cacheKey = `${parsed.streetNumber}:${parsed.streetName.toUpperCase()}`;
  const cached = buildingQualityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = buildBuildingQualitySignals(parsed).then((signals) => {
    // Do not cache partial failures for 12h — let the next ask retry.
    if (
      signals.openComplaints.status === "error" ||
      signals.evictionNotices.status === "error"
    ) {
      buildingQualityCache.delete(cacheKey);
    }
    return signals;
  });
  // Sweep expired entries on insert: keys are unique street addresses, so on
  // the long-lived server this map would otherwise grow with every distinct
  // listing ever asked about.
  for (const [entryKey, entry] of buildingQualityCache) {
    if (entry.expiresAt <= Date.now()) {
      buildingQualityCache.delete(entryKey);
    }
  }
  buildingQualityCache.set(cacheKey, {
    expiresAt: Date.now() + buildingQualityCacheTtlMs,
    promise,
  });
  return promise;
}

async function buildBuildingQualitySignals(parsed: {
  blockAddress: string;
  streetName: string;
  streetNumber: string;
}): Promise<BuildingQualitySignals> {
  const appToken = resolveAreaSignalKeys().dataSf?.value;
  const headers = appToken ? { "X-App-Token": appToken } : undefined;
  const complaintWhere = `status = 'Active' AND street_number = '${escapeSocrataString(parsed.streetNumber)}' AND upper(street_name) = '${escapeSocrataString(parsed.streetName.toUpperCase())}'`;
  const evictionWindowStart = toSocrataDate(evictionNoticeWindowMonths * 30);
  const evictionWhere = `upper(address) = '${escapeSocrataString(parsed.blockAddress)}' AND file_date >= '${evictionWindowStart}'`;

  const [complaints, complaintCategories, evictions] = await Promise.all([
    fetchDataSfAggregate({
      dateColumn: "date_filed",
      headers,
      url: dataSfDbiComplaintsUrl,
      where: complaintWhere,
    }).catch(() => null),
    fetchDataSfCounts({
      headers,
      labelColumn: "assigned_division",
      limit: 4,
      url: dataSfDbiComplaintsUrl,
      where: complaintWhere,
    }).catch(() => null),
    fetchDataSfAggregate({
      dateColumn: "file_date",
      headers,
      url: dataSfEvictionNoticesUrl,
      where: evictionWhere,
    }).catch(() => null),
  ]);

  return {
    evictionNotices: {
      blockAddress: parsed.blockAddress,
      mostRecentDate: evictions?.mostRecent?.slice(0, 10) ?? null,
      noticeCount: evictions?.total ?? 0,
      status: evictions ? "ok" : "error",
      windowMonths: evictionNoticeWindowMonths,
    },
    openComplaints: {
      categories: complaintCategories ?? [],
      count: complaints?.total ?? 0,
      mostRecentDate: complaints?.mostRecent?.slice(0, 10) ?? null,
      status: complaints && complaintCategories ? "ok" : "error",
    },
    source: "DataSF (DBI complaints; Rent Board eviction notices)",
  };
}

async function fetchDataSfAggregate({
  dateColumn,
  headers,
  url,
  where,
}: {
  dateColumn: string;
  headers?: Record<string, string>;
  url: string;
  where: string;
}): Promise<{ mostRecent: string | null; total: number }> {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set(
    "$select",
    `count(*) as total, max(${dateColumn}) as most_recent`,
  );
  requestUrl.searchParams.set("$where", where);

  const data = await fetchJson<Array<Record<string, unknown>>>(requestUrl, {
    headers,
    provider: "DataSF",
    timeoutMs: externalLookupTimeoutMs,
  });
  const row = data[0] ?? {};

  return {
    mostRecent: typeof row.most_recent === "string" ? row.most_recent : null,
    total: Number(row.total ?? 0) || 0,
  };
}

async function fetchJson<T>(
  input: string | URL,
  {
    provider,
    retries = 1,
    retryDelayMs = 300,
    timeoutMs = 8_000,
    ...options
  }: RequestInit & {
    provider: string;
    retries?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
  },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;
    let data: unknown;

    try {
      response = await fetch(input, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      data = text ? safeJsonParse(text) : null;
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      await delay(retryDelayMs * 2 ** attempt);
      continue;
    }

    if (response.ok) {
      return data as T;
    }

    lastError = new Error(`${provider} request failed: ${response.status}`);
    if (!shouldRetryStatus(response.status) || attempt === retries) {
      throw lastError;
    }
    await delay(retryDelayMs * 2 ** attempt);
  }

  throw lastError;
}

type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  rating?: number;
  types?: string[];
  userRatingCount?: number;
};

type MapboxFeature = {
  geometry?: { coordinates?: number[] };
  properties?: {
    address?: string;
    full_address?: string;
    name?: string;
    place_formatted?: string;
  };
};

type HowLoudResult = {
  airports?: number;
  airportstext?: string;
  local?: number;
  localtext?: string;
  score?: number;
  scoretext?: string;
  traffic?: number;
  traffictext?: string;
};

type HowLoudBatchResult = {
  result?: HowLoudResult;
};

function unwrapHowLoudResult(
  result: HowLoudResult | Array<HowLoudResult | HowLoudBatchResult> | undefined,
): HowLoudResult | undefined {
  if (!Array.isArray(result)) return result;
  const first = result[0];
  if (!first) return undefined;
  return isHowLoudBatchResult(first) ? first.result : first;
}

function isHowLoudBatchResult(
  value: HowLoudResult | HowLoudBatchResult,
): value is HowLoudBatchResult {
  return "result" in value;
}

// DataSF incident timestamps are floating Pacific-local; a UTC-derived
// boundary would shift every window by 7–8 hours.
function toSocrataDate(days: number) {
  const parts = losAngelesDateParts(
    new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  );
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function isRestaurantLikeGooglePlace(place: GooglePlace) {
  if (!place.primaryType) return true;
  if (
    /\b(?:hotel|lodging|movie_theater|association_or_organization)\b/i.test(
      place.primaryType,
    )
  ) {
    return false;
  }
  return /(?:restaurant|cafe|bakery|deli|meal|pizza|food|bar)/i.test(
    place.primaryType,
  );
}

function escapeSocrataString(value: string) {
  return value.replaceAll("'", "''");
}

function shouldRetryStatus(status: number) {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function sumCounts(counts: AreaSignalCount[]) {
  return counts.reduce((sum, count) => sum + count.count, 0);
}

function roundScore(value: number) {
  return Number(value.toFixed(1));
}

function normalizeDataSfLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runNext = async (): Promise<void> => {
    if (nextIndex >= items.length) return;
    const index = nextIndex;
    nextIndex += 1;
    results[index] = await mapper(items[index], index);
    return runNext();
  };
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext(),
  );

  await Promise.all(workers);
  return results;
}

function skippedSoundscore() {
  return {
    airports: null,
    airportsText: null,
    local: null,
    localText: null,
    score: null,
    scoreText: null,
    status: "skipped" as const,
    traffic: null,
    trafficText: null,
  };
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundDistance(value: number) {
  return Number(value.toFixed(2));
}

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const radiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
