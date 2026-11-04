import type { ChatMessageView, ChatRoomType } from "@/lib/chat/types";
import { formatDayDivider } from "./format";

export type Renderable = ChatMessageView & { pending?: boolean };

export type RenderItem =
  | { type: "divider"; key: string; label: string }
  | { type: "message"; message: Renderable; showSender: boolean; topOfGroup: boolean };

function dayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Turn a flat message list into render items: day dividers plus per-message flags
 * for iMessage-style grouping (consecutive same-sender bubbles collapse; group rooms
 * label the first bubble of each "them" run with the sender's name).
 */
export function buildRenderItems(
  messages: Renderable[],
  roomType: ChatRoomType,
): RenderItem[] {
  const items: RenderItem[] = [];
  let prevSender: string | null | undefined;
  let prevDay: string | null = null;

  for (const message of messages) {
    const day = dayKey(message.createdAt);
    if (day !== prevDay) {
      items.push({
        type: "divider",
        key: `divider-${day}-${message.id}`,
        label: formatDayDivider(message.createdAt),
      });
      prevDay = day;
      prevSender = undefined; // force a fresh group after a divider
    }
    const senderKey = message.isMine ? "me" : message.senderUserId ?? message.senderName;
    const topOfGroup = senderKey !== prevSender;
    const showSender = roomType === "apartment_group" && !message.isMine && topOfGroup;
    items.push({ type: "message", message, showSender, topOfGroup });
    prevSender = senderKey;
  }

  return items;
}
