"use client";

import { ArrowRight, ChevronLeft, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  FloorPlanType,
  RoommateGroup,
  RoommateGroupMember,
} from "@/lib/apartments/types";
import { formatRoommateWork } from "@/lib/apartments/roommate-profile";
import { profileMatchBandForScore } from "@/lib/matching/profile-match-calibration";
import { type FitTone, fitToneForScore } from "./fit-tone";
import {
  VIEWER_MEMBER_NAME,
  type MembershipStatus,
} from "@/lib/apartments/use-user-groups";
import { Confetti, type ConfettiRef } from "@/components/ui/confetti";
import { MemberAvatar } from "./floor-plan-avatar-stack";
import {
  groupDetailFooterActionState,
  userGroupActionLabel,
} from "./floor-plan-groups-modal-state";
import { summarizeGroupPreferences, type GroupPreferenceChip } from "./group-preferences";
import { MemberProfileModal } from "./member-profile-modal";

const GROUP_CONFETTI_STORAGE_PREFIX = "kinfolk:group-confetti:";

// ── helpers ─────────────────────────────────────────────────────────────
function isUser(member: RoommateGroupMember): boolean {
  return member.name === VIEWER_MEMBER_NAME;
}

function firstName(name: string): string {
  if (name === VIEWER_MEMBER_NAME) return "You";
  return name.split(" ")[0] ?? name;
}

function groupLead(group: RoommateGroup): RoommateGroupMember | null {
  return group.members.find((m) => !isUser(m)) ?? group.members[0] ?? null;
}

function groupTitle(group: RoommateGroup): string {
  const lead = groupLead(group);
  if (!lead || isUser(lead)) return "Your group";
  return `${firstName(lead.name)}'s group`;
}

function memberHeadlineSignals(members: RoommateGroupMember[]): string[] {
  const headlines: string[] = [];
  for (const member of members) {
    if (!member.headline) continue;
    headlines.push(member.headline);
    if (headlines.length === 2) break;
  }
  return headlines;
}

// The seeded `matchSummary` bakes in an "· N open spot(s)" suffix from when the
// group was generated — it goes stale the moment the user joins, and every
// surface that shows the summary already states the open count elsewhere
// (list rows say "needs N", the detail header says "N rooms open"). Strip it.
function groupMatchSummary(group: RoommateGroup): string | null {
  if (!group.matchSummary) return null;
  return group.matchSummary.replace(/ · \d+ open spots?$/, "");
}

function groupIsFull(group: RoommateGroup): boolean {
  return group.members.length >= group.maxSize;
}

function averageMatch(members: RoommateGroupMember[]): number | null {
  const scored = members.filter(
    (m) => !isUser(m) && typeof m.matchScore === "number",
  );
  if (scored.length === 0) return null;
  return Math.round(
    scored.reduce((sum, m) => sum + (m.matchScore ?? 0), 0) / scored.length,
  );
}

// The binding constraint: you live with everyone, so the lowest pairwise fit
// matters more than the average. Only meaningful with 2+ scored members
// (with one, lowest == average).
function lowestMatch(members: RoommateGroupMember[]): { name: string; score: number } | null {
  const scored = members.filter(
    (m) => !isUser(m) && typeof m.matchScore === "number",
  );
  if (scored.length < 2) return null;
  const weakest = scored.reduce((lowest, m) =>
    (m.matchScore ?? 0) < (lowest.matchScore ?? 0) ? m : lowest,
  );
  return { name: firstName(weakest.name), score: weakest.matchScore! };
}

const FIT_RING_FILL: Record<FitTone, string> = {
  positive: "var(--mint-400)",
  caution: "var(--ochre)",
  muted: "var(--ink-300)",
};

// Tone shows up in exactly two places — the ring fill and the band word.
// Panels stay white; emphasis comes from structure, not tinted washes.
const FIT_TITLE: Record<FitTone, string> = {
  positive: "text-[var(--forest-800)]",
  caution: "text-[#7a5220]",
  muted: "text-[var(--ink-700)]",
};

