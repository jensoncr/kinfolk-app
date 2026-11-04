import { PaneShell } from "@/app/(app)/me/_components/dashboard-layout";
import { ProfilePane } from "@/app/(app)/me/_components/profile-page";
import { getContinueOnPhoneConfig } from "@/lib/integrations/continue-on-phone-server";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";
import { getProfileSummarySnapshot } from "@/lib/profiles/enrichment-store";
import { buildProfileViewModel } from "@/lib/profiles/view";
import type { DashboardSnapshot } from "@/lib/shared/types";

export const metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const [snapshot, enrichment] = await Promise.all([
    getDashboardSnapshot(),
    getProfileSummarySnapshot(),
  ]);
  const view = buildProfileViewModel(snapshot, enrichment);

  return (
    <PaneShell snapshot={snapshot} active="profile" title="Profile">
      <ProfilePane
        continueOnPhoneConfig={getContinueOnPhoneConfig()}
        key={getProfilePaneKey(snapshot)}
        view={view}
      />
    </PaneShell>
  );
}

function getProfilePaneKey(snapshot: DashboardSnapshot) {
  const linkedinProfile = snapshot.linkedinProfile;
  const workKey = linkedinProfile.workExperience.map((item) => item.id).join(",");
  const educationKey = linkedinProfile.education.map((item) => item.id).join(",");
  const matchingKey = [
    snapshot.profile.budgetMin,
    snapshot.profile.budgetMax,
    snapshot.profile.moveInStart,
    snapshot.profile.moveInEnd,
    snapshot.profile.householdSizeMin,
    snapshot.profile.householdSizeMax,
    snapshot.profile.targetMarkets.join(","),
    snapshot.housing.neighborhoods.join(","),
    snapshot.housing.pets,
    snapshot.housing.mustHaves.join(","),
    snapshot.housing.dealbreakers.join(","),
    snapshot.roommate.cleanliness,
    snapshot.roommate.sleepSchedule,
    snapshot.roommate.socialEnergy,
    snapshot.roommate.hostingExpectations,
  ].join(":");

  return [
    snapshot.user.id,
    snapshot.interview.status,
    linkedinProfile.enrichmentStatus,
    linkedinProfile.enrichedAt ?? "",
    workKey,
    educationKey,
    matchingKey,
  ].join(":");
}
