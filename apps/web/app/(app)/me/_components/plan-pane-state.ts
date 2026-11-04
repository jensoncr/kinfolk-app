import { normalizeSavedAreaLabel, savedAreaLabelKey } from "@/lib/plan/saved-place-labels";
import type { LivingPlan, SavedListing } from "@/lib/plan/plan";
import {
  locationLabelsMatch,
  normalizeMapboxLocationLabel,
  type LocationSuggestion,
} from "@/lib/shared/location-suggestions";

export type PlanSaveState = "idle" | "saving" | "saved" | "error";
type PlanSaveResult = "success" | "error";
const CITY_CHIP_SELECTION_ERROR = "Choose a city from the suggestions.";
const PLAN_INTENT_PAYLOAD_KEYS = [
  "futureCities",
  "moveHorizon",
  "relocationFlexibility",
  "intentNote",
  "silentMatcherEnabled",
];

export type PlanMatch = {
  userId: string;
  name: string;
  initials: string;
  imageUrl: string | null;
  headline: string;
  score: number;
  components: { label: string; score: number }[];
};

export type PlanInviteLinkView = {
  url: string;
  openInviteCount: number;
};

type InviteClipboard = {
  writeText: (text: string) => Promise<void> | void;
};

type InviteShare = (data: { title: string; text: string; url: string }) => Promise<void> | void;

export type InviteBrowserApi = {
  clipboard?: InviteClipboard | null;
  share?: InviteShare | null;
};

export type InviteShareResult = "shared" | "copied" | "copy_failed";

export function planSaveStateForLatestResult(
  requestId: number,
  latestRequestId: number,
  result: PlanSaveResult,
): Extract<PlanSaveState, "saved" | "error"> | null {
  if (requestId !== latestRequestId) return null;
  return result === "success" ? "saved" : "error";
}

export function formatOpenInviteCountLabel(count: number): string {
  const safeCount = Math.max(0, Math.floor(count));
  return `${safeCount} open ${safeCount === 1 ? "invite" : "invites"}`;
}

export function resolveInviteLinkUrl(url: string, origin?: string): string {
  if (!origin) return url;
  try {
    const base = new URL(origin);
    const inviteUrl = new URL(url, base.origin);
    if (!inviteUrl.pathname.startsWith("/invite/")) {
      return new URL("/me/plan", base.origin).toString();
    }
    return new URL(
      `${inviteUrl.pathname}${inviteUrl.search}${inviteUrl.hash}`,
      base.origin,
    ).toString();
  } catch {
    return url;
  }
}

export async function copyInviteLinkToClipboard(
  absoluteUrl: string,
  browserApi: InviteBrowserApi,
): Promise<boolean> {
  if (!browserApi.clipboard?.writeText) return false;
  try {
    await browserApi.clipboard.writeText(absoluteUrl);
    return true;
  } catch {
    return false;
  }
}

export async function shareInviteLink(
  absoluteUrl: string,
  browserApi: InviteBrowserApi,
): Promise<InviteShareResult> {
  if (browserApi.share) {
    try {
      await browserApi.share({
        title: "Join my Kinfolk plan",
        text: "I'm planning where to live next. Join my plan on Kinfolk.",
        url: absoluteUrl,
      });
      return "shared";
    } catch {
      // Fall through to clipboard copy if the share sheet is dismissed or blocked.
    }
  }

  return (await copyInviteLinkToClipboard(absoluteUrl, browserApi)) ? "copied" : "copy_failed";
}

export function clampPlanMatchScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function formatPlanMatchScoreLabel(score: number): string {
  return `${clampPlanMatchScore(score)}%`;
}

export function planMatchComponentBarWidth(score: number): string {
  const clampedScore = clampPlanMatchScore(score);
  if (clampedScore === 0) return "0%";
  return `${Math.max(6, clampedScore)}%`;
}

export function applyPlanPatch(plan: LivingPlan, patch: Partial<LivingPlan>): LivingPlan {
  return { ...plan, ...patch };
}

export function buildPlanIntentPayload(persisted: Record<string, unknown>) {
  return Object.fromEntries(
    PLAN_INTENT_PAYLOAD_KEYS.filter((key) => Object.hasOwn(persisted, key)).map((key) => [
      key,
      persisted[key],
    ]),
  );
}

export function buildSilentMatcherIntentPayload(enabled: boolean) {
  return { silentMatcherEnabled: enabled };
}

