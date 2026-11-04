import { formatCurrency } from "@/lib/shared/currency";
import type { ProfileSetupState } from "@/lib/profiles/completion";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

export function formatBudgetSummary(min: number, max: number) {
  const hasMin = min > 0;
  const hasMax = max > 0;

  if (hasMin && hasMax && min <= max) {
    return `${formatCurrency(min)}-${formatCurrency(max)}`;
  }
  if (hasMin && !hasMax) {
    return `From ${formatCurrency(min)}`;
  }
  if (!hasMin && hasMax) {
    return `Up to ${formatCurrency(max)}`;
  }
  return undefined;
}

export function formatAgeComfortSummary(setup: ProfileSetupState) {
  const agePart = setup.age != null ? `Age ${setup.age}` : "Add your age";
  const rangePart = formatAgeRangeSummary(
    setup.preferredAgeMin,
    setup.preferredAgeMax,
    setup.preferredAgeStrict,
  );
  return `${agePart} · ${rangePart}`;
}

function formatAgeRangeSummary(
  min: number | null,
  max: number | null,
  strict: boolean,
) {
  if (min == null && max == null) {
    return "No roommate age range";
  }

  const prefix = strict ? "Strict roommate range" : "Roommate range";
  if (min != null && max != null) return `${prefix} ${min}-${max}`;
  if (min != null) return `${prefix} ${min}+`;
  return `${prefix} up to ${max}`;
}

export function formatListSummary(values: string[]) {
  const cleaned = values.flatMap((value) => {
    const summary = cleanPreferenceSummary(value);
    return summary ? [summary] : [];
  });
  return cleaned.length > 0 ? cleaned.join(", ") : undefined;
}

export function cleanPreferenceSummary(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function formatRoommateOpennessSummary(_min: number, max: number) {
  const normalizedMax = Math.max(0, Math.round(max));
  if (normalizedMax <= 0) {
    return undefined;
  }

  if (normalizedMax <= 1) {
    return "Solo only";
  }

  return `Open to households up to ${normalizedMax} ${formatPersonCount(normalizedMax)}`;
}

function formatPersonCount(count: number) {
  return count === 1 ? "person" : "people";
}

export function formatMoveByDate(start: string, end: string) {
  if (start === end) {
    return formatDate(end);
  }
  return `By ${formatDate(end)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return shortDateFormatter.format(new Date(year, month - 1, day));
}
