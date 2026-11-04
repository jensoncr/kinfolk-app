import "server-only";

import { createHash } from "node:crypto";
import { ApiError } from "@/lib/shared/api-error";
import type { Database, Json } from "@/lib/supabase/types";
import {
  structuredFactOptions,
  normalizeStructuredFactValue,
  structuredValueSimilarity,
} from "./fact-normalization";
import { isCanonicalAssistantProfileFactKey } from "./canonical-facts";
import {
  type ProfileImportProvider,
  type ProfileFactForScoring,
  assistantTrustRapportFactKeys,
  bestDuplicateMatch,
  clamp,
  classifyFactKeyValue,
  consolidateProfileFactsForProjection,
  isAdditiveProfileFactKey,
  isSameProfileFactSlot,
  normalizeComparableValue,
  stableJsonStringify,
  valueSimilarityForKey,
} from "../matching/fact-similarity";

type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export {
  profileImportProviders,
  type ProfileImportProvider,
  readBudgetNumbersFromText,
} from "../matching/fact-similarity";

export const profileImportMethods = [
  "paste",
  "upload",
  "mcp_tool",
  "seed",
  "system",
  "text_message",
] as const;
export type ProfileImportMethod = (typeof profileImportMethods)[number];
export type ProfileFactReviewState =
  | "pending"
  | "approved"
  | "edited"
  | "rejected"
  | "deleted"
  | "revoked";
export type ProfileImportReviewStatus =
  | "processed"
  | "needs_review"
  | "approved";

export function isFullyApprovedProfileImport(
  reviewStates: readonly (ProfileFactReviewState | string | null | undefined)[],
) {
  return (
    reviewStates.length > 0 &&
    reviewStates.every((state) => state === "approved" || state === "edited")
  );
}

export function profileImportStatusForFactReviewStates(
  reviewStates: readonly (ProfileFactReviewState | string | null | undefined)[],
): ProfileImportReviewStatus {
  if (reviewStates.length === 0) {
    return "processed";
  }

  if (reviewStates.some((state) => state === "pending")) {
    return "needs_review";
  }

  return isFullyApprovedProfileImport(reviewStates) ? "approved" : "processed";
}

type ProfileSensitivityLevel = "standard" | "sensitive" | "protected" | "high_risk";

export type NormalizedProfileImport = {
  payload: Json;
  payloadHash: string;
  payloadText: string;
};

export type ProfileImportMetadata = {
  profileSummary?: {
    shortSelfSummary?: string;
    livingWithMeIsLike?: string;
    knownUncertainties?: string[];
  };
  recommendedFollowUpQuestions?: string[];
  contradictionsOrUncertainties?: string[];
};

export type ExtractedProfileFact = {
  dimension: string;
  factKey: string;
  value: Json;
  normalizedValue: string;
  assertionType: "explicit" | "inferred" | "imported" | "user_confirmed";
  confidence: number;
  importance: number;
  sensitivityLevel: ProfileSensitivityLevel;
  matchingEligible: boolean;
  evidenceExcerpt: string;
  sourceType?: string;
  observedVsSelfReported?: string;
  recencyHint?: string;
  recencyAt?: string;
};

export type {
  ProfileFactForScoring,
} from "../matching/fact-similarity";

type InformativeProfileFactInput = {
  assertionType?: ExtractedProfileFact["assertionType"] | string | null;
  confidence: number;
  evidenceExcerpt?: string | null;
  factKey?: string | null;
  normalizedValue?: string | null;
  value?: Json | null;
};

export type ReconciledProfileFactImport = {
  duplicateMatches: {
    incomingFactIndex: number;
    fact: ExtractedProfileFact;
    existingFact: ProfileFactForScoring;
    similarity: number;
  }[];
  factsToInsert: {
    incomingFactIndex: number;
    fact: ExtractedProfileFact;
    conflictingExistingFacts: ProfileFactForScoring[];
  }[];
};

const maxPayloadCharacters = 200_000;
const contradictoryFactSimilarityThreshold = 0.25;

