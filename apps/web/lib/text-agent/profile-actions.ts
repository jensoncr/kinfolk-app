import "server-only";
import { resolveCanonicalFactKey } from "@/lib/profiles/enrichment";
import { summarizeTextProfileFacts } from "@/lib/text-agent";
import { dedupeStrings, formatNaturalList, isAdditiveDraftFact, makeProfileActionFact, readTextProfileFactValue, textFactValueToStrings, validateTextProfileFacts } from "@/lib/text-agent/fact-utils";
import { readNumberField } from "@/lib/text-agent/reply-format";
import { formatCurrency } from "@/lib/text-agent/store-shared";
import type { TextProfileFact } from "@/lib/text-agent";
import type { TextAgentProfileAction } from "@/lib/text-agent/extraction";
import type { ProfileActionToolPlan, SupabaseServiceClient } from "@/lib/text-agent/store-types";
import type { Json } from "@/lib/supabase/types";

export async function buildProfileActionToolPlan(
  supabase: SupabaseServiceClient,
  {
    action,
    body,
    userId,
  }: { action: TextAgentProfileAction; body: string; userId: string },
): Promise<ProfileActionToolPlan> {
  const revokeKeys = profileActionRevokeKeys(action);

  if (action.action === "clear_budget_bound") {
    const target = action.bound;
    if (!target) {
      return {
        clarifyingReply:
          "I can edit your budget, but I need to know whether to remove the minimum or the max.",
        facts: [],
        revokeKeys,
        summary: "budget edit needs a bound",
      };
    }

    const preservedBound = target === "min" ? "max" : "min";
    const preservedValue = readBudgetBoundFromFacts(
      await loadActiveProfileFactsByKeys(supabase, userId, [
        "budget",
        "budget_preferred_max",
        "budget_min",
        "budget_max",
      ]),
      preservedBound,
    );

    if (preservedValue == null) {
      return {
        clarifyingReply:
          target === "min"
            ? "I can remove the minimum, but I do not have a saved max budget to keep. What max should Kinfolk use?"
            : "I can remove the max, but I do not have a saved minimum budget to keep. What minimum should Kinfolk use?",
        facts: [],
        revokeKeys,
        summary: "budget edit needs the remaining bound",
      };
    }

    const fact =
      target === "min"
        ? makeProfileActionFact({
            body,
            factKey: "budget_max",
            value: preservedValue,
          })
        : makeProfileActionFact({
            body,
            factKey: "budget_min",
            value: preservedValue,
          });
    return {
      facts: [fact],
      revokeKeys,
      summary:
        target === "min"
          ? `minimum budget removed; budget is now up to ${formatCurrency(
              preservedValue,
            )}/month`
          : `max budget removed; budget is now from ${formatCurrency(
              preservedValue,
            )}/month`,
    };
  }

  if (action.action === "merge_profile_facts") {
    return buildMergeProfileActionToolPlan(supabase, {
      action,
      userId,
    });
  }

  if (action.action === "clear_profile_slot") {
    return {
      facts: [],
      revokeKeys,
      summary:
        action.userFacingSummary ||
        `${profileActionSlotLabel(action.slot)} cleared`,
    };
  }

  if (action.facts.length === 0) {
    return {
      clarifyingReply:
        action.action === "replace_profile_facts"
          ? `I can update ${profileActionSlotLabel(
              action.slot,
            )}, but I need the replacement value to save.`
          : "I can update your profile, but I need the value to save.",
      facts: [],
      revokeKeys: [],
      summary: "profile edit needs replacement facts",
    };
  }

  const validation = await validateTextProfileFacts(supabase, action.facts);
  if (action.facts.length > 0 && validation.facts.length === 0) {
    return {
      clarifyingReply:
        validation.reply ||
        "I understood that you want to update your profile, but I need the replacement value. What should Kinfolk save?",
      facts: [],
      revokeKeys,
      summary: "profile edit needs replacement facts",
    };
  }

  const facts = await preserveUngroundedAdditiveReplacementValues(supabase, {
    action,
    body,
    facts: validation.facts,
    userId,
  });

  return {
    facts,
    revokeKeys,
    summary:
      action.userFacingSummary ||
      summarizeTextProfileFacts(facts) ||
      "profile updated",
  };
}

