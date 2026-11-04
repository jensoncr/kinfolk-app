"use client";

import { ChevronRight, Plus } from "lucide-react";
import Image from "next/image";
import { canSplitByRoommates } from "@/lib/apartments/roommate-splits";
import type {
  FloorPlanType,
  RoommateGroupMember,
  RoommateGroupMemberColor,
} from "@/lib/apartments/types";

const COLOR_CLASS: Record<RoommateGroupMemberColor, string> = {
  forest: "bg-[var(--forest-700)] text-white",
  mint: "bg-[var(--mint-400)] text-[var(--forest-900)]",
  warm: "bg-[var(--ochre)] text-white",
  rust: "bg-[var(--rust)] text-white",
  sage: "bg-[var(--sage)] text-white",
};

export function MemberAvatar({ member }: { member: RoommateGroupMember }) {
  const title = member.flex ? `${member.name} · open to multiple plans` : member.name;
  const classes = [
    "relative inline-grid size-7 place-items-center overflow-hidden rounded-full text-[10px] font-bold ring-2 ring-white",
    member.flex
      ? "border border-dashed border-[var(--ink-400)] bg-white text-[var(--ink-700)]"
      : COLOR_CLASS[member.color],
  ].join(" ");

  if (member.imageUrl) {
    return (
      <span className={classes} title={title}>
        <Image
          src={member.imageUrl}
          alt=""
          fill
          sizes="28px"
          className="object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={classes}
      title={title}
    >
      {member.initials}
    </span>
  );
}

export function FloorPlanAvatarStack({
  floorPlan,
  onOpenGroups,
  onStart,
  canStart = true,
}: {
  floorPlan: FloorPlanType;
  onOpenGroups: () => void;
  onStart: () => void;
  /** False once the viewer already has a group on this listing — one per listing. */
  canStart?: boolean;
}) {
  const bedrooms = floorPlan.bedrooms;
  if (!canSplitByRoommates(bedrooms)) {
    return null;
  }

  if (floorPlan.groups.length === 0) {
    // No groups here yet and the viewer can't start another — nothing to show.
    if (!canStart) return null;
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onStart();
        }}
        aria-label={`Start a group on ${floorPlan.name}`}
        className="kin-focus inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--border-strong)] bg-white px-3 py-1 text-[12px] font-semibold text-[var(--ink-700)] transition hover:border-[var(--forest-700)] hover:text-[var(--forest-700)]"
      >
        <Plus size={11} aria-hidden="true" />
        Start group
      </button>
    );
  }

  const seen = new Set<string>();
  const dedupedMembers: RoommateGroupMember[] = [];
  for (const group of floorPlan.groups) {
    for (const member of group.members) {
      if (seen.has(member.name)) continue;
      seen.add(member.name);
      dedupedMembers.push(member);
    }
  }
  const visible = dedupedMembers.slice(0, 5);
  const overflow = Math.max(0, dedupedMembers.length - visible.length);

  const groupCount = floorPlan.groups.length;
  const onlyGroup = groupCount === 1 ? floorPlan.groups[0]! : null;
  const ready = onlyGroup != null && onlyGroup.members.length === onlyGroup.maxSize;
  const viewerGroup = floorPlan.groups.find(
    (group) =>
      group.viewerMembershipStatus != null ||
      group.members.some(
        (member) =>
          member.name === "You" ||
          member.membershipStatus === "member" ||
          member.membershipStatus === "requested",
      ),
  );
  const shouldShowLabel = groupCount > 1 || viewerGroup != null;
  const groupLabel =
    viewerGroup != null
      ? "Manage group"
      : `${groupCount} group${groupCount === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenGroups();
      }}
      aria-label={`View groups on ${floorPlan.name}`}
      className={[
        "kin-focus inline-flex items-center gap-2 rounded-full transition",
        shouldShowLabel
          ? "border border-[var(--border-strong)] bg-white py-1 pl-1 pr-2.5 hover:bg-[var(--bg-soft)]"
          : "p-1 hover:bg-[var(--bg-soft)]",
        ready ? "ring-2 ring-[var(--mint-400)] ring-offset-1 ring-offset-white" : "",
      ].join(" ")}
    >
      <span className="flex">
        {visible.map((member, index) => (
          <span
            key={`${floorPlan.id ?? floorPlan.name}-${member.userId ?? member.name}`}
            className={index === 0 ? "" : "-ml-2"}
          >
            <MemberAvatar member={member} />
          </span>
        ))}
        {overflow > 0 ? (
          <span
            className="-ml-2 inline-grid size-7 place-items-center rounded-full border border-[var(--border-strong)] bg-white text-[10px] font-bold text-[var(--ink-700)] ring-2 ring-white"
            title={`${overflow} more`}
          >
            +{overflow}
          </span>
        ) : null}
      </span>
      {shouldShowLabel ? (
        <>
          <span className="text-[12px] font-semibold text-[var(--ink-700)]">
            {groupLabel}
          </span>
          <ChevronRight size={12} className="text-[var(--ink-500)]" aria-hidden="true" />
        </>
      ) : null}
    </button>
  );
}
