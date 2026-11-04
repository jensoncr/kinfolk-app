import type {
  MatchesSnapshot,
  PendingGroupRequest,
  RoommateMatch,
  RoommateProfileDetail,
} from "@/lib/matching/matches";
import { isViableRoommateMatch } from "@/lib/matching/roommate-match-viability";

export type Tab = "apartments" | "roommates";
type ActiveProfile = { kind: "match" | "request"; id: string } | null;

export type MatchesPaneState = {
  active: ActiveProfile;
  error: string | null;
  /** Request ids with an in-flight respond POST (a Set-as-array so concurrent
   * responses can't re-enable each other's buttons mid-flight). */
  pendingIds: string[];
  /** Requests resolved locally this session; the visible list is derived from
   * the latest snapshot minus these, so router.refresh() results (new
   * requests arriving mid-session) actually surface. */
  resolvedRequestIds: string[];
  tab: Tab;
};

type MatchesPanePatch =
  | Partial<MatchesPaneState>
  | ((state: MatchesPaneState) => Partial<MatchesPaneState>);

export type ProfileModalPhotoSource = {
  detail: Pick<RoommateProfileDetail, "photos">;
  imageUrl: string | null;
};

type EnrichmentReview = NonNullable<MatchesSnapshot["enrichmentReview"]>;

export function createMatchesPaneState(): MatchesPaneState {
  return {
    active: null,
    error: null,
    pendingIds: [],
    resolvedRequestIds: [],
    tab: "apartments",
  };
}

export function getVisibleRequestsForMatchesPane(
  requests: PendingGroupRequest[],
  resolvedRequestIds: string[],
): PendingGroupRequest[] {
  return requests.filter((request) => !resolvedRequestIds.includes(request.id));
}

export function matchesPaneReducer(
  state: MatchesPaneState,
  patch: MatchesPanePatch,
): MatchesPaneState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function getNextMatchesTabFromKey(current: Tab, key: string): Tab | null {
  if (key === "ArrowRight" || key === "ArrowDown") {
    return current === "apartments" ? "roommates" : "apartments";
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return current === "roommates" ? "apartments" : "roommates";
  }
  if (key === "Home") return "apartments";
  if (key === "End") return "roommates";
  return null;
}

export function getVisibleRoommatesForMatchesPane(roommates: RoommateMatch[]): RoommateMatch[] {
  return roommates.filter(isViableRoommateMatch);
}

export function clampMatchesScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function formatMatchesScoreLabel(score: number, suffix: string): string {
  return `${clampMatchesScore(score)}% ${suffix}`;
}

/**
 * Confidence-aware roommate badge. When the pair has little two-sided signal
 * (low coverage), an exact "52% match" overstates what we know — show the
 * honest range the engine computed instead; it narrows as facts arrive.
 */
export function formatRoommateMatchBadge(
  match: Pick<RoommateMatch, "score" | "scoreLow" | "scoreHigh" | "coverage">,
): string {
  if (
    match.coverage != null &&
    match.coverage < 0.7 &&
    match.scoreLow != null &&
    match.scoreHigh != null &&
    match.scoreHigh - match.scoreLow >= 8
  ) {
    return `${clampMatchesScore(match.scoreLow)}–${clampMatchesScore(match.scoreHigh)}% match`;
  }
  return formatMatchesScoreLabel(match.score, "match");
}

export function buildGroupRequestResponsePayload(
  request: Pick<PendingGroupRequest, "groupId" | "requesterUserId">,
  approve: boolean,
) {
  return {
    action: approve ? "approve_request" : "decline_request",
    groupId: request.groupId,
    targetUserId: request.requesterUserId,
  };
}

export function applySuccessfulRequestResponseState(
  state: MatchesPaneState,
  requestId: string,
): Pick<MatchesPaneState, "active" | "resolvedRequestIds"> {
  return {
    active:
      state.active?.kind === "request" && state.active.id === requestId
        ? null
        : state.active,
    resolvedRequestIds: [...state.resolvedRequestIds, requestId],
  };
}

export function getProfileModalPhotoUrls(profile: ProfileModalPhotoSource): string[] {
  if (profile.detail.photos.length > 0) return profile.detail.photos;
  const fallback = profile.imageUrl?.trim();
  return fallback ? [fallback] : [];
}

export function formatEnrichmentReviewCountLabel(review: EnrichmentReview): string {
  const factCount = Math.max(0, review.pendingFactCount);
  const behavioralCount = Math.max(0, review.pendingBehavioralCount);
  const factLabel = `${factCount} ${factCount === 1 ? "fact" : "facts"} pending`;

  if (factCount > 0 && behavioralCount > 0 && behavioralCount !== factCount) {
    return `${factLabel} · ${behavioralCount} lifestyle`;
  }
  if (behavioralCount > 0) {
    return `${behavioralCount} lifestyle ${behavioralCount === 1 ? "fact" : "facts"} pending`;
  }
  if (factCount > 0) {
    return factLabel;
  }
  return "Memory review pending";
}
