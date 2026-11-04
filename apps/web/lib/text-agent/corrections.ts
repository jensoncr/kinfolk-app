export type CorrectionProfileFact = {
  fact_key: string;
  value:
    | string
    | number
    | boolean
    | string[]
    | Record<string, string | number | boolean | null>;
};

export type CorrectionProfileAction = {
  action: "replace_profile_facts";
  bound: null;
  confidence: number;
  facts: CorrectionProfileFact[];
  revokeFactKeys: string[];
  slot:
    | "budget"
    | "move_in"
    | "household_size"
    | "neighborhoods"
    | "home_preferences"
    | "roommate_preferences"
    | "unknown";
  userFacingSummary: string;
};

const correctionPattern =
  /\b(?:sorry|i mean|meant|actually|correction|corrected|typo|my bad|instead|rather)\b/i;

export function isTextProfileCorrectionMessage(body: string) {
  return correctionPattern.test(body.trim());
}

export function exclusiveTextProfileFactFamily(factKey: string): string[] | null {
  const key = factKey.trim().toLowerCase();

  if (["budget", "budget_min", "budget_max"].includes(key)) {
    return ["budget", "budget_min", "budget_max"];
  }
  if (key === "move_in_window") {
    return ["move_in_window"];
  }
  if (["household_size", "group_size_flexibility"].includes(key)) {
    return ["household_size", "group_size_flexibility"];
  }
  if (key === "age") {
    return ["age"];
  }
  if (key === "preferred_age_range") {
    return ["preferred_age_range"];
  }

  return null;
}

function readAgeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const age = Math.round(value);
    return age >= 18 && age <= 100 ? age : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/\b(1[89]|[2-9]\d|100)\b/);
  if (!match) {
    return null;
  }

  return readAgeNumber(Number(match[1]));
}

export type PreferredAgeRangeValue = {
  min: number;
  max: number;
  strict: boolean;
};

export function looksLikePreferredAgeRangeValue(value: unknown) {
  if (typeof value === "string") {
    return /\d/.test(value) && /(?:-|–|to|through)/i.test(value);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.min != null ||
    record.max != null ||
    record.minimum != null ||
    record.maximum != null
  );
}

