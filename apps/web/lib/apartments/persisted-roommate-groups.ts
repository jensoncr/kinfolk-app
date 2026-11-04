import type { Database, Json } from "@/lib/supabase/types";
import type {
  ApartmentListing,
  EnrichedDetail,
  FloorPlanType,
  GroupMoveInWindow,
  GroupPetPreference,
  GroupPreferences,
  MembershipStatus,
  RoommateGroup,
  RoommateGroupMember,
  RoommateGroupMemberColor,
  RoommateLifestyle,
} from "./types";
import { canSplitByRoommates } from "./roommate-splits";

type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export type PersistedRoommateGroupRow = Pick<
  TableRow<"apartment_roommate_groups">,
  | "id"
  | "listing_id"
  | "floor_plan_key"
  | "floor_plan_name"
  | "target_unit_name"
  | "bedrooms"
  | "max_size"
  | "monthly_rent"
  | "status"
  | "preferences"
  | "match_summary"
  | "created_by_user_id"
  | "updated_at"
>;

export type PersistedRoommateGroupMembershipRow = Pick<
  TableRow<"apartment_roommate_group_memberships">,
  "group_id" | "user_id" | "status" | "role" | "updated_at"
>;

export type PersistedRoommateFact = {
  userId: string;
  dimension: string;
  factKey: string;
  value: unknown;
  normalizedValue: string;
  confidence: number;
  importance: number;
};

export type PersistedRoommateProfile = {
  userId: string;
  /** matching_profiles.visibility_mode === 'public'; anonymous otherwise. */
  isPublic: boolean;
  name: string;
  imageUrl?: string;
  about?: string | null;
  interests: string[];
  occupationTitle?: string | null;
  occupationCompany?: string | null;
  occupationCompanyLogoUrl?: string | null;
  educationSchool?: string | null;
  educationDegree?: string | null;
  educationMajor?: string | null;
  educationYear?: string | null;
  educationSchoolLogoUrl?: string | null;
  facts: PersistedRoommateFact[];
};

export type PersistedCompatibilityEdge = {
  userAId: string;
  userBId: string;
  score: number;
  /** Top human-readable dimensions behind the score (the "why"). */
  reasons?: string[];
};

export type PersistedRoommateGroupContext = {
  activeUserId: string | null;
  groups: PersistedRoommateGroupRow[];
  memberships: PersistedRoommateGroupMembershipRow[];
  profiles: PersistedRoommateProfile[];
  compatibilityEdges: PersistedCompatibilityEdge[];
};

const MEMBER_COLORS: RoommateGroupMemberColor[] = ["forest", "mint", "warm", "rust", "sage"];
const WHOLE_UNIT_GROUP_KEY = "kinfolk:whole-unit";

function floorPlanGroupKey(type: Pick<FloorPlanType, "id" | "name">, index: number) {
  return `${type.id ?? type.name}-${index}`;
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "K";
}

function cleanText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower.startsWith("unknown") || lower.includes("no reliable evidence")) {
    return null;
  }
  return normalized;
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function factFor(
  profile: PersistedRoommateProfile,
  keys: string[],
): PersistedRoommateFact | null {
  const keySet = new Set(keys);
  return (
    profile.facts.find(
      (fact) =>
        keySet.has(fact.factKey) &&
        fact.confidence > 0 &&
        cleanText(fact.normalizedValue) != null,
    ) ?? null
  );
}

function factText(profile: PersistedRoommateProfile, keys: string[]): string | null {
  const fact = factFor(profile, keys);
  return truncate(fact?.normalizedValue, 80);
}

function lifestyleFor(profile: PersistedRoommateProfile): RoommateLifestyle {
  return {
    sleep: factText(profile, ["sleep_schedule", "routine_regularity"]) ?? "Flexible schedule",
    kitchen: factText(profile, ["cooking", "kitchen", "dishes"]) ?? "Shared kitchen norms",
    hosting: factText(profile, ["guests", "hosting_style", "social_energy"]) ?? "Checks in on guests",
    tidiness: factText(profile, ["cleanliness", "home_cleanliness"]) ?? "Keeps shared spaces clear",
  };
}

