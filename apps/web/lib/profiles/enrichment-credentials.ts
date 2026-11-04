import type { Json } from "@/lib/supabase/types";

/** A school/company credential with its enrichment logo (logo may be null). */
export type RoommateCredential = {
  label: string;
  logoUrl: string | null;
};

/**
 * Pull the first timeline item's `{ organization, logoUrl }` from an enrichment
 * JSONB column (`professional_profiles.experiences` / `.education`). The
 * enrichment writes the current/most-recent entry first, so the first item's
 * logo pairs with the flat `occupation_company` / `education_school` shown on
 * roommate cards.
 */
export function parseFirstCredential(value: Json): RoommateCredential | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const label = typeof record.organization === "string" ? record.organization.trim() : "";
    if (!label) continue;
    const logoUrl =
      typeof record.logoUrl === "string" && record.logoUrl.trim() ? record.logoUrl : null;
    return { label, logoUrl };
  }
  return null;
}
