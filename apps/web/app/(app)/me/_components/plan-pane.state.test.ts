import { describe, expect, it, vi } from "vitest";
import type { LivingPlan, SavedListing } from "@/lib/plan/plan";
import {
  applyPlanPatch,
  buildPlanIntentPayload,
  buildSavedAreaPayload,
  buildSavedListingPayload,
  buildSilentMatcherIntentPayload,
  clampPlanMatchScore,
  copyInviteLinkToClipboard,
  formatOpenInviteCountLabel,
  formatPlanMatchScoreLabel,
  nextSavedAreasState,
  planMatchComponentBarWidth,
  planSaveStateForLatestResult,
  planStateAfterFailedSync,
  quietWatchReadinessForPlan,
  removeSavedListingState,
  resolveInviteLinkUrl,
  savedAreasStateAfterFailedSync,
  savedListingsStateAfterFailedSync,
  shareInviteLink,
} from "./plan-pane-state";

const plan: LivingPlan = {
  futureCities: ["San Francisco, CA"],
  intentConfirmedAt: "2026-06-21T12:00:00.000Z",
  intentNote: "Sunny kitchen.",
  moveHorizon: "3_6mo",
  relocationFlexibility: "flexible",
  silentMatcherEnabled: false,
};

function makeListing(overrides: Partial<SavedListing> = {}): SavedListing {
  return {
    address: "77 Bruton St",
    beds: "2 bd · 2 ba",
    listingId: "listing-1",
    monthlyRent: 5200,
    neighborhood: "Nob Hill",
    note: null,
    perPersonRent: 2600,
    photoUrl: null,
    savedId: "saved-1",
    ...overrides,
  };
}

