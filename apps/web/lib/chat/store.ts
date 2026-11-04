import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { hasServerSupabaseConfig, supabaseUrl } from "@/lib/supabase/config";
import { ApiError } from "@/lib/shared/api-error";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { prependLinkedInProfilePhotoUrl } from "@/lib/profiles/photos";
import { selectPreferredIdentityAvatarUrl } from "@/lib/profiles/identity-avatar";
import type { Database } from "@/lib/supabase/types";
import type {
  ChatMessageProvenance,
  ChatMessageView,
  ChatParticipant,
  ChatRoomContext,
  ChatRoomDetail,
  ChatRoomsSnapshot,
  ChatRoomSummary,
  ChatRoomType,
  MatchIntentResult,
} from "@/lib/chat/types";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type ChatRoomRow = Database["public"]["Tables"]["chat_rooms"]["Row"];
type ChatMemberRow = Database["public"]["Tables"]["chat_room_members"]["Row"];
type MatchFeedbackEventRow = Pick<
  Database["public"]["Tables"]["match_feedback_events"]["Row"],
  "created_at" | "event_type"
>;

const MESSAGE_PAGE_SIZE = 300;
const MAX_BODY_LENGTH = 4000;

/** Carries an HTTP status so thin route handlers can map it without leaking room existence. */
export class ChatError extends ApiError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "ChatError";
  }
}

