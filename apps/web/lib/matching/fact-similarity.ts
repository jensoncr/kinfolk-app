// Shared fact-comparison engine — imported by both
// lib/profiles/enrichment.ts and lib/matching/compatibility-scoring.ts.
//
// CONSTRAINTS:
//   - NO "server-only" import
//   - NO @/ imports — only relative paths
//   - May import from ../supabase/types (types only) and ../profiles/fact-normalization
//   - Must NOT import from ../profiles/enrichment (would recreate the cycle)

import type { Json } from "../supabase/types";
import {
  normalizeStructuredFactValue,
  structuredValueSimilarity,
} from "../profiles/fact-normalization";

// ---------------------------------------------------------------------------
// Provider / fact identity types (moved here to avoid enrichment ↔ scoring cycle)
// ---------------------------------------------------------------------------

export const profileImportProviders = [
  "claude",
  "chatgpt",
  "manual",
  "mcp",
  "mock",
  "other",
  "linq",
  "sendblue",
  "web",
] as const;
export type ProfileImportProvider = (typeof profileImportProviders)[number];

export type ProfileFactForScoring = {
  id?: string;
  userId: string;
  sourceImportId?: string | null;
  sourceImportProvider?: ProfileImportProvider | string | null;
  dimension: string;
  factKey: string;
  value: Json;
  normalizedValue: string;
  confidence: number;
  importance: number;
  sensitivityLevel: string;
  matchingEligible: boolean;
  reviewState: string;
  evidenceExcerpt: string | null;
  createdAt?: string;
};

export type CompatibilityScore = {
  score: number;
  /** Pessimistic end of the confidence range (unknown terms scored low). */
  scoreLow: number;
  /** Optimistic end of the confidence range (unknown terms scored high). */
  scoreHigh: number;
  /** 0–1 share of scoring weight where BOTH users actually had signal. */
  coverage: number;
  components: Record<string, number>;
  evidence: { label: string; detail: string }[];
  risks: { label: string; detail: string }[];
};

// ---------------------------------------------------------------------------
// Primitive utilities
// ---------------------------------------------------------------------------

export function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function tokenize(value: string) {
  const stopWords = new Set(["and", "or", "the", "with", "for", "from", "that", "this", "very", "mostly", "prefers"]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .flatMap((token) => {
        const trimmed = token.trim();
        return trimmed.length > 2 && !stopWords.has(trimmed) ? [trimmed] : [];
      }),
  );
}

export function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * Canonical label when the shared tokens identify a known trust entity —
 * keeps evidence labels in sync with trustEntityAliases so a new alias never
 * has to be added in two places.
 */
export function trustEntityLabelForTokens(tokens: string[]): string | null {
  const tokenSet = new Set(tokens);
  for (const aliasGroup of trustEntityAliases) {
    const matched = aliasGroup.aliases.some((alias) =>
      alias.split(" ").every((word) => tokenSet.has(word)),
    );
    if (matched) {
      return aliasGroup.label;
    }
  }
  return null;
}

export function stableJsonStringify(value: Json): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key] ?? null)}`)
    .join(",")}}`;
}

export function normalizeComparableValue(value: Json): string {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableValue).sort().join(", ");
  }

  if (value && typeof value === "object") {
    return stableJsonStringify(value).toLowerCase();
  }

  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trust entity overlap
// ---------------------------------------------------------------------------

export const trustEntityFactKeys = new Set([
  "trust_context",
  "verified_work_or_school",
  "shared_communities",
  "mutuals",
  "references",
  "friend_of_friend_context",
]);

export const assistantTrustRapportFactKeys = new Set([
  "interests",
  "music_taste",
  "media_taste",
  "aesthetic_taste",
]);

const trustEntityStopWords = new Set([
  "and",
  "the",
  "for",
  "from",
  "with",
  "of",
  "at",
  "in",
  "to",
  "university",
  "college",
  "school",
  "business",
  "institute",
  "institution",
  "program",
  "department",
  "community",
  "communities",
  "club",
  "group",
  "network",
  "chapter",
  "alum",
  "alumni",
  "founder",
  "founders",
  "circle",
  "member",
  "members",
  "mutual",
  "friend",
  "friends",
  "reference",
  "references",
  "context",
]);

