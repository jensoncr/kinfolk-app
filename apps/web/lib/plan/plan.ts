import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/shared/api-error";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ensureShareInviteLinkForUser } from "@/lib/contacts/network";
import { normalizeSavedAreaLabel, savedAreaLabelKey } from "@/lib/plan/saved-place-labels";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export const MOVE_HORIZONS = [
  "now",
  "lt_3mo",
  "3_6mo",
  "6_12mo",
  "1_2yr",
  "exploring",
] as const;
export type MoveHorizon = (typeof MOVE_HORIZONS)[number];

export const RELOCATION_FLEXIBILITIES = [
  "locked",
  "some",
  "flexible",
  "ready",
] as const;
export type RelocationFlexibility = (typeof RELOCATION_FLEXIBILITIES)[number];

export type LivingPlan = {
  futureCities: string[];
  moveHorizon: MoveHorizon | null;
  relocationFlexibility: RelocationFlexibility | null;
  intentNote: string;
  silentMatcherEnabled: boolean;
  intentConfirmedAt: string | null;
};

/** A real person you share a forming group with — both sides consented. */
export type PlanPerson = {
  userId: string;
  name: string;
  initials: string;
  imageUrl: string | null;
  headline: string;
  groupLabel: string;
  relationship: "you_invited" | "you_joined";
  connectedAt: string;
  /** 0–100 compatibility when an edge exists, else null. */
  fitScore: number | null;
};

export type SavedListing = {
  savedId: string;
  listingId: string;
  address: string;
  neighborhood: string;
  beds: string | null;
  monthlyRent: number | null;
  perPersonRent: number | null;
  photoUrl: string | null;
  note: string | null;
};

type PlanInviteLink = {
  url: string;
  shareToken: string;
  /** Links you created that nobody has joined yet. */
  openInviteCount: number;
};

export type PlanSnapshot = {
  status: "connected" | "signed_out" | "error";
  detail: string;
  plan: LivingPlan;
  people: PlanPerson[];
  savedListings: SavedListing[];
  savedAreas: string[];
  inviteLink: PlanInviteLink | null;
};

const EMPTY_PLAN: LivingPlan = {
  futureCities: [],
  moveHorizon: null,
  relocationFlexibility: null,
  intentNote: "",
  silentMatcherEnabled: false,
  intentConfirmedAt: null,
};