const dimensionByKey: Record<string, { dimension: string; factKey: string; importance: number }> = {
  accessibility: { dimension: "feasibility", factKey: "accessibility", importance: 0.82 },
  budget: { dimension: "feasibility", factKey: "budget", importance: 1 },
  budget_preferred_max: { dimension: "feasibility", factKey: "budget_preferred_max", importance: 1 },
  budget_max: { dimension: "feasibility", factKey: "budget_max", importance: 1 },
  budget_min: { dimension: "feasibility", factKey: "budget_min", importance: 1 },
  budget_range: { dimension: "feasibility", factKey: "budget", importance: 1 },
  cities: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  city: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  base_city: { dimension: "feasibility", factKey: "target_market", importance: 0.72 },
  base_city_area: { dimension: "feasibility", factKey: "target_market", importance: 0.72 },
  bass_sensitivity: { dimension: "environment_tolerance", factKey: "noise_tolerance", importance: 0.86 },
  clean: { dimension: "home_labor", factKey: "cleanliness", importance: 0.88 },
  cleaning: { dimension: "home_labor", factKey: "cleanliness", importance: 0.88 },
  cleanliness: { dimension: "home_labor", factKey: "cleanliness", importance: 0.9 },
  cleanliness_standard: { dimension: "home_labor", factKey: "cleanliness", importance: 0.9 },
  chores: { dimension: "home_labor", factKey: "chores", importance: 0.75 },
  chores_expectation: { dimension: "home_labor", factKey: "chores", importance: 0.78 },
  chore_avoidances: { dimension: "home_labor", factKey: "chore_avoidances", importance: 0.66 },
  chore_strengths: { dimension: "home_labor", factKey: "chore_strengths", importance: 0.68 },
  chronotype: { dimension: "daily_rhythm", factKey: "sleep_schedule", importance: 0.9 },
  commute: { dimension: "feasibility", factKey: "commute", importance: 0.7 },
  commute_anchor: { dimension: "feasibility", factKey: "commute", importance: 0.72 },
  commute_notes: { dimension: "feasibility", factKey: "commute", importance: 0.7 },
  commute_tradeoff: { dimension: "preference_elasticity", factKey: "commute_tradeoff", importance: 0.66 },
  communication: { dimension: "communication", factKey: "communication_style", importance: 0.88 },
  communication_style: { dimension: "communication", factKey: "communication_style", importance: 0.9 },
  conflict: { dimension: "communication", factKey: "conflict_repair", importance: 0.86 },
  conflict_discussion_fit: { dimension: "communication", factKey: "conflict_repair", importance: 0.88 },
  conflict_repair: { dimension: "communication", factKey: "conflict_repair", importance: 0.88 },
  conflict_repair_style: { dimension: "communication", factKey: "conflict_repair", importance: 0.88 },
  conflict_resolution: { dimension: "communication", factKey: "conflict_repair", importance: 0.88 },
  conflict_style: { dimension: "communication", factKey: "conflict_repair", importance: 0.86 },
  current_base: { dimension: "feasibility", factKey: "target_market", importance: 0.72 },
  current_base_city_area: { dimension: "feasibility", factKey: "target_market", importance: 0.72 },
  current_city: { dimension: "feasibility", factKey: "target_market", importance: 0.72 },
  current_location: { dimension: "feasibility", factKey: "target_market", importance: 0.72 },
  current_role: { dimension: "trust_context", factKey: "verified_work_or_school", importance: 0.68 },
  dealbreakers: { dimension: "feasibility", factKey: "dealbreakers", importance: 0.92 },
  dishes: { dimension: "home_labor", factKey: "dishes", importance: 0.76 },
  directness: { dimension: "communication", factKey: "communication_style", importance: 0.86 },
  decor_style: { dimension: "rapport_taste", factKey: "aesthetic_taste", importance: 0.34 },
  aesthetic_taste: { dimension: "rapport_taste", factKey: "aesthetic_taste", importance: 0.34 },
  emotional_availability: { dimension: "communication", factKey: "emotional_availability", importance: 0.62 },
  education_network: { dimension: "trust_context", factKey: "shared_communities", importance: 0.72 },
  friend_of_friend_context: { dimension: "trust_context", factKey: "friend_of_friend_context", importance: 0.72 },
  flexibility: { dimension: "preference_elasticity", factKey: "location_tradeoff", importance: 0.65 },
  flexibility_notes: { dimension: "preference_elasticity", factKey: "location_tradeoff", importance: 0.65 },
  fairness_orientation: { dimension: "home_labor", factKey: "chores", importance: 0.65 },
  guest_cadence: { dimension: "social_boundary", factKey: "guests", importance: 0.84 },
  guest_policy: { dimension: "social_boundary", factKey: "guests", importance: 0.84 },
  group_size_flexibility: { dimension: "preference_elasticity", factKey: "group_size_flexibility", importance: 0.72 },
  guests: { dimension: "social_boundary", factKey: "guests", importance: 0.84 },
  guests_policy: { dimension: "social_boundary", factKey: "guests", importance: 0.84 },
  home_as_hub: { dimension: "social_boundary", factKey: "social_energy", importance: 0.7 },
  home_as_recharge: { dimension: "social_boundary", factKey: "social_energy", importance: 0.7 },
  hosting: { dimension: "social_boundary", factKey: "guests", importance: 0.84 },
  hosting_expectations: { dimension: "social_boundary", factKey: "guests", importance: 0.84 },
  hometown: { dimension: "trust_context", factKey: "hometown", importance: 0.48 },
  home_town: { dimension: "trust_context", factKey: "hometown", importance: 0.48 },
  grew_up_in: { dimension: "trust_context", factKey: "hometown", importance: 0.48 },
  housemate_count: { dimension: "feasibility", factKey: "household_size", importance: 0.9 },
  housemates: { dimension: "feasibility", factKey: "household_size", importance: 0.9 },
  household_size: { dimension: "feasibility", factKey: "household_size", importance: 0.9 },
  household_size_range: { dimension: "feasibility", factKey: "household_size", importance: 0.9 },
  household_systems_preference: { dimension: "home_labor", factKey: "shared_supplies", importance: 0.6 },
  house_meetings: { dimension: "communication", factKey: "house_meetings", importance: 0.58 },
  institutional_overlap: { dimension: "trust_context", factKey: "verified_work_or_school", importance: 0.68 },
  interests: { dimension: "rapport_taste", factKey: "interests", importance: 0.32 },
  interest_ai_agents: { dimension: "rapport_taste", factKey: "interests", importance: 0.32 },
  interest_real_estate_investing: { dimension: "rapport_taste", factKey: "interests", importance: 0.32 },
  interest_startups_venture: { dimension: "rapport_taste", factKey: "interests", importance: 0.32 },
  lease_length: { dimension: "feasibility", factKey: "lease_length", importance: 0.74 },
  lease_risk_tolerance: { dimension: "preference_elasticity", factKey: "risk_tolerance", importance: 0.7 },
  light_tolerance: { dimension: "environment_tolerance", factKey: "light_tolerance", importance: 0.62 },
  lifestyle: { dimension: "daily_rhythm", factKey: "lifestyle", importance: 0.72 },
  lifestyle_notes: { dimension: "daily_rhythm", factKey: "lifestyle", importance: 0.72 },
  location: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  location_preferences: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  location_tradeoff: { dimension: "preference_elasticity", factKey: "location_tradeoff", importance: 0.68 },
  market: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  markets: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  media_taste: { dimension: "rapport_taste", factKey: "media_taste", importance: 0.32 },
  monthly_budget: { dimension: "feasibility", factKey: "budget", importance: 1 },
  music_or_calls_at_home: { dimension: "environment_tolerance", factKey: "noise_tolerance", importance: 0.66 },
  music_taste: { dimension: "rapport_taste", factKey: "music_taste", importance: 0.32 },
  move_in: { dimension: "feasibility", factKey: "move_in_window", importance: 0.9 },
  move_in_date: { dimension: "feasibility", factKey: "move_in_window", importance: 0.9 },
  move_in_window: { dimension: "feasibility", factKey: "move_in_window", importance: 0.9 },
  move_timeline: { dimension: "feasibility", factKey: "move_in_window", importance: 0.9 },
  move_timing: { dimension: "feasibility", factKey: "move_in_window", importance: 0.9 },
  move_window: { dimension: "feasibility", factKey: "move_in_window", importance: 0.9 },
  mutual_reference_context: { dimension: "trust_context", factKey: "mutuals", importance: 0.72 },
  must_haves: { dimension: "feasibility", factKey: "must_haves", importance: 0.8 },
  neighborhoods: { dimension: "feasibility", factKey: "neighborhoods", importance: 0.82 },
  nighttime_bass_sensitivity: { dimension: "environment_tolerance", factKey: "noise_tolerance", importance: 0.86 },
  noise: { dimension: "environment_tolerance", factKey: "noise_tolerance", importance: 0.86 },
  noise_sensitivity: { dimension: "environment_tolerance", factKey: "noise_tolerance", importance: 0.86 },
  noise_tolerance: { dimension: "environment_tolerance", factKey: "noise_tolerance", importance: 0.86 },
  overnight_guests: { dimension: "social_boundary", factKey: "overnight_guests", importance: 0.82 },
  overnight_visitors: { dimension: "social_boundary", factKey: "overnight_guests", importance: 0.82 },
  office_anchor: { dimension: "feasibility", factKey: "commute", importance: 0.72 },
  parties: { dimension: "social_boundary", factKey: "parties", importance: 0.76 },
  partners: { dimension: "social_boundary", factKey: "partners", importance: 0.7 },
  pets: { dimension: "feasibility", factKey: "pets", importance: 0.9 },
  planning_style: { dimension: "communication", factKey: "planning_style", importance: 0.66 },
  privacy: { dimension: "social_boundary", factKey: "privacy", importance: 0.76 },
  privacy_boundary_interest: { dimension: "social_boundary", factKey: "privacy", importance: 0.76 },
  prior_roommate_context: { dimension: "trust_context", factKey: "prior_roommate_context", importance: 0.7 },
  professional_domain: { dimension: "trust_context", factKey: "verified_work_or_school", importance: 0.65 },
  professional_network_context: { dimension: "trust_context", factKey: "shared_communities", importance: 0.68 },
  references: { dimension: "trust_context", factKey: "references", importance: 0.76 },
  references_or_mutuals: { dimension: "trust_context", factKey: "mutuals", importance: 0.72 },
  relationship_status_context: { dimension: "social_boundary", factKey: "overnight_guests", importance: 0.82 },
  repairs: { dimension: "home_labor", factKey: "repairs", importance: 0.6 },
  response_latency: { dimension: "communication", factKey: "response_time", importance: 0.62 },
  response_time: { dimension: "communication", factKey: "response_time", importance: 0.62 },
  response_preference: { dimension: "communication", factKey: "response_time", importance: 0.62 },
  rent_budget: { dimension: "feasibility", factKey: "budget", importance: 1 },
  rent_location_commute_tradeoff: { dimension: "preference_elasticity", factKey: "commute_tradeoff", importance: 0.7 },
  rent_tradeoff: { dimension: "preference_elasticity", factKey: "rent_tradeoff", importance: 0.7 },
  rent_vs_location: { dimension: "preference_elasticity", factKey: "rent_tradeoff", importance: 0.7 },
  risk_tolerance: { dimension: "preference_elasticity", factKey: "risk_tolerance", importance: 0.7 },
  roommate_count: { dimension: "feasibility", factKey: "household_size", importance: 0.9 },
  roommates: { dimension: "social_boundary", factKey: "household_expectations", importance: 0.7 },
  roommate_preferences: { dimension: "social_boundary", factKey: "household_expectations", importance: 0.7 },
  room_quality_tradeoff: { dimension: "preference_elasticity", factKey: "room_quality_tradeoff", importance: 0.62 },
  routine_signal: { dimension: "daily_rhythm", factKey: "routine_regularity", importance: 0.66 },
  routine_regularity: { dimension: "daily_rhythm", factKey: "routine_regularity", importance: 0.86 },
  shared_communities: { dimension: "trust_context", factKey: "shared_communities", importance: 0.72 },
  shared_meals: { dimension: "social_boundary", factKey: "shared_meals", importance: 0.58 },
  shared_supplies: { dimension: "home_labor", factKey: "shared_supplies", importance: 0.6 },
  smell_tolerance: { dimension: "environment_tolerance", factKey: "scent_tolerance", importance: 0.66 },
  scent_tolerance: { dimension: "environment_tolerance", factKey: "scent_tolerance", importance: 0.66 },
  sleep: { dimension: "daily_rhythm", factKey: "sleep_schedule", importance: 0.9 },
  sleep_schedule: { dimension: "daily_rhythm", factKey: "sleep_schedule", importance: 0.9 },
  sleep_window: { dimension: "daily_rhythm", factKey: "sleep_schedule", importance: 0.9 },
  sleep_environment_preference: { dimension: "environment_tolerance", factKey: "noise_tolerance", importance: 0.82 },
  smoking: { dimension: "feasibility", factKey: "smoking", importance: 0.9 },
  social: { dimension: "social_boundary", factKey: "social_energy", importance: 0.72 },
  social_energy: { dimension: "social_boundary", factKey: "social_energy", importance: 0.74 },
  social_frequency: { dimension: "social_boundary", factKey: "social_energy", importance: 0.78 },
  storage: { dimension: "home_labor", factKey: "storage", importance: 0.54 },
  target_markets: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  target_city: { dimension: "feasibility", factKey: "target_market", importance: 0.95 },
  temperature_preference: { dimension: "environment_tolerance", factKey: "temperature_preference", importance: 0.58 },
  tolerance_for_bluntness: { dimension: "communication", factKey: "tolerance_for_bluntness", importance: 0.64 },
  trust: { dimension: "trust_context", factKey: "trust_context", importance: 0.7 },
  trust_context: { dimension: "trust_context", factKey: "trust_context", importance: 0.7 },
  mutuals: { dimension: "trust_context", factKey: "mutuals", importance: 0.72 },
  verified_work_or_school: { dimension: "trust_context", factKey: "verified_work_or_school", importance: 0.68 },
  visitors: { dimension: "social_boundary", factKey: "guests", importance: 0.84 },
  weekend_routine: { dimension: "daily_rhythm", factKey: "weekend_routine", importance: 0.62 },
  weekday_routine: { dimension: "daily_rhythm", factKey: "weekday_routine", importance: 0.62 },
  workplace_anchor: { dimension: "feasibility", factKey: "commute", importance: 0.72 },
  remote_work: { dimension: "daily_rhythm", factKey: "work_from_home", importance: 0.7 },
  work_from_home: { dimension: "daily_rhythm", factKey: "work_from_home", importance: 0.7 },
  work_from_home_pattern: { dimension: "daily_rhythm", factKey: "work_from_home", importance: 0.7 },
  work_hours: { dimension: "daily_rhythm", factKey: "work_hours", importance: 0.7 },
  work_intensity_pattern: { dimension: "daily_rhythm", factKey: "work_from_home", importance: 0.65 },
  work_mode: { dimension: "daily_rhythm", factKey: "work_from_home", importance: 0.7 },
  work_pace: { dimension: "daily_rhythm", factKey: "work_hours", importance: 0.65 },
  work_schedule: { dimension: "daily_rhythm", factKey: "work_hours", importance: 0.7 },
  work_style: { dimension: "communication", factKey: "work_style", importance: 0.6 },
};

