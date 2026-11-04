import { textAgentAllowedFactKeys } from "..";
import type { TextProfileFact } from "..";
import { escapeRegExp } from "@/lib/shared/regex";

// ---------------------------------------------------------------------------
// update_prefs fact normalization
//
// Pure translation from whatever the model handed the tool (loose keys, free
// text, shorthand money) into canonical TextProfileFact values. No supabase,
// no tool plumbing — unit-testable in isolation.
// ---------------------------------------------------------------------------

const allowedFactKeys = new Set<string>(textAgentAllowedFactKeys);

export function readToolFacts(value: unknown): TextProfileFact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): TextProfileFact[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const rawFactKey =
      typeof record.fact_key === "string"
        ? record.fact_key.trim().toLowerCase()
        : "";
    const evidence =
      typeof record.evidence === "string" ? record.evidence.trim() : "";
    const normalized = normalizeToolFact(rawFactKey, record.value, evidence);
    if (!normalized) {
      return [];
    }
    const { factKey, value } = normalized;
    if (!allowedFactKeys.has(factKey)) {
      return [];
    }

    if (
      value == null ||
      (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
    ) {
      return [];
    }

    return [
      {
        assertion_type: "explicit",
        confidence: readScore(record.confidence, 0.85),
        dimension:
          typeof record.dimension === "string"
            ? record.dimension
            : "feasibility",
        evidence,
        fact_key: factKey,
        importance: readScore(record.importance, 0.8),
        matching_eligible: record.matching_eligible !== false,
        sensitivity_level:
          record.sensitivity_level === "sensitive" ||
          record.sensitivity_level === "protected" ||
          record.sensitivity_level === "high_risk"
            ? record.sensitivity_level
            : "standard",
        value: value as TextProfileFact["value"],
      },
    ];
  });
}

function normalizeToolFact(
  rawFactKey: string,
  rawValue: unknown,
  evidence = "",
): { factKey: string; value: TextProfileFact["value"] } | null {
  const factKey = canonicalToolFactKey(rawFactKey, rawValue);
  if (!factKey) {
    return null;
  }

  if (factKey === "budget_preferred_max" || factKey === "budget_max") {
    return {
      factKey,
      value: (readMoneyLikeNumber(rawValue) ?? rawValue) as TextProfileFact["value"],
    };
  }

  if (factKey === "neighborhoods") {
    return { factKey, value: normalizeNeighborhoodValue(rawValue) };
  }

  if (factKey === "move_in_window") {
    return { factKey, value: normalizeMoveInWindow(rawValue, evidence) };
  }

  if (factKey === "household_size") {
    const householdSize = normalizeHouseholdSize(rawFactKey, rawValue, evidence);
    if (householdSize) {
      return { factKey, value: householdSize };
    }
  }

  return { factKey, value: rawValue as TextProfileFact["value"] };
}

function normalizeHouseholdSize(
  rawFactKey: string,
  rawValue: unknown,
  evidence = "",
): TextProfileFact["value"] | null {
  const evidenceHouseholdSize = parseHouseholdSizeFromText(evidence);
  if (evidenceHouseholdSize) {
    return evidenceHouseholdSize;
  }

  if (typeof rawValue === "string") {
    const valueHouseholdSize = parseHouseholdSizeFromText(rawValue);
    if (valueHouseholdSize) {
      return valueHouseholdSize;
    }
  }

  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return null;
  }

  const roommateCount = readInteger(rawValue);
  if (
    roommateCount != null &&
    ["roommate_count", "roommate_count_preference", "roommate_preference", "roommates"].includes(rawFactKey)
  ) {
    return { max: roommateCount + 1, min: 1 };
  }
  if (roommateCount != null) {
    return { max: roommateCount, min: roommateCount };
  }

  return null;
}

function parseHouseholdSizeFromText(text: string): { max: number; min: number } | null {
  if (!text.trim()) {
    return null;
  }

  const totalPeopleRange = text.match(
    /\b(\d{1,2})\s*(?:-|–|to|or)\s*(\d{1,2})\s*(?:people|persons|person|total|household)\b/iu,
  );
  if (totalPeopleRange) {
    return orderedHouseholdSize(Number(totalPeopleRange[1]), Number(totalPeopleRange[2]));
  }

  const roommateRange = text.match(
    /\b(\d{1,2})\s*(?:-|–|to|or)\s*(\d{1,2})\s*(?:roommates?|housemates?|roomies?)\b/iu,
  );
  if (roommateRange) {
    return orderedHouseholdSize(Number(roommateRange[1]) + 1, Number(roommateRange[2]) + 1);
  }

  const upToRoommates = text.match(
    /\b(?:up to|as many as|max(?:imum)?(?: of)?|no more than)\s+(\d{1,2})\s*(?:roommates?|housemates?|roomies?)\b/iu,
  );
  if (upToRoommates) {
    return orderedHouseholdSize(1, Number(upToRoommates[1]) + 1);
  }

  return null;
}

