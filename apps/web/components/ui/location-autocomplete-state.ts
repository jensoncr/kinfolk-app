import {
  locationLabelsMatch,
  type LocationSuggestion,
} from "@/lib/shared/location-suggestions";

export function findMatchingLocationSuggestion(
  suggestions: LocationSuggestion[],
  value: string,
) {
  return suggestions.find((suggestion) =>
    locationLabelsMatch(suggestion.label, value),
  );
}
