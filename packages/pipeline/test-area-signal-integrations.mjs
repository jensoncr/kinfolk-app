import { loadDotEnv, parseArgs } from "./lib/cli.mjs"
import {
  DEFAULT_GOOGLE_PLACE_TYPES,
  DEFAULT_MAPBOX_CATEGORIES,
  buildAreaSignalProbe,
} from "./lib/area-signal-integrations.mjs"

loadDotEnv()

const args = parseArgs()
const neighborhood = args.get("neighborhood") ?? "North Beach"
const lat = numberArg("lat", 37.8024)
const lng = numberArg("lng", -122.4058)
const days = numberArg("days", 180)
const radiusMeters = numberArg("radius-meters", 805)
const limit = numberArg("limit", 5)
const mapboxCategories = listArg("mapbox-categories", DEFAULT_MAPBOX_CATEGORIES)
const googleTypes = listArg("google-types", DEFAULT_GOOGLE_PLACE_TYPES)
const includeGoogleRatings = args.get("google-ratings") === "true"
const allowProviderErrors = args.get("allow-provider-errors") === "true"

const report = await buildAreaSignalProbe({
  neighborhood,
  lat,
  lng,
  days,
  radiusMeters,
  limit,
  mapboxCategories,
  googleTypes,
  includeGoogleRatings,
})

console.log(JSON.stringify(report, null, 2))

const errors = collectProviderErrors(report)
if (errors.length > 0) {
  console.error(`\nProvider errors: ${errors.join("; ")}`)
  if (!allowProviderErrors) process.exitCode = 1
}

function numberArg(name, fallback) {
  const raw = args.get(name)
  if (raw == null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    console.error(`Invalid --${name}: ${raw}`)
    process.exit(1)
  }
  return value
}

function listArg(name, fallback) {
  const raw = args.get(name)
  if (!raw) return fallback
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function collectProviderErrors(report) {
  const errors = []
  for (const [key, value] of Object.entries(report)) {
    if (!value || typeof value !== "object") continue
    if (value.status === "error") errors.push(`${key}: ${value.message}`)
  }

  for (const [category, value] of Object.entries(report.mapbox?.categories ?? {})) {
    if (value.status === "error") errors.push(`mapbox.${category}: ${value.message}`)
  }

  for (const [type, value] of Object.entries(report.googlePlaces?.types ?? {})) {
    if (value.status === "error") errors.push(`googlePlaces.${type}: ${value.message}`)
  }

  return errors
}