export class PhoneVerificationRequiredError extends ChatError {
  constructor() {
    super("Verify your phone in Settings before turning on text notifications.", 400);
    this.name = "PhoneVerificationRequiredError";
  }
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function shortAddress(addressLine: string | null | undefined): string | null {
  if (!addressLine) return null;
  return addressLine.split(",")[0]?.trim() || addressLine.trim();
}

function formatBeds(beds: number | null | undefined): string | null {
  if (beds == null) return null;
  if (beds === 0) return "Studio";
  return `${beds % 1 === 0 ? beds : beds}bd`;
}

// ── Auth + membership gates ──────────────────────────────────────────────────

async function getActiveChatMembership(
  supabase: ServiceClient,
  roomId: string,
  userId: string,
): Promise<ChatMemberRow | null> {
  const result = await supabase
    .from("chat_room_members")
    .select("*")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("left_at", null)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

/**
 * Apartment-group rooms require an active *group* membership too — defense in depth
 * so a user who left/was removed from the group loses chat access immediately, even
 * before reconciliation flips their chat_room_member row.
 */
async function viewerStillInGroup(
  supabase: ServiceClient,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const result = await supabase
    .from("apartment_roommate_group_memberships")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("status", "member")
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

async function assertRoomAccess(
  supabase: ServiceClient,
  room: Pick<ChatRoomRow, "id" | "room_type" | "apartment_group_id">,
  userId: string,
): Promise<ChatMemberRow> {
  const membership = await getActiveChatMembership(supabase, room.id, userId);
  if (!membership) throw new ChatError("Not found.", 404);
  if (room.room_type === "apartment_group" && room.apartment_group_id) {
    const stillIn = await viewerStillInGroup(supabase, room.apartment_group_id, userId);
    if (!stillIn) throw new ChatError("Not found.", 404);
  }
  return membership;
}

type AccessibleRoom = Pick<
  ChatRoomRow,
  "id" | "room_type" | "status" | "apartment_group_id"
>;

/**
 * Fetch a room and assert the current user may act on it. Used by every
 * member-scoped mutation so they all run the same membership + (for group rooms)
 * viewerStillInGroup checks and return the same generic 404 to non-members.
 */
async function loadRoomWithAccess(
  supabase: ServiceClient,
  roomId: string,
  userId: string,
): Promise<{ room: AccessibleRoom; membership: ChatMemberRow }> {
  const roomResult = await supabase
    .from("chat_rooms")
    .select("id, room_type, status, apartment_group_id")
    .eq("id", roomId)
    .maybeSingle();
  if (roomResult.error) throw roomResult.error;
  if (!roomResult.data) throw new ChatError("Not found.", 404);
  const membership = await assertRoomAccess(supabase, roomResult.data, userId);
  return { room: roomResult.data, membership };
}

// ── Room reconciliation (apartment groups) ───────────────────────────────────

type GroupMembershipRow = {
  user_id: string;
  role: string;
  approved_at: string | null;
  created_at: string;
};

async function findOrCreateRoom(
  supabase: ServiceClient,
  match: { column: "apartment_group_id" | "compatibility_edge_id"; value: string },
  insert: Database["public"]["Tables"]["chat_rooms"]["Insert"],
): Promise<ChatRoomRow> {
  const existing = await supabase
    .from("chat_rooms")
    .select("*")
    .eq(match.column, match.value)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const created = await supabase.from("chat_rooms").insert(insert).select("*").single();
  if (!created.error && created.data) return created.data;

  // Only a lost race against the partial-unique index (23505) is recoverable by
  // re-reading the winner. Any other insert failure is a genuine error — surface a
  // clean 500 rather than re-reading (which would return null and throw opaquely).
  if (created.error && created.error.code !== "23505") {
    throw new ChatError("Unable to open chat room.", 500);
  }

  const reread = await supabase
    .from("chat_rooms")
    .select("*")
    .eq(match.column, match.value)
    .maybeSingle();
  if (reread.error) throw reread.error;
  if (reread.data) return reread.data;
  throw new ChatError("Unable to open chat room.", 500);
}

/**
 * Make sure an apartment group has a room whose membership mirrors the group's
 * active members. New members get history_visible_from = their group join time, so
 * they never see messages sent before they joined.
 */
async function ensureApartmentGroupRoom(
  supabase: ServiceClient,
  groupId: string,
): Promise<ChatRoomRow | null> {
  const groupResult = await supabase
    .from("apartment_roommate_groups")
    .select("id, listing_id")
    .eq("id", groupId)
    .maybeSingle();
  if (groupResult.error) throw groupResult.error;
  if (!groupResult.data) return null;

  const room = await findOrCreateRoom(
    supabase,
    { column: "apartment_group_id", value: groupId },
    {
      room_type: "apartment_group",
      apartment_group_id: groupId,
      listing_id: groupResult.data.listing_id,
      status: "active",
    },
  );

  const groupMembersResult = await supabase
    .from("apartment_roommate_group_memberships")
    .select("user_id, role, approved_at, created_at")
    .eq("group_id", groupId)
    .eq("status", "member");
  if (groupMembersResult.error) throw groupMembersResult.error;
  const groupMembers = (groupMembersResult.data ?? []) as GroupMembershipRow[];

  const chatMembersResult = await supabase
    .from("chat_room_members")
    .select("id, user_id, status")
    .eq("room_id", room.id);
  if (chatMembersResult.error) throw chatMembersResult.error;
  const chatMembers = chatMembersResult.data ?? [];
  const chatByUser = new Map(chatMembers.map((m) => [m.user_id, m]));

  for (const member of groupMembers) {
    const existing = chatByUser.get(member.user_id);
    const joinTime = member.approved_at ?? member.created_at;
    const role = member.role === "creator" ? "owner" : "member";
    if (!existing) {
      const insert = await supabase.from("chat_room_members").insert({
        room_id: room.id,
        user_id: member.user_id,
        role,
        status: "active",
        joined_at: joinTime,
        history_visible_from: joinTime,
      });
      // A concurrent reconcile may have inserted the same (room, user) first; the
      // unique constraint makes the loser fail with 23505 — that is success, not error.
      if (insert.error && insert.error.code !== "23505") throw insert.error;
    } else if (existing.status !== "active") {
      // Rejoin: fresh visibility window from the new join time (no old history).
      const update = await supabase
        .from("chat_room_members")
        .update({
          status: "active",
          role,
          left_at: null,
          last_read_at: null,
          joined_at: joinTime,
          history_visible_from: joinTime,
        })
        .eq("id", existing.id);
      if (update.error) throw update.error;
    }
  }

  // Anyone who left/was removed from the group loses chat membership. Re-read the
  // live roster immediately before the sweep: the snapshot above could be stale, and
  // a member who rejoined since then must NOT be marked 'left'. The .eq("status",
  // "active") guard also avoids clobbering a row another reconcile just changed.
  const currentMembersResult = await supabase
    .from("apartment_roommate_group_memberships")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("status", "member");
  if (currentMembersResult.error) throw currentMembersResult.error;
  const currentGroupUserIds = new Set(
    (currentMembersResult.data ?? []).map((row) => row.user_id),
  );

  for (const member of chatMembers) {
    if (member.status === "active" && !currentGroupUserIds.has(member.user_id)) {
      const update = await supabase
        .from("chat_room_members")
        .update({ status: "left", left_at: new Date().toISOString() })
        .eq("id", member.id)
        .eq("status", "active");
      if (update.error) throw update.error;
    }
  }

  return room;
}

async function ensureApartmentGroupRoomsForUser(
  supabase: ServiceClient,
  userId: string,
): Promise<void> {
  const result = await supabase
    .from("apartment_roommate_group_memberships")
    .select("group_id")
    .eq("user_id", userId)
    .eq("status", "member");
  if (result.error) throw result.error;
  const groupIds = Array.from(new Set((result.data ?? []).map((row) => row.group_id)));
  for (const groupId of groupIds) {
    await ensureApartmentGroupRoom(supabase, groupId);
  }
}

async function ensureMatchDmRoom(
  supabase: ServiceClient,
  edgeId: string,
  memberUserIds: string[],
): Promise<ChatRoomRow> {
  const room = await findOrCreateRoom(
    supabase,
    { column: "compatibility_edge_id", value: edgeId },
    { room_type: "match_dm", compatibility_edge_id: edgeId, status: "active" },
  );

  const chatMembersResult = await supabase
    .from("chat_room_members")
    .select("id, user_id, status")
    .eq("room_id", room.id);
  if (chatMembersResult.error) throw chatMembersResult.error;
  const chatByUser = new Map((chatMembersResult.data ?? []).map((m) => [m.user_id, m]));

  for (const userId of memberUserIds) {
    const existing = chatByUser.get(userId);
    if (!existing) {
      const insert = await supabase.from("chat_room_members").insert({
        room_id: room.id,
        user_id: userId,
        status: "active",
        joined_at: room.created_at,
        history_visible_from: room.created_at,
      });
      // Concurrent match-intent calls collapse onto one room (partial-unique index),
      // then both try to add the same members; the loser's 23505 is benign.
      if (insert.error && insert.error.code !== "23505") throw insert.error;
    } else if (existing.status !== "active") {
      const update = await supabase
        .from("chat_room_members")
        .update({ status: "active", left_at: null })
        .eq("id", existing.id);
      if (update.error) throw update.error;
    }
  }

  return room;
}

// ── Identity + context builders ──────────────────────────────────────────────

type UserIdentity = { name: string; initials: string; imageUrl: string | null };

async function loadUserMap(
  supabase: ServiceClient,
  userIds: string[],
): Promise<Map<string, UserIdentity>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const map = new Map<string, UserIdentity>();
  if (unique.length === 0) return map;

  // Resolve each member's avatar the same way the matches view does: uploaded
  // photos (primary first), with the LinkedIn profile photo preferred when set.
  const [usersResult, photosResult, linkedinResult] = await Promise.all([
    supabase.from("kinfolk_users").select("id, display_name").in("id", unique),
    supabase
      .from("kinfolk_user_photos")
      .select("user_id, public_url, is_primary, position")
      .in("user_id", unique)
      .order("is_primary", { ascending: false })
      .order("position", { ascending: true }),
    supabase
      .from("linkedin_enrichment_jobs")
      .select("user_id, image_url, idempotency_key, updated_at")
      .in("user_id", unique)
      .not("image_url", "is", null)
      .order("updated_at", { ascending: false }),
  ]);
  if (usersResult.error) throw usersResult.error;
  if (photosResult.error) throw photosResult.error;
  if (linkedinResult.error) throw linkedinResult.error;

  const photosByUser = new Map<string, string[]>();
  for (const photo of photosResult.data ?? []) {
    if (!photo.public_url) continue;
    const list = photosByUser.get(photo.user_id) ?? [];
    list.push(photo.public_url);
    photosByUser.set(photo.user_id, list);
  }

  const linkedinCandidatesByUser = new Map<
    string,
    Array<{
      idempotency_key: string;
      image_url: string | null;
      updated_at: string;
    }>
  >();
  for (const row of linkedinResult.data ?? []) {
    const candidates = linkedinCandidatesByUser.get(row.user_id) ?? [];
    candidates.push(row);
    linkedinCandidatesByUser.set(row.user_id, candidates);
  }
  const linkedinByUser = new Map<string, string>();
  for (const [userId, candidates] of linkedinCandidatesByUser) {
    const imageUrl = selectPreferredIdentityAvatarUrl(candidates, supabaseUrl);
    if (imageUrl) linkedinByUser.set(userId, imageUrl);
  }

  for (const row of usersResult.data ?? []) {
    const name = row.display_name?.trim() || "Kinfolk member";
    const photos = prependLinkedInProfilePhotoUrl(
      photosByUser.get(row.id) ?? [],
      linkedinByUser.get(row.id),
    );
    map.set(row.id, { name, initials: initialsFor(name), imageUrl: photos[0] ?? null });
  }
  return map;
}

function participantFrom(
  userId: string,
  userMap: Map<string, UserIdentity>,
  selfId: string,
): ChatParticipant {
  const entry = userMap.get(userId);
  const name = entry?.name ?? "Kinfolk member";
  return {
    userId,
    name,
    initials: entry?.initials ?? initialsFor(name),
    imageUrl: entry?.imageUrl ?? null,
    isSelf: userId === selfId,
  };
}

function toMessageView(
  row: Database["public"]["Tables"]["chat_messages"]["Row"],
  userMap: Map<string, UserIdentity>,
  selfId: string,
): ChatMessageView {
  const senderId = row.sender_user_id;
  const entry = senderId ? userMap.get(senderId) : undefined;
  const name = entry?.name ?? "Former member";
  return {
    id: row.id,
    body: row.body,
    sentVia: (row.sent_via as ChatMessageProvenance) ?? "manual",
    senderUserId: senderId,
    senderName: name,
    senderInitials: entry?.initials ?? initialsFor(name),
    isMine: senderId === selfId,
    createdAt: row.created_at,
  };
}

// ── Public reads ─────────────────────────────────────────────────────────────

export async function getChatRoomsForCurrentUser(): Promise<ChatRoomsSnapshot> {
  if (!hasServerSupabaseConfig()) return { status: "unavailable", rooms: [] };
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);
  if (!user) return { status: "signed_out", rooms: [] };

  return getChatRoomsForUser(supabase, user.id);
}

// Group-room reconciliation costs 5+ queries per group and can write; the
// /chats list polls every ~8s per viewer, so run it at most once per minute
// per user. Membership changes surface within the TTL, and group actions
// repair rooms through their own paths.
const GROUP_ROOM_RECONCILE_TTL_MS = 60_000;
const lastGroupRoomReconcileAt = new Map<string, number>();

export async function getChatRoomsForUser(
  supabase: ServiceClient,
  userId: string,
): Promise<ChatRoomsSnapshot> {
  const lastReconcile = lastGroupRoomReconcileAt.get(userId) ?? 0;
  if (Date.now() - lastReconcile >= GROUP_ROOM_RECONCILE_TTL_MS) {
    if (lastGroupRoomReconcileAt.size > 10_000) {
      lastGroupRoomReconcileAt.clear();
    }
    lastGroupRoomReconcileAt.set(userId, Date.now());
    await ensureApartmentGroupRoomsForUser(supabase, userId).catch((error) => {
      console.error("[chat] Failed to reconcile apartment group rooms.", error);
    });
  }

  const membershipResult = await supabase
    .from("chat_room_members")
    .select("room_id, last_read_at, history_visible_from, text_notifications_enabled")
    .eq("user_id", userId)
    .eq("status", "active");
  if (membershipResult.error) throw membershipResult.error;
  const memberships = membershipResult.data ?? [];
  if (memberships.length === 0) return { status: "connected", rooms: [] };

  const membershipByRoom = new Map(memberships.map((m) => [m.room_id, m]));
  const roomIds = memberships.map((m) => m.room_id);

  const roomsResult = await supabase.from("chat_rooms").select("*").in("id", roomIds);
  if (roomsResult.error) throw roomsResult.error;
  let rooms = roomsResult.data ?? [];

  // Drop apartment-group rooms the viewer is no longer an active group member of.
  const groupRoomGroupIds = rooms
    .filter((r) => r.room_type === "apartment_group" && r.apartment_group_id)
    .map((r) => r.apartment_group_id as string);
  if (groupRoomGroupIds.length > 0) {
    const activeGroups = await supabase
      .from("apartment_roommate_group_memberships")
      .select("group_id")
      .eq("user_id", userId)
      .eq("status", "member")
      .in("group_id", groupRoomGroupIds);
    if (activeGroups.error) throw activeGroups.error;
    const activeGroupIds = new Set((activeGroups.data ?? []).map((row) => row.group_id));
    rooms = rooms.filter(
      (r) =>
        r.room_type !== "apartment_group" ||
        (r.apartment_group_id != null && activeGroupIds.has(r.apartment_group_id)),
    );
  }
  if (rooms.length === 0) return { status: "connected", rooms: [] };

  // Batch the context lookups.
  const allMembersResult = await supabase
    .from("chat_room_members")
    .select("room_id, user_id, role")
    .in(
      "room_id",
      rooms.map((r) => r.id),
    )
    .eq("status", "active");
  if (allMembersResult.error) throw allMembersResult.error;
  const membersByRoom = new Map<string, { user_id: string; role: string }[]>();
  for (const member of allMembersResult.data ?? []) {
    const list = membersByRoom.get(member.room_id) ?? [];
    list.push(member);
    membersByRoom.set(member.room_id, list);
  }

  const groupIds = rooms
    .map((r) => r.apartment_group_id)
    .filter((id): id is string => Boolean(id));
  const edgeIds = rooms
    .map((r) => r.compatibility_edge_id)
    .filter((id): id is string => Boolean(id));

  const [groupsById, listingsById, edgeScoreById] = await Promise.all([
    loadGroupsById(supabase, groupIds),
    loadListingsForRooms(supabase, rooms, groupIds),
    loadEdgeScores(supabase, edgeIds),
  ]);

  const userMap = await loadUserMap(
    supabase,
    (allMembersResult.data ?? []).map((m) => m.user_id),
  );

  const summaries = await Promise.all(
    rooms.map(async (room) => {
      const membership = membershipByRoom.get(room.id);
      if (!membership) return null;
      const members = membersByRoom.get(room.id) ?? [];
      const participants = members
        .filter((m) => m.user_id !== userId)
        .map((m) => participantFrom(m.user_id, userMap, userId));

      const threshold = membership.last_read_at ?? membership.history_visible_from;
      const [last, unread] = await Promise.all([
        supabase
          .from("chat_messages")
          .select("body, sent_via, created_at")
          .eq("room_id", room.id)
          .is("deleted_at", null)
          .gte("created_at", membership.history_visible_from)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("room_id", room.id)
          .is("deleted_at", null)
          // PostgREST neq excludes NULLs, which would hide null-sender
          // messages (deleted accounts) from the unread count even though
          // the thread renders them.
          .or(`sender_user_id.is.null,sender_user_id.neq.${userId}`)
          .gt("created_at", threshold),
      ]);
      if (last.error) throw last.error;
      if (unread.error) throw unread.error;

      const context = buildContext(room, groupsById, listingsById, edgeScoreById);
      const title = buildTitle(room, participants, context, listingsById);

      return {
        id: room.id,
        roomType: room.room_type as ChatRoomType,
        status: room.status as ChatRoomSummary["status"],
        title,
        participants,
        context,
        lastMessagePreview: last.data?.body ?? null,
        lastMessageSentVia: (last.data?.sent_via as ChatMessageProvenance | undefined) ?? null,
        lastActivityAt: last.data?.created_at ?? room.created_at,
        unreadCount: unread.count ?? 0,
        textNotificationsEnabled: membership.text_notifications_enabled,
      } satisfies ChatRoomSummary;
    }),
  );

  const rows = summaries.filter((s): s is ChatRoomSummary => s !== null);
  rows.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return { status: "connected", rooms: rows };
}

export async function getChatRoomForCurrentUser(
  roomId: string,
): Promise<ChatRoomDetail | null> {
  if (!hasServerSupabaseConfig()) return null;
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);
  if (!user) return null;

