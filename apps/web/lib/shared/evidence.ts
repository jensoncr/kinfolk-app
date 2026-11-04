import type { EvidencePoint } from "@/lib/shared/types";
import type { Json } from "@/lib/supabase/types";

export function parseEvidencePoints(value: Json): EvidencePoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    return typeof item.label === "string" && typeof item.detail === "string"
      ? [{ label: item.label, detail: item.detail }]
      : [];
  });
}