function lookupDimensionByKey(factKey: string | null | undefined) {
  if (!factKey) {
    return undefined;
  }

  return (
    dimensionByKey[factKey] ??
    (factKey.startsWith("interest_") ? dimensionByKey.interests : undefined)
  );
}

export function resolveCanonicalFactKey(factKey: string | null | undefined): string {
  if (!factKey) {
    return "";
  }

  return lookupDimensionByKey(factKey)?.factKey ?? factKey;
}

const crossProviderCorroborationAutoApproveThreshold = 0.85;
const crossProviderCorroborationLowRiskThreshold = 0.78;
const crossProviderCorroboratedStructuredThreshold = 0.7;

const assistantBehavioralAutoApproveThreshold = 0.8;
const assistantCommunicationAutoApproveThreshold = 0.75;
const assistantTrustRapportAutoApproveThreshold = 0.72;

const assistantTrustRapportDimensions = new Set(["trust_context", "rapport_taste"]);

const assistantCommunicationAutoApproveKeys = new Set([
  "communication_style",
  "planning_style",
  "conflict_repair",
  "response_time",
  "house_meetings",
]);

const hedgedEvidencePatterns = [
  /\bno direct preference\b/i,
  /\bdefaulting to (?:midpoint|neutral|average|moderate)\b/i,
  /\bcautious midpoint\b/i,
  /\bnot directly known\b/i,
  /\bno direct evidence\b/i,
  /\bnot explicitly stated\b/i,
];

const inferredStructuredMidpointTokens = new Set([
  "moderate",
  "balanced",
  "flexible",
  "occasional",
]);

export function assistantAutoApproveConfidenceThresholdForFact(
  fact: Pick<ExtractedProfileFact, "dimension" | "factKey">,
) {
  const canonicalKey = resolveCanonicalFactKey(fact.factKey);

  if (
    assistantTrustRapportDimensions.has(fact.dimension) ||
    assistantTrustRapportFactKeys.has(canonicalKey)
  ) {
    return assistantTrustRapportAutoApproveThreshold;
  }

  if (
    fact.dimension === "communication" &&
    assistantCommunicationAutoApproveKeys.has(canonicalKey)
  ) {
    return assistantCommunicationAutoApproveThreshold;
  }

  return assistantBehavioralAutoApproveThreshold;
}