function headlineFor(profile: PersistedRoommateProfile): string {
  const work = [profile.occupationTitle, profile.occupationCompany]
    .map((part) => truncate(part, 36))
    .filter(Boolean)
    .join(" · ");
  if (work) return work;

  return (
    factText(profile, ["work_identity_current", "professional_domain", "work_pace"]) ??
    "Roommate match"
  );
}

function roleFor(profile: PersistedRoommateProfile): string | undefined {
  const work = [profile.occupationTitle, profile.occupationCompany]
    .map((part) => truncate(part, 40))
    .filter(Boolean)
    .join(" · ");
  return work || undefined;
}

// Top compatibility dimensions (human labels) from an edge's `evidence` jsonb,
// used as the "why you'd fit" hint. Best-effort parse of untrusted shape.
export function topReasonLabels(evidence: unknown, limit = 2): string[] {
  if (!Array.isArray(evidence)) return [];
  const labels: string[] = [];
  for (const entry of evidence) {
    const label =
      entry && typeof entry === "object" && typeof (entry as { label?: unknown }).label === "string"
        ? (entry as { label: string }).label.trim()
        : "";
    if (label) labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels;
}

function compatibilityEdgeBetween(
  context: PersistedRoommateGroupContext,
  userAId: string | null,
  userBId: string,
): PersistedCompatibilityEdge | null {
  if (!userAId || userAId === userBId) return null;
  return (
    context.compatibilityEdges.find(
      (candidate) =>
        (candidate.userAId === userAId && candidate.userBId === userBId) ||
        (candidate.userAId === userBId && candidate.userBId === userAId),
    ) ?? null
  );
}

function compatibilityScore(
  context: PersistedRoommateGroupContext,
  userAId: string | null,
  userBId: string,
): number | null {
  const edge = compatibilityEdgeBetween(context, userAId, userBId);
  return edge ? Math.round(edge.score) : null;
}

function averageCompatibilityScore(
  context: PersistedRoommateGroupContext,
  profile: PersistedRoommateProfile,
  selected: PersistedRoommateProfile[],
): number | null {
  const scores = selected.flatMap((candidate) => {
    const score = compatibilityScore(context, profile.userId, candidate.userId);
    return score == null ? [] : [score];
  });
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function profileMemberFor(
  profile: PersistedRoommateProfile,
  context: PersistedRoommateGroupContext,
  index: number,
  selected: PersistedRoommateProfile[],
  status: MembershipStatus,
  viewerIsGroupMember: boolean,
): RoommateGroupMember {
  const isViewer = context.activeUserId === profile.userId;
  // PRIVACY: anonymous-mode members stay identity-hidden to viewers outside
  // the group. The stripped record keeps first name + the viewer's own fit
  // signal (score + reasons) so joining is still an informed decision, and
  // omits photo, work, school, bio, lifestyle, and interests entirely — this
  // projection is serialized into wire responses, so absence is the guarantee.
  const locked = !isViewer && !profile.isPublic && !viewerIsGroupMember;
  // Direct viewer↔member edge (when present) carries both the score and the
  // dimensions behind it; only a direct edge yields per-person "why" reasons.
  const directEdge =
    context.activeUserId != null && !isViewer
      ? compatibilityEdgeBetween(context, context.activeUserId, profile.userId)
      : null;
  const directScore =
    context.activeUserId != null && !isViewer
      ? (directEdge ? Math.round(directEdge.score) : null) ??
        averageCompatibilityScore(context, profile, selected)
      : averageCompatibilityScore(context, profile, selected);
  const matchReasons =
    !isViewer && directEdge?.reasons && directEdge.reasons.length > 0
      ? directEdge.reasons
      : undefined;
  const interests =
    profile.interests.length > 0
      ? profile.interests.slice(0, 4)
      : profile.facts
          .reduce<string[]>((values, fact) => {
            if (fact.dimension === "feasibility" || values.length >= 4) return values;
            const value = truncate(fact.normalizedValue, 28);
            if (value != null) values.push(value);
            return values;
          }, []);

  if (locked) {
    const first = firstName(profile.name);
    // No matchReasons here: they are edge-evidence labels (free text) and can
    // carry identity the same way match evidence copy does.
    return {
      userId: profile.userId,
      name: first,
      initials: initialsFor(first),
      locked: true,
      color: MEMBER_COLORS[index % MEMBER_COLORS.length],
      flex: false,
      membershipStatus: status,
      matchScore: directScore == null ? undefined : directScore,
    };
  }

  return {
    userId: profile.userId,
    name: isViewer ? "You" : profile.name,
    initials: initialsFor(profile.name),
    color: isViewer ? "forest" : MEMBER_COLORS[index % MEMBER_COLORS.length],
    flex: false,
    membershipStatus: status,
    imageUrl: profile.imageUrl,
    headline: isViewer ? undefined : headlineFor(profile),
    matchScore: isViewer || directScore == null ? undefined : directScore,
    matchReasons,
    role: roleFor(profile),
    occupationTitle: profile.occupationTitle ?? undefined,
    occupationCompany: profile.occupationCompany ?? undefined,
    occupationCompanyLogoUrl: profile.occupationCompanyLogoUrl ?? undefined,
    educationSchool: profile.educationSchool ?? undefined,
    educationDegree: profile.educationDegree ?? undefined,
    educationMajor: profile.educationMajor ?? undefined,
    educationYear: profile.educationYear ?? undefined,
    educationSchoolLogoUrl: profile.educationSchoolLogoUrl ?? undefined,
    about:
      truncate(profile.about, 180) ??
      factText(profile, ["community_orientation", "rent_tradeoff"]) ??
      undefined,
    lifestyle: lifestyleFor(profile),
    interests,
  };
}

function summarizeGroup(members: RoommateGroupMember[], maxSize: number): string {
  const names = members.slice(0, 2).map((member) => firstName(member.name)).join(" + ");
  const signals = members
    .flatMap((member) => {
      const signal = member.headline?.split(" · ").at(-1) ?? member.headline;
      return signal ? [signal] : [];
    })
    .slice(0, 2)
    .join(" · ");
  const openSpots = Math.max(0, maxSize - members.length);
  const suffix = openSpots > 0 ? ` · ${openSpots} open spot${openSpots === 1 ? "" : "s"}` : "";
  return [names || "New group", signals].filter(Boolean).join(" · ") + suffix;
}

function averageMemberScore(members: RoommateGroupMember[]): number {
  const scored = members.flatMap((member) =>
    typeof member.matchScore === "number" ? [member.matchScore] : [],
  );
  if (scored.length === 0) return 0;
  return Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length);
}

function isMembershipStatus(value: string): value is MembershipStatus {
  return value === "requested" || value === "member";
}

function parseGroupPreferences(value: Json): GroupPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    gender:
      source.gender === "women" || source.gender === "men" || source.gender === "nonbinary"
        ? source.gender
        : null,
    ageMin: typeof source.ageMin === "number" ? source.ageMin : null,
    ageMax: typeof source.ageMax === "number" ? source.ageMax : null,
    pets: parseFilter<GroupPetPreference>(source.pets, ["friendly", "none"]),
    industry: parseStringFilter(source.industry),
    moveIn: parseFilter<GroupMoveInWindow>(source.moveIn, ["asap", "1w", "1m", "1m-plus"]),
  };
}

