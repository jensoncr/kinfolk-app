import { PaneShell } from "@/app/(app)/me/_components/dashboard-layout";
import { ProfileEnrichmentPanel } from "@/app/(app)/me/_components/profile-enrichment-panel";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";
import { getProfileSummarySnapshot } from "@/lib/profiles/enrichment-store";

export const metadata = {
  title: "Memories",
};

export default async function MemoriesSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ import?: string | string[]; provider?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const [snapshot, enrichment] = await Promise.all([
    getDashboardSnapshot(),
    getProfileSummarySnapshot(),
  ]);

  return (
    <PaneShell
      snapshot={snapshot}
      active="memories"
      title="Memories"
      eyebrow="Settings · Memories"
      lede="Everything Kinfolk knows about you, with the source for each fact."
    >
      <div className="mx-auto w-full max-w-[760px] space-y-5">
        <ProfileEnrichmentPanel
          initialImportOpen={readSearchParam(params.import) === "1"}
          initialProvider={readSearchParam(params.provider)}
          initialSnapshot={enrichment}
        />
      </div>
    </PaneShell>
  );
}

function readSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