export function shouldAutoApproveCrossProviderCorroboration(
  existingFact: ProfileFactForScoring,
  incomingFact: ExtractedProfileFact,
  incomingProvider: ProfileImportProvider | string | null | undefined,
) {
  if (existingFact.reviewState !== "pending") {
    return false;
  }

  if (!isAssistantImportProvider(incomingProvider)) {
    return false;
  }

  if (!isAssistantImportProvider(existingFact.sourceImportProvider)) {
    return false;
  }

  const combinedConfidence = Math.max(
    existingFact.confidence,
    incomingFact.confidence,
  );
  const incomingCanonicalKey = resolveCanonicalFactKey(incomingFact.factKey);
  const existingCanonicalKey = resolveCanonicalFactKey(existingFact.factKey);
  const structuredOptions = structuredFactOptions(incomingCanonicalKey);
  const corroboratedStructuredValue =
    incomingCanonicalKey === existingCanonicalKey &&
    structuredOptions !== null &&
    structuredOptions.includes(incomingFact.normalizedValue) &&
    incomingFact.normalizedValue === existingFact.normalizedValue;
  const lowRisk =
    assistantTrustRapportDimensions.has(incomingFact.dimension) ||
    assistantTrustRapportDimensions.has(existingFact.dimension) ||
    incomingFact.dimension === "communication" ||
    existingFact.dimension === "communication";
  const threshold = corroboratedStructuredValue
    ? crossProviderCorroboratedStructuredThreshold
    : lowRisk
      ? crossProviderCorroborationLowRiskThreshold
      : crossProviderCorroborationAutoApproveThreshold;

  return combinedConfidence >= threshold;
}

export function isHedgedStructuredProfileFact(fact: InformativeProfileFactInput) {
  const evidence = fact.evidenceExcerpt ?? "";
  if (hedgedEvidencePatterns.some((pattern) => pattern.test(evidence))) {
    return true;
  }

  const canonicalKey = fact.factKey ? resolveCanonicalFactKey(fact.factKey) : "";
  const comparable =
    typeof fact.normalizedValue === "string"
      ? fact.normalizedValue.toLowerCase()
      : typeof fact.value === "string"
        ? fact.value.toLowerCase()
        : "";

  if (
    fact.assertionType === "inferred" &&
    fact.confidence < 0.6 &&
    inferredStructuredMidpointTokens.has(comparable)
  ) {
    return true;
  }

  if (
    fact.confidence < 0.5 &&
    ["cleanliness", "social_energy", "guests", "noise_tolerance"].includes(
      canonicalKey,
    )
  ) {
    return true;
  }

  return false;
}

const allowedDimensions = new Set([
  "feasibility",
  "daily_rhythm",
  "environment_tolerance",
  "home_labor",
  "social_boundary",
  "communication",
  "trust_context",
  "preference_elasticity",
  "rapport_taste",
  "disallowed",
]);

const dimensionAliases: Record<string, string> = {
  budget_location: "feasibility",
  environment: "environment_tolerance",
  environmental: "environment_tolerance",
  home: "home_labor",
  household: "home_labor",
  lifestyle: "daily_rhythm",
  rhythm: "daily_rhythm",
  routine: "daily_rhythm",
  social: "social_boundary",
  social_boundaries: "social_boundary",
  social_preferences: "social_boundary",
  taste: "rapport_taste",
  tastes: "rapport_taste",
  tradeoffs: "preference_elasticity",
  trust: "trust_context",
};


const protectedPatterns = [
  /\bage\b/i,
  /\b\d{2}\s*(?:years?\s*old|year-old)\b/i,
  /\brace\b/i,
  /\bethnic/i,
  /\bnational origin\b/i,
  /\bcitizen(ship)?\b/i,
  /\breligion\b/i,
  /\bchristian\b/i,
  /\bjewish\b/i,
  /\bmuslim\b/i,
  /\bchurch\b/i,
  /\bmosque\b/i,
  /\bsynagogue\b/i,
  /\bsex\b/i,
  /\bgender\b/i,
  /\bsexual orientation\b/i,
  /\bdisab/i,
  /\bpregnan/i,
  /\bfamilial status\b/i,
  /\bchildren\b/i,
  /\bkids\b/i,
];

const highRiskPatterns = [
  /\bdiagnos/i,
  /\btherapy\b/i,
  /\bmedication\b/i,
  /\bmental health\b/i,
  /\bcredit score\b/i,
  /\bbankruptcy\b/i,
  /\beviction\b/i,
  /\bcriminal\b/i,
  /\bconviction\b/i,
  /\bimmigration\b/i,
  /\bssn\b/i,
  /\bsocial security\b/i,
];

const executablePatterns = [
  /<\s*script\b/i,
  /\bjavascript\s*:/i,
  /\bon[a-z]+\s*=/i,
  /<\s*iframe\b/i,
];

const nonInformativeFactPatterns = [
  /^(?:unknown|not known|not explicitly known|none known|n\/a|not applicable|no data|no saved memory|no saved memories)$/i,
  /^no\b.*\b(?:data|direct evidence|evidence|information|memory|memories|record|reliable evidence|saved memory|signal)\b/i,
  /^no\b.*\bfacts?\b.*\b(?:available|found|included|known|stored)\b/i,
  /\b(?:actual|specific|direct|reliable)?\s*(?:data|evidence|information|signal)\s+(?:is|are)?\s*(?:not\s+)?(?:available|known|recorded|stated)\b/i,
  /\b(?:is|are|remains?|still)\s+unknown\b/i,
  /\bnot\s+(?:available|confirmed|directly observed|explicitly stated|known|recorded|reliably established|stated)\b/i,
  /\bunknown;?\s*no\b/i,
  /\bno reliable evidence\b/i,
  /\bno direct evidence\b/i,
  /\bno direct preference\b/i,
  /\bdefaulting to (?:midpoint|neutral|average|moderate)\b/i,
  /\bcautious midpoint\b/i,
  /\bnot directly known\b/i,
  /\bnot enough (?:evidence|information|signal)\b/i,
];

export function normalizeProfileImportPayload(input: unknown): NormalizedProfileImport {
  const payload = normalizeJsonValue(input);
  const payloadText = stableJsonStringify(payload);

  if (payloadText.length > maxPayloadCharacters) {
    throw new ApiError(`Profile import is too large. Maximum size is ${maxPayloadCharacters} characters.`);
  }

  if (!payload || (typeof payload !== "object" && !Array.isArray(payload))) {
    throw new ApiError("Profile import must be a JSON object or array.");
  }

  if (containsExecutableContent(payload)) {
    throw new ApiError("Profile import contains executable-looking content and was rejected.");
  }

  return {
    payload,
    payloadHash: createHash("sha256").update(payloadText).digest("hex"),
    payloadText,
  };
}

export function parseProfileImportText(rawText: string): NormalizedProfileImport {
  const candidates = profileJsonTextCandidates(rawText);

  for (const candidate of candidates) {
    try {
      return normalizeProfileImportPayload(JSON.parse(candidate));
    } catch {
      // Assistant exports occasionally ignore the prompt's escaping rule and
      // put quoted source language directly inside a JSON string. Repair only
      // that narrow, recognizable profile shape before trying the next body.
      const repairedCandidate = repairAssistantProfileJsonQuotes(candidate);
      if (repairedCandidate) {
        try {
          return normalizeProfileImportPayload(JSON.parse(repairedCandidate));
        } catch {
          // Try the next likely JSON body.
        }
      }
    }
  }

  throw new ApiError("Invalid JSON. Paste assistant-generated JSON; markdown code fences are okay.");
}

