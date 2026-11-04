import "server-only";
import { STRUCTURED_FACT_KEYS, structuredFactOptions } from "../profiles/fact-normalization";
import { classifyTextSensitivity } from "@/lib/text-agent";
import { dimensionHintForFactKey } from "@/lib/text-agent/fact-dimensions";
import { z } from "zod";
import type { TextProfileFact } from "@/lib/text-agent";
import type { TextAgentGenerationResult, TextAgentProfileAction } from "@/lib/text-agent/extraction";

export const preferredValuePhrasings = Object.fromEntries(
  STRUCTURED_FACT_KEYS.map((factKey) => [factKey, structuredFactOptions(factKey)]),
);

const rawFactValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

const modelScoreSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  const parsed = Number(normalized);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  if (/^((very\s+)?high|strong|certain)$/.test(normalized)) {
    return 0.85;
  }

  if (/^(medium|moderate|normal|some)$/.test(normalized)) {
    return 0.6;
  }

  if (/^(low|weak|uncertain)$/.test(normalized)) {
    return 0.35;
  }

  return value;
}, z.number().min(0).max(1));

function coerceModelFactInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const fact = value as Record<string, unknown>;
  const factKey =
    firstStringValue(
      fact.fact_key,
      fact.factKey,
      fact.key,
      fact.name,
      fact.field,
      fact.attribute,
    ) ?? "";
  const aliasedValue = firstDefinedValue(
    fact.value,
    fact.fact_value,
    fact.factValue,
    fact.raw_value,
    fact.rawValue,
    fact.normalized_value,
    fact.normalizedValue,
    fact.value_json,
    fact.valueJson,
    fact.values,
    fact.answer,
    fact.content,
    fact.text,
    fact.data,
    fact.details,
  );

  return {
    ...fact,
    assertion_type: normalizeModelAssertionType(fact.assertion_type),
    dimension:
      firstStringValue(
        fact.dimension,
        fact.category,
        fact.section,
        fact.type,
        fact.kind,
      ) ?? (factKey ? dimensionHintForFactKey(factKey) : "feasibility"),
    fact_key: factKey || fact.fact_key,
    value:
      aliasedValue !== undefined
        ? aliasedValue
        : inferMissingModelFactValue(factKey, fact),
    sensitivity_level: normalizeModelSensitivityLevel(fact.sensitivity_level),
  };
}

function coerceProfileActionInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const action = value as Record<string, unknown>;
  const actionName = firstStringValue(
    action.action,
    action.tool,
    action.kind,
    action.type,
  );
  const slot = firstStringValue(
    action.slot,
    action.field,
    action.profile_slot,
    action.profileSlot,
  );
  const bound = firstStringValue(
    action.bound,
    action.target,
    action.budget_bound,
    action.budgetBound,
  );
  const facts = firstDefinedValue(
    action.facts,
    action.profile_facts,
    action.profileFacts,
    action.replacement_facts,
    action.replacementFacts,
  );
  const revokeFactKeys = firstDefinedValue(
    action.revoke_fact_keys,
    action.revokeFactKeys,
    action.revoke_keys,
    action.revokeKeys,
    action.fact_keys,
    action.factKeys,
  );
  const userFacingSummary = firstStringValue(
    action.user_facing_summary,
    action.userFacingSummary,
    action.summary,
    action.label,
  );

  return {
    ...action,
    action: normalizeProfileActionName(actionName),
    bound: normalizeProfileActionBound(bound),
    facts: coerceModelFactList(facts),
    revoke_fact_keys: coerceStringList(revokeFactKeys),
    slot: normalizeProfileActionSlot(slot),
    user_facing_summary: userFacingSummary ?? action.user_facing_summary,
  };
}

function normalizeProfileActionName(value: string | null) {
  const normalized = normalizeFactKey(value ?? "");
  if (
    normalized === "clear_budget_bound" ||
    normalized === "remove_budget_bound" ||
    normalized === "clear_budget_min" ||
    normalized === "clear_budget_max"
  ) {
    return "clear_budget_bound";
  }
  if (
    normalized === "merge_profile_facts" ||
    normalized === "add_profile_facts" ||
    normalized === "append_profile_facts" ||
    normalized === "add" ||
    normalized === "append" ||
    normalized === "merge" ||
    normalized === "save"
  ) {
    return "merge_profile_facts";
  }
  if (
    normalized === "clear_profile_slot" ||
    normalized === "delete_profile_slot" ||
    normalized === "remove_profile_slot" ||
    normalized === "clear"
  ) {
    return "clear_profile_slot";
  }
  return "replace_profile_facts";
}

