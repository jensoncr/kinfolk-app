import { PaneShell } from "@/app/(app)/me/_components/dashboard-layout";
import { SettingsPane } from "@/app/(app)/me/_components/settings-page";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";
import { getProfileSummarySnapshot } from "@/lib/profiles/enrichment-store";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const [snapshot, enrichment] = await Promise.all([
    getDashboardSnapshot(),
    getProfileSummarySnapshot(),
  ]);

  return (
    <PaneShell snapshot={snapshot} active="settings" title="Settings">
      <SettingsPane enrichment={enrichment} snapshot={snapshot} />
    </PaneShell>
  );
}
