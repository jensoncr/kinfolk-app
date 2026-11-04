"use client";

import Link from "next/link";
import useSWR from "swr";
import { MessageCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { ChatRoomsSnapshot, ChatRoomSummary } from "@/lib/chat/types";
import { formatChatTimestamp } from "./format";

async function fetchRooms(): Promise<ChatRoomsSnapshot> {
  const response = await fetch("/api/chats", {
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error("Unable to load your chats.");
  return (await response.json()) as ChatRoomsSnapshot;
}

export function ChatList({ initial }: { initial: ChatRoomsSnapshot }) {
  const { data } = useSWR<ChatRoomsSnapshot>("/api/chats", fetchRooms, {
    fallbackData: initial,
    refreshInterval: 8000,
    revalidateOnFocus: true,
  });
  const rooms = data?.rooms ?? [];

  return (
    <section className="flex w-full flex-col">
      <h1 className="serif text-4xl leading-[1] tracking-[-0.02em] text-[#0f1a14] sm:text-[44px]">
        Chats
      </h1>

      {rooms.length === 0 ? (
        <EmptyChats />
      ) : (
        <div className="mt-6 rounded-2xl border border-[rgba(28,51,38,0.08)] bg-[#fdfcf8] p-1.5">
          <ul className="flex flex-col">
            {rooms.map((room, index) => (
              <li key={room.id}>
                {index > 0 ? (
                  <div className="mx-3 h-px bg-[rgba(28,51,38,0.06)]" aria-hidden="true" />
                ) : null}
                <ChatRow room={room} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ChatRow({ room }: { room: ChatRoomSummary }) {
  const unread = room.unreadCount > 0;
  const preview = room.lastMessagePreview ?? previewFallback(room);
  const timestamp = formatChatTimestamp(room.lastActivityAt);
  const agent = room.lastMessageSentVia === "kinfolk_agent";
  return (
    <Link
      href={`/chats/${room.id}`}
      aria-label={chatRowAriaLabel({
        agent,
        preview,
        room,
        timestamp,
        unread,
      })}
      className="kin-focus group flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-[rgba(28,51,38,0.04)]"
    >
      <RoomAvatars room={room} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={`min-w-0 flex-1 truncate text-[15.5px] text-[#0f1a14] ${unread ? "font-bold" : "font-semibold"}`}
          >
            {room.title}
          </span>
          <span className="mono shrink-0 text-[11.5px] text-[#8d9690]">
            {timestamp}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "text-[#2f4a3a]" : "text-[#6b7a70]"}`}
          >
            {agent ? (
              <span
                aria-hidden="true"
                className="mr-1.5 text-[12px] text-[#264a36]"
              >
                via Kinfolk ·
              </span>
            ) : null}
            {preview}
          </span>
          {unread ? (
            <span
              aria-label={`${room.unreadCount} unread`}
              className="mono grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--forest-600)] px-1.5 text-[11px] text-white"
            >
              {room.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function chatRowAriaLabel({
  agent,
  preview,
  room,
  timestamp,
  unread,
}: {
  agent: boolean;
  preview: string;
  room: ChatRoomSummary;
  timestamp: string;
  unread: boolean;
}): string {
  const header = `${room.title}, ${timestamp}${agent ? ", via Kinfolk" : ""}`;
  const previewLabel = preview.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const unreadLabel = unread ? `, ${room.unreadCount} unread` : "";
  return `${header}. ${previewLabel}${unreadLabel}.`;
}

function RoomAvatars({ room }: { room: ChatRoomSummary }) {
  if (room.roomType === "apartment_group") {
    const shown = room.participants.slice(0, 3);
    return (
      <span className="relative grid size-12 shrink-0 place-items-center">
        {shown.map((p, index) => (
          <span
            key={p.userId}
            className="absolute"
            style={positionFor(index, shown.length)}
          >
            <Avatar
              imageUrl={p.imageUrl}
              initials={p.initials}
              seed={p.userId}
              size={26}
              fontSize={10}
              className="ring-2 ring-[#fdfcf8]"
            />
          </span>
        ))}
        {shown.length === 0 ? (
          <span className="grid size-11 place-items-center rounded-full bg-[#eef2eb] text-[#264a36]">
            <MessageCircle size={18} strokeWidth={1.7} aria-hidden="true" />
          </span>
        ) : null}
      </span>
    );
  }
  const other = room.participants[0];
  return (
    <span className="shrink-0">
      <Avatar
        imageUrl={other?.imageUrl ?? null}
        initials={other?.initials ?? "·"}
        seed={other?.userId ?? room.id}
        size={48}
        fontSize={15}
      />
    </span>
  );
}

function positionFor(index: number, count: number): React.CSSProperties {
  if (count === 1) return { left: 11, top: 11 };
  const layout: React.CSSProperties[] = [
    { left: 0, top: 0 },
    { right: 0, top: 2 },
    { left: 9, bottom: 0 },
  ];
  return layout[index] ?? { left: 0, top: 0 };
}

function previewFallback(room: ChatRoomSummary): string {
  return room.roomType === "apartment_group"
    ? "Start coordinating with the group"
    : "Say hi 👋";
}

function EmptyChats() {
  return (
    <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-[rgba(28,51,38,0.14)] bg-[#fdfcf8] px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-[#eef2eb] text-[#264a36]">
        <MessageCircle size={20} strokeWidth={1.7} aria-hidden="true" />
      </span>
      <p className="serif mt-4 text-[20px] text-[#2f4a3a]">No chats yet</p>
      <p className="mt-1.5 max-w-[42ch] text-[13.5px] leading-6 text-[#6b7a70]">
        When you and a roommate both message interest, or you join an apartment group,
        the conversation opens here.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link
          href="/me/matches"
          className="kin-focus rounded-full border border-[rgba(28,51,38,0.16)] px-4 py-2 text-[13px] font-semibold text-[#2f4a3a] transition hover:border-[#264a36]"
        >
          See your matches
        </Link>
        <Link
          href="/apartments"
          className="kin-focus rounded-full border border-[rgba(28,51,38,0.16)] px-4 py-2 text-[13px] font-semibold text-[#2f4a3a] transition hover:border-[#264a36]"
        >
          Browse apartments
        </Link>
      </div>
    </div>
  );
}
