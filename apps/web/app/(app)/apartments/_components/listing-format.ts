import { formatCurrency } from "@/lib/shared/currency";

export function formatMaybeMoney(value: number | null) {
  return value == null || value <= 0 ? "Ask agent" : formatCurrency(value);
}

export function formatBedrooms(value: number | null) {
  if (value == null) return "? bd";
  return value === 0 ? "Studio" : `${value} bd`;
}

export function formatBedroomRange(min: number | null, max: number | null) {
  if (min == null && max == null) return null;
  if (min == null) return formatBedrooms(max);
  if (max == null || min === max) return formatBedrooms(min);
  return `${formatBedrooms(min)}-${formatBedrooms(max)}`;
}

export function formatBathrooms(value: number | null) {
  return value == null || value <= 0 ? "? ba" : `${value} ba`;
}

export function formatConcession(months: number, variant: "short" | "long" = "short") {
  if (months > 0 && months < 1) {
    const weeks = Math.round(months * 4);
    return variant === "short"
      ? `${weeks} wks free`
      : `${weeks} week${weeks === 1 ? "" : "s"} free`;
  }

  const rounded = Number.isInteger(months) ? String(months) : String(Number(months.toFixed(2)));
  return variant === "short"
    ? `${rounded} mo free`
    : `${rounded} month${rounded === "1" ? "" : "s"} free`;
}
