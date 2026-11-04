import type { TextProfileFact } from "./index";

export function summarizeTextProfileFacts(facts: TextProfileFact[]) {
  const byKey = new Map<string, TextProfileFact>();
  for (const fact of facts) {
    byKey.set(fact.fact_key, fact);
  }

  const usedKeys = new Set<string>();
  const rows: Array<{ label: string; value: string }> = [];
  const budget = displayBudgetFacts(byKey);
  if (budget) {
    rows.push({ label: "Budget", value: budget });
    usedKeys.add("budget");
    usedKeys.add("budget_preferred_max");
    usedKeys.add("budget_min");
    usedKeys.add("budget_max");
  }

  for (const key of textProfileSummaryFactOrder) {
    if (usedKeys.has(key)) continue;
    const fact = byKey.get(key);
    if (!fact) continue;

    const value = displayFactValueForKey(fact.fact_key, fact.value);
    if (!value) continue;

    rows.push({ label: humanizeFactKey(fact.fact_key), value });
    usedKeys.add(key);
  }

  for (const fact of facts) {
    if (usedKeys.has(fact.fact_key)) continue;

    const value = displayFactValueForKey(fact.fact_key, fact.value);
    if (!value) continue;

    rows.push({ label: humanizeFactKey(fact.fact_key), value });
    usedKeys.add(fact.fact_key);
  }

  return rows
    .slice(0, 12)
    .map((row, index) => `${index + 1}. ${row.label}: ${row.value}`)
    .join("\n");
}

function humanizeFactKey(value: string) {
  if (value === "age") {
    return "Age";
  }

  if (value === "preferred_age_range") {
    return "Preferred Age Range";
  }

  if (value === "household_size") {
    return "Household Size";
  }

  if (value === "group_size_flexibility") {
    return "Roommates";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const textProfileSummaryFactOrder = [
  "neighborhoods",
  "move_in_window",
  "household_size",
  "group_size_flexibility",
  "age",
  "preferred_age_range",
  "sleep_schedule",
  "work_from_home",
  "work_hours",
  "routine_regularity",
  "noise_tolerance",
  "cleanliness",
  "guests",
  "overnight_guests",
  "social_energy",
  "privacy",
  "communication_style",
  "planning_style",
  "response_time",
  "house_meetings",
  "conflict_repair",
  "verified_work_or_school",
  "shared_communities",
  "mutuals",
  "references",
  "prior_roommate_context",
  "interests",
  "music_taste",
  "media_taste",
  "aesthetic_taste",
  "pets",
  "dealbreakers",
  "rent_tradeoff",
  "location_tradeoff",
  "commute_tradeoff",
  "room_quality_tradeoff",
  "risk_tolerance",
  "must_haves",
  "commute",
  "accessibility",
  "smoking",
] as const;

function displayFactValueForKey(
  factKey: string,
  value: TextProfileFact["value"],
): string | null {
  if (factKey === "household_size") {
    return displayHouseholdSize(value);
  }

  if (factKey === "move_in_window") {
    return displayMoveInWindow(value);
  }

  if (factKey === "preferred_age_range") {
    return displayAgeRange(value);
  }

  if (factKey === "budget") {
    return displayBudgetValue(value);
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .flatMap(([key, entry]) => {
        if (entry === null || entry === "") return [];
        return `${humanizeObjectKey(key)}: ${entry}`;
      })
      .join(", ");
  }

  return String(value);
}

function displayBudgetFacts(byKey: Map<string, TextProfileFact>): string | null {
  const budgetValue = displayBudgetValue(byKey.get("budget")?.value);
  if (budgetValue) return budgetValue;

  const preferredMax = readMoneyFactValue(byKey.get("budget_preferred_max")?.value);
  const min = readMoneyFactValue(byKey.get("budget_min")?.value);
  const max = readMoneyFactValue(byKey.get("budget_max")?.value);
  if (preferredMax != null && max != null && preferredMax < max) {
    return `target up to ${formatSmsCurrency(preferredMax)}/mo, stretch to ${formatSmsCurrency(max)}/mo`;
  }
  if (preferredMax != null) {
    return `target up to ${formatSmsCurrency(preferredMax)}/mo`;
  }
  if (min != null && max != null) {
    return `${formatSmsCurrency(min)}-${formatSmsCurrency(max)}/mo`;
  }
  if (max != null) {
    return `up to ${formatSmsCurrency(max)}/mo`;
  }
  if (min != null) {
    return `from ${formatSmsCurrency(min)}/mo`;
  }
  return null;
}

function displayBudgetValue(value: TextProfileFact["value"] | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const min = readNumberField(value, "min");
  const max = readNumberField(value, "max");
  if (min != null && max != null) {
    return `${formatSmsCurrency(min)}-${formatSmsCurrency(max)}/mo`;
  }
  return null;
}

function displayHouseholdSize(value: TextProfileFact["value"]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return displayFactValueForKey("group_size_flexibility", value);
  }

  const min = readNumberField(value, "min");
  const max = readNumberField(value, "max");
  if (min === 1 && max === 1) return "solo only";
  if (min === 1 && max === 2) {
    return "solo or one roommate (1-2 people total)";
  }
  if (min === 2 && max === 2) {
    return "you plus one roommate (2 people total)";
  }
  if (min != null && max != null) return `${min}-${max} people total`;
  if (max != null) return `up to ${max} people total`;
  if (min != null) return `${min}+ people total`;
  return null;
}

function displayMoveInWindow(value: TextProfileFact["value"]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return displayFactValueForKey("move_in", value);
  }

  const start =
    formatShortDateString(readStringField(value, "start")) ??
    formatShortDateString(readStringField(value, "earliest"));
  const end =
    formatShortDateString(readStringField(value, "end")) ??
    formatShortDateString(readStringField(value, "latest"));
  if (start && end) return `${start}-${end}`;
  return start ?? end ?? null;
}

function displayAgeRange(value: TextProfileFact["value"]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return displayFactValueForKey("age", value);
  }

  const min = readNumberField(value, "min");
  const max = readNumberField(value, "max");
  const strict = value.strict === true;
  const suffix = strict ? " strict" : "";
  if (min != null && max != null) return `${min}-${max}${suffix}`;
  if (min != null) return `${min}+${suffix}`;
  if (max != null) return `up to ${max}${suffix}`;
  return null;
}

function readMoneyFactValue(value: TextProfileFact["value"] | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberField(
  value: Record<string, string | number | boolean | null>,
  key: string,
) {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function readStringField(
  value: Record<string, string | number | boolean | null>,
  key: string,
) {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function formatSmsCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

const smsShortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatShortDateString(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return smsShortDateFormatter.format(date);
}

function humanizeObjectKey(value: string) {
  return value.replace(/_/g, " ");
}