// Honest one-liner for groups with no seeded summary and no weakest pairing to
// name — it must not cheerlead a low score.
const FIT_FALLBACK: Record<FitTone, string> = {
  positive: "Schedules and shared-space habits line up.",
  caution: "Some habits line up; a few are worth talking through.",
  muted: "Not much overlap yet. More profile detail sharpens this.",
};

function matchScoreClass(score: number): string {
  const base = "shrink-0 text-[11px] font-semibold";
  const tone = fitToneForScore(score);
  if (tone === "positive") return `${base} text-[var(--forest-700)]`;
  if (tone === "caution") return `${base} text-[#7a5220]`;
  return `${base} text-[var(--ink-500)]`;
}

// Compact conic-gradient fit ring used on group rows and the detail header.
function FitRing({ score, size = 36 }: { score: number; size?: number }) {
  const inner = size - 12;
  const fill = FIT_RING_FILL[fitToneForScore(score)];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${fill} ${score}%, rgba(28,51,38,0.12) 0)`,
      }}
      aria-hidden="true"
    >
      <span
        className="mono grid place-items-center rounded-full bg-white text-[11px] font-bold text-[var(--forest-800)]"
        style={{ width: inner, height: inner }}
      >
        {score}
      </span>
    </span>
  );
}

// Each member's standing in the group: who started it, who's flexible, etc.
function makeTagFor(group: RoommateGroup) {
  const lead = group.members.find((m) => !isUser(m));
  return (member: RoommateGroupMember): string => {
    if (isUser(member)) return "You";
    if (member.flex) return "Flexible";
    if (lead && member.name === lead.name) return "Started the group";
    return "Confirmed";
  };
}

function preferenceChipClass(tone: GroupPreferenceChip["tone"]): string {
  const base = "inline-flex items-center rounded-md px-2 py-0.5 text-[10.5px] font-medium";
  if (tone === "required") return `${base} bg-[var(--forest-700)] text-white`;
  if (tone === "preferred") {
    return `${base} border border-[var(--border-strong)] text-[var(--ink-600)]`;
  }
  return `${base} bg-[var(--bg-soft)] text-[var(--forest-800)]`;
}

// ── member card ─────────────────────────────────────────────────────────
function MemberCard({
  member,
  tag,
  showScore,
  onOpen,
}: {
  member: RoommateGroupMember;
  tag: string;
  /**
   * Per-member scores only earn their place with 2+ other members; with one,
   * that member's score IS the group score already shown in the fit summary,
   * and repeating the same number an inch apart reads as two different facts.
   */
  showScore: boolean;
  onOpen: (() => void) | null;
}) {
  const workLine = formatRoommateWork(member);

  // The signed-in user's own card — their real photo and occupation, shown
  // the same way as everyone else's, minus the match score and profile link.
  if (isUser(member)) {
    return (
      <div className="flex items-center gap-3 border-t border-[var(--border)] px-5 py-4">
        <span className="relative size-[60px] shrink-0 overflow-hidden rounded-[10px] bg-[var(--forest-700)]">
          {member.imageUrl ? (
            <Image
              src={member.imageUrl}
              alt="Your profile photo"
              fill
              sizes="60px"
              className="object-cover"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-base font-bold text-white">
              {member.initials}
            </span>
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-tight">You</p>
          <p className="mt-0.5 truncate text-[11.5px] text-[var(--ink-500)]">
            {workLine || "This is your place in the group."}
          </p>
        </div>
      </div>
    );
  }

  const body = (
    <>
      <span className="relative size-[60px] shrink-0 overflow-hidden rounded-[10px] bg-[var(--bg-soft)]">
        {member.imageUrl ? (
          <Image
            src={member.imageUrl}
            alt={member.name}
            fill
            sizes="60px"
            className="object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-sm font-bold text-[var(--ink-600)]">
            {member.initials}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[14px] font-semibold leading-tight">
              {member.name}
              <span className="text-[11px] font-normal text-[var(--ink-400)]">{tag}</span>
            </p>
            {workLine ? (
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--ink-500)]">
                {workLine}
              </p>
            ) : null}
            {member.matchReasons && member.matchReasons.length > 0 ? (
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--forest-700)]">
                {member.matchReasons.slice(0, 2).join(" · ")}
              </p>
            ) : null}
          </div>
          {showScore ? (
            typeof member.matchScore === "number" ? (
              <span className={matchScoreClass(member.matchScore)}>
                Fit {member.matchScore}
              </span>
            ) : (
              <span
                className="shrink-0 text-[11px] text-[var(--ink-400)]"
                title="Not enough profile info yet to score this match"
              >
                Fit pending
              </span>
            )
          ) : null}
        </div>
        {onOpen ? (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--forest-700)]">
            View profile <ArrowRight size={11} aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </>
  );

  if (!onOpen) {
    return (
      <div className="flex items-center gap-3 border-t border-[var(--border)] px-5 py-4">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${member.name}'s full profile`}
      className="kin-focus flex w-full items-center gap-3 border-t border-[var(--border)] px-5 py-4 text-left transition hover:bg-[var(--bg-soft)]"
    >
      {body}
    </button>
  );
}