describe("plan pane state helpers", () => {
  it("applies local plan edits without mutating the existing plan object", () => {
    const updated = applyPlanPatch(plan, {
      intentNote: "Need a desk and morning light.",
      moveHorizon: "lt_3mo",
    });

    expect(updated).toEqual({
      ...plan,
      intentNote: "Need a desk and morning light.",
      moveHorizon: "lt_3mo",
    });
    expect(updated).not.toBe(plan);
    expect(plan.intentNote).toBe("Sunny kitchen.");
  });

  it("keeps the persisted intent payload narrow to the changed fields", () => {
    const payload = buildPlanIntentPayload({
      localOnlySaveState: "saving",
      moveHorizon: "now",
      profileId: "user-1",
      relocationFlexibility: "ready",
    });

    expect(payload).toEqual({
      moveHorizon: "now",
      relocationFlexibility: "ready",
    });
  });

  it("builds the quiet-watch intent payload from the next switch value", () => {
    expect(buildSilentMatcherIntentPayload(true)).toEqual({
      silentMatcherEnabled: true,
    });
    expect(buildSilentMatcherIntentPayload(false)).toEqual({
      silentMatcherEnabled: false,
    });
  });

  it("summarizes whether Quiet watch can start from the saved plan intent", () => {
    expect(quietWatchReadinessForPlan(plan)).toEqual({
      canEnable: true,
      message: "Ready for background matching once alerts ship.",
    });
    expect(
      quietWatchReadinessForPlan({
        ...plan,
        futureCities: [],
        moveHorizon: null,
        relocationFlexibility: null,
      }),
    ).toEqual({
      canEnable: false,
      message: "Add a future city, timing, and readiness before Quiet watch can start.",
    });
    expect(
      quietWatchReadinessForPlan({
        ...plan,
        relocationFlexibility: "locked",
      }),
    ).toEqual({
      canEnable: false,
      message: "Add flexible readiness before Quiet watch can start.",
    });
  });

  it("ignores stale plan-save responses when a newer edit is in flight", () => {
    expect(planSaveStateForLatestResult(2, 2, "success")).toBe("saved");
    expect(planSaveStateForLatestResult(2, 2, "error")).toBe("error");
    expect(planSaveStateForLatestResult(1, 2, "success")).toBeNull();
    expect(planSaveStateForLatestResult(1, 2, "error")).toBeNull();
  });

  it("rolls back failed plan intent syncs without clobbering newer edits", () => {
    const optimistic = { ...plan, silentMatcherEnabled: true };
    const newer = { ...optimistic, intentNote: "Need an east-facing desk." };

    expect(planStateAfterFailedSync(optimistic, optimistic, plan)).toBe(plan);
    expect(planStateAfterFailedSync(newer, optimistic, plan)).toBe(newer);
  });

  it("formats open invite counts for the People invite row", () => {
    expect(formatOpenInviteCountLabel(0)).toBe("0 open invites");
    expect(formatOpenInviteCountLabel(1)).toBe("1 open invite");
    expect(formatOpenInviteCountLabel(2)).toBe("2 open invites");
    expect(formatOpenInviteCountLabel(-3)).toBe("0 open invites");
  });

  it("resolves invite links against the current browser origin", () => {
    expect(resolveInviteLinkUrl("/invite/kin-123", "https://app.kinfolk.test")).toBe(
      "https://app.kinfolk.test/invite/kin-123",
    );
    expect(
      resolveInviteLinkUrl(
        "https://evil.example/invite/kin-123?code=abc#join",
        "https://app.kinfolk.test",
      ),
    ).toBe("https://app.kinfolk.test/invite/kin-123?code=abc#join");
    expect(resolveInviteLinkUrl("https://evil.example/not-invite", "https://app.kinfolk.test")).toBe(
      "https://app.kinfolk.test/me/plan",
    );
    expect(resolveInviteLinkUrl("https://kinfolk.test/invite/kin-123")).toBe(
      "https://kinfolk.test/invite/kin-123",
    );
    expect(resolveInviteLinkUrl("/invite/kin-123", "not a url")).toBe("/invite/kin-123");
  });

  it("copies invite links only when clipboard access succeeds", async () => {
    const writeText = vi.fn<(text: string) => void>();

    await expect(
      copyInviteLinkToClipboard("https://app.kinfolk.test/invite/kin-123", {
        clipboard: { writeText },
      }),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://app.kinfolk.test/invite/kin-123");

    await expect(
      copyInviteLinkToClipboard("https://app.kinfolk.test/invite/kin-123", {}),
    ).resolves.toBe(false);

    const blockedClipboard = vi.fn<(text: string) => never>(() => {
      throw new Error("blocked");
    });
    await expect(
      copyInviteLinkToClipboard("https://app.kinfolk.test/invite/kin-123", {
        clipboard: { writeText: blockedClipboard },
      }),
    ).resolves.toBe(false);
  });

  it("uses native share for invite links before falling back to clipboard copy", async () => {
    const share = vi.fn<(data: { title: string; text: string; url: string }) => void>();
    const writeText = vi.fn<(text: string) => void>();
    const absoluteUrl = "https://app.kinfolk.test/invite/kin-123";

    await expect(
      shareInviteLink(absoluteUrl, {
        clipboard: { writeText },
        share,
      }),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "Join my Kinfolk plan",
      text: "I'm planning where to live next. Join my plan on Kinfolk.",
      url: absoluteUrl,
    });
    expect(writeText).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new Error("dismissed"));
    await expect(
      shareInviteLink(absoluteUrl, {
        clipboard: { writeText },
        share,
      }),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(absoluteUrl);

    await expect(shareInviteLink(absoluteUrl, {})).resolves.toBe("copy_failed");
  });

  it("keeps Plan match preview scores within the visible 0-100 range", () => {
    expect(clampPlanMatchScore(91.4)).toBe(91);
    expect(clampPlanMatchScore(128)).toBe(100);
    expect(clampPlanMatchScore(-4)).toBe(0);
    expect(clampPlanMatchScore(Number.NaN)).toBe(0);

    expect(formatPlanMatchScoreLabel(128)).toBe("100%");
    expect(planMatchComponentBarWidth(2)).toBe("6%");
    expect(planMatchComponentBarWidth(0)).toBe("0%");
    expect(planMatchComponentBarWidth(128)).toBe("100%");
  });

  it("adds saved areas once and removes only the selected area", () => {
    const existing = ["Pacific Heights"];

    expect(nextSavedAreasState(existing, "  Nob   Hill  ", true)).toEqual([
      "Pacific Heights",
      "Nob Hill",
    ]);
    expect(nextSavedAreasState(existing, " pacific   heights ", true)).toBe(existing);
    expect(
      nextSavedAreasState(["Pacific   Heights", "Nob Hill"], "pacific heights", false),
    ).toEqual(["Nob Hill"]);
  });

  it("rolls back failed saved-area syncs without clobbering newer edits", () => {
    const previous = ["Pacific Heights"];
    const optimistic = ["Pacific Heights", "Nob Hill"];
    const newer = ["Pacific Heights", "Nob Hill", "Hayes Valley"];

    expect(savedAreasStateAfterFailedSync(optimistic, optimistic, previous)).toBe(previous);
    expect(savedAreasStateAfterFailedSync(newer, optimistic, previous)).toBe(newer);
  });

  it("builds the saved-area toggle payload expected by /api/plan/saved", () => {
    expect(buildSavedAreaPayload("  Pacific   Heights ", true)).toEqual({
      areaLabel: "Pacific Heights",
      kind: "area",
      saved: true,
    });
  });

  it("removes one saved listing and builds the listing toggle payload", () => {
    const target = makeListing();
    const other = makeListing({
      address: "2120 Pine St",
      listingId: "listing-2",
      savedId: "saved-2",
    });

    expect(removeSavedListingState([target, other], target)).toEqual([other]);
    expect(buildSavedListingPayload(target, false)).toEqual({
      kind: "listing",
      listingId: "listing-1",
      saved: false,
    });
  });

  it("rolls back failed saved-listing syncs without clobbering newer edits", () => {
    const target = makeListing();
    const other = makeListing({
      address: "2120 Pine St",
      listingId: "listing-2",
      savedId: "saved-2",
    });
    const previous = [target, other];
    const optimistic = [other];
    const newer = [makeListing({ savedId: "saved-3" }), other];

    expect(savedListingsStateAfterFailedSync(optimistic, optimistic, previous)).toBe(previous);
    expect(savedListingsStateAfterFailedSync(newer, optimistic, previous)).toBe(newer);
  });
});