function repairAssistantProfileJsonQuotes(candidate: string) {
  if (
    !candidate.includes('"schema_version"') ||
    !/kinfolk_assistant_profile_v\d+/.test(candidate) ||
    !candidate.includes('"profile_facts"')
  ) {
    return null;
  }

  let inString = false;
  let escaped = false;
  let repaired = "";
  let repairCount = 0;

  for (let index = 0; index < candidate.length; index += 1) {
    const character = candidate[index] ?? "";

    if (!inString) {
      repaired += character;
      if (character === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      repaired += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      repaired += character;
      escaped = true;
      continue;
    }

    if (character !== '"') {
      repaired += character;
      continue;
    }

    const nextSignificantCharacter = readNextNonWhitespaceCharacter(
      candidate,
      index + 1,
    );
    const closesJsonString =
      nextSignificantCharacter === null ||
      [":", ",", "}", "]"].includes(nextSignificantCharacter);

    if (closesJsonString) {
      repaired += character;
      inString = false;
      continue;
    }

    repaired += '\\"';
    repairCount += 1;
  }

  return !inString && repairCount > 0 ? repaired : null;
}

function readNextNonWhitespaceCharacter(value: string, startIndex: number) {
  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];
    if (character && !/\s/.test(character)) {
      return character;
    }
  }
  return null;
}

export function extractProfileImportMetadata(payload: Json): ProfileImportMetadata {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const record = payload as Record<string, Json | undefined>;
  const metadata: ProfileImportMetadata = {};

  const profileSummaryRaw = record.profile_summary ?? record.profileSummary;
  if (
    profileSummaryRaw &&
    typeof profileSummaryRaw === "object" &&
    !Array.isArray(profileSummaryRaw)
  ) {
    const summary = profileSummaryRaw as Record<string, Json | undefined>;
    const profileSummary: NonNullable<ProfileImportMetadata["profileSummary"]> = {};

    const shortSelfSummary =
      readJsonString(summary.short_self_summary) ??
      readJsonString(summary.shortSelfSummary);
    const livingWithMeIsLike =
      readJsonString(summary.living_with_me_is_like) ??
      readJsonString(summary.livingWithMeIsLike);
    const knownUncertainties =
      readJsonStringArray(summary.known_uncertainties) ??
      readJsonStringArray(summary.knownUncertainties);

    if (shortSelfSummary) {
      profileSummary.shortSelfSummary = shortSelfSummary;
    }
    if (livingWithMeIsLike) {
      profileSummary.livingWithMeIsLike = livingWithMeIsLike;
    }
    if (knownUncertainties && knownUncertainties.length > 0) {
      profileSummary.knownUncertainties = knownUncertainties;
    }

    if (Object.keys(profileSummary).length > 0) {
      metadata.profileSummary = profileSummary;
    }
  }

  const recommendedFollowUpQuestions =
    readJsonStringArray(record.recommended_follow_up_questions) ??
    readJsonStringArray(record.recommendedFollowUpQuestions);
  if (recommendedFollowUpQuestions && recommendedFollowUpQuestions.length > 0) {
    metadata.recommendedFollowUpQuestions = recommendedFollowUpQuestions;
  }

  const contradictionsOrUncertainties =
    readJsonStringArray(record.contradictions_or_uncertainties) ??
    readJsonStringArray(record.contradictionsOrUncertainties);
  if (contradictionsOrUncertainties && contradictionsOrUncertainties.length > 0) {
    metadata.contradictionsOrUncertainties = contradictionsOrUncertainties;
  }

  return metadata;
}

export function extractProfileFacts(payload: Json): ExtractedProfileFact[] {
  const facts: ExtractedProfileFact[] = extractStructuredProfileFacts(payload);

  walkPayload(payload, [], (path, value) => {
    const leaf = normalizeLeafValue(value);
    if (leaf === null || isNonInformativeProfileFactValue(leaf)) {
      return;
    }

    if (isInsideStructuredFacts(path)) {
      return;
    }

    const pathKey = toSnake(path.at(-1) ?? "");
    const pathText = path.map(toSnake).join(".");
    const mapped = mapPathToDimension(pathKey, pathText, leaf);

    if (!mapped) {
      return;
    }

    const evidenceExcerpt = excerptFromValue(value);
    const sensitivityLevel = classifySensitivity(`${pathText} ${evidenceExcerpt}`);
    const assertionType = pathText.includes("inferred") ? "inferred" : pathText.includes("explicit") ? "explicit" : "imported";
    const confidence = assertionType === "explicit" ? 0.86 : assertionType === "inferred" ? 0.64 : 0.74;

    facts.push({
      dimension: mapped.dimension,
      factKey: mapped.factKey,
      value: leaf,
      normalizedValue: normalizedFactValue(mapped.factKey, leaf),
      assertionType,
      confidence,
      importance: mapped.importance,
      sensitivityLevel,
      matchingEligible: sensitivityLevel === "standard" && mapped.dimension !== "disallowed",
      evidenceExcerpt,
    });
  });

  return dedupeFacts(facts.filter(isInformativeProfileFact));
}

export function isInformativeProfileFact(fact: InformativeProfileFactInput) {
  if (!fact.factKey?.trim()) {
    return false;
  }

  if (isHedgedStructuredProfileFact(fact)) {
    return false;
  }

  return (
    !isNonInformativeProfileFactValue(fact.value ?? null) &&
    !isNonInformativeText(fact.normalizedValue ?? "") &&
    !isNonInformativeText(fact.evidenceExcerpt ?? "")
  );
}

const assistantImportProviders = new Set<ProfileImportProvider>(["chatgpt", "claude"]);
const assistantAllowedSearchProfileFactKeys = new Set(["pets"]);

export const searchProfileFactKeys = new Set([
  "accessibility",
  "budget",
  "budget_preferred_max",
  "budget_max",
  "budget_min",
  "commute",
  "commute_anchor",
  "commute_tradeoff",
  "current_location",
  "dealbreakers",
  "group_size_flexibility",
  "household_size",
  "lease_length",
  "location_tradeoff",
  "move_in_window",
  "must_haves",
  "neighborhoods",
  "office_anchor",
  "pets",
  "rent_tradeoff",
  "rent_location_commute_tradeoff",
  "risk_tolerance",
  "room_quality_tradeoff",
  "smoking",
  "target_city",
  "target_market",
  "target_markets",
  "workplace_anchor",
]);

export function isAssistantImportProvider(
  provider: ProfileImportProvider | string | null | undefined,
) {
  return assistantImportProviders.has(provider as ProfileImportProvider);
}

function isSearchProfileFactForAssistantImport(
  fact: Pick<ExtractedProfileFact | ProfileFactForScoring, "factKey">,
) {
  return searchProfileFactKeys.has(fact.factKey);
}

export function filterFactsForImportProvider(
  facts: ExtractedProfileFact[],
  provider: ProfileImportProvider,
) {
  if (!isAssistantImportProvider(provider)) {
    return facts.filter(isInformativeProfileFact);
  }

  return facts.filter(
    (fact) =>
      isCanonicalAssistantProfileFactKey(
        resolveCanonicalFactKey(fact.factKey),
      ) &&
      (!isSearchProfileFactForAssistantImport(fact) ||
        assistantAllowedSearchProfileFactKeys.has(
          resolveCanonicalFactKey(fact.factKey),
        )) &&
      isInformativeProfileFact(fact) &&
      fact.sensitivityLevel === "standard" &&
      fact.matchingEligible,
  );
}

