import type { ProfileEnrichmentSnapshot } from "@/lib/shared/types";

const ASSISTANT_MEMORY_PROVIDERS = new Set(["chatgpt", "claude"]);

export function getMemoriesMeta(
  enrichment: Pick<ProfileEnrichmentSnapshot, "facts" | "imports">,
) {
  const assistantImportIds = new Set<string>();

  for (const profileImport of enrichment.imports) {
    if (ASSISTANT_MEMORY_PROVIDERS.has(profileImport.provider.toLowerCase())) {
      assistantImportIds.add(profileImport.id);
    }
  }

  if (assistantImportIds.size === 0) {
    return "Enrich with AI";
  }

  const signalCount = enrichment.facts.filter((fact) => assistantImportIds.has(fact.importId)).length;

  return signalCount > 0 ? `${signalCount} signals` : "Imported";
}