// ── modal ───────────────────────────────────────────────────────────────
type Props = {
  floorPlan: FloorPlanType;
  userGroupId: string | null;
  userStatus: MembershipStatus | null;
  /** False once the viewer already has a group on this listing — one per listing. */
  canStartGroup?: boolean;
  actionError?: string | null;
  onClose: () => void;
  onRequestJoin: (groupId: string) => void;
  onLeave: () => void;
  onStartGroup: () => void;
  pendingAction?: string | null;
};

export function FloorPlanGroupsModal({
  floorPlan,
  userGroupId,
  userStatus,
  canStartGroup = true,
  actionError = null,
  onClose,
  onRequestJoin,
  onLeave,
  onStartGroup,
  pendingAction,
}: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [memberIndex, setMemberIndex] = useState<number | null>(null);
  const confettiRef = useRef<ConfettiRef>(null);

  const selectedGroup = selectedGroupId
    ? floorPlan.groups.find((g) => g.id === selectedGroupId) ?? null
    : null;
  const userGroup = userGroupId
    ? floorPlan.groups.find((group) => group.id === userGroupId) ?? null
    : null;
  const groupsByFit = useMemo(
    () =>
      floorPlan.groups.toSorted(
        (a, b) => (averageMatch(b.members) ?? -1) - (averageMatch(a.members) ?? -1),
      ),
    [floorPlan.groups],
  );

  // The user is a confirmed member of a group that's now full — a completed
  // household. A still-"requested" join doesn't count: nothing is final until
  // the group accepts, so confetti waits for that.
  const userGroupCompleted =
    selectedGroup != null &&
    selectedGroup.id === userGroupId &&
    userStatus === "member" &&
    groupIsFull(selectedGroup);
  const closeModal = useEffectEvent(onClose);

  // If the selected group disappears (e.g. the user left a group they started),
  // `selectedGroup` falls to null and the list renders again — no cleanup needed.

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The member profile modal handles its own Escape.
      if (memberIndex != null) return;
      event.preventDefault();
      if (selectedGroupId) {
        setSelectedGroupId(null);
      } else {
        closeModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [memberIndex, selectedGroupId]);

  // Fire confetti the first time the user's group fills up.
  useEffect(() => {
    if (!userGroupCompleted || userGroupId == null) return;
    const storageKey = `${GROUP_CONFETTI_STORAGE_PREFIX}${userGroupId}`;
    try {
      if (window.sessionStorage.getItem(storageKey) === "1") {
        return;
      }
    } catch {
      // Storage can be unavailable in private contexts; the effect dependencies
      // still prevent repeats for the same completed group while mounted.
    }
    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Best-effort only; the celebration itself should not depend on storage.
    }
    // Let the detail view paint the full roster before the burst.
    const timer = window.setTimeout(() => {
      confettiRef.current?.fire({
        particleCount: 130,
        spread: 100,
        startVelocity: 42,
        ticks: 220,
        origin: { y: 0.45 },
        colors: ["#1c3326", "#7fb98a", "#c78b3e", "#d8e8d3", "#ffffff"],
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [userGroupCompleted, userGroupId]);

  if (typeof document === "undefined") return null;

  const bedrooms = floorPlan.bedrooms ?? 0;
  const isStartingGroup = pendingAction?.startsWith("start:") ?? false;

  return createPortal(
    <dialog
      open
      aria-modal="true"
      aria-label={
        selectedGroup
          ? `${groupTitle(selectedGroup)} on ${floorPlan.name}`
          : `Groups on ${floorPlan.name}`
      }
      className="fixed inset-0 z-[70] m-0 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-transparent p-0 px-3 py-3 sm:px-6 sm:py-6"
    >
      <button
        type="button"
        aria-label="Close groups panel"
        onClick={onClose}
        className="absolute inset-0 -z-10 bg-[rgba(14,31,23,0.45)] backdrop-blur-[4px]"
      />
      <div className="relative flex max-h-[86vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-white text-[var(--ink-900)] shadow-[0_40px_120px_-30px_rgba(8,18,12,0.6)]">
        {actionError ? (
          <p
            role="alert"
            className="border-b border-[rgba(199,139,62,0.28)] bg-[rgba(199,139,62,0.12)] px-5 py-2 text-sm font-semibold text-[var(--ink-800)]"
          >
            {actionError}
          </p>
        ) : null}
        {selectedGroup ? (
          <FloorPlanGroupDetail
            canStartGroup={canStartGroup}
            floorPlan={floorPlan}
            group={selectedGroup}
            pendingAction={pendingAction}
            userGroupId={userGroupId}
            userStatus={userStatus}
            onBack={() => setSelectedGroupId(null)}
            onClose={onClose}
            onLeave={onLeave}
            onOpenMember={setMemberIndex}
            onRequestJoin={onRequestJoin}
          />
        ) : (
          <FloorPlanGroupsList
            bedrooms={bedrooms}
            canStartGroup={canStartGroup}
            floorPlan={floorPlan}
            groupsByFit={groupsByFit}
            isStartingGroup={isStartingGroup}
            pendingAction={pendingAction}
            userGroup={userGroup}
            userGroupId={userGroupId}
            userStatus={userStatus}
            onClose={onClose}
            onLeave={onLeave}
            onSelectGroup={setSelectedGroupId}
            onStartGroup={onStartGroup}
          />
        )}
      </div>

      <Confetti
        ref={confettiRef}
        manualstart
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[80] h-full w-full"
      />

      {selectedGroup && memberIndex != null ? (
        <MemberProfileModal
          members={selectedGroup.members.filter((m) => !isUser(m))}
          index={memberIndex}
          tagFor={makeTagFor(selectedGroup)}
          onIndexChange={setMemberIndex}
          onClose={() => setMemberIndex(null)}
        />
      ) : null}
    </dialog>,
    document.body,
  );
}

function FloorPlanGroupsList({
  bedrooms,
  canStartGroup,
  floorPlan,
  groupsByFit,
  isStartingGroup,
  pendingAction,
  userGroup,
  userGroupId,
  userStatus,
  onClose,
  onLeave,
  onSelectGroup,
  onStartGroup,
}: {
  bedrooms: number;
  canStartGroup: boolean;
  floorPlan: FloorPlanType;
  groupsByFit: RoommateGroup[];
  isStartingGroup: boolean;
  pendingAction?: string | null;
  userGroup: RoommateGroup | null;
  userGroupId: string | null;
  userStatus: MembershipStatus | null;
  onClose: () => void;
  onLeave: () => void;
  onSelectGroup: (groupId: string) => void;
  onStartGroup: () => void;
}) {
  return (
    <>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <p className="serif text-lg font-semibold text-[var(--ink-900)]">
            Groups on {floorPlan.name}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--ink-500)]">
            Groups of up to {bedrooms} people · {floorPlan.groups.length} forming
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="kin-focus grid size-7 place-items-center rounded-full border border-[var(--border)] bg-white text-[var(--ink-600)] transition hover:bg-[var(--bg-soft)]"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </header>

      {floorPlan.groups.length === 0 ? (
        <EmptyGroupsState
          canStartGroup={canStartGroup}
          isStartingGroup={isStartingGroup}
          onStartGroup={onStartGroup}
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto">
          {groupsByFit.map((group) => (
            <FloorPlanGroupRow
              key={group.id}
              group={group}
              userGroupId={userGroupId}
              userStatus={userStatus}
              onSelectGroup={onSelectGroup}
            />
          ))}
        </ul>
      )}

      {floorPlan.groups.length > 0 ? (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] bg-[#fbfaf5] px-5 py-3">
          <p className="text-[12px] text-[var(--ink-500)]">
            {userGroupId
              ? "Manage your group on this plan"
              : canStartGroup
                ? "Tap a group to review it"
                : "You already have a group on this listing"}
          </p>
          {userGroupId ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLeave();
              }}
              disabled={pendingAction === `leave:${userGroupId}`}
              className="kin-focus rounded-full border border-[var(--border-strong)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--rust)] transition hover:bg-[var(--bg-soft)]"
            >
              {userGroupActionLabel(userGroup, userStatus)}
            </button>
          ) : canStartGroup ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStartGroup();
              }}
              disabled={isStartingGroup}
              className="kin-focus rounded-full border border-[var(--border-strong)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink-900)] transition hover:bg-[var(--bg-soft)]"
            >
              {isStartingGroup ? "Starting..." : "Start new group"}
            </button>
          ) : null}
        </footer>
      ) : null}
    </>
  );
}