  return getChatRoomForUser(supabase, roomId, user.id);
}

export async function getChatRoomForUser(
  supabase: ServiceClient,
  roomId: string,
  userId: string,
): Promise<ChatRoomDetail | null> {
  const roomResult = await supabase
    .from("chat_rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (roomResult.error) throw roomResult.error;
  const room = roomResult.data;
  if (!room) return null;

  let membership: ChatMemberRow;
  try {
    membership = await assertRoomAccess(supabase, room, userId);
  } catch (error) {
    if (error instanceof ChatError && error.status === 404) {
      return null;
    }
    throw error;
  }

  // Newest page first, then re-sorted ascending for display: an ascending
  // LIMIT would freeze the room at its oldest MESSAGE_PAGE_SIZE messages —
  // past that count, new messages would never render.
  const messagesResult = await supabase
    .from("chat_messages")
    .select("*")
    .eq("room_id", room.id)
    .is("deleted_at", null)
    .gte("created_at", membership.history_visible_from)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (messagesResult.error) throw messagesResult.error;
  const messageRows = (messagesResult.data ?? []).reverse();
  const readThreshold = membership.last_read_at ?? membership.history_visible_from;
  const unreadResult = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id)
    .is("deleted_at", null)
    // NULL-safe: see the list-path unread count.
    .or(`sender_user_id.is.null,sender_user_id.neq.${userId}`)
    .gt("created_at", readThreshold);
  if (unreadResult.error) throw unreadResult.error;

  const membersResult = await supabase
    .from("chat_room_members")
    .select("user_id")
    .eq("room_id", room.id)
    .eq("status", "active");
  if (membersResult.error) throw membersResult.error;

  const userIds = [
    ...membersResult.data!.map((m) => m.user_id),
    ...messageRows.map((m) => m.sender_user_id).filter((id): id is string => Boolean(id)),
  ];
  const userMap = await loadUserMap(supabase, userIds);

  const participants = membersResult
    .data!.filter((m) => m.user_id !== userId)
    .map((m) => participantFrom(m.user_id, userMap, userId));

  const [groupsById, listingsById, edgeScoreById] = await Promise.all([
    loadGroupsById(supabase, room.apartment_group_id ? [room.apartment_group_id] : []),
    loadListingsForRooms(supabase, [room], room.apartment_group_id ? [room.apartment_group_id] : []),
    loadEdgeScores(supabase, room.compatibility_edge_id ? [room.compatibility_edge_id] : []),
  ]);
  const context = buildContext(room, groupsById, listingsById, edgeScoreById);
  const title = buildTitle(room, participants, context, listingsById);

  return {
    id: room.id,
    roomType: room.room_type as ChatRoomType,
    status: room.status as ChatRoomDetail["status"],
    title,
    participants,
    context,
    historyVisibleFrom: membership.history_visible_from,
    unreadCount: unreadResult.count ?? 0,
    textNotificationsEnabled: membership.text_notifications_enabled,
    canSend: room.status === "active",
    messages: messageRows.map((row) => toMessageView(row, userMap, userId)),
  };
}