function normalizeProfileActionBound(value: string | null) {
  const normalized = normalizeFactKey(value ?? "");
  if (
    normalized === "min" ||
    normalized === "minimum" ||
    normalized === "floor" ||
    normalized === "lower_bound"
  ) {
    return "min";
  }
  if (
    normalized === "max" ||
    normalized === "maximum" ||
    normalized === "cap" ||
    normalized === "ceiling" ||
    normalized === "upper_bound"
  ) {
    return "max";
  }
  return null;
}

function normalizeProfileActionSlot(value: string | null) {
  const normalized = normalizeFactKey(value ?? "");
  if (
    normalized === "budget" ||
    normalized === "rent" ||
    normalized === "price"
  ) {
    return "budget";
  }
  if (normalized === "move_in" || normalized === "move_in_window") {
    return "move_in";
  }
  if (
    normalized === "household_size" ||
    normalized === "roommates" ||
    normalized === "roommate_setup"
  ) {
    return "household_size";
  }
  if (normalized === "neighborhoods" || normalized === "areas") {
    return "neighborhoods";
  }
  if (
    normalized === "home_preferences" ||
    normalized === "must_haves" ||
    normalized === "dealbreakers"
  ) {
    return "home_preferences";
  }
  if (normalized === "roommate_preferences") {
    return "roommate_preferences";
  }
  return "unknown";
}

function coerceStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function firstStringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function firstDefinedValue(...values: unknown[]) {
  return values.find((value) => value !== undefined);
}

function normalizeModelAssertionType(value: unknown) {
  const normalized = typeof value === "string" ? normalizeFactKey(value) : "";
  if (normalized === "inferred" || normalized === "implicit" || normalized === "implied") {
    return "inferred";
  }
  if (
    normalized === "explicit" ||
    normalized === "stated" ||
    normalized === "stated_preference" ||
    normalized === "direct" ||
    normalized === "inclusion" ||
    normalized === "exclusion" ||
    normalized === "preference" ||
    normalized === "range" ||
    normalized === "requirement" ||
    normalized === "constraint"
  ) {
    return "explicit";
  }
  return value;
}

function normalizeModelSensitivityLevel(value: unknown) {
  const normalized = typeof value === "string" ? normalizeFactKey(value) : "";
  if (
    normalized === "low" ||
    normalized === "normal" ||
    normalized === "standard" ||
    normalized === "safe" ||
    normalized === "public" ||
    normalized === "private"
  ) {
    return "standard";
  }
  if (normalized === "medium" || normalized === "moderate" || normalized === "sensitive") {
    return "sensitive";
  }
  if (normalized === "protected" || normalized === "protected_attribute") {
    return "protected";
  }
  if (
    normalized === "high" ||
    normalized === "risk" ||
    normalized === "high_risk" ||
    normalized === "unsafe"
  ) {
    return "high_risk";
  }
  return value;
}

function inferMissingModelFactValue(
  factKey: string,
  fact: Record<string, unknown>,
) {
  const normalizedFactKey = normalizeFactKey(factKey);

  if (normalizedFactKey === "budget") {
    const min = readLooseNumber(fact.min ?? fact.budget_min ?? fact.floor);
    const max = readLooseNumber(fact.max ?? fact.budget_max ?? fact.cap);
    if (min !== null || max !== null) {
      return Object.fromEntries(
        [
          ["min", min],
          ["max", max],
        ].filter(([, value]) => value !== null),
      );
    }
  }

  if (normalizedFactKey === "budget_preferred_max") {
    return readLooseNumber(
      fact.preferred_max ??
        fact.preferredMax ??
        fact.target ??
        fact.target_max ??
        fact.targetMax ??
        fact.max ??
        fact.cap,
    );
  }

  if (normalizedFactKey === "move_in_window") {
    const start = firstStringValue(fact.start, fact.move_in_start);
    const end = firstStringValue(fact.end, fact.move_in_end);
    if (start || end) {
      return Object.fromEntries(
        [
          ["start", start],
          ["end", end],
        ].filter(([, value]) => value),
      );
    }
  }

  if (
    normalizedFactKey === "neighborhoods" ||
    normalizedFactKey === "dealbreakers" ||
    normalizedFactKey === "must_haves"
  ) {
    return firstDefinedValue(
      fact.neighborhoods,
      fact.names,
      fact.items,
      fact.list,
    );
  }

  return "";
}

