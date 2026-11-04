import type { FloorPlanType } from "@/lib/apartments/types";
import { formatCurrency } from "@/lib/shared/currency";

const longDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});
export const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
export const collapsedFloorPlanCount = 4;

export type AmenityChipItem = {
  amenity: string;
  highlighted: boolean;
};

export function buildAmenityChipItems({
  hasActiveSelection,
  selectedAmenities,
  propertyAmenities,
}: {
  hasActiveSelection: boolean;
  selectedAmenities: string[];
  propertyAmenities: string[];
}): AmenityChipItem[] {
  const selectedKeys = new Set(
    selectedAmenities
      .map((amenity) => amenity.trim().toLowerCase())
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const ordered: AmenityChipItem[] = [];
  for (const amenity of [...selectedAmenities, ...propertyAmenities]) {
    const label = amenity.trim();
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push({
      amenity: label,
      highlighted: hasActiveSelection && selectedKeys.has(key),
    });
  }
  return ordered;
}

export function formatDate(value: string | null, formatter: Intl.DateTimeFormat = longDate) {
  if (!value) return "Ask agent";
  return formatter.format(new Date(value));
}

export function formatSqftRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null) return `${max!.toLocaleString()} sqft`;
  if (max == null || max === min) return `${min.toLocaleString()} sqft`;
  return `${min.toLocaleString()}–${max.toLocaleString()} sqft`;
}

export function formatRentRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null) return formatCurrency(max!);
  if (max == null || max === min) return formatCurrency(min);
  return `${formatCurrency(min)}–${formatCurrency(max)}`;
}

export function floorPlanKey(type: FloorPlanType, index: number) {
  return `${type.id ?? type.name}-${index}`;
}

export function formatFloorPlanAvailability(type: FloorPlanType) {
  if (type.availableUnits > 0) {
    return `${type.availableUnits} available`;
  }
  if (type.availableAt) {
    return `Available ${formatDate(type.availableAt, shortDate)}`;
  }
  return "Ask for availability";
}

export function sourceLabel(source: string): string {
  if (source === "redfin") return "Redfin";
  if (source === "zillow") return "Zillow";
  if (source === "manual_seed") return "Kinfolk";
  return source.charAt(0).toUpperCase() + source.slice(1);
}
