import { parsePoiSummary } from "../apartments/poi-summary";
import type { AreaSignalPlace, AreaSignalSummary } from "../apartments/area-signals";
import type { NeighborhoodPoiPoint, NeighborhoodPoiSummary } from "./tools";
import type { Json } from "@/lib/supabase/types";

export { formatCurrency } from "../shared/currency";

export function formatSoundscoreSignal(areaSignals: AreaSignalSummary) {
  if (areaSignals.soundscore?.status !== "ok" || areaSignals.soundscore.score == null) {
    return null;
  }

  const label = areaSignals.soundscore.scoreText
    ? ` (${areaSignals.soundscore.scoreText.toLowerCase()})`
    : "";
  const traffic = areaSignals.soundscore.trafficText
    ? ` Traffic reads ${areaSignals.soundscore.trafficText.toLowerCase()}.`
    : "";
  const local = areaSignals.soundscore.localText
    ? ` Local noise reads ${areaSignals.soundscore.localText.toLowerCase()}.`
    : "";

  return `HowLoud SoundScore is ${areaSignals.soundscore.score}${label}.${traffic}${local}`;
}

export function formatPlace(place: AreaSignalPlace) {
  const rating =
    place.rating != null
      ? `, ${place.rating.toFixed(1)} stars${place.userRatingCount ? ` from ${place.userRatingCount.toLocaleString()} ratings` : ""}`
      : "";
  const distance =
    place.distanceMiles != null ? `, ${place.distanceMiles.toFixed(2)} mi` : "";
  return `${place.name}${rating}${distance}`;
}

export function formatCountLabels(
  counts: Array<{ count: number; label: string }>,
  limit = 2,
) {
  return formatList(counts.slice(0, limit).map((count) => count.label));
}

export function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function readPoiSummary(value: Json | null): NeighborhoodPoiSummary {
  const summary = parsePoiSummary(value);

  return {
    grocery: summary?.grocery ?? [],
    parks: summary?.parks ?? [],
    restaurant: summary?.restaurant ?? [],
    transit: summary?.transit ?? [],
  };
}

export function formatPoiReason(label: string, points: NeighborhoodPoiPoint[]) {
  const examples = formatPoiExamples(points);
  return examples ? `${label}: ${examples}` : "";
}

export function formatWalkabilityReason(poi: NeighborhoodPoiSummary) {
  const parts = [
    firstPoiLabel("transit", poi.transit),
    firstPoiLabel("grocery", poi.grocery),
    firstPoiLabel("dining", poi.restaurant),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? `walkable basics: ${parts.slice(0, 2).join("; ")}` : "";
}

function firstPoiLabel(label: string, points: NeighborhoodPoiPoint[]) {
  const point = nearestPoi(points);
  return point ? `${label}: ${formatPoiNameAndDistance(point)}` : "";
}

function formatPoiExamples(points: NeighborhoodPoiPoint[], limit = 2) {
  return sortPoiByDistance(points)
    .slice(0, limit)
    .map(formatPoiNameAndDistance)
    .join(", ");
}

function nearestPoi(points: NeighborhoodPoiPoint[]) {
  return sortPoiByDistance(points)[0] ?? null;
}

function sortPoiByDistance(points: NeighborhoodPoiPoint[]) {
  return points
    .filter((point) => point.name.trim())
    .sort((left, right) => {
      if (left.distance === right.distance) return 0;
      if (!Number.isFinite(left.distance)) return 1;
      if (!Number.isFinite(right.distance)) return -1;
      return left.distance - right.distance;
    });
}

function formatPoiNameAndDistance(point: NeighborhoodPoiPoint) {
  const name = point.name.trim();
  if (!Number.isFinite(point.distance) || point.distance <= 0) {
    return name;
  }

  const distance =
    point.distance < 0.1 ? "<0.1 mi" : `${point.distance.toFixed(1)} mi`;
  return `${name} (${distance})`;
}

export function dedupeReasons(reasons: string[]) {
  return [...new Set(reasons.filter(Boolean))];
}

export function dedupeTextValues(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}
