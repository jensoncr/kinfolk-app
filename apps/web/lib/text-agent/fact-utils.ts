import "server-only";
import { resolveCanonicalFactKey } from "@/lib/profiles/enrichment";
import { factKeysForTextAgentActiveExtractionStep, factKeysForTextAgentExtractionStep, factKeysForTextAgentIntakeStep, normalizeHousingPreferenceListFacts, textAgentAllowedFactKeys, textAgentIntakeSteps, textAgentOpportunisticFactKeys } from "@/lib/text-agent";
import { exclusiveTextProfileFactFamily, looksLikePreferredAgeRangeValue, normalizeTextProfileFactForCorrection, textProfileFactsCoverAgeComfortStep } from "@/lib/text-agent/corrections";
import { validateSanFranciscoNeighborhoods } from "@/lib/text-agent/neighborhoods";
import type { TextAgentIntakeStep, TextProfileFact } from "@/lib/text-agent";
import type { TextAgentLastSentCard } from "@/lib/text-agent/state";
import type { IntakeControlResult, SupabaseServiceClient, TableRow, TextAgentDraftState } from "@/lib/text-agent/store-types";
import type { Json } from "@/lib/supabase/types";
import { jsonObjectOrEmpty } from "@/lib/text-agent/store-shared";

export function splitExclusiveSlotEditFacts(facts: TextProfileFact[]) {
  const slotEdits = new Map<
    string,
    { facts: TextProfileFact[]; revokeKeys: string[] }
  >();
  const remainingFacts: TextProfileFact[] = [];

  for (const fact of facts) {
    const family = exclusiveTextProfileFactFamily(fact.fact_key);
    if (!family) {
      remainingFacts.push(fact);
      continue;
    }

    const key = family.join("|");
    const revokeKeys = budgetSlotRevokeKeys(family);
    const existing = slotEdits.get(key);
    if (existing) {
      existing.facts.push(fact);
    } else {
      slotEdits.set(key, { facts: [fact], revokeKeys });
    }
  }

  return {
    remainingFacts,
    slotEdits: [...slotEdits.values()],
  };
}

function budgetSlotRevokeKeys(family: string[]) {
  return family.includes("budget") ||
    family.includes("budget_min") ||
    family.includes("budget_max")
    ? [...new Set([...family, "budget_preferred_max"])]
    : family;
}

export function canAutoPersistAllTextFacts(facts: TextProfileFact[]) {
  return facts.length > 0 && facts.every(isAutoPersistableTextFact);
}

export function autoPersistableTextFacts(facts: TextProfileFact[]) {
  return facts.filter(isAutoPersistableTextFact);
}

function isAutoPersistableTextFact(fact: TextProfileFact) {
  return (
    fact.sensitivity_level === "standard" &&
    fact.matching_eligible !== false
  );
}