function readLooseNumber(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

const modelFactSchema = z
  .preprocess((value) => coerceModelFactInput(value), z
  .object({
    dimension: z.string().min(1).max(80).optional().default("feasibility"),
    fact_key: z.string().min(1).max(80),
    value: rawFactValueSchema.optional().default(""),
    assertion_type: z.enum(["explicit", "inferred"]).optional().default("explicit"),
    confidence: modelScoreSchema.optional().default(0.7),
    importance: modelScoreSchema.optional().default(0.5),
    evidence: z.string().max(260).optional().default(""),
    sensitivity_level: z.enum([
      "standard",
      "sensitive",
      "protected",
      "high_risk",
    ]).optional().default("standard"),
    matching_eligible: z.boolean().optional().default(false),
  })
  .passthrough());

const profileActionSchema = z
  .preprocess((value) => coerceProfileActionInput(value), z
  .object({
    action: z
      .enum([
        "replace_profile_facts",
        "merge_profile_facts",
        "clear_profile_slot",
        "clear_budget_bound",
      ])
      .optional()
      .default("replace_profile_facts"),
    bound: z.enum(["max", "min"]).nullable().optional().default(null),
    confidence: modelScoreSchema.optional().default(0.7),
    facts: z.array(modelFactSchema).max(12).optional().default([]),
    revoke_fact_keys: z.array(z.string().max(80)).max(16).optional().default([]),
    slot: z
      .enum([
        "budget",
        "move_in",
        "household_size",
        "neighborhoods",
        "home_preferences",
        "roommate_preferences",
        "unknown",
      ])
      .optional()
      .default("unknown"),
    user_facing_summary: z.string().max(220).optional().default(""),
  })
  .passthrough());

export const textAgentExtractionSchema = z
  .object({
    assistant_reply: z.string().max(500).optional().default(""),
    intent: z
      .enum(["profile_update", "clarification_needed", "unsupported"])
      .optional(),
    confidence: z.number().min(0).max(1).optional().default(0.5),
    reply_kind: z
      .enum(["confirmation", "clarification", "unsupported"])
      .optional(),
    clarifying_question: z.string().max(220).optional().default(""),
    facts: z.array(modelFactSchema).max(12).optional().default([]),
    profile_actions: z.array(profileActionSchema).max(4).optional().default([]),
    warnings: z.array(z.string().max(180)).max(6).optional().default([]),
    should_create_proposal: z.boolean().optional(),
  })
  .passthrough()
  .transform((extraction) => {
    const hasFacts = extraction.facts.length > 0;
    const hasProfileActions = extraction.profile_actions.length > 0;
    const replyKind =
      extraction.reply_kind ??
      (hasFacts || hasProfileActions
        ? "confirmation"
        : extraction.assistant_reply || extraction.clarifying_question
          ? "clarification"
          : "unsupported");
    const intent =
      (hasFacts || hasProfileActions) && extraction.intent !== "unsupported"
        ? "profile_update"
        : extraction.intent ??
          (replyKind === "clarification" ? "clarification_needed" : "unsupported");

    return {
      ...extraction,
      intent,
      reply_kind: replyKind,
      should_create_proposal:
        intent === "profile_update" && (hasFacts || hasProfileActions),
    };
  });

export function normalizeModelFact(
  fact: z.infer<typeof modelFactSchema>,
): TextProfileFact {
  const value = normalizeFactValue(fact.value);
  const dimension = normalizeModelDimension(fact.dimension, fact.fact_key);
  const evidence =
    fact.evidence.replace(/\s+/g, " ").trim() || stringifyFactValue(value);
  const policyLevel = classifyTextSensitivity(
    `${dimension} ${fact.fact_key} ${stringifyFactValue(value)} ${evidence}`,
  );
  const sensitivityLevel =
    sensitivityRank(policyLevel) > sensitivityRank(fact.sensitivity_level)
      ? policyLevel
      : fact.sensitivity_level;

  return {
    assertion_type: fact.assertion_type,
    confidence: clamp(fact.confidence),
    dimension,
    evidence: evidence.slice(0, 260),
    fact_key: normalizeFactKey(fact.fact_key),
    importance: clamp(fact.importance),
    matching_eligible:
      fact.matching_eligible &&
      sensitivityLevel === "standard" &&
      dimension !== "disallowed",
    sensitivity_level: sensitivityLevel,
    value,
  };
}

export function normalizeProfileAction(
  action: z.infer<typeof profileActionSchema>,
): TextAgentProfileAction {
  return {
    action: action.action,
    bound: action.bound ?? null,
    confidence: clamp(action.confidence),
    facts: action.facts.map(normalizeModelFact),
    revokeFactKeys: [
      ...new Set(
        action.revoke_fact_keys.flatMap((factKey) => {
          const normalized = normalizeFactKey(factKey);
          return normalized ? [normalized] : [];
        }),
      ),
    ],
    slot: action.slot,
    userFacingSummary: action.user_facing_summary.trim(),
  };
}

function normalizeModelDimension(dimension: string, factKey: string) {
  const normalized = normalizeFactKey(dimension);
  if (
    [
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
    ].includes(normalized)
  ) {
    return normalized;
  }

  return dimensionHintForFactKey(factKey);
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match?.[1]) {
      return JSON.parse(match[1]);
    }

    const objectSlice = extractFirstJsonObject(trimmed);
    if (objectSlice) {
      return JSON.parse(objectSlice);
    }

    throw new Error(
      `OpenRouter extraction returned invalid JSON. Preview: ${trimmed.slice(0, 300)}`,
    );
  }
}

