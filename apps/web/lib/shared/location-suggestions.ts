export type LocationSuggestion = {
  id: string;
  label: string;
  city: string;
  state: string;
  stateCode: string;
};

export const LOCATION_SEARCH_MIN_QUERY_LENGTH = 2;
export const LOCATION_SEARCH_MAX_QUERY_LENGTH = 120;

export function formatMapboxLocationLabel({
  city,
  state,
  stateCode,
}: {
  city: string;
  state: string;
  stateCode: string;
}): string {
  const cleanCity = city.trim();
  const cleanState = state.trim();
  const cleanStateCode = stateCode.trim().toUpperCase();

  if (cleanCity && cleanStateCode) {
    return `${cleanCity}, ${cleanStateCode}`;
  }

  return cleanCity || cleanState;
}

export function normalizeMapboxLocationLabel(value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!cleaned) return "";

  const match = cleaned.match(/^(.+?),\s*([A-Za-z]{2})$/);
  if (!match?.[1] || !match[2]) {
    return "";
  }

  return `${match[1].trim()}, ${match[2].toUpperCase()}`;
}

export function comparableLocationText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function locationLabelsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftKey = comparableLocationText(left ?? "");
  const rightKey = comparableLocationText(right ?? "");
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}