function emptySnapshot(
  status: PlanSnapshot["status"],
  detail: string,
): PlanSnapshot {
  return {
    status,
    detail,
    plan: EMPTY_PLAN,
    people: [],
    savedListings: [],
    savedAreas: [],
    inviteLink: null,
  };
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

function headlineFor(
  user: Pick<TableRow<"kinfolk_users">, "occupation_title" | "occupation_company"> | undefined,
): string {
  if (!user) return "On Kinfolk";
  const parts = [user.occupation_title, user.occupation_company]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join(" · ") || "On Kinfolk";
}

function formatBeds(bedrooms: number | null, bathrooms: number | null): string | null {
  if (bedrooms == null) return null;
  const bedLabel = bedrooms === 0 ? "Studio" : `${bedrooms} bd`;
  return bathrooms ? `${bedLabel} · ${bathrooms} ba` : bedLabel;
}

function mapPlanRow(row: TableRow<"living_plans">): LivingPlan {
  return {
    futureCities: row.future_cities ?? [],
    moveHorizon: (row.move_horizon as MoveHorizon | null) ?? null,
    relocationFlexibility:
      (row.relocation_flexibility as RelocationFlexibility | null) ?? null,
    intentNote: row.intent_note ?? "",
    silentMatcherEnabled: row.silent_matcher_enabled,
    intentConfirmedAt: row.intent_confirmed_at,
  };
}

/**
 * The plan is latent future intent. It must not inherit the current active
 * housing profile, because today's Kinfolk matching remains SF-first.
 */
async function loadLivingPlan(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<LivingPlan> {
  const planResult = await supabase
    .from("living_plans")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (planResult.error) throw planResult.error;
  if (planResult.data) return mapPlanRow(planResult.data);

  return EMPTY_PLAN;
}

/** People in a forming group with the viewer, both sides accepted. */
async function loadPeople(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<PlanPerson[]> {
  const [ownedResult, joinedResult] = await Promise.all([
    supabase
      .from("roommate_contact_groups")
      .select("id,label,created_at")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("roommate_contact_group_members")
      .select("contact_group_id,matched_user_id,status,created_at")
      .eq("matched_user_id", userId)
      .eq("status", "accepted"),
  ]);
  if (ownedResult.error) throw ownedResult.error;
  if (joinedResult.error) throw joinedResult.error;

  const ownedGroups = ownedResult.data ?? [];
  const ownedGroupById = new Map(ownedGroups.map((group) => [group.id, group]));

  // People who joined a group I own.
  const ownedMembers = ownedGroups.length
    ? await supabase
        .from("roommate_contact_group_members")
        .select("contact_group_id,matched_user_id,status,created_at")
        .in(
          "contact_group_id",
          ownedGroups.map((group) => group.id),
        )
        .eq("status", "accepted")
        .not("matched_user_id", "is", null)
    : { data: [], error: null };
  if (ownedMembers.error) throw ownedMembers.error;

  type Edge = {
    otherUserId: string;
    relationship: PlanPerson["relationship"];
    groupLabel: string;
    connectedAt: string;
  };
  const edges: Edge[] = [];

  for (const member of ownedMembers.data ?? []) {
    if (!member.matched_user_id || member.matched_user_id === userId) continue;
    edges.push({
      otherUserId: member.matched_user_id,
      relationship: "you_invited",
      groupLabel: ownedGroupById.get(member.contact_group_id)?.label ?? "Your group",
      connectedAt: member.created_at,
    });
  }

  // Groups I joined that someone else owns.
  const joinedGroupIds = (joinedResult.data ?? []).map((row) => row.contact_group_id);
  if (joinedGroupIds.length) {
    const joinedGroups = await supabase
      .from("roommate_contact_groups")
      .select("id,label,owner_user_id")
      .in("id", joinedGroupIds);
    if (joinedGroups.error) throw joinedGroups.error;
    const joinedById = new Map((joinedGroups.data ?? []).map((g) => [g.id, g]));
    for (const row of joinedResult.data ?? []) {
      const group = joinedById.get(row.contact_group_id);
      if (!group || group.owner_user_id === userId) continue;
      edges.push({
        otherUserId: group.owner_user_id,
        relationship: "you_joined",
        groupLabel: group.label,
        connectedAt: row.created_at,
      });
    }
  }

  // Dedupe to one row per person (most recent connection wins).
  const byUser = new Map<string, Edge>();
  for (const edge of edges) {
    const existing = byUser.get(edge.otherUserId);
    if (!existing || edge.connectedAt > existing.connectedAt) {
      byUser.set(edge.otherUserId, edge);
    }
  }
  const otherIds = [...byUser.keys()];
  if (otherIds.length === 0) return [];

  const [usersResult, photosResult, edgeResult] = await Promise.all([
    supabase
      .from("kinfolk_users")
      .select("id,display_name,occupation_title,occupation_company")
      .in("id", otherIds),
    supabase
      .from("kinfolk_user_photos")
      .select("user_id,public_url,is_primary,position")
      .in("user_id", otherIds)
      .order("is_primary", { ascending: false })
      .order("position", { ascending: true }),
    supabase
      .from("compatibility_edges")
      .select("user_a_id,user_b_id,score,status")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .eq("status", "active"),
  ]);
  if (usersResult.error) throw usersResult.error;
  if (photosResult.error) throw photosResult.error;
  if (edgeResult.error) throw edgeResult.error;

  const userById = new Map((usersResult.data ?? []).map((u) => [u.id, u]));
  const photoByUser = new Map<string, string>();
  for (const photo of photosResult.data ?? []) {
    if (!photo.public_url || photoByUser.has(photo.user_id)) continue;
    photoByUser.set(photo.user_id, photo.public_url);
  }
  const fitByUser = new Map<string, number>();
  for (const edge of edgeResult.data ?? []) {
    const other = edge.user_a_id === userId ? edge.user_b_id : edge.user_a_id;
    if (!fitByUser.has(other)) fitByUser.set(other, Math.round(edge.score));
  }

  return otherIds
    .map((otherId) => {
      const edge = byUser.get(otherId)!;
      const user = userById.get(otherId);
      const name = user?.display_name?.trim() || "Kinfolk member";
      return {
        userId: otherId,
        name,
        initials: initialsFor(name),
        imageUrl: photoByUser.get(otherId) ?? null,
        headline: headlineFor(user),
        groupLabel: edge.groupLabel,
        relationship: edge.relationship,
        connectedAt: edge.connectedAt,
        fitScore: fitByUser.get(otherId) ?? null,
      } satisfies PlanPerson;
    })
    .sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
}

async function loadSavedPlaces(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<{ listings: SavedListing[]; areas: string[] }> {
  const savedResult = await supabase
    .from("saved_places")
    .select("id,kind,listing_id,area_label,note,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (savedResult.error) throw savedResult.error;

  const rows = savedResult.data ?? [];
  const seenAreas = new Set<string>();
  const areas: string[] = [];
  for (const row of rows) {
    if (row.kind !== "area" || !row.area_label) continue;
    const label = normalizeSavedAreaLabel(row.area_label);
    const key = savedAreaLabelKey(label);
    if (!label || seenAreas.has(key)) continue;
    seenAreas.add(key);
    areas.push(label);
  }

  const listingRows = rows.filter(
    (row): row is typeof row & { listing_id: string } =>
      row.kind === "listing" && Boolean(row.listing_id),
  );
  if (listingRows.length === 0) return { listings: [], areas };

  const listingIds = listingRows.map((row) => row.listing_id);
  const [listingsResult, photosResult] = await Promise.all([
    supabase
      .from("apartment_listings")
      .select(
        "id,address_line,neighborhood,city,bedrooms,bathrooms,monthly_rent,effective_monthly_rent",
      )
      .in("id", listingIds),
    supabase
      .from("apartment_listing_photos")
      .select("listing_id,url,position")
      .in("listing_id", listingIds)
      .order("position", { ascending: true }),
  ]);
  if (listingsResult.error) throw listingsResult.error;
  if (photosResult.error) throw photosResult.error;

  const listingById = new Map((listingsResult.data ?? []).map((row) => [row.id, row]));
  const coverByListing = new Map<string, string>();
  for (const photo of photosResult.data ?? []) {
    if (photo.url && !coverByListing.has(photo.listing_id)) {
      coverByListing.set(photo.listing_id, photo.url);
    }
  }

  const listings = listingRows.flatMap((row) => {
    const listing = listingById.get(row.listing_id);
    if (!listing) return [];
    const monthlyRent = listing.effective_monthly_rent ?? listing.monthly_rent;
    const splitSize = listing.bedrooms && listing.bedrooms > 0 ? listing.bedrooms : null;
    return [
      {
        savedId: row.id,
        listingId: row.listing_id,
        address: listing.address_line,
        neighborhood: listing.neighborhood ?? listing.city ?? "San Francisco",
        beds: formatBeds(listing.bedrooms, listing.bathrooms),
        monthlyRent: monthlyRent ?? null,
        perPersonRent:
          monthlyRent != null && splitSize ? Math.round(monthlyRent / splitSize) : null,
        photoUrl: coverByListing.get(row.listing_id) ?? null,
        note: row.note,
      } satisfies SavedListing,
    ];
  });

  return { listings, areas };
}

async function getPlanSnapshotForUser(
  supabase: SupabaseServiceClient,
  userId: string,
  baseUrl?: string | null,
): Promise<PlanSnapshot> {
  try {
    const [plan, people, saved, inviteLink] = await Promise.all([
      loadLivingPlan(supabase, userId),
      loadPeople(supabase, userId),
      loadSavedPlaces(supabase, userId),
      ensureShareInviteLinkForUser(supabase, userId, baseUrl),
    ]);

    return {
      status: "connected",
      detail: "Reading your living plan.",
      plan,
      people,
      savedListings: saved.listings,
      savedAreas: saved.areas,
      inviteLink,
    };
  } catch (error) {
    // Log the real failure server-side; the page-facing detail stays generic
    // (raw DB error strings must never reach the client).
    console.error("[plan] snapshot query failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return emptySnapshot("error", "Plan query failed. Try again shortly.");
  }
}

export async function getPlanSnapshotForCurrentUser(
  baseUrl?: string | null,
): Promise<PlanSnapshot> {
  const { identity, user } = await ensureCurrentKinfolkUser();
  if (!identity || !user) {
    return emptySnapshot("signed_out", "Sign in to open your plan.");
  }
  const supabase = createSupabaseServiceClient();
  return getPlanSnapshotForUser(supabase, user.id, baseUrl);
}

export type LivingPlanPatch = {
  futureCities?: string[];
  moveHorizon?: MoveHorizon | null;
  relocationFlexibility?: RelocationFlexibility | null;
  intentNote?: string;
  silentMatcherEnabled?: boolean;
};

function cleanList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    // Per-entry length cap to match intentNote's bound — a "city" should
    // never persist megabytes into living_plans.
    const trimmed = value.trim().slice(0, 80);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 12) break;
  }
  return out;
}

export async function updateLivingPlanForCurrentUser(
  patch: LivingPlanPatch,
): Promise<LivingPlan> {
  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);
  if (!identity || !user) {
    throw new ApiError("Sign in before editing your plan.", 401);
  }

  const futureCities = cleanList(patch.futureCities);

  const update: Database["public"]["Tables"]["living_plans"]["Insert"] = {
    user_id: user.id,
    intent_confirmed_at: new Date().toISOString(),
  };
  if (futureCities !== undefined) update.future_cities = futureCities;
  if (patch.moveHorizon !== undefined) update.move_horizon = patch.moveHorizon;
  if (patch.relocationFlexibility !== undefined) {
    update.relocation_flexibility = patch.relocationFlexibility;
  }
  if (patch.intentNote !== undefined) update.intent_note = patch.intentNote.trim() || null;
  if (patch.silentMatcherEnabled !== undefined) {
    update.silent_matcher_enabled = patch.silentMatcherEnabled;
  }

  const result = await supabase
    .from("living_plans")
    .upsert(update, { onConflict: "user_id" })
    .select("*")
    .single();
  if (result.error) throw result.error;

  return mapPlanRow(result.data);
}

export type SavedPlaceInput =
  | { kind: "listing"; listingId: string }
  | { kind: "area"; areaLabel: string };

/**
 * Toggle a saved place, or force it when `desired` is given — callers that
 * retry (or race their own optimistic UI) send the end state so a duplicate
 * request can't undo the save.
 */
export async function toggleSavedPlaceForCurrentUser(
  input: SavedPlaceInput,
  desired?: boolean,
): Promise<{ saved: boolean }> {
  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);
  if (!identity || !user) {
    throw new ApiError("Sign in before saving places.", 401);
  }

  if (input.kind === "listing") {
    const listingId = input.listingId.trim();
    if (!listingId) throw new ApiError("Pick a listing to save.");
    const existing = await supabase
      .from("saved_places")
      .select("id")
      .eq("user_id", user.id)
      .eq("listing_id", listingId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (desired === true) return { saved: true };
      const del = await supabase.from("saved_places").delete().eq("id", existing.data.id);
      if (del.error) throw del.error;
      return { saved: false };
    }
    if (desired === false) return { saved: false };
    const insert = await supabase
      .from("saved_places")
      .insert({ user_id: user.id, kind: "listing", listing_id: listingId });
    // A concurrent duplicate save losing the unique-index race IS the saved
    // end-state the caller asked for — not a 500.
    if (insert.error && insert.error.code !== "23505") throw insert.error;
    return { saved: true };
  }

  const areaLabel = normalizeSavedAreaLabel(input.areaLabel);
  if (!areaLabel) throw new ApiError("Add an area to save.");
  const areaKey = savedAreaLabelKey(areaLabel);
  const existingAreas = await supabase
    .from("saved_places")
    .select("id,area_label")
    .eq("user_id", user.id)
    .eq("kind", "area");
  if (existingAreas.error) throw existingAreas.error;
  const existing = (existingAreas.data ?? []).find(
    (row) => savedAreaLabelKey(row.area_label ?? "") === areaKey,
  );
  if (existing) {
    if (desired === true) return { saved: true };
    const del = await supabase.from("saved_places").delete().eq("id", existing.id);
    if (del.error) throw del.error;
    return { saved: false };
  }
  if (desired === false) return { saved: false };
  const insert = await supabase
    .from("saved_places")
    .insert({ user_id: user.id, kind: "area", area_label: areaLabel });
  // See the listing branch: a lost duplicate-insert race is still "saved".
  if (insert.error && insert.error.code !== "23505") throw insert.error;
  return { saved: true };
}