function orderedHouseholdSize(left: number, right: number) {
  return {
    max: Math.max(left, right),
    min: Math.min(left, right),
  };
}

function canonicalToolFactKey(rawFactKey: string, rawValue: unknown) {
  if (allowedFactKeys.has(rawFactKey)) {
    return rawFactKey;
  }

  if (
    [
      "budget_cap",
      "budget_hard_cap",
      "budget_max_per_person",
      "hard_budget",
      "hard_budget_cap",
      "max_budget",
      "max_budget_per_person",
    ].includes(rawFactKey)
  ) {
    return "budget_max";
  }

  if (
    [
      "budget_preferred_cap",
      "budget_target",
      "budget_target_max",
      "preferred_budget",
      "preferred_budget_cap",
      "preferred_budget_max",
      "target_budget",
      "target_budget_cap",
      "target_budget_max",
    ].includes(rawFactKey)
  ) {
    return "budget_preferred_max";
  }

  if (["area", "areas", "location", "locations"].includes(rawFactKey)) {
    return "neighborhoods";
  }

  if (["move_date", "move_in", "move_in_date"].includes(rawFactKey)) {
    return "move_in_window";
  }

  if (
    [
      "roommate_count",
      "roommate_count_preference",
      "roommate_preference",
      "roommates",
    ].includes(rawFactKey)
  ) {
    return readInteger(rawValue) == null
      ? "group_size_flexibility"
      : "household_size";
  }

  return null;
}

function normalizeNeighborhoodValue(value: unknown): TextProfileFact["value"] {
  if (Array.isArray(value)) {
    return value as TextProfileFact["value"];
  }

  if (typeof value !== "string") {
    return value as TextProfileFact["value"];
  }

  const entries = value.split(/,|\/|\bor\b/iu).flatMap((entry) => {
    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });
  return entries.length > 1 ? entries : value;
}

function normalizeMoveInWindow(
  value: unknown,
  evidence = "",
): TextProfileFact["value"] {
  const evidenceAnchoredWindow = parseAnchoredMoveInWindow(evidence);
  const evidenceRange = parseMonthRange(evidence);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (evidenceAnchoredWindow && hasCollapsedMoveInRange(value)) {
      return evidenceAnchoredWindow;
    }
    if (evidenceRange && hasCollapsedMoveInRange(value)) {
      return evidenceRange;
    }
    return value as TextProfileFact["value"];
  }

  if (typeof value !== "string") {
    return value as TextProfileFact["value"];
  }

  const textAnchoredWindow = parseAnchoredMoveInWindow(value);
  if (textAnchoredWindow) {
    return textAnchoredWindow;
  }
  const textRange = parseMonthRange(value);
  if (textRange) {
    return textRange;
  }
  if (evidenceAnchoredWindow) {
    return evidenceAnchoredWindow;
  }
  if (evidenceRange) {
    return evidenceRange;
  }

  const isoDate = value.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0];
  if (isoDate) {
    return { end: isoDate, start: isoDate };
  }

  const isoMonth = value.match(/\b(\d{4})-(\d{2})\b/u);
  if (isoMonth) {
    const year = Number(isoMonth[1]);
    const month = Number(isoMonth[2]);
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { end, start: `${isoMonth[1]}-${isoMonth[2]}-01` };
  }

  return value;
}

function hasCollapsedMoveInRange(value: object) {
  const record = value as Record<string, unknown>;
  return (
    typeof record.start === "string" &&
    typeof record.end === "string" &&
    record.start === record.end
  );
}

