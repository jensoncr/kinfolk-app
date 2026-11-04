// Shared chat domain types — safe to import from both server accessors and
// client components (no "server-only" here). The server store in lib/chat/store.ts
// builds these; the UI in components/chat/* renders them.

export type ChatRoomType = "match_dm" | "apartment_group";
type ChatRoomStatus = "active" | "frozen" | "archived";
export type ChatMessageProvenance = "manual" | "kinfolk_agent";

export type ChatParticipant = {
  userId: string;
  name: string;
  initials: string;
  imageUrl: string | null;
  isSelf: boolean;
};

export type ChatMessageView = {
  id: string;
  body: string;
  sentVia: ChatMessageProvenance;
  senderUserId: string | null;
  senderName: string;
  senderInitials: string;
  isMine: boolean;
  createdAt: string;
};

/** Lightweight context shown in the room header / list row. */
export type ChatRoomContext = {
  /** Apartment-group rooms: the listing line, e.g. "1487 14th Ave, Inner Sunset". */
  listingLine: string | null;
  /** Apartment-group rooms: "$4,200/mo · 3bd"-style summary. */
  priceLine: string | null;
  /** Match DMs: the compatibility score (0-100), if known. */
  matchScore: number | null;
};

export type ChatRoomSummary = {
  id: string;
  roomType: ChatRoomType;
  status: ChatRoomStatus;
  title: string;
  /** Other participants (everyone but the viewer). */
  participants: ChatParticipant[];
  context: ChatRoomContext;
  lastMessagePreview: string | null;
  lastMessageSentVia: ChatMessageProvenance | null;
  lastActivityAt: string;
  unreadCount: number;
  textNotificationsEnabled: boolean;
};

export type ChatRoomDetail = {
  id: string;
  roomType: ChatRoomType;
  status: ChatRoomStatus;
  title: string;
  participants: ChatParticipant[];
  context: ChatRoomContext;
  /** This viewer only sees messages at/after this instant. */
  historyVisibleFrom: string;
  unreadCount: number;
  textNotificationsEnabled: boolean;
  /** False when the room is frozen/archived (read-only). */
  canSend: boolean;
  messages: ChatMessageView[];
};

type ChatRoomsSnapshotStatus = "connected" | "signed_out" | "unavailable";

export type ChatRoomsSnapshot = {
  status: ChatRoomsSnapshotStatus;
  rooms: ChatRoomSummary[];
};

export type MatchIntentResult =
  | { status: "opened"; roomId: string }
  | { status: "pending" };