function EmptyGroupsState({
  canStartGroup,
  isStartingGroup,
  onStartGroup,
}: {
  canStartGroup: boolean;
  isStartingGroup: boolean;
  onStartGroup: () => void;
}) {
  return (
    <div className="px-5 py-8 text-center">
      <p className="serif text-base text-[var(--ink-900)]">No groups here yet.</p>
      {canStartGroup ? (
        <>
          <p className="mt-1 text-sm text-[var(--ink-600)]">
            Start one and Kinfolk will surface matches.
          </p>
          <button
            type="button"
            onClick={onStartGroup}
            disabled={isStartingGroup}
            className="kin-focus mt-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--forest-700)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--forest-800)]"
          >
            {isStartingGroup ? "Starting..." : "Start a group"}
          </button>
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--ink-600)]">
          You already have a group on this listing.
        </p>
      )}
    </div>
  );
}

function FloorPlanGroupRow({
  group,
  userGroupId,
  userStatus,
  onSelectGroup,
}: {
  group: RoommateGroup;
  userGroupId: string | null;
  userStatus: MembershipStatus | null;
  onSelectGroup: (groupId: string) => void;
}) {
  const ready = group.members.length >= group.maxSize;
  const needs = group.maxSize - group.members.length;
  const isUserInThis = group.id === userGroupId;
  const groupFit = averageMatch(group.members);
  const prefChips = summarizeGroupPreferences(group.preferences);
  const memberHeadlines = memberHeadlineSignals(group.members);
  const matchSummary = groupMatchSummary(group);
  const openSpotKeys = Array.from(
    { length: Math.max(0, needs) },
    (_, slot) => `${group.id}-open-${slot}`,
  );

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectGroup(group.id)}
        aria-label={`View ${groupTitle(group)}`}
        className={[
          "kin-focus flex w-full items-center gap-4 px-5 py-4 text-left transition",
          isUserInThis
            ? "bg-[var(--mint-100)]/40 hover:bg-[var(--mint-100)]/70"
            : "hover:bg-[var(--bg-soft)]",
        ].join(" ")}
      >
        <GroupAvatarStack group={group} openSpotKeys={openSpotKeys} ready={ready} />
        <div className="min-w-0 flex-1">
          <p
            className={[
              "text-sm font-semibold",
              group.targetUnitName ? "text-[var(--ink-900)]" : "italic text-[var(--ink-400)]",
            ].join(" ")}
          >
            {group.targetUnitName ? `Unit ${group.targetUnitName}` : "No unit yet"}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-[var(--ink-500)]">
            {group.members.map((m) => firstName(m.name)).join(", ")}
            {needs > 0 ? ` · needs ${needs} more` : ""}
          </p>
          {matchSummary || memberHeadlines.length > 0 ? (
            <p className="mt-1 truncate text-[11px] text-[var(--ink-600)]">
              {matchSummary ?? memberHeadlines.join(" · ")}
            </p>
          ) : null}
          {prefChips.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {prefChips.map((chip) => (
                <span key={chip.label} className={preferenceChipClass(chip.tone)}>
                  {chip.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <GroupFitBadge
          groupFit={groupFit}
          isUserInThis={isUserInThis}
          ready={ready}
          userStatus={userStatus}
        />
      </button>
    </li>
  );
}

function GroupAvatarStack({
  group,
  openSpotKeys,
  ready,
}: {
  group: RoommateGroup;
  openSpotKeys: string[];
  ready: boolean;
}) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-full p-1",
        ready ? "ring-2 ring-[var(--mint-400)] ring-offset-1 ring-offset-white" : "",
      ].join(" ")}
    >
      {group.members.map((member, index) => (
        <span key={`${group.id}-m-${member.name}`} className={index === 0 ? "" : "-ml-2"}>
          <MemberAvatar member={member} />
        </span>
      ))}
      {openSpotKeys.map((openSpotKey) => (
        <span
          key={openSpotKey}
          className="-ml-2 inline-grid size-7 place-items-center rounded-full border border-dashed border-[var(--border-strong)] bg-white text-[10px] font-bold text-[var(--ink-400)] ring-2 ring-white"
          aria-hidden="true"
        >
          +
        </span>
      ))}
    </span>
  );
}