function isInsideStructuredFacts(path: string[]) {
  return path.some((segment) =>
    ["profile_facts", "kinfolk_profile_facts", "structured_facts"].includes(toSnake(segment)),
  );
}

export function detectProfileFactConflicts(facts: ExtractedProfileFact[]) {
  const conflicts: { factAIndex: number; factBIndex: number; conflictType: "contradiction" | "low_confidence" | "sensitive_proxy" }[] = [];
  const seen = new Map<string, { index: number; fact: ExtractedProfileFact }>();

  facts.forEach((fact, index) => {
    if (fact.confidence < 0.5) {
      conflicts.push({ factAIndex: index, factBIndex: index, conflictType: "low_confidence" });
    }

    if (fact.sensitivityLevel !== "standard") {
      conflicts.push({ factAIndex: index, factBIndex: index, conflictType: "sensitive_proxy" });
    }

    const key = `${fact.dimension}:${fact.factKey}`;
    const previous = seen.get(key);

    if (previous && isContradictoryProfileFactValue(fact, previous.fact)) {
      conflicts.push({ factAIndex: previous.index, factBIndex: index, conflictType: "contradiction" });
    }

    seen.set(key, { index, fact });
  });

  return conflicts;
}

export function reconcileProfileFactImport(
  incomingFacts: ExtractedProfileFact[],
  existingFacts: ProfileFactForScoring[],
): ReconciledProfileFactImport {
  const activeExistingFacts = existingFacts.filter(isActiveProfileFactForMerge);
  const mergeFacts = [...activeExistingFacts];
  // Text transports store list edits as full snapshots. Compare an incoming
  // additive list with the currently projected snapshot, not an older
  // superseded snapshot that happens to contain the same values. Otherwise
  // reverting a list can corroborate stale history without creating the fresh
  // fact timestamp that makes the replacement authoritative.
  const duplicateCandidateFacts = [
    ...activeExistingFacts.filter(
      (existingFact) => !isAdditiveProfileFactKey(existingFact.factKey),
    ),
    ...consolidateProfileFactsForProjection(
      activeExistingFacts.filter((existingFact) =>
        isAdditiveProfileFactKey(existingFact.factKey),
      ),
    ),
  ];
  const duplicateMatches: ReconciledProfileFactImport["duplicateMatches"] = [];
  const factsToInsert: ReconciledProfileFactImport["factsToInsert"] = [];

  incomingFacts.forEach((fact, incomingFactIndex) => {
    const sameSlotFacts = mergeFacts.filter((existingFact) =>
      isSameProfileFactSlot(fact, existingFact),
    );
    const duplicate = bestDuplicateMatch(
      fact,
      duplicateCandidateFacts.filter((existingFact) =>
        isSameProfileFactSlot(fact, existingFact),
      ),
    );

    if (duplicate) {
      duplicateMatches.push({
        incomingFactIndex,
        fact,
        existingFact: duplicate.existingFact,
        similarity: duplicate.similarity,
      });
      return;
    }

    const conflictingExistingFacts = isAdditiveProfileFactKey(fact.factKey)
      ? []
      : sameSlotFacts.filter((existingFact) =>
          isContradictoryProfileFactValue(fact, existingFact),
        );

    factsToInsert.push({ incomingFactIndex, fact, conflictingExistingFacts });
    const incomingMergeFact = profileFactForMerge(fact, incomingFactIndex);
    mergeFacts.push(incomingMergeFact);
    duplicateCandidateFacts.push(incomingMergeFact);
  });

  return { duplicateMatches, factsToInsert };
}

export { consolidateProfileFactsForProjection } from "../matching/fact-similarity";

function normalizeJsonValue(value: unknown): Json {
  if (value === null) {
    return null;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    return value as Json;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, normalizeJsonValue(entry)]),
    );
  }

  return String(value);
}

function profileJsonTextCandidates(rawText: string) {
  const trimmed = rawText.trim();
  const candidates = [trimmed];
  const bareLanguageLine = trimmed.match(/^(?:json|jsonc|javascript|js|typescript|ts)\s+([\s\S]*)$/i);

  if (bareLanguageLine?.[1]) {
    candidates.push(bareLanguageLine[1].trim());
  }

  const fencePattern =
    /(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(?:json|jsonc|javascript|js|typescript|ts)?[^\n\r]*\r?\n([\s\S]*?)\r?\n?[ \t]*\1[ \t]*(?=\n|$)/gi;

  for (const match of trimmed.matchAll(fencePattern)) {
    if (match[2]) {
      candidates.push(match[2].trim());
    }
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  return [...new Set(candidates.filter((candidate) => candidate.length > 0))];
}

function extractStructuredProfileFacts(payload: Json): ExtractedProfileFact[] {
  const facts: ExtractedProfileFact[] = [];

  collectStructuredProfileFacts(payload, [], facts);

  return facts;
}

function collectStructuredProfileFacts(value: Json, path: string[], facts: ExtractedProfileFact[]) {
  if (value === null) {
    return;
  }

  if (Array.isArray(value)) {
    if (isStructuredFactsPath(path)) {
      for (const item of value) {
        const fact = coerceStructuredProfileFact(item);
        if (fact) {
          facts.push(fact);
        }
      }
      return;
    }

    value.forEach((item, index) => collectStructuredProfileFacts(item, [...path, String(index)], facts));
    return;
  }

  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectStructuredProfileFacts(entry ?? null, [...path, key], facts);
    }
  }
}

function isStructuredFactsPath(path: string[]) {
  const pathKey = toSnake(path.at(-1) ?? "");
  return ["facts", "profile_facts", "kinfolk_profile_facts", "structured_facts"].includes(pathKey);
}

function coerceStructuredProfileFact(value: Json): ExtractedProfileFact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, Json | undefined>;
  const rawFactKey = readJsonString(record.fact_key) ?? readJsonString(record.key) ?? readJsonString(record.name);
  const factKey = toSnake(rawFactKey ?? "");
  const factValue = record.value ?? record.fact ?? record.answer ?? null;
  const leaf = normalizeLeafValue(factValue);

  if (!factKey || leaf === null || isNonInformativeProfileFactValue(leaf)) {
    return null;
  }

  const dimension = normalizeStructuredDimension(readJsonString(record.dimension), factKey);
  const evidence =
    readJsonString(record.evidence) ??
    readJsonString(record.source) ??
    readJsonString(record.basis) ??
    excerptFromValue(leaf);
  const sensitivityLevel = normalizeSensitivityLevel(
    readJsonString(record.sensitivity_level),
    `${dimension} ${factKey} ${excerptFromValue(leaf)}`,
    factKey,
  );
  const assertionType = normalizeAssertionType(readJsonString(record.assertion_type));
  const mapped = lookupDimensionByKey(factKey);
  const resolvedFactKey = mapped?.factKey ?? factKey;
  const sourceType = normalizeOptionalProvenanceText(
    record.source_type ?? record.sourceType,
  );
  const observedVsSelfReported = normalizeOptionalProvenanceText(
    record.observed_vs_self_reported ?? record.observedVsSelfReported,
  );
  const recencyHint = normalizeOptionalProvenanceText(
    record.recency_hint ?? record.recencyHint,
  );
  const recencyAt = parseUnambiguousIsoDate(
    normalizeOptionalProvenanceText(record.recency_at ?? record.recencyAt) ??
      recencyHint,
  );

  return {
    dimension,
    factKey: resolvedFactKey,
    value: leaf,
    normalizedValue: normalizedFactValue(resolvedFactKey, leaf),
    assertionType,
    confidence: clamp(readJsonNumber(record.confidence) ?? (assertionType === "explicit" ? 0.86 : 0.7)),
    importance: mapped?.importance ?? defaultImportanceForDimension(dimension),
    sensitivityLevel,
    matchingEligible: sensitivityLevel === "standard" && dimension !== "disallowed",
    evidenceExcerpt: evidence.replace(/\s+/g, " ").trim().slice(0, 260),
    ...(sourceType ? { sourceType } : {}),
    ...(observedVsSelfReported ? { observedVsSelfReported } : {}),
    ...(recencyHint ? { recencyHint } : {}),
    ...(recencyAt ? { recencyAt } : {}),
  };
}