export async function validateTextProfileFacts(
  supabase: SupabaseServiceClient,
  facts: TextProfileFact[],
  {
    activeIntakeStep = null,
  }: {
    activeIntakeStep?: TextAgentIntakeStep | null;
  } = {},
): Promise<{
  facts: TextProfileFact[];
  notice?: string;
  reply?: string;
  warnings: string[];
}> {
  const validatedFacts: TextProfileFact[] = [];
  const warnings: string[] = [];
  const rejectedNeighborhoods: string[] = [];
  const allowedFactKeys = new Set<string>(textAgentAllowedFactKeys);
  const expectedFactKeys = activeIntakeStep
    ? new Set<string>([
        ...factKeysForTextAgentActiveExtractionStep(activeIntakeStep),
        ...textAgentOpportunisticFactKeys,
      ])
    : null;

  const processFact = async (index: number): Promise<void> => {
    const fact = facts[index];
    if (!fact) return;

    const factKey = fact.fact_key.trim().toLowerCase();

    if (
      factKey === "target_market" ||
      factKey === "target_markets"
    ) {
      warnings.push(
        "Ignored city/market fact because Kinfolk text intake is San Francisco-only.",
      );
      return processFact(index + 1);
    }

    if (!allowedFactKeys.has(factKey)) {
      warnings.push(`Dropped unsupported profile fact key: ${fact.fact_key}.`);
      return processFact(index + 1);
    }

    if (expectedFactKeys && !expectedFactKeys.has(factKey)) {
      warnings.push(
        `Dropped ${fact.fact_key} because the active interview step only accepts ${[
          ...expectedFactKeys,
        ].join(", ")}.`,
      );
      return processFact(index + 1);
    }

    const normalizedFact =
      factKey === fact.fact_key ? fact : { ...fact, fact_key: factKey };
    const storageFact = normalizeTextProfileFactForStorage(normalizedFact);
    const canonicalFact = normalizeTextProfileFactForCorrection(storageFact);

    if (
      storageFact.fact_key === "preferred_age_range" &&
      looksLikePreferredAgeRangeValue(storageFact.value) &&
      !canonicalFact
    ) {
      warnings.push(
        "Dropped invalid preferred_age_range because the minimum exceeds the maximum.",
      );
      return processFact(index + 1);
    }

    if (!canonicalFact) {
      if (storageFact.fact_key === "age") {
        warnings.push("Dropped invalid age value.");
      }
      return processFact(index + 1);
    }

    if (!isInformativeTextProfileFact(canonicalFact)) {
      warnings.push(`Dropped non-informative profile fact: ${fact.fact_key}.`);
      return processFact(index + 1);
    }

    if (canonicalFact.fact_key !== "neighborhoods") {
      validatedFacts.push(canonicalFact);
      return processFact(index + 1);
    }

    const validation = await validateSanFranciscoNeighborhoods(
      supabase,
      textFactValueToStrings(canonicalFact.value),
    );
    rejectedNeighborhoods.push(...validation.rejected);

    if (validation.accepted.length === 0) {
      warnings.push(
        "Dropped neighborhood fact because no real San Francisco neighborhoods were verified.",
      );
      return processFact(index + 1);
    }

    validatedFacts.push({
      ...canonicalFact,
      evidence: canonicalFact.evidence || validation.accepted.join(", "),
      value: validation.accepted,
    });

    if (validation.rejected.length > 0) {
      warnings.push(
        `Dropped unverified neighborhood values: ${validation.rejected.slice(0, 6).join(", ")}.`,
      );
    }
    return processFact(index + 1);
  };

  await processFact(0);

  const housingListNormalization =
    normalizeHousingPreferenceListFacts(validatedFacts);
  warnings.push(...housingListNormalization.warnings);

  const rejected = dedupeStrings(rejectedNeighborhoods).slice(0, 6);

  return {
    facts: housingListNormalization.facts,
    notice:
      rejected.length > 0 && validatedFacts.length > 0
        ? `I could not verify ${formatQuotedList(rejected)} as San Francisco neighborhoods, so I left ${rejected.length === 1 ? "it" : "them"} out.`
        : undefined,
    reply:
      rejected.length > 0 && validatedFacts.length === 0
        ? `I could not verify ${formatQuotedList(rejected)} as San Francisco neighborhoods. Which SF neighborhoods should I use instead?`
        : undefined,
    warnings,
  };
}

export function textFactValueToStrings(value: TextProfileFact["value"]): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(textFactValueToStrings);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) =>
      entry === null ? [] : textFactValueToStrings(entry),
    );
  }

  return [String(value)];
}

export function isInformativeTextProfileFact(fact: TextProfileFact) {
  const valueStrings = textFactValueToStrings(fact.value).flatMap((value) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? [normalized] : [];
  });

  if (valueStrings.length === 0) {
    return false;
  }

  const text = `${fact.evidence} ${valueStrings.join(" ")}`.toLowerCase();
  const nonInformativePatterns = [
    /\bunknown\b/,
    /\bnot\s+(?:stated|specified|provided|known|clear|available)\b/,
    /\bno\s+(?:reliable|explicit|direct|clear)\s+evidence\b/,
    /\bdoes\s+not\s+reliably\s+establish\b/,
    /\bavailable\s+context\s+does\s+not\b/,
    /\binsufficient\s+(?:evidence|information|context)\b/,
    /\bunclear\b/,
  ];

  return !nonInformativePatterns.some((pattern) => pattern.test(text));
}

function normalizeTextProfileFactForStorage(
  fact: TextProfileFact,
): TextProfileFact {
  if (
    fact.fact_key === "household_size" &&
    typeof fact.value === "string" &&
    isOpenEndedRoommateFlexibilityValue(fact.value)
  ) {
    return { ...fact, fact_key: "group_size_flexibility" };
  }

  if (fact.fact_key !== "rent_tradeoff" || typeof fact.value !== "string") {
    return fact;
  }

  const normalized = fact.value.trim().toLowerCase();
  const humanReadableValue =
    normalizedRentTradeoffValues[normalized] ?? fact.value;

  return humanReadableValue === fact.value
    ? fact
    : { ...fact, value: humanReadableValue };
}

