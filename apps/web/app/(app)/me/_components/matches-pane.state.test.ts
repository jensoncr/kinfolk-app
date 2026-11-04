import { describe, expect, it, vi } from "vitest";
import type {
  PendingGroupRequest,
  RoommateMatch,
  RoommateProfileDetail,
} from "@/lib/matching/matches";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("next/image", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: (props: Record<string, unknown>) => React.createElement("img", props),
    getImageProps: ({ props }: { props: Record<string, unknown> }) => ({ props }),
  };
});

import {
  applySuccessfulRequestResponseState,
  buildGroupRequestResponsePayload,
  clampMatchesScore,
  createMatchesPaneState,
  formatEnrichmentReviewCountLabel,
  formatMatchesScoreLabel,
  formatRoommateMatchBadge,
  getNextMatchesTabFromKey,
  getProfileModalPhotoUrls,
  getVisibleRequestsForMatchesPane,
  getVisibleRoommatesForMatchesPane,
  matchesPaneReducer,
} from "./matches-pane-state";

const profileDetail: RoommateProfileDetail = {
  about: null,
  age: null,
  breakdown: [],
  company: null,
  education: null,
  hometown: null,
  interests: [],
  photos: [],
  school: null,
  signals: [],
};

function makeRequest(overrides: Partial<PendingGroupRequest> = {}): PendingGroupRequest {
  return {
    detail: profileDetail,
    evidence: [],
    fitScore: 88,
    groupId: "group-1",
    groupLabel: "Pacific Heights",
    groupNeighborhood: "Pacific Heights",
    id: "request-1",
    listing: null,
    openSpots: 1,
    requestedAt: "2026-06-21T12:00:00.000Z",
    requesterHeadline: "Designer at Studio",
    requesterImageUrl: null,
    requesterInitials: "AR",
    requesterName: "Avery Reed",
    requesterUserId: "user-requester",
    risks: [],
    ...overrides,
  };
}

function makeRoommate(overrides: Partial<RoommateMatch> = {}): RoommateMatch {
  return {
    components: [],
    computedAt: "2026-06-21T12:00:00.000Z",
    detail: profileDetail,
    evidence: [],
    headline: "Product designer",
    id: "match-1",
    imageUrl: null,
    initials: "ML",
    locked: false,
    name: "Mina Lee",
    risks: [],
    score: 92,
    scoreLow: 86,
    scoreHigh: 96,
    coverage: 0.85,
    incomingIntent: false,
    userId: "user-match",
    ...overrides,
  };
}