export function parseTextAgentExtractionResult(result: TextAgentGenerationResult) {
  const candidate =
    result.object ??
    result.structuredOutput ??
    parseJsonContent(readModelTextResult(result));
  const parsed = textAgentExtractionSchema.safeParse(
    coerceExtractionCandidate(candidate),
  );

  if (parsed.success) {
    return parsed.data;
  }

  const schemaWarning = `schema_mismatch: ${parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
      .join("; ")}`;

  return textAgentExtractionSchema.parse({
    assistant_reply: "",
    confidence: 0.2,
    facts: [],
    intent: "unsupported",
    reply_kind: "unsupported",
    should_create_proposal: false,
    warnings: [schemaWarning.slice(0, 180)],
  });
}

function coerceExtractionCandidate(candidate: unknown) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }

  const record = candidate as Record<string, unknown>;
  const facts =
    firstDefinedValue(
      record.facts,
      record.profile_facts,
      record.profileFacts,
      record.extracted_facts,
      record.extractedFacts,
      record.updates,
      record.preferences,
    ) ?? record.facts;
  const profileActions =
    firstDefinedValue(
      record.profile_actions,
      record.profileActions,
      record.actions,
      record.profile_edits,
      record.profileEdits,
      record.tools,
    ) ?? record.profile_actions;

  return {
    ...record,
    facts: coerceModelFactList(facts),
    profile_actions: coerceProfileActionList(profileActions),
  };
}

function coerceProfileActionList(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return [value];
  }

  return [];
}

function coerceModelFactList(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, entry]) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? { fact_key: key, ...(entry as Record<string, unknown>) }
        : { fact_key: key, value: entry },
    );
  }

  return [];
}

function readModelTextResult(result: TextAgentGenerationResult) {
  const text =
    result.text?.trim() ||
    result.steps
      ?.map((step) => step.text ?? "")
      .join("")
      .trim();

  if (text) {
    return text;
  }

  throw new Error(
    `OpenRouter extraction returned empty text. finishReason=${String(
      result.finishReason,
    )}; steps=${result.steps?.length ?? 0}; warnings=${JSON.stringify(
      result.warnings ?? [],
    ).slice(0, 300)}`,
  );
}

function extractFirstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function readNumber(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

function normalizeFactKey(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

function stringifyFactValue(value: TextProfileFact["value"]) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function normalizeFactValue(
  value: z.infer<typeof rawFactValueSchema>,
): TextProfileFact["value"] {
  if (value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const normalized = item === null ? "" : String(item).trim();
      return normalized ? [normalized] : [];
    });
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        normalizeFactKey(key),
        normalizeObjectFactValue(entry),
      ]),
    );
  }

  return value;
}

function normalizeObjectFactValue(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return JSON.stringify(value);
}

function sensitivityRank(level: TextProfileFact["sensitivity_level"]) {
  switch (level) {
    case "standard":
      return 0;
    case "sensitive":
      return 1;
    case "protected":
      return 2;
    case "high_risk":
      return 3;
  }
}

function clamp(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}
