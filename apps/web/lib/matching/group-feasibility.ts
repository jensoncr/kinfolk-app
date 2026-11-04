/**
 * group-feasibility.ts
 *
 * Pure reconciliation of a roommate group's member constraints — the P4
 * "group formation is unit discovery" arithmetic:
 *
 *   - budget: the group's per-person cap is the TIGHTEST member cap (one
 *     member's $2,400 ceiling binds everyone), the floor is the highest
 *     member floor.
 *   - dealbreakers: the UNION — any member's hard no is the group's hard no.
 *   - move-in: the INTERSECTION of member windows; disjoint windows are a
 *     real feasibility failure, not an average.
 *
 * Design constraints: NO `@/` imports, NO `import "server-only"` — a
 * relative-importable leaf, pure and total (never throws on empty input).
 */

export type GroupMemberConstraints = {
  userId: string;
  /** Per-person monthly budget cap, when known. */
  budgetMax: number | null;
  /** Per-person monthly budget floor, when known. */
  budgetMin: number | null;
  /** Hard no's (free text). */
  dealbreakers: string[];
  /** ISO date bounds of the member's move-in window, when known. */
  moveInStart: string | null;
  moveInEnd: string | null;
};

export type GroupConstraints = {
  /** Tightest member cap — the number every split must clear. Null = no caps known. */
  budgetPerPersonCap: number | null;
  /** Members whose cap IS the binding one (ties included). */
  bindingBudgetUserIds: string[];
  /** Highest member floor, when any floor is known. */
  budgetPerPersonFloor: number | null;
  /** Case-insensitive union of every member's dealbreakers (original casing of first occurrence). */
  dealbreakers: string[];
  /**
   * Overlap of the member move-in windows. Null when no member stated a
   * window OR when stated windows don't overlap — see moveInDisjoint.
   */
  moveInWindow: { start: string; end: string } | null;
  /** True when two members' stated windows cannot overlap at all. */
  moveInDisjoint: boolean;
};

export function reconcileGroupConstraints(
  members: GroupMemberConstraints[],
): GroupConstraints {
  let cap: number | null = null;
  let bindingBudgetUserIds: string[] = [];
  let floor: number | null = null;

  for (const member of members) {
    if (member.budgetMax != null && Number.isFinite(member.budgetMax)) {
      if (cap == null || member.budgetMax < cap) {
        cap = member.budgetMax;
        bindingBudgetUserIds = [member.userId];
      } else if (member.budgetMax === cap) {
        bindingBudgetUserIds.push(member.userId);
      }
    }
    if (member.budgetMin != null && Number.isFinite(member.budgetMin)) {
      floor = floor == null ? member.budgetMin : Math.max(floor, member.budgetMin);
    }
  }

  const seenDealbreakers = new Map<string, string>();
  for (const member of members) {
    for (const dealbreaker of member.dealbreakers) {
      const trimmed = dealbreaker.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seenDealbreakers.has(key)) {
        seenDealbreakers.set(key, trimmed);
      }
    }
  }

  let start: string | null = null;
  let end: string | null = null;
  let sawWindow = false;
  for (const member of members) {
    if (!member.moveInStart && !member.moveInEnd) continue;
    sawWindow = true;
    if (member.moveInStart && (start == null || member.moveInStart > start)) {
      start = member.moveInStart;
    }
    if (member.moveInEnd && (end == null || member.moveInEnd < end)) {
      end = member.moveInEnd;
    }
  }
  const moveInDisjoint = sawWindow && start != null && end != null && start > end;

  return {
    bindingBudgetUserIds,
    budgetPerPersonCap: cap,
    budgetPerPersonFloor: floor,
    dealbreakers: [...seenDealbreakers.values()],
    moveInDisjoint,
    moveInWindow:
      sawWindow && !moveInDisjoint && (start != null || end != null)
        ? {
            end: end ?? start ?? "",
            start: start ?? end ?? "",
          }
        : null,
  };
}

export type GroupListingFeasibility = {
  /** Per-person rent at full group size (equal split), when rent is known. */
  perPersonRent: number | null;
  /** True/false when the group has any budget caps; null when none are known. */
  withinEveryBudget: boolean | null;
  /** Members whose stated cap is below the per-person split. */
  stretchedUserIds: string[];
};

export function evaluateGroupListingFeasibility({
  members,
  monthlyRent,
  groupSize,
}: {
  members: GroupMemberConstraints[];
  monthlyRent: number | null;
  groupSize: number;
}): GroupListingFeasibility {
  const perPersonRent =
    monthlyRent != null && Number.isFinite(monthlyRent) && monthlyRent > 0 && groupSize > 0
      ? Math.round(monthlyRent / groupSize)
      : null;

  if (perPersonRent == null) {
    return { perPersonRent: null, stretchedUserIds: [], withinEveryBudget: null };
  }

  const membersWithCaps = members.filter(
    (member) => member.budgetMax != null && Number.isFinite(member.budgetMax),
  );
  if (membersWithCaps.length === 0) {
    return { perPersonRent, stretchedUserIds: [], withinEveryBudget: null };
  }

  const stretchedUserIds = membersWithCaps
    .filter((member) => (member.budgetMax as number) < perPersonRent)
    .map((member) => member.userId);

  return {
    perPersonRent,
    stretchedUserIds,
    withinEveryBudget: stretchedUserIds.length === 0,
  };
}
