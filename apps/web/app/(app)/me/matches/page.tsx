import { DashboardChrome } from "@/app/(app)/me/_components/dashboard-layout";
import { MatchesPane } from "@/app/(app)/me/_components/matches-pane";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";
import { getMatchesSnapshot } from "@/lib/matching/matches";

export const metadata = {
  title: "Matches",
};

export default async function MatchesPage() {
  const [snapshot, matches] = await Promise.all([
    getDashboardSnapshot(),
    getMatchesSnapshot(),
  ]);

  return (
    <DashboardChrome
      active="matches"
      containerClassName="mx-auto w-full max-w-[1200px] px-5 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-8"
      snapshot={snapshot}
    >
      <MatchesPane snapshot={matches} />
    </DashboardChrome>
  );
}