const trustEntityAliases = [
  {
    canonicalId: "notre-dame",
    label: "Notre Dame",
    aliases: ["notre dame", "university of notre dame"],
  },
  {
    canonicalId: "stanford",
    label: "Stanford",
    aliases: ["stanford", "stanford university"],
  },
  {
    canonicalId: "berkeley",
    label: "Berkeley",
    aliases: ["berkeley", "uc berkeley", "university of california berkeley"],
  },
] as const;

type TrustEntityCandidate = {
  normalized: string;
  concreteTokens: string[];
  concreteTokenSet: Set<string>;
  concreteKey: string;
  label: string;
  canonicalId?: string;
};

function normalizeTrustEntityText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s,;|\n-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function concreteTrustEntityTokens(value: string) {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalizeTrustEntityText(value).split(/\s+/g)) {
    if (token.length <= 1 || trustEntityStopWords.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function includesTrustEntityPhrase(value: string, phrase: string) {
  const normalizedPhrase = normalizeTrustEntityText(phrase);
  const pattern = normalizedPhrase
    .split(/\s+/g)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(^|\\s)${pattern}(?=\\s|$)`).test(value);
}

function buildTrustEntityCandidate(
  normalized: string,
  canonicalId?: string,
  label?: string,
): TrustEntityCandidate | null {
  const concreteTokens = concreteTrustEntityTokens(normalized);
  if (!canonicalId && concreteTokens.length === 0) {
    return null;
  }

  const concreteKey = concreteTokens.toSorted().join(" ");
  return {
    canonicalId,
    concreteKey,
    concreteTokens,
    concreteTokenSet: new Set(concreteTokens),
    label: label ?? titleCase(concreteTokens.slice(0, 3).join(" ")),
    normalized,
  };
}

function splitTrustEntitySegments(normalized: string) {
  return normalized
    .split(/\s*(?:,|;|\||\n|\band\b)\s*/g)
    .flatMap((segment) => {
      const trimmed = segment.trim();
      return trimmed ? [trimmed] : [];
    });
}

function trustEntityCandidates(value: string) {
  const normalized = normalizeTrustEntityText(value);
  const candidates: TrustEntityCandidate[] = [];

  for (const aliasGroup of trustEntityAliases) {
    if (
      aliasGroup.aliases.some((alias) =>
        includesTrustEntityPhrase(normalized, alias),
      )
    ) {
      const candidate = buildTrustEntityCandidate(
        aliasGroup.aliases[0] ?? aliasGroup.label,
        aliasGroup.canonicalId,
        aliasGroup.label,
      );
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  for (const segment of splitTrustEntitySegments(normalized)) {
    const candidate = buildTrustEntityCandidate(segment);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.canonicalId
      ? `canonical:${candidate.canonicalId}`
      : `entity:${candidate.concreteKey}:${candidate.normalized}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function concreteTrustEntityLabel(
  entityA: TrustEntityCandidate,
  entityB: TrustEntityCandidate,
) {
  const sharedTokens = entityA.concreteTokens.filter((token) =>
    entityB.concreteTokenSet.has(token),
  );
  return titleCase(
    (sharedTokens.length > 0 ? sharedTokens : entityA.concreteTokens)
      .slice(0, 3)
      .join(" "),
  );
}

function compareTrustEntities(
  entityA: TrustEntityCandidate,
  entityB: TrustEntityCandidate,
) {
  if (
    entityA.canonicalId &&
    entityB.canonicalId &&
    entityA.canonicalId === entityB.canonicalId
  ) {
    return { score: 1, label: entityA.label };
  }

  if (
    entityA.normalized === entityB.normalized &&
    entityA.concreteTokens.length > 0
  ) {
    return { score: 1, label: concreteTrustEntityLabel(entityA, entityB) };
  }

  if (
    entityA.concreteKey &&
    entityA.concreteKey === entityB.concreteKey
  ) {
    return { score: 0.96, label: concreteTrustEntityLabel(entityA, entityB) };
  }

  const sharedTokens = entityA.concreteTokens.filter((token) =>
    entityB.concreteTokenSet.has(token),
  );
  if (sharedTokens.length === 0) {
    return { score: 0, label: null };
  }

  const union = new Set([...entityA.concreteTokens, ...entityB.concreteTokens]).size;
  const jaccard = union > 0 ? sharedTokens.length / union : 0;
  if (sharedTokens.length >= 2 && jaccard >= 0.5) {
    return { score: clamp(0.5 + jaccard * 0.4), label: titleCase(sharedTokens.join(" ")) };
  }

  if (
    sharedTokens.length === 1 &&
    jaccard >= 0.67 &&
    entityA.concreteTokens.length <= 2 &&
    entityB.concreteTokens.length <= 2
  ) {
    return { score: 0.72, label: titleCase(sharedTokens[0]) };
  }

  return { score: 0, label: null };
}

export function trustEntityOverlap(a: string, b: string) {
  const entitiesA = trustEntityCandidates(a);
  const entitiesB = trustEntityCandidates(b);
  let best = { score: 0, label: null as string | null };

  for (const entityA of entitiesA) {
    for (const entityB of entitiesB) {
      const overlap = compareTrustEntities(entityA, entityB);
      if (overlap.score > best.score) {
        best = overlap;
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Budget engine
// ---------------------------------------------------------------------------

export type BudgetConstraint = {
  min: number | null;
  max: number | null;
};

const marketBudgetLowerBound = 0;
const marketBudgetCeiling = 100_000;
const minimumBudgetGapScale = 1_000;

export function readBudgetNumbersFromText(value: string) {
  return [
    ...value.matchAll(
      /\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|thousand)?\b/gi,
    ),
  ].flatMap((match) => {
    const parsed = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return [];
    }

    const amount = match[2] || parsed < 100 ? parsed * 1000 : parsed;
    return amount >= 100 && amount <= 100_000 ? [Math.round(amount)] : [];
  });
}

function normalizeBudgetAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const amount = value < 100 ? value * 1000 : value;
  return amount >= 100 && amount <= 100_000 ? Math.round(amount) : null;
}

function readBudgetAmount(value: unknown) {
  if (typeof value === "number") {
    return normalizeBudgetAmount(value);
  }

  if (typeof value === "string") {
    return readBudgetNumbersFromText(value)[0] ?? null;
  }

  return null;
}

function readFirstBudgetAmount(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const amount = readBudgetAmount(record[key]);
    if (amount !== null) {
      return amount;
    }
  }

  return null;
}

function budgetConstraintFromNumbers(
  numbers: number[],
  factKey = "budget",
): BudgetConstraint | null {
  if (numbers.length === 0) {
    return null;
  }

  if (numbers.length === 1) {
    if (factKey === "budget_min") {
      return { min: numbers[0], max: null };
    }

    return { min: null, max: numbers[0] };
  }

  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function budgetConstraintFromJson(
  value: unknown,
  factKey: string,
): BudgetConstraint | null {
  if (Array.isArray(value)) {
    const numbers = value
      .map(readBudgetAmount)
      .filter((amount): amount is number => amount !== null);
    return budgetConstraintFromNumbers(numbers, factKey);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const min = readFirstBudgetAmount(record, [
    "min",
    "minimum",
    "budget_min",
    "lower",
    "lower_bound",
    "from",
  ]);
  const max = readFirstBudgetAmount(record, [
    "max",
    "maximum",
    "budget_preferred_max",
    "preferred_max",
    "target_max",
    "budget_max",
    "upper",
    "upper_bound",
    "to",
  ]);

  if (min !== null || max !== null) {
    return { min, max };
  }

  return budgetConstraintFromNumbers(
    Object.values(record)
      .map(readBudgetAmount)
      .filter((amount): amount is number => amount !== null),
    factKey,
  );
}

function parseStructuredBudgetConstraint(
  factKey: string,
  value: string,
): BudgetConstraint | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return budgetConstraintFromJson(JSON.parse(trimmed), factKey);
  } catch {
    return null;
  }
}

export function parseBudgetConstraint(factKey: string, value: string): BudgetConstraint | null {
  const structured = parseStructuredBudgetConstraint(factKey, value);
  if (structured) {
    return structured;
  }

  const numbers = readBudgetNumbersFromText(value);
  if (numbers.length === 0) {
    return null;
  }

  if (factKey === "budget_preferred_max" || factKey === "budget_max") {
    return { min: null, max: Math.max(...numbers) };
  }

  if (factKey === "budget_min") {
    return { min: Math.min(...numbers), max: null };
  }

  if (numbers.length >= 2) {
    return { min: Math.min(...numbers), max: Math.max(...numbers) };
  }

  const [amount] = numbers;
  if (/\b(at least|from|minimum|min|starting at|starts at|floor)\b/i.test(value)) {
    return { min: amount, max: null };
  }

  return { min: null, max: amount };
}

function budgetConstraintBounds(budget: BudgetConstraint) {
  return {
    min: budget.min ?? marketBudgetLowerBound,
    max: budget.max ?? marketBudgetCeiling,
  };
}

function narrowerBudgetSpan(
  boundsA: { min: number; max: number },
  boundsB: { min: number; max: number },
) {
  return Math.max(
    1,
    Math.min(
      Math.max(0, boundsA.max - boundsA.min),
      Math.max(0, boundsB.max - boundsB.min),
    ),
  );
}

export function budgetConstraintSimilarity(
  budgetA: BudgetConstraint,
  budgetB: BudgetConstraint,
) {
  const boundsA = budgetConstraintBounds(budgetA);
  const boundsB = budgetConstraintBounds(budgetB);
  const overlap = Math.min(boundsA.max, boundsB.max) - Math.max(boundsA.min, boundsB.min);

  if (overlap > 0) {
    return clamp(overlap / narrowerBudgetSpan(boundsA, boundsB));
  }

  const gap = Math.max(boundsA.min, boundsB.min) - Math.min(boundsA.max, boundsB.max);
  if (gap <= 0) {
    return 1;
  }

  const gapScale = Math.max(narrowerBudgetSpan(boundsA, boundsB), minimumBudgetGapScale);
  return clamp(1 / (1 + gap / gapScale));
}

export function mergeBudgetConstraints(constraints: BudgetConstraint[]): BudgetConstraint {
  return constraints.reduce<BudgetConstraint>(
    (merged, constraint) => ({
      min:
        constraint.min === null
          ? merged.min
          : merged.min === null
            ? constraint.min
            : Math.max(merged.min, constraint.min),
      max:
        constraint.max === null
          ? merged.max
          : merged.max === null
            ? constraint.max
            : Math.min(merged.max, constraint.max),
    }),
    { min: null, max: null },
  );
}

// ---------------------------------------------------------------------------
// Value similarity engine
// ---------------------------------------------------------------------------

const categoricalSimilarityPatterns = [
  /quiet|low noise|calm|low-key/,
  /social|host|guests|dinner|party/,
  /direct|blunt|fast|responsive/,
  /clean|tidy|organized|dishes/,
  /night|late|night owl/,
  /morning|early|early bird/,
  /flexible|tradeoff|elastic/,
] as const;

function categoricalSimilarity(a: string, b: string) {
  const textA = a.toLowerCase();
  const textB = b.toLowerCase();

  for (const pattern of categoricalSimilarityPatterns) {
    const hasA = pattern.test(textA);
    const hasB = pattern.test(textB);
    if (hasA && hasB) {
      return 0.82;
    }
  }

  return 0.2;
}

function tokenSimilarity(a: string, b: string) {
  if (a === b) {
    return 1;
  }

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0.3;
  }

  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = intersection / union;
  const category = categoricalSimilarity(a, b);

  return clamp(Math.max(jaccard, category));
}

function readDateString(value: unknown) {
  return typeof value === "string" && isValidIsoDate(value) ? value : null;
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRange(min: number | null, max: number | null) {
  const start = min ?? max;
  const end = max ?? min;
  if (start == null || end == null || start <= 0 || end <= 0) {
    return null;
  }

  return {
    min: Math.min(start, end),
    max: Math.max(start, end),
  };
}

function rangesOverlap(
  startA: number | string,
  endA: number | string,
  startB: number | string,
  endB: number | string,
) {
  return startA <= endB && startB <= endA;
}

// Non-overlapping move-in windows are a soft penalty, not a hard exclusion:
// people routinely flex their move-in by a few weeks. Decay over a ~90-day
// horizon so a near-miss stays a strong signal and only windows a full season
// apart fall to ~0 (where the feasibility gate excludes them).
const MOVE_IN_DECAY_HORIZON_DAYS = 90;

function moveInWindowSimilarity(a: string, b: string) {
  const rangeA = parseDateWindow(a);
  const rangeB = parseDateWindow(b);
  if (!rangeA || !rangeB) {
    // Prose values ("flexible", "sometime this fall") must stay above the
    // feasibility gate's hard-fail floor (MOVE_IN_GATE_FLOOR = 0.2): only
    // windows that BOTH parsed to dates and sit a season apart may zero the
    // pair. tokenSimilarity's own floor is exactly 0.2, so raw fallback would
    // hard-exclude the most flexible answers.
    return Math.max(tokenSimilarity(a, b), 0.25);
  }

  if (rangesOverlap(rangeA.start, rangeA.end, rangeB.start, rangeB.end)) {
    return 1;
  }

  return clamp(1 - moveInGapDays(rangeA, rangeB) / MOVE_IN_DECAY_HORIZON_DAYS);
}

/** Whole-day gap between two non-overlapping date windows (earlier end → later start). */
function moveInGapDays(
  a: { start: string; end: string },
  b: { start: string; end: string },
) {
  const startA = Date.parse(a.start);
  const endA = Date.parse(a.end);
  const startB = Date.parse(b.start);
  const endB = Date.parse(b.end);
  if (![startA, endA, startB, endB].every(Number.isFinite)) {
    return MOVE_IN_DECAY_HORIZON_DAYS;
  }
  // Exactly one term is positive for non-overlapping windows: the distance from
  // the earlier window's end to the later window's start.
  const gapMs = Math.max(startB - endA, startA - endB);
  return Math.max(0, Math.round(gapMs / 86_400_000));
}

function parseDateWindow(value: string) {
  const structured = parseJsonObject(value);
  const structuredDates = structured
    ? [
        readDateString(structured.start),
        readDateString(structured.move_in_start),
        readDateString(structured.from),
        readDateString(structured.end),
        readDateString(structured.move_in_end),
        readDateString(structured.to),
      ].filter((date): date is string => Boolean(date))
    : [];
  const textDates = [...value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(
    (match) => match[0],
  );
  const dates = [...structuredDates, ...textDates].filter(isValidIsoDate).sort();

  if (dates.length === 0) {
    return null;
  }

  return {
    start: dates[0],
    end: dates[dates.length - 1],
  };
}

function parseNumericRange(value: string) {
  const structured = parseJsonObject(value);
  if (structured) {
    const min =
      readFiniteNumber(structured.min) ??
      readFiniteNumber(structured.minimum) ??
      readFiniteNumber(structured.household_size_min);
    const max =
      readFiniteNumber(structured.max) ??
      readFiniteNumber(structured.maximum) ??
      readFiniteNumber(structured.household_size_max);
    if (min !== null || max !== null) {
      return normalizeRange(min, max);
    }
  }

  const numbers = [...value.matchAll(/\b(\d+)\b/g)].flatMap((match) => {
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? [n] : [];
  });

  if (numbers.length === 0) {
    return null;
  }

  return normalizeRange(Math.min(...numbers), Math.max(...numbers));
}

function householdSizeOpennessSimilarity(a: string, b: string) {
  const rangeA = householdOpennessRange(a);
  const rangeB = householdOpennessRange(b);
  if (!rangeA || !rangeB) {
    return tokenSimilarity(a, b);
  }

  return rangesOverlap(rangeA.min, rangeA.max, rangeB.min, rangeB.max)
    ? 1
    : 0;
}

function householdOpennessRange(value: string) {
  const range = parseNumericRange(value);
  if (!range) {
    return null;
  }

  if (range.max <= 1) {
    return { min: 1, max: 1 };
  }

  return {
    min: 2,
    max: range.max,
  };
}

function listOverlapSimilarity(a: string, b: string) {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0.5;
  }
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const smaller = Math.min(tokensA.size, tokensB.size);
  return smaller > 0 ? clamp(intersection / smaller) : 0.5;
}

function listJaccardSimilarity(a: string, b: string) {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0.5;
  }

  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? clamp(intersection / union) : 0.5;
}

export function classifyFactKeyValue(factKey: string, value: string) {
  const text = value.toLowerCase();

  if (["noise_tolerance", "social_energy", "guests"].includes(factKey)) {
    if (/\b(quiet|calm|decompression|low|rare|occasional|planned|advance|small)\b/.test(text)) {
      return "low_social_low_noise";
    }
    if (/\b(frequent|party|parties|social hub|active|high|music|late dinners)\b/.test(text)) {
      return "high_social_high_noise";
    }
  }

  if (["cleanliness", "chores"].includes(factKey)) {
    if (/\b(flexible|overnight|loose|busy|relaxed)\b/.test(text)) {
      return "relaxed_clean";
    }
    if (/\b(clean|tidy|reset|dishes|kitchen|organized)\b/.test(text)) {
      return "structured_clean";
    }
  }

  if (["communication_style", "conflict_repair"].includes(factKey)) {
    if (/\b(direct|clear|quick|fast|explicit|early|concrete)\b/.test(text)) {
      return "direct_fast";
    }
    if (/\b(casual|in-person|live|not always fast|cool down)\b/.test(text)) {
      return "casual_live";
    }
  }

  if (factKey === "sleep_schedule") {
    if (/\b(early|morning|8am|7am)\b/.test(text) && !/\b(late|midnight|2am)\b/.test(text)) {
      return "early";
    }
    if (/\b(late|midnight|2am|night)\b/.test(text)) {
      return "late";
    }
  }

  if (factKey === "work_from_home") {
    if (/\b(hybrid|two days|three days|some days|part[- ]?time)\b/.test(text)) {
      return "hybrid_home";
    }
    if (/\b(remote|wfh|work from home|home office|desk setup)\b/.test(text)) {
      return "mostly_home";
    }
    if (/\b(in[- ]?office|office majority|mostly out|out of the apartment|onsite)\b/.test(text)) {
      return "mostly_away";
    }
  }

  return null;
}

function budgetTextSimilarity(
  factKeyA: string,
  a: string,
  factKeyB: string,
  b: string,
) {
  const budgetA = parseBudgetConstraint(factKeyA, a);
  const budgetB = parseBudgetConstraint(factKeyB, b);
  if (!budgetA || !budgetB) {
    return tokenSimilarity(a, b);
  }

  return budgetConstraintSimilarity(budgetA, budgetB);
}

function structuredComparableToken(factKey: string, value: string) {
  return normalizeStructuredFactValue(factKey, normalizeComparableValue(value));
}

export function valueSimilarityForKey(
  factKey: string,
  a: string,
  b: string,
  otherFactKey = factKey,
) {
  if (
    factKey === "budget" ||
    factKey === "budget_preferred_max" ||
    factKey === "budget_min" ||
    factKey === "budget_max"
  ) {
    return budgetTextSimilarity(factKey, a, otherFactKey, b);
  }

  if (trustEntityFactKeys.has(factKey)) {
    return trustEntityOverlap(a, b).score;
  }

  if (factKey === "move_in_window") {
    return moveInWindowSimilarity(a, b);
  }

  if (factKey === "household_size") {
    return householdSizeOpennessSimilarity(a, b);
  }

  if (factKey === "neighborhoods") {
    return listJaccardSimilarity(a, b);
  }

  if (
    [
      "target_market",
      "trust_context",
      "verified_work_or_school",
      "shared_communities",
      "mutuals",
      "interests",
      "music_taste",
      "media_taste",
      // Same dimension as its taste siblings above — leaving it to the
      // categorical/token fallback gave same-dimension keys inconsistent
      // metrics.
      "aesthetic_taste",
    ].includes(factKey)
  ) {
    return listOverlapSimilarity(a, b);
  }

  // Prefer precise comparison when both sides carry canonical structured tokens,
  // including legacy rows whose normalized_value still contains prose.
  const structuredA = structuredComparableToken(factKey, a);
  const structuredB =
    factKey === otherFactKey ? structuredComparableToken(factKey, b) : null;
  const structured =
    structuredA && structuredB
      ? structuredValueSimilarity(factKey, structuredA, structuredB)
      : null;
  if (structured !== null) {
    return structured;
  }

  const categoryA = classifyFactKeyValue(factKey, a);
  const categoryB = classifyFactKeyValue(factKey, b);
  if (categoryA && categoryB) {
    return categoryA === categoryB ? 0.88 : 0.22;
  }

  return tokenSimilarity(a, b);
}

// ---------------------------------------------------------------------------
// Profile fact projection consolidation
// ---------------------------------------------------------------------------

const additiveProfileFactKeys = new Set([
  "chore_avoidances",
  "chore_strengths",
  "dealbreakers",
  "interests",
  "media_taste",
  "music_taste",
  "mutuals",
  "must_haves",
  "neighborhoods",
  "prior_roommate_context",
  "references",
  "shared_communities",
  "target_market",
  "trust_context",
  "verified_work_or_school",
]);

const projectionOverrideImportProviders = new Set<string>([
  "linq",
  "sendblue",
  // Explicit web profile-editor edits are authoritative user input.
  "web",
]);

const duplicateFactSimilarityThreshold = 0.82;

export function isAdditiveProfileFactKey(factKey: string) {
  return additiveProfileFactKeys.has(factKey);
}

function isProjectionOverrideFact(fact: ProfileFactForScoring) {
  return projectionOverrideImportProviders.has(fact.sourceImportProvider ?? "");
}

function projectionFactSlot(
  fact: Pick<ProfileFactForScoring, "dimension" | "factKey">,
) {
  if (
    ["budget", "budget_preferred_max", "budget_min", "budget_max"].includes(
      fact.factKey,
    )
  ) {
    return "feasibility:budget";
  }

  if (["group_size_flexibility", "household_size"].includes(fact.factKey)) {
    return "feasibility:household_size";
  }

  return `${fact.dimension}:${fact.factKey}`;
}

function compareProfileFactsForProjection(
  a: ProfileFactForScoring,
  b: ProfileFactForScoring,
) {
  const scoreA = a.confidence * 2 + a.importance;
  const scoreB = b.confidence * 2 + b.importance;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

export function isSameProfileFactSlot(
  factA: Pick<ProfileFactForScoring, "dimension" | "factKey">,
  factB: Pick<ProfileFactForScoring, "dimension" | "factKey">,
) {
  return factA.dimension === factB.dimension && factA.factKey === factB.factKey;
}

export function bestDuplicateMatch(
  fact: Pick<ProfileFactForScoring, "factKey" | "normalizedValue">,
  existingFacts: ProfileFactForScoring[],
) {
  let bestMatch:
    | { existingFact: ProfileFactForScoring; similarity: number }
    | null = null;

  for (const existingFact of existingFacts) {
    // Neighborhood snapshots are duplicates only when they contain the same
    // values. Their Jaccard threshold can otherwise swallow a one-area
    // expansion of a long list. Other additive keys retain semantic matching
    // for aliases such as "Stanford" and "Stanford University".
    if (
      fact.factKey === "neighborhoods" &&
      !haveSameTokens(fact.normalizedValue, existingFact.normalizedValue)
    ) {
      continue;
    }
    const similarity = valueSimilarityForKey(
      fact.factKey,
      fact.normalizedValue,
      existingFact.normalizedValue,
      existingFact.factKey,
    );
    if (similarity < duplicateFactSimilarityThreshold) {
      continue;
    }
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = { existingFact, similarity };
    }
  }

  return bestMatch;
}

function haveSameTokens(a: string, b: string) {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  return (
    tokensA.size === tokensB.size &&
    [...tokensA].every((token) => tokensB.has(token))
  );
}

function filterProjectionFactsForOverrides(facts: ProfileFactForScoring[]) {
  const latestOverrideTimestampBySlot = new Map<string, string>();

  for (const fact of facts) {
    if (!isProjectionOverrideFact(fact)) {
      continue;
    }

    const slot = projectionFactSlot(fact);
    const timestamp = fact.createdAt ?? "";
    const previous = latestOverrideTimestampBySlot.get(slot);
    if (previous === undefined || timestamp.localeCompare(previous) > 0) {
      latestOverrideTimestampBySlot.set(slot, timestamp);
    }
  }

  if (latestOverrideTimestampBySlot.size === 0) {
    return [...facts];
  }

  return facts.filter((fact) => {
    const latestTimestamp = latestOverrideTimestampBySlot.get(
      projectionFactSlot(fact),
    );

    if (latestTimestamp === undefined) {
      return true;
    }

    return isProjectionOverrideFact(fact) && (fact.createdAt ?? "") === latestTimestamp;
  });
}

export function consolidateProfileFactsForProjection(
  facts: ProfileFactForScoring[],
) {
  const selected: ProfileFactForScoring[] = [];
  const sortedFacts = filterProjectionFactsForOverrides(facts).sort(
    compareProfileFactsForProjection,
  );

  for (const fact of sortedFacts) {
    const sameSlotFacts = selected.filter((selectedFact) =>
      isSameProfileFactSlot(fact, selectedFact),
    );

    if (bestDuplicateMatch(fact, sameSlotFacts)) {
      continue;
    }

    if (!isAdditiveProfileFactKey(fact.factKey) && sameSlotFacts.length > 0) {
      continue;
    }

    selected.push(fact);
  }

  return selected;
}