// ── Context lookup helpers ───────────────────────────────────────────────────

type GroupContextRow = {
  id: string;
  listing_id: string | null;
  floor_plan_name: string | null;
  target_unit_name: string | null;
  monthly_rent: number | null;
  bedrooms: number | null;
};
type ListingContextRow = {
  id: string;
  address_line: string;
  neighborhood: string | null;
  monthly_rent: number | null;
  bedrooms: number | null;
};

async function loadGroupsById(
  supabase: ServiceClient,
  groupIds: string[],
): Promise<Map<string, GroupContextRow>> {
  const map = new Map<string, GroupContextRow>();
  const unique = Array.from(new Set(groupIds));
  if (unique.length === 0) return map;
  const result = await supabase
    .from("apartment_roommate_groups")
    .select("id, listing_id, floor_plan_name, target_unit_name, monthly_rent, bedrooms")
    .in("id", unique);
  if (result.error) throw result.error;
  for (const row of result.data ?? []) map.set(row.id, row as GroupContextRow);
  return map;
}

async function loadListingsForRooms(
  supabase: ServiceClient,
  rooms: ChatRoomRow[],
  groupIds: string[],
): Promise<Map<string, ListingContextRow>> {
  const map = new Map<string, ListingContextRow>();
  const listingIds = new Set<string>();
  for (const room of rooms) if (room.listing_id) listingIds.add(room.listing_id);
  // Also pull listing ids from the groups so titles resolve even if room.listing_id is null.
  if (groupIds.length > 0) {
    const groupListings = await supabase
      .from("apartment_roommate_groups")
      .select("listing_id")
      .in("id", Array.from(new Set(groupIds)));
    if (groupListings.error) throw groupListings.error;
    for (const row of groupListings.data ?? []) {
      if (row.listing_id) listingIds.add(row.listing_id);
    }
  }
  if (listingIds.size === 0) return map;
  const result = await supabase
    .from("apartment_listings")
    .select("id, address_line, neighborhood, monthly_rent, bedrooms")
    .in("id", Array.from(listingIds));
  if (result.error) throw result.error;
  for (const row of result.data ?? []) map.set(row.id, row as ListingContextRow);
  return map;
}