function isOpenEndedRoommateFlexibilityValue(value: string) {
  return (
    /\b(?:open|yes|yeah|yep|sure|flexible|roommates?|shared)\b/i.test(value) &&
    !/\b(?:solo|alone|no roommates?|not open|without roommates?)\b/i.test(value) &&
    !/\b[1-8]\b/.test(value)
  );
}

const normalizedRentTradeoffValues: Record<string, string> = {
  higher_rent_for_fit_location: "higher rent for fit/location",
  higher_rent_for_location_fit: "higher rent for fit/location",
  prioritize_fit_and_location: "higher rent for fit/location",
  smaller_room_for_price: "smaller room for price",
};

export function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cleaned);
  }

  return out;
}

function formatQuotedList(values: string[]) {
  return values
    .map((value) => `"${value}"`)
    .join(values.length === 2 ? " or " : ", ");
}

export function readTextAgentDraftState(
  summary: TableRow<"text_thread_summaries"> | null,
): TextAgentDraftState {
  const summaryJson = jsonObjectOrEmpty(summary?.summary_json ?? null);
  if (
    summaryJson.intake_complete === true &&
    summaryJson.last_reply_kind !== "unsupported"
  ) {
    return { facts: [], skippedSteps: [] };
  }

  const preferences = jsonObjectOrEmpty(
    summary?.known_preferences_json ?? null,
  );
  const rawFacts = Array.isArray(preferences.facts) ? preferences.facts : [];
  const rawSkipped = Array.isArray(preferences.skipped_steps)
    ? preferences.skipped_steps
    : [];

  return {
    facts: rawFacts.flatMap((value) => {
      const fact = readTextProfileFactFromJson(value);
      return fact ? [fact] : [];
    }),
    skippedSteps: rawSkipped.filter(
      (value): value is TextAgentIntakeStep =>
        typeof value === "string" && isTextAgentIntakeStep(value),
    ),
  };
}

export function readLastSentCardsFromSummary(
  summary: TableRow<"text_thread_summaries"> | null,
): TextAgentLastSentCard[] {
  const summaryJson = jsonObjectOrEmpty(summary?.summary_json ?? null);
  const conversationState = jsonObjectOrEmpty(
    summaryJson.conversation_state ?? null,
  );
  const rawCards = Array.isArray(conversationState.last_sent_cards)
    ? conversationState.last_sent_cards
    : Array.isArray(summaryJson.last_sent_cards)
      ? summaryJson.last_sent_cards
      : [];

  return rawCards
    .map(readTextAgentLastSentCardFromJson)
    .filter((card): card is TextAgentLastSentCard => card !== null)
    .slice(0, 10);
}

function readTextAgentLastSentCardFromJson(value: Json): TextAgentLastSentCard | null {
  const raw = jsonObjectOrEmpty(value);
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!id || !["apartment", "profile", "roommate"].includes(type)) {
    return null;
  }
  const cardType = type as TextAgentLastSentCard["type"];

  return {
    id,
    reactionState:
      typeof raw.reactionState === "string"
        ? raw.reactionState
        : typeof raw.reaction_state === "string"
          ? raw.reaction_state
          : null,
    score:
      typeof raw.score === "number" && Number.isFinite(raw.score)
        ? raw.score
        : null,
    sendReason:
      typeof raw.sendReason === "string"
        ? raw.sendReason
        : typeof raw.send_reason === "string"
          ? raw.send_reason
          : "",
    type: cardType,
  };
}

export function readNextIntakeStepFromSummary(
  summary: TableRow<"text_thread_summaries"> | null,
) {
  const summaryJson = jsonObjectOrEmpty(summary?.summary_json ?? null);
  const value = summaryJson.next_intake_step;
  return typeof value === "string" && isTextAgentIntakeStep(value)
    ? value
    : null;
}

function readTextProfileFactFromJson(value: Json): TextProfileFact | null {
  const raw = jsonObjectOrEmpty(value);
  const factValue = readTextProfileFactValue(raw.value);
  const factKey = typeof raw.fact_key === "string" ? raw.fact_key : "";
  const dimension = typeof raw.dimension === "string" ? raw.dimension : "";

  if (!factKey || !dimension || factValue === null) {
    return null;
  }

  const fact: TextProfileFact = {
    assertion_type: raw.assertion_type === "inferred" ? "inferred" : "explicit",
    confidence: readBoundedNumber(raw.confidence, 0.75),
    dimension,
    evidence: typeof raw.evidence === "string" ? raw.evidence : "",
    fact_key: factKey,
    importance: readBoundedNumber(raw.importance, 0.5),
    sensitivity_level: readSensitivityLevel(raw.sensitivity_level),
    value: factValue,
  };

  if (typeof raw.matching_eligible === "boolean") {
    fact.matching_eligible = raw.matching_eligible;
  }

  return fact;
}