async function preserveUngroundedAdditiveReplacementValues(
  supabase: SupabaseServiceClient,
  {
    action,
    body,
    facts,
    userId,
  }: {
    action: TextAgentProfileAction;
    body: string;
    facts: TextProfileFact[];
    userId: string;
  },
) {
  if (action.action !== "replace_profile_facts" || facts.length === 0) {
    return facts;
  }

  const additiveKeys = [
    ...new Set(
      facts.flatMap((fact) => {
        const key = resolveCanonicalFactKey(fact.fact_key);
        return isAdditiveDraftFact(key) ? [key] : [];
      }),
    ),
  ];
  if (additiveKeys.length === 0) {
    return facts;
  }

  const existingFacts = await loadActiveProfileFactsByKeys(
    supabase,
    userId,
    additiveKeys,
  );
  const existingValuesByKey = new Map<string, string[]>();
  for (const fact of existingFacts) {
    const key = resolveCanonicalFactKey(fact.fact_key);
    existingValuesByKey.set(key, [
      ...(existingValuesByKey.get(key) ?? []),
      ...textFactValueToStrings(fact.value),
    ]);
  }

  return facts.map((fact) => {
    const key = resolveCanonicalFactKey(fact.fact_key);
    if (!additiveKeys.includes(key)) {
      return fact;
    }

    const replacementValues = dedupeStrings(textFactValueToStrings(fact.value));
    const existingValues = dedupeStrings(existingValuesByKey.get(key) ?? []);
    if (
      replacementValues.length === 0 ||
      existingValues.length === 0 ||
      bodyRequestsExactAdditiveReplacement(body, replacementValues)
    ) {
      return fact;
    }

    const replacementKeys = new Set(
      replacementValues.map(normalizeProfileActionValueText),
    );
    const groundingText = [body, action.userFacingSummary, fact.evidence].join(" ");
    const preservedValues = existingValues.filter((value) => {
      const normalized = normalizeProfileActionValueText(value);
      return (
        normalized &&
        !replacementKeys.has(normalized) &&
        !profileActionTextMentionsValue(groundingText, value)
      );
    });

    if (preservedValues.length === 0) {
      return fact;
    }

    return {
      ...fact,
      value: dedupeStrings([...replacementValues, ...preservedValues]),
    };
  });
}

function bodyRequestsExactAdditiveReplacement(
  body: string,
  replacementValues: string[],
) {
  const normalizedBody = normalizeProfileActionValueText(body);
  if (!/\b(?:only|instead|replace|set|switch|change)\b/.test(normalizedBody)) {
    return false;
  }

  return replacementValues.some((value) =>
    profileActionTextMentionsValue(body, value),
  );
}

function profileActionTextMentionsValue(text: string, value: string) {
  const normalizedText = normalizeProfileActionValueText(text);
  const normalizedValue = normalizeProfileActionValueText(value);
  return (
    Boolean(normalizedText && normalizedValue) &&
    ` ${normalizedText} `.includes(` ${normalizedValue} `)
  );
}

function normalizeProfileActionValueText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function buildMergeProfileActionToolPlan(
  supabase: SupabaseServiceClient,
  {
    action,
    userId,
  }: {
    action: TextAgentProfileAction;
    userId: string;
  },
): Promise<ProfileActionToolPlan> {
  const validation = await validateTextProfileFacts(supabase, action.facts);
  if (action.facts.length > 0 && validation.facts.length === 0) {
    return {
      clarifyingReply:
        validation.reply ||
        "I understood that you want to add something to your profile, but I need the value to save. What should Kinfolk add?",
      facts: [],
      revokeKeys: [],
      summary: "profile add needs facts",
    };
  }

  const mergeKeys = profileActionMergeKeys(action, validation.facts);
  if (mergeKeys.length === 0) {
    if (validation.facts.length > 0) {
      const revokeKeys = [
        ...new Set(
          validation.facts.map((fact) => resolveCanonicalFactKey(fact.fact_key)),
        ),
      ];
      return {
        facts: validation.facts,
        revokeKeys,
        summary:
          action.userFacingSummary ||
          summarizeTextProfileFacts(validation.facts) ||
          "profile updated",
      };
    }

    return {
      clarifyingReply:
        "I understood that you want to add something to your profile, but I need which profile field to update.",
      facts: [],
      revokeKeys: [],
      summary: "profile add needs a slot",
    };
  }

  const existingFacts = await loadActiveProfileFactsByKeys(
    supabase,
    userId,
    mergeKeys,
  );
  const existingValuesByKey = new Map<string, string[]>();
  for (const fact of existingFacts) {
    const key = resolveCanonicalFactKey(fact.fact_key);
    existingValuesByKey.set(key, [
      ...(existingValuesByKey.get(key) ?? []),
      ...textFactValueToStrings(fact.value),
    ]);
  }

  const mergedFacts = validation.facts.map((fact) => {
    const key = resolveCanonicalFactKey(fact.fact_key);
    if (!isAdditiveDraftFact(key)) {
      return fact;
    }

    return {
      ...fact,
      value: dedupeStrings([
        ...(existingValuesByKey.get(key) ?? []),
        ...textFactValueToStrings(fact.value),
      ]),
    };
  });

  return {
    facts: mergedFacts,
    revokeKeys: mergeKeys,
    summary:
      action.userFacingSummary ||
      summarizeTextProfileFacts(validation.facts) ||
      "profile updated",
  };
}

function profileActionMergeKeys(
  action: TextAgentProfileAction,
  facts: TextProfileFact[],
) {
  const factKeys = facts.map((fact) => resolveCanonicalFactKey(fact.fact_key));
  if (action.slot === "neighborhoods" || factKeys.includes("neighborhoods")) {
    return ["neighborhoods"];
  }
  if (action.slot === "home_preferences") {
    return ["must_haves", "dealbreakers"];
  }
  return [...new Set(factKeys.filter(isAdditiveDraftFact))];
}