async function loadEdgeScores(
  supabase: ServiceClient,
  edgeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = Array.from(new Set(edgeIds));
  if (unique.length === 0) return map;
  const result = await supabase
    .from("compatibility_edges")
    .select("id, score")
    .in("id", unique);
  if (result.error) throw result.error;
  for (const row of result.data ?? []) map.set(row.id, Math.round(row.score));
  return map;
}

function listingForRoom(
  room: ChatRoomRow,
  groupsById: Map<string, GroupContextRow>,
  listingsById: Map<string, ListingContextRow>,
): ListingContextRow | null {
  if (room.listing_id && listingsById.has(room.listing_id)) {
    return listingsById.get(room.listing_id)!;
  }
  if (room.apartment_group_id) {
    const group = groupsById.get(room.apartment_group_id);
    if (group?.listing_id && listingsById.has(group.listing_id)) {
      return listingsById.get(group.listing_id)!;
    }
  }
  return null;
}

function buildContext(
  room: ChatRoomRow,
  groupsById: Map<string, GroupContextRow>,
  listingsById: Map<string, ListingContextRow>,
  edgeScoreById: Map<string, number>,
): ChatRoomContext {
  if (room.room_type === "match_dm") {
    const score = room.compatibility_edge_id
      ? edgeScoreById.get(room.compatibility_edge_id) ?? null
      : null;
    return { listingLine: null, priceLine: null, matchScore: score };
  }

  const group = room.apartment_group_id ? groupsById.get(room.apartment_group_id) : undefined;
  const listing = listingForRoom(room, groupsById, listingsById);
  const rent = group?.monthly_rent ?? listing?.monthly_rent ?? null;
  const beds = group?.bedrooms ?? listing?.bedrooms ?? null;

  const addr = shortAddress(listing?.address_line);
  const listingLine = addr
    ? listing?.neighborhood
      ? `${addr}, ${listing.neighborhood}`
      : addr
    : null;

  const bedsLabel = formatBeds(beds);
  const priceLine = rent
    ? `$${Math.round(rent).toLocaleString("en-US")}/mo${bedsLabel ? ` · ${bedsLabel}` : ""}`
    : bedsLabel;

  return { listingLine, priceLine, matchScore: null };
}