function parseStringFilter(value: unknown): GroupPreferences["industry"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.value !== "string") return null;
  return {
    value: source.value,
    gate: source.gate === "required" ? "required" : "preferred",
  };
}

function parseFilter<T extends string>(value: unknown, allowed: T[]): { value: T; gate: "required" | "preferred" } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!allowed.includes(source.value as T)) return null;
  return {
    value: source.value as T,
    gate: source.gate === "required" ? "required" : "preferred",
  };
}

function groupsForListing(
  context: PersistedRoommateGroupContext | null | undefined,
  listingId: string,
) {
  if (!context) return [];
  return context.groups
    .filter((group) => group.listing_id === listingId && group.status !== "closed")
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

function roommateGroupForRow(
  row: PersistedRoommateGroupRow,
  context: PersistedRoommateGroupContext,
): RoommateGroup | null {
  const profilesByUserId = new Map(context.profiles.map((profile) => [profile.userId, profile]));
  const activeMemberships = context.memberships.filter(
    (membership) =>
      membership.group_id === row.id &&
      isMembershipStatus(membership.status) &&
      (membership.status === "member" || membership.user_id === context.activeUserId),
  );
  const viewerMembership =
    activeMemberships.find((membership) => membership.user_id === context.activeUserId) ?? null;
  const memberMemberships = activeMemberships.filter(
    (membership) => membership.status === "member",
  );
  const selectedProfiles = memberMemberships.flatMap((membership) => {
    const profile = profilesByUserId.get(membership.user_id);
    return profile ? [profile] : [];
  });
  // Only an ACCEPTED membership in a CREATOR-OWNED group unlocks the group's
  // anonymous members. A pending request ("requested") reveals nothing, and
  // migration-seeded groups (created_by_user_id null — no owner who could
  // have approved anyone) never count as consent.
  const viewerIsGroupMember =
    viewerMembership?.status === "member" && row.created_by_user_id != null;
  const members = memberMemberships.flatMap<RoommateGroupMember>((membership, index) => {
    const profile = profilesByUserId.get(membership.user_id);
    if (!profile) return [];
    return [
      profileMemberFor(
        profile,
        context,
        index,
        selectedProfiles,
        membership.status === "requested" ? "requested" : "member",
        viewerIsGroupMember,
      ),
    ];
  });

  if (members.length === 0 && !viewerMembership) return null;

  return {
    id: row.id,
    members,
    targetUnitName: row.target_unit_name,
    maxSize: row.max_size,
    viewerMembershipStatus: isMembershipStatus(viewerMembership?.status ?? "")
      ? (viewerMembership!.status as MembershipStatus)
      : null,
    preferences: parseGroupPreferences(row.preferences),
    // PRIVACY: a persisted match_summary bypasses the member projection above.
    // Nothing writes the column today; if that changes, it must be generated
    // from projected (possibly locked) members only.
    matchSummary: row.match_summary ?? summarizeGroup(members, row.max_size),
  };
}

function toFormingGroup(
  group: RoommateGroup,
  row: PersistedRoommateGroupRow,
  monthlyRent: number | null,
): ApartmentListing["formingGroups"][number] {
  const lead = group.members[0]?.name ?? "New";
  return {
    id: group.id,
    name: `${firstName(lead)}'s group`,
    status: row.status === "touring" ? "touring" : group.members.length >= group.maxSize ? "ready" : "forming",
    spotsTotal: group.maxSize,
    spotsFilled: group.members.length,
    perPersonRent:
      monthlyRent != null && monthlyRent > 0 ? Math.round(monthlyRent / group.maxSize) : 0,
    fitScore: averageMemberScore(group.members),
    members: group.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      initials: member.initials,
      locked: member.locked,
      imageUrl: member.imageUrl,
      headline: member.headline,
      matchScore: member.matchScore,
      occupationTitle: member.occupationTitle,
      occupationCompany: member.occupationCompany,
      educationSchool: member.educationSchool,
      educationDegree: member.educationDegree,
      educationMajor: member.educationMajor,
      educationYear: member.educationYear,
    })),
    summary: group.matchSummary ?? summarizeGroup(group.members, group.maxSize),
    viewerMembershipStatus: group.viewerMembershipStatus ?? null,
    preferences: group.preferences ?? null,
  };
}

