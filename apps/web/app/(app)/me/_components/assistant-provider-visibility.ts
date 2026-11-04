import type { AssistantProfileProvider } from "@/lib/profiles/enrichment-prompt";
import type { ProfileImportSummary } from "@/lib/shared/types";

const assistantProfileProviders = ["claude", "chatgpt"] as const satisfies readonly AssistantProfileProvider[];

type ProviderView = {
  pending: number;
  failed: boolean;
  settled: boolean;
};

export function getVisibleAssistantProviders(
  imports: ProfileImportSummary[],
  {
    hiddenProviders = [],
    previewAll = false,
  }: {
    hiddenProviders?: readonly AssistantProfileProvider[];
    previewAll?: boolean;
  } = {},
) {
  const hiddenProviderSet = new Set<AssistantProfileProvider>(hiddenProviders);

  return assistantProfileProviders.flatMap((provider) => {
    const view = providerView(imports, provider);
    const shouldShow =
      !hiddenProviderSet.has(provider) && (previewAll || !view.settled);

    return shouldShow ? [{ provider, view }] : [];
  });
}

function providerView(
  imports: ProfileImportSummary[],
  provider: AssistantProfileProvider,
): ProviderView {
  const entries = imports.filter((entry) => normalizeAssistantProvider(entry.provider) === provider);
  const pending = entries.reduce((total, entry) => total + entry.pendingFactCount, 0);
  const hasImport = entries.length > 0;
  const allFailed = hasImport && entries.every((entry) => entry.status === "failed");

  return {
    pending,
    failed: allFailed,
    // Imported successfully with nothing left pending: the prompt is done.
    settled: hasImport && !allFailed && pending === 0,
  };
}

function normalizeAssistantProvider(provider: string) {
  const normalized = provider.toLowerCase();
  return assistantProfileProviders.find((entry) => entry === normalized) ?? null;
}
