import type {
  PendingGroupRequest,
  RoommateMatch,
} from "@/lib/matching/matches";
import type {
  GroupJoinProfileCardSnapshot,
  ProfileCardFact,
} from "@/lib/profiles/profile-card";

type RoommateProfileCardFactSource = {
  components: RoommateMatch["components"];
  detail: RoommateMatch["detail"] | PendingGroupRequest["detail"];
  evidence: RoommateMatch["evidence"] | PendingGroupRequest["evidence"];
};

export function buildRoommateMatchProfileCardSnapshot(
  roommate: RoommateMatch,
): GroupJoinProfileCardSnapshot {
  return {
    about: roommate.detail.about,
    facts: buildRoommateProfileCardFacts({
      components: roommate.components,
      detail: roommate.detail,
      evidence: roommate.evidence,
    }),
    fitScore: roommate.score,
    groupLabel: "Kinfolk roommate match",
    groupNeighborhood: "",
    headline: roommate.headline,
    imageUrl: roommate.imageUrl,
    requestedAt: roommate.computedAt,
    requesterInitials: roommate.initials,
    requesterName: roommate.name,
    requesterUserId: roommate.userId,
  };
}

function buildRoommateProfileCardFacts({
  components,
  detail,
  evidence,
}: RoommateProfileCardFactSource): ProfileCardFact[] {
  const signalFacts = detail.signals.map((signal) => ({
    label: signal.label,
    value: signal.value,
  }));
  const componentFacts = components.slice(0, 3).map((component) => ({
    label: component.label,
    value: `${Math.round(component.score)}%`,
  }));
  const evidenceFacts = evidence.slice(0, 2).map((point) => ({
    label: point.label,
    value: point.detail,
  }));

  return [...signalFacts, ...componentFacts, ...evidenceFacts]
    .filter((fact) => fact.label.trim() && fact.value.trim())
    .slice(0, 4);
}
