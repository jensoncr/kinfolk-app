import { structuredFactOptions } from "./fact-normalization";

// Curated assistant-import fact keys that survive assistant import filtering.
// Apartment-search and preference-elasticity filters are excluded; pets remains
// because it is a roommate-compatibility signal when phrased as pet status or
// comfort rather than apartment pet-policy search.
export const assistantProfileFactKeys = [
  "hometown",
  "sleep_schedule",
  "work_from_home",
  "work_hours",
  "routine_regularity",
  "noise_tolerance",
  "light_tolerance",
  "scent_tolerance",
  "temperature_preference",
  "cleanliness",
  "chores",
  "dishes",
  "shared_supplies",
  "pets",
  "guests",
  "overnight_guests",
  "social_energy",
  "privacy",
  "parties",
  "communication_style",
  "conflict_repair",
  "planning_style",
  "response_time",
  "house_meetings",
  "verified_work_or_school",
  "shared_communities",
  "mutuals",
  "references",
  "prior_roommate_context",
  "interests",
  "music_taste",
  "media_taste",
  "aesthetic_taste",
] as const;

export type AssistantProfileFactKey = (typeof assistantProfileFactKeys)[number];

const assistantProfileFactKeySet = new Set<string>(assistantProfileFactKeys);

export function isCanonicalAssistantProfileFactKey(
  factKey: string,
): factKey is AssistantProfileFactKey {
  return assistantProfileFactKeySet.has(factKey);
}

export function buildCanonicalFactKeyPromptSection(): string {
  const allowlist = assistantProfileFactKeys.join(",");

  const structuredLines = assistantProfileFactKeys.flatMap((factKey) => {
    const options = structuredFactOptions(factKey);
    if (!options) {
      return [];
    }
    return [`${factKey}=${options.join("|")}`];
  });

  return [
    "keys:",
    allowlist,
    "",
    "tokens:",
    structuredLines.join(";"),
  ].join("\n");
}