export function normalizePreferredAgeRangeValue(
  value: unknown,
): PreferredAgeRangeValue | null {
  if (typeof value === "string") {
    const parsed = parseAgeRangeString(value);
    if (!parsed || parsed.min > parsed.max) {
      return null;
    }

    return {
      min: parsed.min,
      max: parsed.max,
      strict: parsed.strict,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const min = readAgeNumber(
    record.min ?? record.minimum ?? record.preferred_age_min,
  );
  const max = readAgeNumber(
    record.max ?? record.maximum ?? record.preferred_age_max,
  );

  if (min == null || max == null) {
    return null;
  }

  if (min > max) {
    return null;
  }

  return {
    min,
    max,
    strict: readBooleanLike(record.strict ?? record.preferred_age_strict),
  };
}

export function normalizeTextProfileFactForCorrection<T extends CorrectionProfileFact>(
  fact: T,
): T | null {
  if (fact.fact_key === "preferred_age_range") {
    const normalized = normalizePreferredAgeRangeValue(fact.value);
    if (!normalized) {
      return null;
    }

    return {
      ...fact,
      value: {
        min: normalized.min,
        max: normalized.max,
        strict: normalized.strict,
      },
    };
  }

  if (fact.fact_key === "age") {
    const age = readAgeNumber(fact.value);
    if (age == null) {
      return null;
    }

    return {
      ...fact,
      value: age,
    };
  }

  return fact;
}

export function textProfileFactsCoverAgeComfortStep(facts: CorrectionProfileFact[]) {
  const rangeFacts = facts.filter((fact) => fact.fact_key === "preferred_age_range");
  const ageFacts = facts.filter((fact) => fact.fact_key === "age");

  if (
    rangeFacts.some(
      (fact) =>
        looksLikePreferredAgeRangeValue(fact.value) &&
        normalizePreferredAgeRangeValue(fact.value) === null,
    )
  ) {
    return false;
  }

  return (
    rangeFacts.some((fact) => normalizePreferredAgeRangeValue(fact.value) !== null) ||
    ageFacts.some((fact) => readAgeNumber(fact.value) !== null)
  );
}

function profileActionSlotForFactKey(
  factKey: string,
): CorrectionProfileAction["slot"] {
  switch (factKey) {
    case "budget":
    case "budget_preferred_max":
    case "budget_min":
    case "budget_max":
      return "budget";
    case "move_in_window":
      return "move_in";
    case "household_size":
    case "group_size_flexibility":
      return "household_size";
    case "neighborhoods":
      return "neighborhoods";
    case "must_haves":
    case "dealbreakers":
      return "home_preferences";
    case "age":
    case "preferred_age_range":
      return "roommate_preferences";
    default:
      return "unknown";
  }
}

export function buildCorrectionProfileActions(
  body: string,
  facts: CorrectionProfileFact[],
): CorrectionProfileAction[] {
  if (!isTextProfileCorrectionMessage(body) || facts.length === 0) {
    return [];
  }

  const slotEdits = new Map<
    string,
    {
      facts: CorrectionProfileFact[];
      revokeKeys: string[];
      slot: CorrectionProfileAction["slot"];
    }
  >();

  for (const fact of facts) {
    const family = correctionProfileFactFamily(fact.fact_key);
    if (!family) {
      continue;
    }

    const normalized = normalizeTextProfileFactForCorrection(fact);
    if (!normalized) {
      continue;
    }

    const key = family.join("|");
    const existing = slotEdits.get(key);
    if (existing) {
      existing.facts.push(normalized);
      continue;
    }

    slotEdits.set(key, {
      facts: [normalized],
      revokeKeys: correctionRevokeKeysForFamily(family),
      slot: profileActionSlotForFactKey(normalized.fact_key),
    });
  }

  return [...slotEdits.values()].map(({ facts: actionFacts, revokeKeys, slot }) => ({
    action: "replace_profile_facts" as const,
    bound: null,
    confidence: 0.95,
    facts: actionFacts,
    revokeFactKeys: revokeKeys,
    slot,
    userFacingSummary: buildCorrectionUserFacingSummary(actionFacts),
  }));
}

function correctionProfileFactFamily(factKey: string) {
  const key = factKey.trim().toLowerCase();
  if (key === "budget_preferred_max") {
    return ["budget", "budget_min", "budget_max"];
  }

  return exclusiveTextProfileFactFamily(factKey);
}

function correctionRevokeKeysForFamily(family: string[]) {
  return family.includes("budget") ||
    family.includes("budget_min") ||
    family.includes("budget_max")
    ? [...new Set([...family, "budget_preferred_max"])]
    : family;
}

export function buildCorrectionConfirmationReply(facts: CorrectionProfileFact[]) {
  const summaries = [...new Set(facts.flatMap((fact) => {
    const summary = buildCorrectionUserFacingSummary([fact]);
    return summary ? [summary] : [];
  }))];

  if (summaries.length === 0) {
    return null;
  }

  return `Updated your ${summaries.join(" and ")}.`;
}

function buildCorrectionUserFacingSummary(facts: CorrectionProfileFact[]) {
  const byKey = new Map(facts.map((fact) => [fact.fact_key, fact]));

  const ageRange = byKey.get("preferred_age_range");
  if (ageRange) {
    const normalized = normalizePreferredAgeRangeValue(ageRange.value);
    if (normalized) {
      return `roommate age range to ${normalized.min}-${normalized.max}`;
    }
  }

  const age = byKey.get("age");
  if (age) {
    const normalizedAge = readAgeNumber(age.value);
    if (normalizedAge != null) {
      return `age to ${normalizedAge}`;
    }
  }

  const budget = byKey.get("budget") ?? byKey.get("budget_max") ?? byKey.get("budget_min");
  if (budget) {
    return "budget";
  }
  if (byKey.has("budget_preferred_max")) {
    return "budget";
  }

  if (byKey.has("move_in_window")) {
    return "move-in timing";
  }

  if (byKey.has("household_size") || byKey.has("group_size_flexibility")) {
    return "roommate setup";
  }

  if (byKey.has("neighborhoods")) {
    return "neighborhoods";
  }

  return "profile detail";
}

function parseAgeRangeString(value: string) {
  const match = value.match(/\b(1[89]|[2-9]\d|100)\b\s*(?:-|–|to|through)\s*\b(1[89]|[2-9]\d|100)\b/i);
  if (!match) {
    return null;
  }

  return {
    min: Number(match[1]),
    max: Number(match[2]),
    strict: /\b(?:only|strict|hard|must)\b/i.test(value),
  };
}

function readBooleanLike(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return /\b(?:true|yes|strict|hard|must|only)\b/i.test(value);
  }

  return false;
}