export function readTextProfileFactValue(value: Json | undefined) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const strings = value.filter(
      (entry): entry is string => typeof entry === "string",
    );
    return strings.length > 0 ? strings : null;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const objectValue: Record<string, string | number | boolean | null> = {};

    for (const [key, entry] of entries) {
      if (
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
      ) {
        objectValue[key] = entry;
      }
    }

    return Object.keys(objectValue).length > 0 ? objectValue : null;
  }

  return null;
}

export function serializeTextProfileFact(fact: TextProfileFact) {
  return {
    assertion_type: fact.assertion_type,
    confidence: fact.confidence,
    dimension: fact.dimension,
    evidence: fact.evidence,
    fact_key: fact.fact_key,
    importance: fact.importance,
    matching_eligible: fact.matching_eligible ?? null,
    sensitivity_level: fact.sensitivity_level,
    value: fact.value,
  };
}

export function mergeTextAgentDraftFacts(
  draft: TextAgentDraftState,
  nextFacts: TextProfileFact[],
): TextAgentDraftState {
  let facts = [...draft.facts];
  const factsByKey = new Map(facts.map((fact) => [fact.fact_key, fact]));

  for (const nextFact of nextFacts) {
    const existing = factsByKey.get(nextFact.fact_key);
    const exclusiveFamily = exclusiveTextProfileFactFamily(nextFact.fact_key);

    if (exclusiveFamily) {
      const exclusiveKeys = new Set(exclusiveFamily);
      facts = facts.filter((fact) => !exclusiveKeys.has(fact.fact_key));
      for (const key of exclusiveKeys) {
        factsByKey.delete(key);
      }
      facts.push(nextFact);
      factsByKey.set(nextFact.fact_key, nextFact);
      continue;
    }

    if (existing && isAdditiveDraftFact(nextFact.fact_key)) {
      // Replace, never mutate: `existing` aliases objects the caller reuses
      // later in the same run (coverage facts, summary merges), and in-place
      // edits cross-contaminate those views.
      const merged = {
        ...existing,
        confidence: Math.max(existing.confidence, nextFact.confidence),
        evidence: nextFact.evidence || existing.evidence,
        importance: Math.max(existing.importance, nextFact.importance),
        matching_eligible:
          existing.matching_eligible ?? nextFact.matching_eligible,
        value: dedupeStrings([
          ...textFactValueToStrings(existing.value),
          ...textFactValueToStrings(nextFact.value),
        ]),
      };
      facts = facts.map((fact) => (fact === existing ? merged : fact));
      factsByKey.set(merged.fact_key, merged);
      continue;
    }

    if (
      existing &&
      isAutoPersistableTextFact(existing) &&
      !isAutoPersistableTextFact(nextFact)
    ) {
      continue;
    }

    facts = facts.filter((fact) => fact.fact_key !== nextFact.fact_key);
    facts.push(nextFact);
    factsByKey.set(nextFact.fact_key, nextFact);
  }

  return {
    facts: normalizeHousingPreferenceListFacts(facts).facts,
    skippedSteps: draft.skippedSteps,
  };
}

export function markCurrentIntakeStepHandledByExtractedFacts(
  draft: TextAgentDraftState,
  currentStep: TextAgentIntakeStep,
  extractedFacts: TextProfileFact[],
): TextAgentDraftState {
  if (textProfileFactsCoverStep(extractedFacts, currentStep)) {
    return draft;
  }

  if (!textProfileFactsAdvanceStep(extractedFacts, currentStep)) {
    return draft;
  }

  // Paired housing-list prompts can be answered with the other semantic key
  // (for example, a must-have while the active prompt asks about dealbreakers).
  // Treat that as progress so we do not ask the same slot again.
  return {
    facts: draft.facts,
    skippedSteps: [...new Set([...draft.skippedSteps, currentStep])],
  };
}

function nextTextAgentIntakeStepFromDraft(
  draft: TextAgentDraftState,
  prioritizedSteps: TextAgentIntakeStep[] = textAgentIntakeSteps,
) {
  const skipped = new Set(draft.skippedSteps);
  return (
    prioritizedSteps.find(
      (step) =>
        !skipped.has(step) && !textProfileFactsCoverStep(draft.facts, step),
    ) ?? null
  );
}

