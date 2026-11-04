import type { ProfileEnrichmentFormValues } from "@/lib/profiles/enrichment-form";

export const ENRICHMENT_BUDGET_LOWER = 500;
export const ENRICHMENT_BUDGET_UPPER = 5000;
export const ENRICHMENT_BUDGET_GAP = 100;
export const ENRICHMENT_TAG_VALUE_MAX_LENGTH = 80;

export type EnrichmentTagFieldKey =
  | "dealbreakers"
  | "interests"
  | "mustHaves"
  | "neighborhoods";
export type EnrichmentTagDrafts = Record<EnrichmentTagFieldKey, string>;

type BudgetRangeValue = {
  budgetMax: number;
  budgetMin: number;
};

export const ENRICHMENT_TAG_FIELD_CAPS: Record<EnrichmentTagFieldKey, number> = {
  dealbreakers: 12,
  interests: 18,
  mustHaves: 12,
  neighborhoods: 12,
};

export function normalizeEnrichmentBudgetRange(
  budgetMin: unknown,
  budgetMax: unknown,
): BudgetRangeValue {
  let min = cleanBudgetValue(budgetMin, 1400);
  let max = cleanBudgetValue(budgetMax, 2600);

  if (min > max) {
    [min, max] = [max, min];
  }

  if (max - min >= ENRICHMENT_BUDGET_GAP) {
    return { budgetMin: min, budgetMax: max };
  }

  if (min <= ENRICHMENT_BUDGET_LOWER) {
    return {
      budgetMin: ENRICHMENT_BUDGET_LOWER,
      budgetMax: ENRICHMENT_BUDGET_LOWER + ENRICHMENT_BUDGET_GAP,
    };
  }

  if (max >= ENRICHMENT_BUDGET_UPPER) {
    return {
      budgetMin: ENRICHMENT_BUDGET_UPPER - ENRICHMENT_BUDGET_GAP,
      budgetMax: ENRICHMENT_BUDGET_UPPER,
    };
  }

  return {
    budgetMin: min,
    budgetMax: min + ENRICHMENT_BUDGET_GAP,
  };
}

export function resolveEnrichmentBudgetMinChange(
  nextMin: unknown,
  currentMax: unknown,
): BudgetRangeValue {
  const max = Math.max(
    cleanBudgetValue(currentMax, 2600),
    ENRICHMENT_BUDGET_LOWER + ENRICHMENT_BUDGET_GAP,
  );
  const min = Math.min(
    cleanBudgetValue(nextMin, ENRICHMENT_BUDGET_LOWER),
    max - ENRICHMENT_BUDGET_GAP,
  );

  return normalizeEnrichmentBudgetRange(min, max);
}

export function resolveEnrichmentBudgetMaxChange(
  currentMin: unknown,
  nextMax: unknown,
): BudgetRangeValue {
  const min = Math.min(
    cleanBudgetValue(currentMin, 1400),
    ENRICHMENT_BUDGET_UPPER - ENRICHMENT_BUDGET_GAP,
  );
  const max = Math.max(
    cleanBudgetValue(nextMax, 2600),
    min + ENRICHMENT_BUDGET_GAP,
  );

  return normalizeEnrichmentBudgetRange(min, max);
}

export function emptyEnrichmentTagDrafts(): EnrichmentTagDrafts {
  return {
    dealbreakers: "",
    interests: "",
    mustHaves: "",
    neighborhoods: "",
  };
}

export function applyEnrichmentTagDrafts(
  values: ProfileEnrichmentFormValues,
  drafts: EnrichmentTagDrafts,
): ProfileEnrichmentFormValues {
  return {
    ...values,
    dealbreakers: addEnrichmentTagDraft(
      values.dealbreakers,
      drafts.dealbreakers,
      ENRICHMENT_TAG_FIELD_CAPS.dealbreakers,
    ),
    interests: addEnrichmentTagDraft(
      values.interests,
      drafts.interests,
      ENRICHMENT_TAG_FIELD_CAPS.interests,
    ),
    mustHaves: addEnrichmentTagDraft(
      values.mustHaves,
      drafts.mustHaves,
      ENRICHMENT_TAG_FIELD_CAPS.mustHaves,
    ),
    neighborhoods: addEnrichmentTagDraft(
      values.neighborhoods,
      drafts.neighborhoods,
      ENRICHMENT_TAG_FIELD_CAPS.neighborhoods,
    ),
  };
}

export function addEnrichmentTagDraft(
  values: string[],
  draft: string,
  maxTags = 12,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of [...values, draft]) {
    const value = normalizeTag(raw);
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(value);
    }

    if (normalized.length >= maxTags) {
      break;
    }
  }

  return normalized;
}

function cleanBudgetValue(value: unknown, fallback: number) {
  const number = readFiniteNumber(value);
  if (number === null) {
    return fallback;
  }

  return Math.min(
    ENRICHMENT_BUDGET_UPPER,
    Math.max(ENRICHMENT_BUDGET_LOWER, Math.round(number)),
  );
}

function readFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function normalizeTag(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, ENRICHMENT_TAG_VALUE_MAX_LENGTH);
}