describe("matches pane state helpers", () => {
  it("starts in the apartments tab with nothing pending or resolved", () => {
    expect(createMatchesPaneState()).toEqual({
      active: null,
      error: null,
      pendingIds: [],
      resolvedRequestIds: [],
      tab: "apartments",
    });
  });

  it("derives visible requests from the snapshot minus locally resolved ids", () => {
    const request = makeRequest();
    const otherRequest = makeRequest({ id: "request-2", requesterUserId: "user-2" });

    expect(
      getVisibleRequestsForMatchesPane([request, otherRequest], ["request-1"]),
    ).toEqual([otherRequest]);
    // New snapshot requests (e.g. after router.refresh) surface immediately.
    expect(getVisibleRequestsForMatchesPane([request, otherRequest], [])).toEqual([
      request,
      otherRequest,
    ]);
  });

  it("applies direct and functional patches for tab/profile interaction state", () => {
    const initial = createMatchesPaneState();
    const opened = matchesPaneReducer(initial, {
      active: { kind: "match", id: "match-1" },
      tab: "roommates",
    });
    const withError = matchesPaneReducer(opened, (state) => ({
      error: state.active?.id ?? "missing-active",
    }));

    expect(opened.tab).toBe("roommates");
    expect(opened.active).toEqual({ kind: "match", id: "match-1" });
    expect(withError.error).toBe("match-1");
  });

  it("resolves keyboard navigation for the tablist", () => {
    expect(getNextMatchesTabFromKey("apartments", "ArrowRight")).toBe("roommates");
    expect(getNextMatchesTabFromKey("apartments", "ArrowDown")).toBe("roommates");
    expect(getNextMatchesTabFromKey("roommates", "ArrowLeft")).toBe("apartments");
    expect(getNextMatchesTabFromKey("roommates", "ArrowUp")).toBe("apartments");
    expect(getNextMatchesTabFromKey("roommates", "Home")).toBe("apartments");
    expect(getNextMatchesTabFromKey("apartments", "End")).toBe("roommates");
    expect(getNextMatchesTabFromKey("apartments", "Enter")).toBeNull();
  });

  it("keeps visible match scores within the 0-100 range", () => {
    expect(clampMatchesScore(91.4)).toBe(91);
    expect(clampMatchesScore(128)).toBe(100);
    expect(clampMatchesScore(-4)).toBe(0);
    expect(clampMatchesScore(Number.NaN)).toBe(0);
    expect(formatMatchesScoreLabel(128, "fit")).toBe("100% fit");
    expect(formatMatchesScoreLabel(-4, "match")).toBe("0% match");
  });

  it("shows a confidence range badge when coverage is low, exact score otherwise", () => {
    expect(
      formatRoommateMatchBadge(
        makeRoommate({ score: 38, scoreLow: 23, scoreHigh: 71, coverage: 0.2 }),
      ),
    ).toBe("23–71% match");
    expect(
      formatRoommateMatchBadge(
        makeRoommate({ score: 82, scoreLow: 78, scoreHigh: 88, coverage: 0.9 }),
      ),
    ).toBe("82% match");
    // Edges persisted before coverage metadata fall back to the exact badge.
    expect(
      formatRoommateMatchBadge(
        makeRoommate({ score: 64, scoreLow: null, scoreHigh: null, coverage: null }),
      ),
    ).toBe("64% match");
  });

  it("hides hard-gated roommate matches before rendering the roommate tab count", () => {
    expect(
      getVisibleRoommatesForMatchesPane([
        makeRoommate({ id: "viable", score: 72 }),
        makeRoommate({ id: "hard-gated", score: 0 }),
      ]).map((match) => match.id),
    ).toEqual(["viable"]);
  });

  it("uses profile imageUrl as the profile modal photo fallback", () => {
    expect(
      getProfileModalPhotoUrls(
        makeRoommate({
          detail: { ...profileDetail, photos: [] },
          imageUrl: "https://example.com/mina.jpg",
        }),
      ),
    ).toEqual(["https://example.com/mina.jpg"]);

    expect(
      getProfileModalPhotoUrls(
        makeRoommate({
          detail: { ...profileDetail, photos: ["https://example.com/detail.jpg"] },
          imageUrl: "https://example.com/mina.jpg",
        }),
      ),
    ).toEqual(["https://example.com/detail.jpg"]);

    expect(
      getProfileModalPhotoUrls(
        makeRoommate({
          detail: { ...profileDetail, photos: [] },
          imageUrl: " https://example.com/mina.jpg ",
        }),
      ),
    ).toEqual(["https://example.com/mina.jpg"]);

    expect(
      getProfileModalPhotoUrls(
        makeRoommate({
          detail: { ...profileDetail, photos: [] },
          imageUrl: "   ",
        }),
      ),
    ).toEqual([]);
  });

  it("formats enrichment review count labels from pending fact counts", () => {
    expect(
      formatEnrichmentReviewCountLabel({
        memoriesHref: "/me/settings/memories",
        message: "Review imported memories.",
        pendingBehavioralCount: 1,
        pendingFactCount: 3,
      }),
    ).toBe("3 facts pending · 1 lifestyle");

    expect(
      formatEnrichmentReviewCountLabel({
        memoriesHref: "/me/settings/memories",
        message: "Review imported memories.",
        pendingBehavioralCount: 2,
        pendingFactCount: 2,
      }),
    ).toBe("2 lifestyle facts pending");

    expect(
      formatEnrichmentReviewCountLabel({
        memoriesHref: "/me/settings/memories",
        message: "Review imported memories.",
        pendingBehavioralCount: 0,
        pendingFactCount: 1,
      }),
    ).toBe("1 fact pending");

    expect(
      formatEnrichmentReviewCountLabel({
        memoriesHref: "/me/settings/memories",
        message: "Review imported memories.",
        pendingBehavioralCount: 0,
        pendingFactCount: 0,
      }),
    ).toBe("Memory review pending");
  });

  it("builds approve and decline payloads with the requester as the target user", () => {
    const request = makeRequest({
      groupId: "group-42",
      requesterUserId: "user-99",
    });

    expect(buildGroupRequestResponsePayload(request, true)).toEqual({
      action: "approve_request",
      groupId: "group-42",
      targetUserId: "user-99",
    });
    expect(buildGroupRequestResponsePayload(request, false)).toEqual({
      action: "decline_request",
      groupId: "group-42",
      targetUserId: "user-99",
    });
  });

  it("marks the completed request resolved and closes its open requester profile", () => {
    const state = matchesPaneReducer(createMatchesPaneState(), {
      active: { kind: "request", id: "request-1" },
      pendingIds: ["request-1"],
    });

    expect(applySuccessfulRequestResponseState(state, "request-1")).toEqual({
      active: null,
      resolvedRequestIds: ["request-1"],
    });
  });

  it("preserves an unrelated active profile when another request completes", () => {
    const state = matchesPaneReducer(createMatchesPaneState(), {
      active: { kind: "match", id: "match-1" },
    });

    expect(applySuccessfulRequestResponseState(state, "request-1")).toEqual({
      active: { kind: "match", id: "match-1" },
      resolvedRequestIds: ["request-1"],
    });
  });
});