function GroupFitBadge({
  groupFit,
  isUserInThis,
  ready,
  userStatus,
}: {
  groupFit: number | null;
  isUserInThis: boolean;
  ready: boolean;
  userStatus: MembershipStatus | null;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      {groupFit != null ? (
        <FitRing score={groupFit} size={36} />
      ) : (
        <span
          className="grid size-9 place-items-center rounded-full border border-dashed border-[var(--border-strong)] text-[11px] font-bold text-[var(--ink-400)]"
          title="Not enough profile info yet to score this match"
          aria-hidden="true"
        >
          –
        </span>
      )}
      {isUserInThis && userStatus === "requested" ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ochre)]">
          <span className="size-1 animate-pulse rounded-full bg-[var(--ochre)]" />
          Requested
        </span>
      ) : isUserInThis ? (
        <span className="text-[10px] font-semibold text-[var(--forest-800)]">
          You&apos;re in
        </span>
      ) : ready ? (
        <span className="text-[10px] font-semibold text-[var(--forest-700)]">Ready</span>
      ) : null}
    </div>
  );
}

function FloorPlanGroupDetail({
  canStartGroup,
  floorPlan,
  group,
  pendingAction,
  userGroupId,
  userStatus,
  onBack,
  onClose,
  onLeave,
  onOpenMember,
  onRequestJoin,
}: {
  canStartGroup: boolean;
  floorPlan: FloorPlanType;
  group: RoommateGroup;
  pendingAction?: string | null;
  userGroupId: string | null;
  userStatus: MembershipStatus | null;
  onBack: () => void;
  onClose: () => void;
  onLeave: () => void;
  onOpenMember: (index: number) => void;
  onRequestJoin: (groupId: string) => void;
}) {
  const tagFor = makeTagFor(group);
  const profileMembers = group.members.filter((m) => !isUser(m));
  const spotsOpen = Math.max(0, group.maxSize - group.members.length);
  const ready = spotsOpen === 0;
  const isUserInThis = group.id === userGroupId;
  const isSoloUserGroup = isUserInThis && group.members.length <= 1;
  const hasOtherMembership =
    (userGroupId != null && userGroupId !== group.id) ||
    (!canStartGroup && !isUserInThis);
  const avg = averageMatch(group.members);
  const lowest = lowestMatch(group.members);
  const prefChips = summarizeGroupPreferences(group.preferences);
  // The single place the open-room count is stated. The fit summary and the
  // footer both used to repeat it; three copies of "1 open spot" is why this
  // screen read as confusing.
  const spotsLine = ready
    ? "Full — ready to book"
    : `${spotsOpen} of ${group.maxSize} ${group.maxSize === 1 ? "room" : "rooms"} open`;

  return (
    <>
      <header className="shrink-0 border-b border-[var(--border)] px-5 pb-4 pt-3.5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="kin-focus inline-flex items-center gap-0.5 rounded-full py-1 pl-0.5 pr-2 text-[12px] font-medium text-[var(--ink-500)] transition hover:bg-[var(--bg-soft)] hover:text-[var(--ink-700)]"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            All groups
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="kin-focus grid size-7 place-items-center rounded-full border border-[var(--border)] bg-white text-[var(--ink-600)] transition hover:bg-[var(--bg-soft)]"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
        <p className="serif mt-2 text-[22px] font-semibold leading-tight">
          {groupTitle(group)}
        </p>
        <p className="mt-1 text-[12.5px] text-[var(--ink-500)]">
          {floorPlan.name} · {spotsLine}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <GroupFitSummary avg={avg} lowest={lowest} />

        <p className="px-5 pb-1 pt-4 text-[12px] font-semibold text-[var(--ink-600)]">
          Who you&apos;d live with
        </p>
        {group.members.some((member) => member.locked) ? (
          <p className="px-5 pb-2 text-[11.5px] leading-snug text-[var(--ink-600)]">
            Anonymous profiles unlock if the group accepts you.
          </p>
        ) : null}
        {group.members.map((member) => {
          const profileIndex = profileMembers.indexOf(member);
          return (
            <MemberCard
              key={member.userId ?? member.name}
              member={member}
              tag={tagFor(member)}
              showScore={profileMembers.length > 1}
              onOpen={
                profileIndex >= 0 && !member.locked
                  ? () => onOpenMember(profileIndex)
                  : null
              }
            />
          );
        })}

        {prefChips.length > 0 ? (
          <>
            <p className="border-t border-[var(--border)] px-5 pb-1.5 pt-4 text-[12px] font-semibold text-[var(--ink-600)]">
              House rules this group set
            </p>
            <div className="flex flex-wrap gap-1.5 px-5 pb-4">
              {prefChips.map((chip) => (
                <span key={chip.label} className={preferenceChipClass(chip.tone)}>
                  {chip.label}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <GroupDetailFooter
        group={group}
        hasOtherMembership={hasOtherMembership}
        isSoloUserGroup={isSoloUserGroup}
        isUserInThis={isUserInThis}
        pendingAction={pendingAction}
        ready={ready}
        userStatus={userStatus}
        onLeave={onLeave}
        onRequestJoin={onRequestJoin}
      />
    </>
  );
}

function GroupFitSummary({
  avg,
  lowest,
}: {
  avg: number | null;
  lowest: { name: string; score: number } | null;
}) {
  if (avg == null) {
    return (
      <div className="flex items-center gap-3.5 border-b border-[var(--border)] px-5 py-4">
        <span className="grid size-[52px] shrink-0 place-items-center rounded-full border border-dashed border-[var(--border-strong)] text-lg font-bold text-[var(--ink-400)]">
          ?
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[var(--ink-700)]">
            Fit not scored yet
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-500)]">
            Add more to your profile and Kinfolk will score how well you&apos;d fit this household.
          </p>
        </div>
      </div>
    );
  }

  const tone = fitToneForScore(avg);

  return (
    <div className="flex items-center gap-3.5 border-b border-[var(--border)] px-5 py-4">
      <FitRing score={avg} size={52} />
      <div className="min-w-0">
        <p className={`text-[14px] font-semibold leading-tight ${FIT_TITLE[tone]}`}>
          {profileMatchBandForScore(avg).label}
          <span className="font-normal text-[var(--ink-500)]"> — your fit with this household</span>
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-600)]">
          {lowest
            ? `Lowest pairing: ${lowest.name} at ${lowest.score}.`
            : FIT_FALLBACK[tone]}
        </p>
      </div>
    </div>
  );
}

function GroupDetailFooter({
  group,
  hasOtherMembership,
  isSoloUserGroup,
  isUserInThis,
  pendingAction,
  ready,
  userStatus,
  onLeave,
  onRequestJoin,
}: {
  group: RoommateGroup;
  hasOtherMembership: boolean;
  isSoloUserGroup: boolean;
  isUserInThis: boolean;
  pendingAction?: string | null;
  ready: boolean;
  userStatus: MembershipStatus | null;
  onLeave: () => void;
  onRequestJoin: (groupId: string) => void;
}) {
  const actionState = groupDetailFooterActionState({
    group,
    hasOtherMembership,
    isSoloUserGroup,
    isUserInThis,
    pendingAction,
    ready,
    userStatus,
  });

  return (
    <footer className="shrink-0 border-t border-[var(--border)] bg-white px-5 py-3.5">
      {actionState.kind === "requested" ? (
        <div className="flex items-center gap-3">
          <span className="mt-0.5 size-2 shrink-0 animate-pulse rounded-full bg-[var(--ochre)]" />
          <p className="flex-1 text-[12px] leading-snug text-[var(--ink-600)]">
            <span className="font-semibold text-[var(--ink-900)]">Request sent.</span>{" "}
            {actionState.statusText}
          </p>
          <button
            type="button"
            onClick={onLeave}
            disabled={actionState.disabled}
            className="kin-focus shrink-0 rounded-full border border-[var(--border-strong)] bg-white px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-700)] transition hover:bg-[var(--bg-soft)]"
          >
            {actionState.buttonLabel}
          </button>
        </div>
      ) : actionState.kind === "member" ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[12px] leading-snug text-[var(--ink-600)]">
            <span className="font-semibold text-[var(--ink-900)]">
              You&apos;re in this group.
            </span>{" "}
            {actionState.detailText}
          </p>
          <button
            type="button"
            onClick={onLeave}
            disabled={actionState.disabled}
            className="kin-focus shrink-0 rounded-full border border-[var(--border-strong)] bg-white px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-700)] transition hover:bg-[var(--bg-soft)]"
          >
            {actionState.buttonLabel}
          </button>
        </div>
      ) : actionState.kind === "other-membership" ? (
        <p className="text-[12px] leading-snug text-[var(--ink-500)]">
          {actionState.detailText}
        </p>
      ) : actionState.kind === "full" ? (
        <p className="text-[12px] leading-snug text-[var(--ink-600)]">
          {actionState.detailText}
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[12px] leading-snug text-[var(--ink-500)]">
            {actionState.detailText}
          </p>
          <button
            type="button"
            onClick={() => onRequestJoin(group.id)}
            disabled={actionState.disabled}
            className="kin-focus shrink-0 rounded-full bg-[var(--forest-700)] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[var(--forest-800)] disabled:opacity-60"
          >
            {actionState.buttonLabel}
          </button>
        </div>
      )}
    </footer>
  );
}