function normalizeStructuredDimension(rawDimension: string | null, factKey: string) {
  const dimension = toSnake(rawDimension ?? "");
  if (allowedDimensions.has(dimension)) {
    return dimension;
  }

  const alias = dimensionAliases[dimension];
  if (alias && allowedDimensions.has(alias)) {
    return alias;
  }

  return lookupDimensionByKey(factKey)?.dimension ?? "disallowed";
}

function normalizeSensitivityLevel(
  rawLevel: string | null,
  fallbackText: string,
  factKey?: string,
): ProfileSensitivityLevel {
  const level = toSnake(rawLevel ?? "");
  if (factKey === "age" || factKey === "preferred_age_range") {
    return ["sensitive", "protected", "high_risk"].includes(level)
      ? (level as ProfileSensitivityLevel)
      : "standard";
  }
  const classifiedLevel = classifySensitivity(fallbackText);
  if (classifiedLevel !== "standard") {
    return classifiedLevel;
  }
  if (["standard", "sensitive", "protected", "high_risk"].includes(level)) {
    return level as ProfileSensitivityLevel;
  }
  if (["private", "financial", "precise_location"].includes(level)) {
    return "sensitive";
  }
  if (["fair_housing_protected", "protected_attribute"].includes(level)) {
    return "protected";
  }
  return "standard";
}

function normalizeAssertionType(rawType: string | null): ExtractedProfileFact["assertionType"] {
  const type = toSnake(rawType ?? "");
  if (["explicit", "inferred", "imported", "user_confirmed"].includes(type)) {
    return type as ExtractedProfileFact["assertionType"];
  }
  if (["memory", "profile", "self_reported"].includes(type)) {
    return "explicit";
  }
  if (["derived", "implicit", "inference"].includes(type)) {
    return "inferred";
  }
  return "imported";
}

function defaultImportanceForDimension(dimension: string) {
  switch (dimension) {
    case "feasibility":
      return 0.9;
    case "daily_rhythm":
    case "environment_tolerance":
    case "home_labor":
    case "social_boundary":
    case "communication":
      return 0.78;
    case "trust_context":
    case "preference_elasticity":
      return 0.68;
    case "rapport_taste":
      return 0.35;
    default:
      return 0;
  }
}

function readJsonString(value: Json | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readJsonStringArray(value: Json | undefined) {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value.flatMap((entry) => {
    const item = typeof entry === "string" ? entry.trim() : "";
    return item ? [item] : [];
  });

  return items.length > 0 ? items : null;
}

function readJsonNumber(value: Json | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOptionalProvenanceText(value: Json | undefined) {
  const text = readJsonString(value);
  return text ? text.replace(/\s+/g, " ").slice(0, 160) : undefined;
}

function parseUnambiguousIsoDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
      ? undefined
      : parsed.toISOString();
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function containsExecutableContent(value: Json): boolean {
  const text = typeof value === "string" ? value : stableJsonStringify(value);
  return executablePatterns.some((pattern) => pattern.test(text));
}

function walkPayload(value: Json, path: string[], visit: (path: string[], value: Json) => void) {
  if (value === null) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
      visit(path, value);
      return;
    }

    value.forEach((item, index) => walkPayload(item, [...path, String(index)], visit));
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return;
    }

    for (const [key, entry] of entries) {
      walkPayload(entry ?? null, [...path, key], visit);
    }
    return;
  }

  visit(path, value);
}

function normalizeLeafValue(value: Json): Json | null {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    const cleaned = value.flatMap((item) => {
      const cleanedItem = typeof item === "string" ? item.trim() : item;
      return cleanedItem === null || cleanedItem === "" || cleanedItem === undefined
        ? []
        : [cleanedItem];
    });
    return cleaned.length > 0 ? (cleaned as Json) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return value;
}

function mapPathToDimension(pathKey: string, pathText: string, value: Json) {
  if (pathKey === "raw_message" || pathText.startsWith("extraction.")) {
    return null;
  }

  if (
    [
      "assertion_type",
      "basis",
      "category",
      "confidence",
      "evidence",
      "generated_at",
      "generated_by",
      "observed_vs_self_reported",
      "recency_hint",
      "schema_version",
      "sensitivity_level",
      "source",
      "source_assistant",
      "source_basis",
      "source_type",
    ].includes(pathKey)
  ) {
    return null;
  }

  if (shouldSkipProfilePath(pathText, value)) {
    return null;
  }

  const valueText = normalizeComparableValue(value);
  const haystack = `${pathText} ${valueText}`;
  const housingContext = /(housing|home|roommate|household|routine|chronotype|lifestyle|living|commute|budget|location_preference|market|neighborhood|sleep|clean|guest|noise|communication|conflict|preference|tradeoff|schedule|social_frequency|aesthetic|taste|rapport|music|privacy|chores|lease|rent)/i.test(
    haystack,
  );
  const broadProfessionalContext = /\b(relationship|relationships|employment|professional|work_history|compensation|legal|company|colleague|education|career|technical|tool|vendor|music|personality|goals)\b/i.test(
    haystack,
  );
  const mappedByKey = lookupDimensionByKey(pathKey);
  if (mappedByKey && (housingContext || isCoreHousingFactKey(pathKey))) {
    if (isAmbiguousHousingFactKey(pathKey) && !hasConcreteHousingSignal(haystack)) {
      return null;
    }
    return mappedByKey;
  }

  const pathParts = pathText.split(".");
  const mappedByPath = housingContext
    ? pathParts.map((part) => lookupDimensionByKey(part)).find(Boolean)
    : null;
  if (mappedByPath) {
    return mappedByPath;
  }

  if (broadProfessionalContext && !housingContext) {
    return null;
  }

  if (!housingContext && !pathText.includes("explicit_memories") && !pathText.includes("contradictions")) {
    return null;
  }

  if (/\b(noise|quiet|loud|volume|soundproof|thin walls)\b/i.test(haystack)) {
    return dimensionByKey.noise;
  }
  if (/\b(clean|dishes|trash|chores|clutter)\b/i.test(haystack)) {
    return dimensionByKey.cleanliness;
  }
  if (/\b(sleep|wake|morning|night owl|bedtime|midnight)\b/i.test(haystack)) {
    return dimensionByKey.sleep;
  }
  if (/\b(guest|host|party|overnight|partner visit|partner stays|visitor)\b/i.test(haystack)) {
    return dimensionByKey.guests;
  }
  if (/\b(direct|responsive|text|communication|conflict|feedback|repair)\b/i.test(haystack)) {
    return dimensionByKey.communication;
  }
  if (/\b(rent|budget|afford|deposit)\b/i.test(haystack)) {
    return dimensionByKey.budget;
  }
  if (/\b(neighborhood|market|location|commute|transit)\b/i.test(haystack)) {
    return dimensionByKey.location;
  }
  if (classifySensitivity(haystack) !== "standard") {
    return { dimension: "disallowed", factKey: "sensitive_profile", importance: 0 };
  }

  return null;
}