function buildTitle(
  room: ChatRoomRow,
  participants: ChatParticipant[],
  context: ChatRoomContext,
  listingsById: Map<string, ListingContextRow>,
): string {
  if (room.room_type === "match_dm") {
    return participants[0]?.name ?? "Match";
  }
  const listing = room.listing_id ? listingsById.get(room.listing_id) : undefined;
  return (
    shortAddress(listing?.address_line) ??
    (context.listingLine ? context.listingLine.split(",")[0] : null) ??
    "Apartment group"
  );
}

// ── Public writes ────────────────────────────────────────────────────────────

export async function sendChatMessageForCurrentUser(
  roomId: string,
  body: string,
): Promise<ChatMessageView> {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);
  if (!user) throw new ChatError("Sign in before sending a message.", 401);

  return sendChatMessageForUser(supabase, user.id, roomId, body);
}

export async function sendChatMessageForUser(
  supabase: ServiceClient,
  userId: string,
  roomId: string,
  body: string,
  options: {
    agentRunId?: string | null;
    sentVia?: ChatMessageProvenance;
    sourceTextMessageId?: string | null;
  } = {},
): Promise<ChatMessageView> {
  const { room } = await loadRoomWithAccess(supabase, roomId, userId);

  if (room.status !== "active") {
    throw new ChatError("This conversation is closed.", 403);
  }

  const trimmed = body.trim();
  if (trimmed.length === 0) throw new ChatError("Write a message first.", 400);
  if (trimmed.length > MAX_BODY_LENGTH) throw new ChatError("That message is too long.", 400);

  const inserted = await supabase
    .from("chat_messages")
    .insert({
      agent_run_id: options.agentRunId ?? null,
      body: trimmed,
      room_id: roomId,
      sender_user_id: userId,
      sent_via: options.sentVia ?? "manual",
      source_text_message_id: options.sourceTextMessageId ?? null,
    })
    .select("*")
    .single();
  if (inserted.error) throw inserted.error;

  // The sender has implicitly read their own message.
  const readUpdate = await supabase
    .from("chat_room_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (readUpdate.error) throw readUpdate.error;

  // Text the other members who opted into room notifications. Genuinely
  // fire-and-forget: the interactive send must not wait on per-recipient
  // lookups or the SMS provider, and a notification failure must never fail
  // the chat send itself.
  void import("@/lib/notifications/chat-message-notifications")
    .then(({ sendChatMessageTextNotifications }) =>
      sendChatMessageTextNotifications(supabase, {
        messageId: inserted.data.id,
        roomId,
        senderUserId: userId,
      }),
    )
    .catch((error: unknown) => {
      console.error("[chat] chat-message text notification failed", {
        error: error instanceof Error ? error.message : String(error),
        roomId,
      });
    });

  const userMap = await loadUserMap(supabase, [userId]);
  const name = userMap.get(userId)?.name ?? "You";
  return {
    id: inserted.data.id,
    body: inserted.data.body,
    sentVia: (inserted.data.sent_via as ChatMessageProvenance) ?? "manual",
    senderUserId: userId,
    senderName: name,
    senderInitials: initialsFor(name),
    isMine: true,
    createdAt: inserted.data.created_at,
  };
}

export async function markChatRoomReadForCurrentUser(roomId: string): Promise<{ ok: true }> {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);
  if (!user) throw new ChatError("Sign in first.", 401);

  const { membership } = await loadRoomWithAccess(supabase, roomId, user.id);

  const update = await supabase
    .from("chat_room_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("id", membership.id);
  if (update.error) throw update.error;
  return { ok: true };
}

export async function setChatRoomNotificationsForCurrentUser(
  roomId: string,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);
  if (!user) throw new ChatError("Sign in first.", 401);

  const { membership } = await loadRoomWithAccess(supabase, roomId, user.id);

  if (enabled) {
    const phone = await supabase
      .from("user_phone_numbers")
      .select("id")
      .eq("user_id", user.id)
      .not("verified_at", "is", null)
      .eq("sms_consent_state", "opted_in")
      .limit(1)
      .maybeSingle();
    if (phone.error) throw phone.error;
    if (!phone.data) {
      throw new PhoneVerificationRequiredError();
    }
  }

  const update = await supabase
    .from("chat_room_members")
    .update({ text_notifications_enabled: enabled })
    .eq("id", membership.id);
  if (update.error) throw update.error;
  return { enabled };
}