export function buildPersistedFormingGroupsForListing(args: {
  listingId: string;
  monthlyRent: number | null | undefined;
  context: PersistedRoommateGroupContext | null | undefined;
}): ApartmentListing["formingGroups"] {
  if (!args.context) return [];
  return groupsForListing(args.context, args.listingId).flatMap((row) => {
    const group = roommateGroupForRow(row, args.context!);
    if (!group) return [];
    return [
      toFormingGroup(
        group,
        row,
        typeof row.monthly_rent === "number"
          ? row.monthly_rent
          : typeof args.monthlyRent === "number"
            ? args.monthlyRent
            : null,
      ),
    ];
  });
}

export function bestPersistedFormingGroupFitScore(
  groups: ApartmentListing["formingGroups"],
): number | null {
  if (groups.length === 0) return null;
  return Math.max(...groups.map((group) => group.fitScore));
}

// Choose where a group with no exact floor-plan match should attach. Prefer
// plans that can actually host a roommate group (2+ bedrooms, so the avatar
// stack renders), then the closest bedroom count; ties keep render order.
function pickFloorPlanForUnmatchedGroup(
  planKeys: { key: string; type: FloorPlanType }[],
  row: PersistedRoommateGroupRow,
): { key: string; type: FloorPlanType } | null {
  if (planKeys.length === 0) return null;
  const splittable = planKeys.filter((entry) => canSplitByRoommates(entry.type.bedrooms));
  const pool = splittable.length > 0 ? splittable : planKeys;
  if (pool.length === 1) return pool[0]!;
  const target = typeof row.bedrooms === "number" ? row.bedrooms : null;
  if (target == null) return pool[0]!;
  let best = pool[0]!;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of pool) {
    const delta = Math.abs((entry.type.bedrooms ?? 0) - target);
    if (delta < bestDelta) {
      best = entry;
      bestDelta = delta;
    }
  }
  return best;
}