export function planStateAfterFailedSync(
  current: LivingPlan,
  optimistic: LivingPlan,
  previous: LivingPlan,
) {
  return livingPlansEqual(current, optimistic) ? previous : current;
}

export function nextSavedAreasState(
  savedAreas: string[],
  label: string,
  nextSaved: boolean,
) {
  const normalizedLabel = normalizeSavedAreaLabel(label);
  if (!normalizedLabel) return savedAreas;
  const labelKey = savedAreaLabelKey(normalizedLabel);

  return nextSaved
    ? savedAreas.some((area) => savedAreaLabelKey(area) === labelKey)
      ? savedAreas
      : [...savedAreas, normalizedLabel]
    : savedAreas.filter((item) => savedAreaLabelKey(item) !== labelKey);
}

export function savedAreasStateAfterFailedSync(
  current: string[],
  optimistic: string[],
  previous: string[],
) {
  return stringListsEqual(current, optimistic) ? previous : current;
}

export function buildSavedAreaPayload(label: string, saved: boolean) {
  return { kind: "area" as const, areaLabel: normalizeSavedAreaLabel(label), saved };
}

export function removeSavedListingState(
  savedListings: SavedListing[],
  listing: Pick<SavedListing, "savedId">,
) {
  return savedListings.filter((item) => item.savedId !== listing.savedId);
}

export function savedListingsStateAfterFailedSync(
  current: SavedListing[],
  optimistic: SavedListing[],
  previous: SavedListing[],
) {
  return savedListingIdsEqual(current, optimistic) ? previous : current;
}

export function buildSavedListingPayload(
  listing: Pick<SavedListing, "listingId">,
  saved: boolean,
) {
  return { kind: "listing" as const, listingId: listing.listingId, saved };
}

export function addFutureCityChip(
  values: string[],
  draft: string,
  selectedSuggestion: LocationSuggestion | null,
) {
  const trimmedDraft = draft.trim();
  if (!trimmedDraft) {
    return { values, error: null, clearInput: false };
  }

  if (!selectedSuggestion || !locationLabelsMatch(trimmedDraft, selectedSuggestion.label)) {
    return {
      values,
      error: CITY_CHIP_SELECTION_ERROR,
      clearInput: false,
    };
  }

  const value = normalizeMapboxLocationLabel(selectedSuggestion.label);
  if (!value || selectedSuggestion.city.trim().length === 0) {
    return {
      values,
      error: "Choose a city, not a state or region.",
      clearInput: false,
    };
  }

  if (values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    return { values, error: null, clearInput: true };
  }

  return { values: [...values, value], error: null, clearInput: true };
}

export function removeFutureCityChip(values: string[], value: string) {
  return values.filter((item) => item !== value);
}

export type QuietWatchReadiness = {
  canEnable: boolean;
  message: string;
};

export function quietWatchReadinessForPlan({
  futureCities,
  moveHorizon,
  relocationFlexibility,
}: {
  futureCities: string[];
  moveHorizon: string | null;
  relocationFlexibility: string | null;
}): QuietWatchReadiness {
  const missing: string[] = [];
  if (futureCities.length === 0) missing.push("a future city");
  if (!moveHorizon) missing.push("timing");
  if (!relocationFlexibility) {
    missing.push("readiness");
  } else if (relocationFlexibility === "locked") {
    missing.push("flexible readiness");
  }

  if (missing.length === 0) {
    return {
      canEnable: true,
      message: "Ready for background matching once alerts ship.",
    };
  }

  return {
    canEnable: false,
    message: `Add ${formatMissingQuietWatchRequirements(missing)} before Quiet watch can start.`,
  };
}

function formatMissingQuietWatchRequirements(requirements: string[]): string {
  if (requirements.length === 1) return requirements[0];
  if (requirements.length === 2) return `${requirements[0]} and ${requirements[1]}`;
  return `${requirements.slice(0, -1).join(", ")}, and ${requirements.at(-1)}`;
}

function stringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function livingPlansEqual(left: LivingPlan, right: LivingPlan): boolean {
  return (
    stringListsEqual(left.futureCities, right.futureCities) &&
    left.moveHorizon === right.moveHorizon &&
    left.relocationFlexibility === right.relocationFlexibility &&
    left.intentNote === right.intentNote &&
    left.silentMatcherEnabled === right.silentMatcherEnabled &&
    left.intentConfirmedAt === right.intentConfirmedAt
  );
}

function savedListingIdsEqual(left: SavedListing[], right: SavedListing[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item.savedId === right[index]?.savedId)
  );
}