/**
 * Record the viewer's interest in a match and, if the other person has also opted
 * in, open (or return) the match DM room. Mirrors the "only mutual interest opens a
 * chat" product rule — no contact details are ever exchanged.
 */
export async function recordMatchIntentAndOpen(
  compatibilityEdgeId: string,
): Promise<MatchIntentResult> {
  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);
  if (!user) throw new ChatError("Sign in before messaging a match.", 401);
  return recordMatchIntentAndOpenForUser(supabase, user.id, compatibilityEdgeId);
}

/**
 * Service-role core of the match-intent flow, shared by the web action above
 * and the iMessage agent's message_roommate_match tool. Records the actor's
 * approved_intro and opens the match DM only when the intent is MUTUAL.
 *
 * `introMessage` (agent path) is stashed on the approved_intro event so the
 * words the user asked to send actually reach the match when the chat opens —
 * "he'll see your message" must be true, not a hope. Stored intros from BOTH
 * sides are delivered (oldest intent first) the moment the room opens, then
 * cleared so a re-open can never re-send them.
 */
export async function recordMatchIntentAndOpenForUser(
  supabase: ServiceClient,
  userId: string,
  compatibilityEdgeId: string,
  options: { introMessage?: string | null } = {},
): Promise<MatchIntentResult> {
  const edgeResult = await supabase
    .from("compatibility_edges")
    .select("id, user_a_id, user_b_id")
    .eq("id", compatibilityEdgeId)
    .maybeSingle();
  if (edgeResult.error) throw edgeResult.error;
  const edge = edgeResult.data;
  if (!edge || (edge.user_a_id !== userId && edge.user_b_id !== userId)) {
    throw new ChatError("Not found.", 404);
  }
  const otherId = edge.user_a_id === userId ? edge.user_b_id : edge.user_a_id;
  const introMessage = options.introMessage?.trim() || null;

  // Record this viewer's approved_intro (idempotently).
  const mine = await supabase
    .from("match_feedback_events")
    .select("id")
    .eq("compatibility_edge_id", compatibilityEdgeId)
    .eq("actor_user_id", userId)
    .eq("event_type", "approved_intro")
    .maybeSingle();
  if (mine.error) throw mine.error;
  if (!mine.data) {
    const insert = await supabase.from("match_feedback_events").insert({
      compatibility_edge_id: compatibilityEdgeId,
      actor_user_id: userId,
      event_type: "approved_intro",
      free_text: introMessage,
      reason_codes: [],
    });
    // A double-tap / concurrent retry can race past the select above; the partial
    // unique index on (edge, actor) WHERE approved_intro collapses the duplicate (23505).
    if (insert.error && insert.error.code !== "23505") throw insert.error;
  } else if (introMessage) {
    // Intent already recorded but the user just gave (or refined) the words —
    // keep the latest draft so it delivers on open.
    const update = await supabase
      .from("match_feedback_events")
      .update({ free_text: introMessage })
      .eq("id", mine.data.id);
    if (update.error) throw update.error;
  }

  // Mutual? Both people's latest meaningful match event must still be
  // approved_intro. An older approval followed by pass/report must not open a DM.
  const [latestMine, latestTheirs] = await Promise.all([
    loadLatestMatchFeedbackEvent(supabase, compatibilityEdgeId, userId),
    loadLatestMatchFeedbackEvent(supabase, compatibilityEdgeId, otherId),
  ]);

  if (
    latestMine?.event_type !== "approved_intro" ||
    latestTheirs?.event_type !== "approved_intro"
  ) {
    return { status: "pending" };
  }

  const room = await ensureMatchDmRoom(supabase, compatibilityEdgeId, [userId, otherId]);
  await deliverStoredIntroMessages(supabase, compatibilityEdgeId, room.id);
  return { status: "opened", roomId: room.id };
}