export function attachPersistedRoommateGroupsToEnriched(
  listingId: string,
  enriched: EnrichedDetail | null,
  context: PersistedRoommateGroupContext | null | undefined,
): EnrichedDetail | null {
  if (!enriched || !context) return enriched;

  const rows = groupsForListing(context, listingId);
  if (rows.length === 0) return enriched;

  // Stable key for every floor plan, in render order.
  const planKeys: { key: string; type: FloorPlanType }[] = [];
  let keyIndex = 0;
  for (const group of enriched.floorPlans) {
    for (const type of group.availableUnitTypes) {
      planKeys.push({ key: floorPlanGroupKey(type, keyIndex), type });
      keyIndex += 1;
    }
  }

  // Assign each group row to a floor plan key. Exact matches (the generated
  // key or the group's target unit name) win; otherwise fall back to the best
  // plan by bedroom count so unit-level groups — e.g. seeded "whole-unit"
  // groups whose floor_plan_key never matches a real plan — still surface in
  // the detail instead of vanishing while still counting on the card.
  const exactPlanKeys = new Map<string, { key: string; type: FloorPlanType }>();
  for (const entry of planKeys) {
    exactPlanKeys.set(entry.key, entry);
    exactPlanKeys.set(entry.type.name, entry);
  }

  const rowsByKey = new Map<string, PersistedRoommateGroupRow[]>();
  const assign = (key: string, row: PersistedRoommateGroupRow) => {
    const list = rowsByKey.get(key);
    if (list) list.push(row);
    else rowsByKey.set(key, [row]);
  };
  for (const row of rows) {
    const exact =
      exactPlanKeys.get(row.floor_plan_key ?? "") ??
      exactPlanKeys.get(row.target_unit_name ?? "");
    const target = exact ?? pickFloorPlanForUnmatchedGroup(planKeys, row);
    if (target) assign(target.key, row);
  }

  let index = 0;
  const floorPlans = enriched.floorPlans.map((group) => ({
    ...group,
    availableUnitTypes: group.availableUnitTypes.map((type: FloorPlanType) => {
      const key = floorPlanGroupKey(type, index);
      index += 1;
      const planRows = rowsByKey.get(key) ?? [];
      const groups = planRows.flatMap<RoommateGroup>((row) => {
        const roommateGroup = roommateGroupForRow(row, context);
        return roommateGroup ? [roommateGroup] : [];
      });
      return { ...type, groups };
    }),
  }));

  return { ...enriched, floorPlans };
}

export { WHOLE_UNIT_GROUP_KEY };