function profileActionRevokeKeys(action: TextAgentProfileAction) {
  if (action.revokeFactKeys.length > 0) {
    return action.revokeFactKeys;
  }

  const factKeys = action.facts.map((fact) => fact.fact_key);
  if (
    factKeys.some((key) =>
      ["budget", "budget_preferred_max", "budget_min", "budget_max"].includes(
        key,
      ),
    )
  ) {
    return ["budget", "budget_preferred_max", "budget_min", "budget_max"];
  }
  if (factKeys.includes("move_in_window")) {
    return ["move_in_window"];
  }
  if (
    factKeys.some((key) =>
      ["household_size", "group_size_flexibility"].includes(key),
    )
  ) {
    return ["household_size", "group_size_flexibility"];
  }
  if (factKeys.includes("preferred_age_range")) {
    return ["preferred_age_range"];
  }
  if (factKeys.includes("age")) {
    return ["age"];
  }

  switch (action.slot) {
    case "budget":
      return ["budget", "budget_min", "budget_max"];
    case "move_in":
      return ["move_in_window"];
    case "household_size":
      return ["household_size", "group_size_flexibility"];
    case "neighborhoods":
      return ["neighborhoods"];
    case "home_preferences":
      return ["must_haves", "dealbreakers"];
    case "roommate_preferences":
      return action.facts.map((fact) => fact.fact_key);
    case "unknown":
    default:
      return action.facts.map((fact) => fact.fact_key);
  }
}

function profileActionSlotLabel(slot: TextAgentProfileAction["slot"]) {
  switch (slot) {
    case "budget":
      return "budget";
    case "move_in":
      return "move-in timing";
    case "household_size":
      return "roommate setup";
    case "neighborhoods":
      return "neighborhoods";
    case "home_preferences":
      return "home preferences";
    case "roommate_preferences":
      return "roommate preferences";
    case "unknown":
    default:
      return "profile detail";
  }
}

async function loadActiveProfileFactsByKeys(
  supabase: SupabaseServiceClient,
  userId: string,
  factKeys: string[],
) {
  const result = await supabase
    .from("profile_facts")
    .select(
      "assertion_type,confidence,dimension,evidence_excerpt,fact_key,importance,matching_eligible,sensitivity_level,value_json",
    )
    .eq("user_id", userId)
    .eq("matching_eligible", true)
    .in("fact_key", [...new Set(factKeys)])
    .in("user_review_state", ["pending", "approved", "edited"])
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (result.error) {
    throw result.error;
  }

  return (result.data ?? []).flatMap((row) => {
    const value = readTextProfileFactValue(row.value_json ?? undefined);
    if (value === null) {
      return [];
    }

    return [
      {
        assertion_type:
          row.assertion_type === "inferred" ? "inferred" : "explicit",
        confidence: row.confidence,
        dimension: row.dimension,
        evidence: row.evidence_excerpt ?? "",
        fact_key: row.fact_key,
        importance: row.importance,
        matching_eligible: row.matching_eligible ?? true,
        sensitivity_level:
          row.sensitivity_level === "standard" ||
          row.sensitivity_level === "sensitive" ||
          row.sensitivity_level === "protected" ||
          row.sensitivity_level === "high_risk"
            ? row.sensitivity_level
            : "standard",
        value,
      } satisfies TextProfileFact,
    ];
  });
}

function readBudgetBoundFromFacts(
  facts: TextProfileFact[],
  bound: "max" | "min",
) {
  for (const fact of facts) {
    if (
      fact.fact_key === `budget_${bound}` &&
      typeof fact.value === "number" &&
      Number.isFinite(fact.value)
    ) {
      return fact.value;
    }

    if (
      fact.fact_key !== "budget" ||
      !fact.value ||
      typeof fact.value !== "object" ||
      Array.isArray(fact.value)
    ) {
      continue;
    }

    const value = readNumberField(fact.value, bound);
    if (value != null) {
      return value;
    }
  }

  return null;
}

export function formatProfileActionSummaries(values: string[]) {
  const summaries = values.flatMap((value) => {
    const summary = value.replace(/[.]+$/g, "").trim();
    return summary ? [summary] : [];
  });
  if (summaries.length <= 1) {
    return summaries[0] ?? "profile updated";
  }
  return formatNaturalList(summaries);
}

export function textProfileFactToImportFact(fact: TextProfileFact): Record<string, Json> {
  return {
    assertion_type: fact.assertion_type,
    confidence: fact.confidence,
    dimension: fact.dimension,
    evidence: fact.evidence,
    fact_key: fact.fact_key,
    importance: fact.importance,
    matching_eligible: fact.matching_eligible ?? null,
    sensitivity_level: fact.sensitivity_level,
    value: fact.value as Json,
  };
}