function shouldSkipProfilePath(pathText: string, value: Json) {
  if (
    /\b(profile_summary|recommended_follow_up_questions|contradictions_or_uncertainties|known_uncertainties|raw_profile_notes|raw_relevant_notes)\b/i.test(
      pathText,
    )
  ) {
    return true;
  }

  const valueText = normalizeComparableValue(value);

  if (isNonInformativeProfileFactValue(value) || /\b(no explicit|unclear|not recorded|not confirmed|no household context)\b/i.test(valueText)) {
    return true;
  }

  if (/\b(colleague|coworker|senior leadership|portfolio company|vendor|enterprise|compliance|tos|tooling|legal entity)\b/i.test(valueText)) {
    return !hasConcreteHousingSignal(`${pathText} ${valueText}`);
  }

  return false;
}

function isAmbiguousHousingFactKey(pathKey: string) {
  return [
    "dealbreakers",
    "guests",
    "guest_cadence",
    "hosting",
    "hosting_expectations",
    "lifestyle",
    "noise",
    "noise_tolerance",
    "roommates",
    "social",
    "social_energy",
    "social_frequency",
  ].includes(pathKey);
}

function hasConcreteHousingSignal(text: string) {
  return /\b(apartment|bedroom|budget|clean|cleaning|chores|commute|dishes|guest|home|household|lease|live|living with|move[ -]?in|neighborhood|noise|overnight|quiet|rent|roommate|sleep|trash|visitor|walkable)\b/i.test(
    text,
  );
}

function isCoreHousingFactKey(pathKey: string) {
  return [
    "budget",
    "budget_preferred_max",
    "budget_max",
    "budget_min",
    "cleanliness",
    "chores",
    "chronotype",
    "commute",
    "commute_notes",
    "communication_style",
    "conflict_repair",
    "conflict_style",
    "dealbreakers",
    "flexibility",
    "flexibility_notes",
    "guest_cadence",
    "guests",
    "hosting",
    "hosting_expectations",
    "household_size",
    "lifestyle_notes",
    "location_preferences",
    "market",
    "move_in",
    "move_in_window",
    "must_haves",
    "neighborhoods",
    "noise_tolerance",
    "pets",
    "routine_regularity",
    "rent_tradeoff",
    "risk_tolerance",
    "sleep_schedule",
    "social_energy",
    "social_frequency",
    "trust_context",
    "work_from_home",
  ].includes(pathKey);
}

function classifySensitivity(text: string): ProfileSensitivityLevel {
  if (protectedPatterns.some((pattern) => pattern.test(text))) {
    return "protected";
  }
  if (highRiskPatterns.some((pattern) => pattern.test(text))) {
    return "high_risk";
  }
  if (/\bincome\b|\bsalary\b|\bdebt\b|\blegal\b/i.test(text)) {
    return "sensitive";
  }
  return "standard";
}

function excerptFromValue(value: Json) {
  const text = typeof value === "string" ? value : stableJsonStringify(value);
  return text.replace(/\s+/g, " ").trim().slice(0, 260);
}

// Stored comparable value for a fact: a canonical structured token when the key
// has a known vocabulary, otherwise the free-text comparable form.
function normalizedFactValue(factKey: string, value: Json): string {
  const comparable = normalizeComparableValue(value);
  return normalizeStructuredFactValue(factKey, comparable) ?? comparable;
}

function isNonInformativeProfileFactValue(value: Json): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => isNonInformativeProfileFactValue(item as Json));
  }

  if (value && typeof value === "object") {
    return false;
  }

  return isNonInformativeText(normalizeComparableValue(value));
}

function isNonInformativeText(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return true;
  }

  return nonInformativeFactPatterns.some((pattern) => pattern.test(normalized));
}

function dedupeFacts(facts: ExtractedProfileFact[]) {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.dimension}:${fact.factKey}:${fact.normalizedValue}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isActiveProfileFactForMerge(fact: ProfileFactForScoring) {
  return !["deleted", "rejected", "revoked"].includes(fact.reviewState);
}

function isContradictoryProfileFactValue(
  fact: Pick<ExtractedProfileFact, "factKey" | "normalizedValue" | "sensitivityLevel">,
  existingFact: Pick<ProfileFactForScoring, "factKey" | "normalizedValue" | "sensitivityLevel">,
) {
  if (fact.sensitivityLevel !== "standard" || existingFact.sensitivityLevel !== "standard") {
    return false;
  }

  if (isAdditiveProfileFactKey(fact.factKey)) {
    return false;
  }

  const structured = structuredValueSimilarity(
    fact.factKey,
    fact.normalizedValue,
    existingFact.normalizedValue,
  );
  if (structured !== null) {
    return structured <= contradictoryFactSimilarityThreshold;
  }

  const similarity = valueSimilarityForKey(
    fact.factKey,
    fact.normalizedValue,
    existingFact.normalizedValue,
    existingFact.factKey,
  );

  if (isSearchProfileFactForAssistantImport(fact)) {
    return similarity <= contradictoryFactSimilarityThreshold;
  }

  const categoryA = classifyFactKeyValue(fact.factKey, fact.normalizedValue);
  const categoryB = classifyFactKeyValue(fact.factKey, existingFact.normalizedValue);
  if (categoryA && categoryB) {
    return categoryA !== categoryB;
  }

  return false;
}

function profileFactForMerge(
  fact: ExtractedProfileFact,
  incomingFactIndex: number,
): ProfileFactForScoring {
  return {
    id: `incoming:${incomingFactIndex}`,
    userId: "",
    sourceImportProvider: "incoming",
    dimension: fact.dimension,
    factKey: fact.factKey,
    value: fact.value,
    normalizedValue: fact.normalizedValue,
    confidence: fact.confidence,
    importance: fact.importance,
    sensitivityLevel: fact.sensitivityLevel,
    matchingEligible: fact.matchingEligible,
    reviewState: "pending",
    evidenceExcerpt: fact.evidenceExcerpt,
  };
}



export function isInformativeProfileFactRow(row: TableRow<"profile_facts">) {
  return isInformativeProfileFact({
    assertionType: row.assertion_type,
    confidence: row.confidence,
    evidenceExcerpt: row.evidence_excerpt ?? "",
    factKey: row.fact_key,
    normalizedValue: row.normalized_value,
    value: row.value_json,
  });
}

export function mapFactForScoring(
  row: TableRow<"profile_facts">,
  sourceImportProvider?: ProfileImportProvider | string | null,
): ProfileFactForScoring {
  return {
    confidence: row.confidence,
    createdAt: row.recency_at ?? row.created_at,
    dimension: row.dimension,
    evidenceExcerpt: row.evidence_excerpt,
    factKey: row.fact_key,
    id: row.id,
    importance: row.importance,
    matchingEligible: row.matching_eligible,
    normalizedValue: row.normalized_value,
    reviewState: row.user_review_state,
    sensitivityLevel: row.sensitivity_level,
    sourceImportId: row.source_import_id,
    sourceImportProvider,
    userId: row.user_id,
    value: row.value_json,
  };
}


function toSnake(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
