import { setTimeout as delay } from "node:timers/promises"

const DATASF_INCIDENTS_URL = "https://data.sfgov.org/resource/wg3w-h783.json"
const DATASF_311_URL = "https://data.sfgov.org/resource/vw6y-z8j6.json"
const MAPBOX_CATEGORY_URL = "https://api.mapbox.com/search/searchbox/v1/category"
const GOOGLE_NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby"
const HOWLOUD_SCORE_URL = "https://api.howloud.com/v2/score"

export const DEFAULT_MAPBOX_CATEGORIES = [
  "restaurant",
  "bar",
  "coffee",
  "grocery",
  "park",
  "fitness_center",
  "laundry",
  "pharmacy",
  "public_transportation_station",
  "bus_stop",
  "railway_station",
  "dog_park",
]

export const DEFAULT_GOOGLE_PLACE_TYPES = [
  "restaurant",
  "bar",
  "cafe",
  "grocery_store",
  "park",
  "gym",
  "laundry",
  "pharmacy",
  "bus_station",
  "train_station",
]

function getFirstEnv(names, env = process.env) {
  for (const name of names) {
    const value = env[name]
    if (value && value.trim()) return { name, value: value.trim() }
  }
  return null
}

function resolveAreaSignalKeys(env = process.env) {
  return {
    dataSf: getFirstEnv(["DATASF_APP_TOKEN", "SOCRATA_APP_TOKEN"], env),
    mapbox: getFirstEnv(["NEXT_PUBLIC_MAPBOX_TOKEN", "MAPBOX_TOKEN"], env),
    google: getFirstEnv(["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "GCP_API_KEY"], env),
    howLoud: getFirstEnv(
      ["HOWLOUD_API_KEY", "HOW_LOUD_API_KEY", "SOUNDSCORE_API_KEY", "SOUND_SCORE_API_KEY"],
      env,
    ),
  }
}

export async function buildAreaSignalProbe({
  neighborhood,
  lat,
  lng,
  days = 180,
  radiusMeters = 805,
  limit = 5,
  mapboxCategories = DEFAULT_MAPBOX_CATEGORIES,
  googleTypes = DEFAULT_GOOGLE_PLACE_TYPES,
  includeGoogleRatings = false,
  env = process.env,
} = {}) {
  if (!neighborhood) throw new Error("Missing neighborhood.")
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Missing valid lat/lng.")

  const keys = resolveAreaSignalKeys(env)
  const target = {
    neighborhood,
    lat,
    lng,
    days,
    radiusMeters,
    windowStart: toSocrataDate(days),
  }

  const [dataSf, mapbox, googlePlaces, soundscore] = await Promise.all([
    fetchDataSfSignals({
      neighborhood,
      lat,
      lng,
      days,
      radiusMeters,
      limit,
      appToken: keys.dataSf?.value,
    }),
    fetchMapboxSignals({
      lat,
      lng,
      limit,
      token: keys.mapbox?.value,
      categories: mapboxCategories,
    }),
    fetchGooglePlacesSignals({
      lat,
      lng,
      limit,
      apiKey: keys.google?.value,
      types: googleTypes,
      includeRatings: includeGoogleRatings,
    }),
    fetchHowLoudSignal({
      lat,
      lng,
      apiKey: keys.howLoud?.value,
    }),
  ])

  return {
    generatedAt: new Date().toISOString(),
    target,
    credentials: {
      dataSf: keys.dataSf ? `present:${keys.dataSf.name}` : "optional:not_configured",
      mapbox: keys.mapbox ? `present:${keys.mapbox.name}` : "missing",
      googlePlaces: keys.google ? `present:${keys.google.name}` : "missing",
      howLoud: keys.howLoud ? `present:${keys.howLoud.name}` : "missing",
    },
    dataSf,
    mapbox,
    googlePlaces,
    soundscore,
    agentUse: summarizeAgentUse({ dataSf, mapbox, googlePlaces, soundscore }),
  }
}

async function fetchDataSfSignals({
  neighborhood,
  lat,
  lng,
  days = 180,
  radiusMeters = 805,
  limit = 5,
  appToken,
} = {}) {
  const windowStart = toSocrataDate(days)
  const headers = appToken ? { "X-App-Token": appToken } : undefined

  try {
    const [
      neighborhoodIncidents,
      radiusIncidents,
      neighborhoodServiceRequests,
      radiusServiceRequests,
    ] = await Promise.all([
      fetchDataSfCounts({
        url: DATASF_INCIDENTS_URL,
        labelColumn: "incident_category",
        dateColumn: "incident_datetime",
        where: `incident_datetime >= '${windowStart}' AND analysis_neighborhood = '${escapeSocrataString(
          neighborhood,
        )}'`,
        limit,
        headers,
      }),
      fetchDataSfCounts({
        url: DATASF_INCIDENTS_URL,
        labelColumn: "incident_category",
        dateColumn: "incident_datetime",
        where: `incident_datetime >= '${windowStart}' AND within_circle(point, ${lat}, ${lng}, ${radiusMeters})`,
        limit,
        headers,
      }),
      fetchDataSfCounts({
        url: DATASF_311_URL,
        labelColumn: "service_name",
        dateColumn: "requested_datetime",
        where: `requested_datetime >= '${windowStart}' AND analysis_neighborhood = '${escapeSocrataString(
          neighborhood,
        )}'`,
        limit,
        headers,
      }),
      fetchDataSfCounts({
        url: DATASF_311_URL,
        labelColumn: "service_name",
        dateColumn: "requested_datetime",
        where: `requested_datetime >= '${windowStart}' AND within_circle(point_geom, ${lat}, ${lng}, ${radiusMeters})`,
        limit,
        headers,
      }),
    ])

    return {
      status: "ok",
      source: "DataSF Socrata APIs",
      windowStart,
      neighborhood,
      radiusMeters,
      incidentReports: {
        neighborhoodTopCategories: neighborhoodIncidents,
        radiusTopCategories: radiusIncidents,
      },
      serviceRequests311: {
        neighborhoodTopCategories: neighborhoodServiceRequests,
        radiusTopCategories: radiusServiceRequests,
      },
    }
  } catch (error) {
    return providerError("DataSF", error)
  }
}

async function fetchMapboxSignals({ lat, lng, token, categories, limit = 5 } = {}) {
  if (!token) return skipped("Missing NEXT_PUBLIC_MAPBOX_TOKEN or MAPBOX_TOKEN.")

  const entries = []
  for (const category of categories) {
    try {
      const url = new URL(`${MAPBOX_CATEGORY_URL}/${category}`)
      url.searchParams.set("access_token", token)
      url.searchParams.set("proximity", `${lng},${lat}`)
      url.searchParams.set("limit", String(limit))
      url.searchParams.set("language", "en")

      const data = await fetchJson(url, { provider: `Mapbox ${category}` })
      const places = (data.features ?? []).map((feature) => normalizeMapboxFeature(feature, lat, lng))
      entries.push([category, { status: "ok", places }])
    } catch (error) {
      entries.push([category, providerError(`Mapbox ${category}`, error)])
    }
    await delay(150)
  }

  return {
    status: "ok",
    source: "Mapbox Search Box Category Search",
    categories: Object.fromEntries(entries),
  }
}

async function fetchGooglePlacesSignals({
  lat,
  lng,
  apiKey,
  types,
  limit = 5,
  radiusMeters = 800,
  includeRatings = false,
} = {}) {
  if (!apiKey) return skipped("Missing GOOGLE_PLACES_API_KEY, GOOGLE_MAPS_API_KEY, or GCP_API_KEY.")

  const fieldMask = [
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.primaryType",
    "places.types",
  ]
  if (includeRatings) fieldMask.push("places.rating", "places.userRatingCount")

  const entries = []
  for (const type of types) {
    try {
      const data = await fetchJson(GOOGLE_NEARBY_SEARCH_URL, {
        provider: `Google Places ${type}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask.join(","),
        },
        body: JSON.stringify({
          includedTypes: [type],
          maxResultCount: limit,
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: radiusMeters,
            },
          },
        }),
      })

      const places = (data.places ?? []).map((place) => normalizeGooglePlace(place, lat, lng))
      entries.push([type, { status: "ok", places }])
    } catch (error) {
      entries.push([type, providerError(`Google Places ${type}`, error)])
    }
    await delay(100)
  }

  return {
    status: "ok",
    source: "Google Places Nearby Search",
    radiusMeters,
    includeRatings,
    types: Object.fromEntries(entries),
  }
}

async function fetchHowLoudSignal({ lat, lng, apiKey } = {}) {
  if (!apiKey) return skipped("Missing HOWLOUD_API_KEY, HOW_LOUD_API_KEY, or SOUNDSCORE_API_KEY.")

  try {
    const url = new URL(HOWLOUD_SCORE_URL)
    url.searchParams.set("lat", String(lat))
    url.searchParams.set("lng", String(lng))

    const data = await fetchJson(url, {
      provider: "HowLoud",
      headers: { "x-api-key": apiKey },
    })
    const result = Array.isArray(data.result) ? data.result[0]?.result ?? data.result[0] : data.result

    return {
      status: "ok",
      source: "HowLoud SoundScore",
      score: numberOrNull(result?.score),
      scoreText: result?.scoretext ?? null,
      traffic: numberOrNull(result?.traffic),
      trafficText: result?.traffictext ?? null,
      local: numberOrNull(result?.local),
      localText: result?.localtext ?? null,
      airports: numberOrNull(result?.airports),
      airportsText: result?.airportstext ?? null,
    }
  } catch (error) {
    return providerError("HowLoud", error)
  }
}

async function fetchDataSfCounts({ url, labelColumn, where, limit, headers } = {}) {
  const requestUrl = new URL(url)
  requestUrl.searchParams.set("$select", `${labelColumn},count(*)`)
  requestUrl.searchParams.set("$where", where)
  requestUrl.searchParams.set("$group", labelColumn)
  requestUrl.searchParams.set("$order", "count DESC")
  requestUrl.searchParams.set("$limit", String(limit))

  const data = await fetchJson(requestUrl, { provider: "DataSF", headers })
  return data.map((row) => ({
    label: row[labelColumn] ?? "Unknown",
    count: Number(row.count ?? 0),
  }))
}

async function fetchJson(input, { provider, retries = 2, retryDelayMs = 500, ...options } = {}) {
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response
    let data

    try {
      response = await fetch(input, {
        ...options,
        signal: AbortSignal.timeout(20000),
      })
      const text = await response.text()
      data = text ? safeJsonParse(text) : null
    } catch (error) {
      lastError = error
      if (attempt === retries) throw error
      await delay(retryDelayMs * 2 ** attempt)
      continue
    }

    if (response.ok) return data

    const message =
      data?.message ??
      data?.error?.message ??
      data?.error ??
      `${response.status} ${response.statusText}`.trim()
    lastError = new Error(`${provider ?? "Provider"} request failed: ${message}`)
    if (!shouldRetryStatus(response.status) || attempt === retries) throw lastError
    await delay(retryDelayMs * 2 ** attempt)
  }

  throw lastError
}

function shouldRetryStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function normalizeMapboxFeature(feature, lat, lng) {
  const coordinates = feature.geometry?.coordinates ?? []
  const placeLat = coordinates.length === 2 ? coordinates[1] : null
  const placeLng = coordinates.length === 2 ? coordinates[0] : null

  return {
    name: feature.properties?.name ?? "Unknown",
    address:
      feature.properties?.full_address ??
      feature.properties?.place_formatted ??
      feature.properties?.address ??
      null,
    mapboxId: feature.properties?.mapbox_id ?? null,
    categories: feature.properties?.poi_category_ids ?? feature.properties?.poi_category ?? [],
    distanceMiles:
      placeLat != null && placeLng != null ? roundDistance(haversineDistance(lat, lng, placeLat, placeLng)) : null,
  }
}

function normalizeGooglePlace(place, lat, lng) {
  return {
    name: place.displayName?.text ?? "Unknown",
    address: place.formattedAddress ?? null,
    primaryType: place.primaryType ?? null,
    types: place.types ?? [],
    rating: numberOrNull(place.rating),
    userRatingCount: numberOrNull(place.userRatingCount),
    distanceMiles:
      place.location?.latitude != null && place.location?.longitude != null
        ? roundDistance(haversineDistance(lat, lng, place.location.latitude, place.location.longitude))
        : null,
  }
}

function summarizeAgentUse({ dataSf, mapbox, googlePlaces, soundscore }) {
  return [
    dataSf.status === "ok"
      ? "Use DataSF counts as objective public indicators, not as a definitive safety rating."
      : "DataSF unavailable; avoid safety claims without public evidence.",
    mapbox.status === "ok"
      ? "Use Mapbox categories for walkable amenities and transit-adjacent context."
      : "Mapbox unavailable; avoid amenity-density claims.",
    googlePlaces.status === "ok"
      ? "Use Google Places for place-quality texture and business presence, with billing-aware field masks."
      : "Google Places unavailable; skip ratings/review-derived claims.",
    soundscore.status === "ok"
      ? "Use HowLoud SoundScore as an address-level quiet/noise signal."
      : "HowLoud unavailable; fall back to 311 noise and POI/nightlife context.",
  ]
}

function toSocrataDate(days) {
  const windowStart = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000)
  return windowStart.toISOString().slice(0, 19)
}

function escapeSocrataString(value) {
  return String(value).replaceAll("'", "''")
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 500) }
  }
}

function providerError(provider, error) {
  return {
    status: "error",
    provider,
    message: error instanceof Error ? error.message : String(error),
  }
}

function skipped(reason) {
  return { status: "skipped", reason }
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function roundDistance(value) {
  return Number(value.toFixed(2))
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180
  const radiusMiles = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