/**
 * Deliver both sides' stored intro drafts into a freshly opened match DM,
 * oldest intent first, then clear them so they can never double-send. Failing
 * to deliver an intro must not fail the open itself.
 */
async function deliverStoredIntroMessages(
  supabase: ServiceClient,
  compatibilityEdgeId: string,
  roomId: string,
): Promise<void> {
  const events = await supabase
    .from("match_feedback_events")
    .select("id, actor_user_id, free_text, created_at")
    .eq("compatibility_edge_id", compatibilityEdgeId)
    .eq("event_type", "approved_intro")
    .not("free_text", "is", null)
    .order("created_at", { ascending: true });
  if (events.error) throw events.error;

  for (const event of events.data ?? []) {
    const body = event.free_text?.trim();
    if (!body) continue;
    // Clear FIRST so a concurrent open can't double-deliver the same intro.
    const claim = await supabase
      .from("match_feedback_events")
      .update({ free_text: null })
      .eq("id", event.id)
      .not("free_text", "is", null)
      .select("id");
    if (claim.error) throw claim.error;
    if ((claim.data ?? []).length === 0) continue;

    try {
      await sendChatMessageForUser(supabase, event.actor_user_id, roomId, body, {
        sentVia: "kinfolk_agent",
      });
    } catch (error) {
      console.error("[chat] stored intro delivery failed", {
        error: error instanceof Error ? error.message : String(error),
        roomId,
      });
      // Put the intro back so a later open retries it — otherwise a transient
      // send failure permanently destroys the user's message.
      const restore = await supabase
        .from("match_feedback_events")
        .update({ free_text: body })
        .eq("id", event.id)
        .is("free_text", null);
      if (restore.error) {
        console.error("[chat] stored intro restore failed", {
          error: restore.error.message,
          roomId,
        });
      }
    }
  }
}

async function loadLatestMatchFeedbackEvent(
  supabase: ServiceClient,
  compatibilityEdgeId: string,
  actorUserId: string,
): Promise<MatchFeedbackEventRow | null> {
  const result = await supabase
    .from("match_feedback_events")
    .select("event_type, created_at")
    .eq("compatibility_edge_id", compatibilityEdgeId)
    .eq("actor_user_id", actorUserId)
    .in("event_type", ["approved_intro", "passed", "reported"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}