const monthIndexByName = new Map<string, number>([
  ["january", 1],
  ["jan", 1],
  ["february", 2],
  ["feb", 2],
  ["march", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["may", 5],
  ["june", 6],
  ["jun", 6],
  ["july", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sept", 9],
  ["sep", 9],
  ["october", 10],
  ["oct", 10],
  ["november", 11],
  ["nov", 11],
  ["december", 12],
  ["dec", 12],
]);

function monthNamePatternSource() {
  return [...monthIndexByName.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
}

function parseMonthRange(text: string): { end: string; start: string } | null {
  if (!text.trim()) {
    return null;
  }

  const monthNames = monthNamePatternSource();
  const rangePattern = new RegExp(
    `(?:from\\s+)?(?:(early|mid|late)\\s+)?(${monthNames})\\.?(?:\\s+(\\d{4}))?\\s*(?:through|thru|to|until|-|–)\\s*(?:(early|mid|late)\\s+)?(${monthNames})\\.?(?:\\s+(\\d{4}))?`,
    "iu",
  );
  const match = text.match(rangePattern);
  if (!match) {
    return null;
  }

  const startMonth = monthIndexByName.get(match[2].toLowerCase());
  const endMonth = monthIndexByName.get(match[5].toLowerCase());
  if (!startMonth || !endMonth) {
    return null;
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const startYear = match[3] ? Number(match[3]) : currentYear;
  let endYear = match[6] ? Number(match[6]) : startYear;
  if (!match[6] && endMonth < startMonth) {
    endYear += 1;
  }

  // "January to March" said in July means NEXT January–March: with no
  // explicit year, a fully-past window must roll forward, mirroring
  // inferMoveInYear's 30-day staleness grace — a past-dated window would
  // hard-fail the feasibility gate against every match.
  if (!match[3] && !match[6]) {
    const staleCutoff = addUtcDays(
      new Date(Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate())),
      -30,
    );
    const end = new Date(
      Date.UTC(endYear, endMonth - 1, rangeEndDay(endYear, endMonth, match[4])),
    );
    if (end < staleCutoff) {
      return {
        end: isoMonthDay(endYear + 1, endMonth, rangeEndDay(endYear + 1, endMonth, match[4])),
        start: isoMonthDay(startYear + 1, startMonth, rangeStartDay(match[1])),
      };
    }
  }

  return {
    end: isoMonthDay(endYear, endMonth, rangeEndDay(endYear, endMonth, match[4])),
    start: isoMonthDay(startYear, startMonth, rangeStartDay(match[1])),
  };
}

function parseAnchoredMoveInWindow(text: string): { end: string; start: string } | null {
  if (!text.trim()) {
    return null;
  }

  const monthNames = monthNamePatternSource();
  const datePattern = new RegExp(
    `\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    "iu",
  );
  const match = text.match(datePattern);
  if (!match) {
    return null;
  }

  const month = monthIndexByName.get(match[1].toLowerCase());
  const day = Number(match[2]);
  if (!month || !Number.isInteger(day)) {
    return null;
  }

  const year = match[3]
    ? Number(match[3])
    : inferMoveInYear(month, day, new Date());
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  const anchor = new Date(Date.UTC(year, month - 1, day));
  const anchorIso = anchor.toISOString().slice(0, 10);
  const flexibilityDays = readMoveInFlexibilityDays(text);
  if (!flexibilityDays) {
    return { end: anchorIso, start: anchorIso };
  }

  return {
    end: addUtcDays(anchor, flexibilityDays).toISOString().slice(0, 10),
    start: addUtcDays(anchor, -flexibilityDays).toISOString().slice(0, 10),
  };
}

function inferMoveInYear(month: number, day: number, now: Date) {
  const currentYear = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(currentYear, month - 1, day));
  const staleCutoff = addUtcDays(
    new Date(Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate())),
    -30,
  );
  return candidate < staleCutoff ? currentYear + 1 : currentYear;
}

function readMoveInFlexibilityDays(text: string) {
  const normalized = text.toLowerCase();
  const hasFlexLanguage =
    /\b(?:flexible|either way|give or take|plus or minus|around|roughly|approx(?:imately)?|ish)\b/u.test(
      normalized,
    );
  if (!hasFlexLanguage) {
    return 0;
  }

  const numericWeeks = normalized.match(/\b(\d{1,2})\s*(?:weeks?|wks?)\b/u);
  if (numericWeeks) {
    return Number(numericWeeks[1]) * 7;
  }

  const numericDays = normalized.match(/\b(\d{1,2})\s*(?:days?)\b/u);
  if (numericDays) {
    return Number(numericDays[1]);
  }

  if (/\b(?:a\s+)?couple(?:\s+of)?\s+weeks?\b/u.test(normalized)) {
    return 14;
  }
  if (/\b(?:a\s+)?few\s+weeks?\b/u.test(normalized)) {
    return 21;
  }
  if (/\b(?:two|2)\s+weeks?\b/u.test(normalized) || /\bweek\s+or\s+two\b/u.test(normalized)) {
    return 14;
  }
  if (/\b(?:one|1|a)\s+weeks?\b/u.test(normalized)) {
    return 7;
  }
  if (/\b(?:a\s+)?month\b/u.test(normalized)) {
    return 30;
  }

  return 7;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function rangeStartDay(qualifier: string | undefined) {
  const normalized = qualifier?.toLowerCase();
  if (normalized === "mid") return 10;
  if (normalized === "late") return 20;
  return 1;
}

function rangeEndDay(year: number, month: number, qualifier: string | undefined) {
  const normalized = qualifier?.toLowerCase();
  if (normalized === "early") return 10;
  if (normalized === "mid") return 20;
  return daysInMonth(year, month);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoMonthDay(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function readMoneyLikeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const shorthand = value.match(/\b(\d+(?:\.\d+)?)\s*k\b/iu);
  if (shorthand) {
    return Math.round(Number(shorthand[1]) * 1000);
  }

  const numeric = value.match(/\b\d[\d,]*(?:\.\d+)?\b/u)?.[0];
  return numeric ? Math.round(Number(numeric.replace(/,/gu, ""))) : null;
}

function readInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const numeric = value.match(/\b\d+\b/u)?.[0];
  return numeric ? Number(numeric) : null;
}

function readScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}