export function nextTextAgentIntakeStepFromDraftWithCoverage(
  draft: TextAgentDraftState,
  profileCoverageFacts: TextProfileFact[] = [],
  enrichmentHintSteps?: TextAgentIntakeStep[],
) {
  return nextTextAgentIntakeStepFromDraft(
    {
      facts: [...profileCoverageFacts, ...draft.facts],
      skippedSteps: draft.skippedSteps,
    },
    enrichmentHintSteps?.length ? enrichmentHintSteps : textAgentIntakeSteps,
  );
}

function textProfileFactsCoverStep(
  facts: TextProfileFact[],
  step: TextAgentIntakeStep,
) {
  if (step === "age_comfort") {
    return textProfileFactsCoverAgeComfortStep(facts);
  }

  const keys = new Set<string>(
    factKeysForTextAgentIntakeStep(step).map(resolveCanonicalFactKey),
  );

  return facts.some(
    (fact) =>
      keys.has(resolveCanonicalFactKey(fact.fact_key)) &&
      isInformativeTextProfileFact(fact),
  );
}

function textProfileFactsAdvanceStep(
  facts: TextProfileFact[],
  step: TextAgentIntakeStep,
) {
  const keys = new Set<string>(
    factKeysForTextAgentExtractionStep(step).map(resolveCanonicalFactKey),
  );

  return facts.some(
    (fact) =>
      keys.has(resolveCanonicalFactKey(fact.fact_key)) &&
      isInformativeTextProfileFact(fact),
  );
}

export function buildIntakeControlResult(
  body: string,
  currentStep?: TextAgentIntakeStep | null,
): IntakeControlResult | null {
  const cleaned = body.trim().replace(/\s+/g, " ");

  if (!cleaned) {
    return null;
  }

  if (isTextAgentSkipReply(cleaned, currentStep)) {
    return {
      facts: [],
      replyPrefix: "No problem, I'll skip that for now.",
      skipped: true,
    };
  }

  return null;
}

export function makeProfileActionFact({
  body,
  factKey,
  value,
}: {
  body: string;
  factKey: string;
  value: TextProfileFact["value"];
}): TextProfileFact {
  return {
    assertion_type: "explicit",
    confidence: 0.9,
    dimension: "feasibility",
    evidence: body,
    fact_key: factKey,
    importance: 0.98,
    matching_eligible: true,
    sensitivity_level: "standard",
    value,
  };
}

export function formatNaturalList(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function isAdditiveDraftFact(factKey: string) {
  return [
    "dealbreakers",
    "interests",
    "media_taste",
    "music_taste",
    "must_haves",
    "mutuals",
    "neighborhoods",
    "references",
    "shared_communities",
  ].includes(factKey);
}

export function isTextAgentSkipReply(
  body: string,
  currentStep?: TextAgentIntakeStep | null,
) {
  if (currentStep === "roommates" && isShortRoommateAnswer(body)) {
    return false;
  }

  return /^(skip(?:\s+(?:that|this|the)\s+question)?(?:\s+for\s+now)?|pass|not sure|unsure|no preference|no prefs|none|neither|no|nope|no must haves?|no i do not need either|no i don't need either|no i dont need either|do not need either|don't need either|dont need either)$/i.test(
    body.trim().replace(/[.!?]+$/g, ""),
  );
}

function isShortRoommateAnswer(body: string) {
  return /^(?:yes|y|yeah|yep|sure|no|nope|nah|none|neither)$/i.test(
    body.trim().replace(/[.!?]+$/g, ""),
  );
}

function isTextAgentIntakeStep(value: string): value is TextAgentIntakeStep {
  return textAgentIntakeSteps.includes(value as TextAgentIntakeStep);
}

function readBoundedNumber(value: Json | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function readSensitivityLevel(
  value: Json | undefined,
): TextProfileFact["sensitivity_level"] {
  return value === "sensitive" ||
    value === "protected" ||
    value === "high_risk" ||
    value === "standard"
    ? value
    : "standard";
}

export async function loadRecentTextMessages(
  supabase: SupabaseServiceClient,
  threadId: string,
  userId: string,
) {
  const result = await supabase
    .from("text_messages")
    .select("body,direction,received_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("received_at", { ascending: false })
    .limit(16);

  if (result.error) {
    throw result.error;
  }

  return (result.data ?? []).reverse().map((row) => ({
    body: row.body,
    direction: row.direction,
    receivedAt: row.received_at,
  }));
}
