"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { Bell, BellOff, ChevronLeft, Send, Sparkle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { ChatRoomDetail } from "@/lib/chat/types";
import { formatDayDivider, formatMessageTime } from "./format";
import { buildRenderItems, type Renderable } from "./grouping";

type RoomResponse = { room: ChatRoomDetail };

async function fetchRoom(url: string): Promise<RoomResponse> {
  const response = await fetch(url, { headers: { "content-type": "application/json" } });
  if (!response.ok) throw new Error("Unable to load this chat.");
  return (await response.json()) as RoomResponse;
}

type Pending = { tempId: string; body: string; createdAt: string };

export function ChatRoom({ initial }: { initial: ChatRoomDetail }) {
  const key = `/api/chats/${initial.id}/messages`;
  const { data, mutate } = useSWR<RoomResponse>(key, fetchRoom, {
    fallbackData: { room: initial },
    refreshInterval: 5000,
    revalidateOnFocus: true,
  });
  const room = data?.room ?? initial;
  const { mutate: revalidate } = useSWRConfig();

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  // Optimistic override while a toggle is in flight; otherwise show server truth, so
  // a change from another tab/device or the agent is reflected on the next poll.
  const [optimisticNotify, setOptimisticNotify] = useState<boolean | null>(null);
  const notify = optimisticNotify ?? room.textNotificationsEnabled;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const shellRef = useRef<HTMLElement>(null);

  // Native-feeling mobile shell. On phones the room owns the whole screen:
  // the page behind it must not scroll (iOS pans the page when the keyboard
  // opens, leaving the composer stranded mid-screen — the "unreadable"
  // keyboard bug), and the shell tracks visualViewport.height so the composer
  // sits exactly on top of the keyboard like iMessage.
  // Subscribed to the media query, not evaluated once at mount: an iPad
  // rotating portrait→landscape must release the lock (and reapply on the way
  // back), otherwise the desktop layout runs with the body still frozen.
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    let release: (() => void) | null = null;

    const applyLock = () => {
      const { body, documentElement } = document;
      const previousOverflow = body.style.overflow;
      const previousOverscroll = documentElement.style.overscrollBehavior;
      body.style.overflow = "hidden";
      documentElement.style.overscrollBehavior = "none";

      const viewport = window.visualViewport;
      const shell = shellRef.current;
      const sync = () => {
        if (shell && viewport) {
          shell.style.height = `${Math.round(viewport.height)}px`;
        }
        // Undo Safari's focus pan so the fixed shell stays aligned to the top.
        window.scrollTo(0, 0);
        if (stickToBottomRef.current) {
          bottomRef.current?.scrollIntoView({ block: "end" });
        }
      };
      viewport?.addEventListener("resize", sync);
      sync();
      release = () => {
        viewport?.removeEventListener("resize", sync);
        if (shell) shell.style.height = "";
        body.style.overflow = previousOverflow;
        documentElement.style.overscrollBehavior = previousOverscroll;
        release = null;
      };
    };

    const syncToViewportClass = () => {
      if (mql.matches) {
        release?.();
      } else if (!release) {
        applyLock();
      }
    };
    syncToViewportClass();
    mql.addEventListener("change", syncToViewportClass);
    return () => {
      mql.removeEventListener("change", syncToViewportClass);
      release?.();
    };
  }, []);

  const newest = room.messages.at(-1) ?? null;
  const newestId = newest?.id ?? null;

  // Mark read on open or poll whenever the server says there is something to clear.
  // Using the unread count avoids missing older unread peer messages when the newest
  // message is ours, including messages sent through the iMessage chat bridge.
  // Keyed on `room` (fresh identity per successful poll), not the count value:
  // a failed POST with an unchanged count would otherwise never retry and the
  // badge would stick until a new message arrived.
  useEffect(() => {
    if (room.unreadCount <= 0) return;
    fetch(`/api/chats/${initial.id}/read`, { method: "POST" })
      .then(() => Promise.all([mutate(), revalidate("/api/chats")]))
      .catch(() => {});
  }, [initial.id, mutate, revalidate, room]);

  // Keep the latest message in view.
  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [newestId, pending.length]);

  function updateScrollStickiness() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
  }

  const items = useMemo(() => {
    // Hide an optimistic bubble once the server list already contains my matching
    // message, so neither the confirm-then-remove gap nor a fast poll shows it twice.
    // Consume one server match per pending bubble to keep two identical sends
    // distinct — and only match messages created around/after the bubble, so
    // re-sending a text identical to something I said last week ("ok") doesn't
    // consume the historical message and suppress the new bubble.
    const MATCH_SKEW_MS = 60_000;
    const myServerMessages = room.messages.filter((m) => m.isMine);
    const visiblePending = pending.filter((p) => {
      const cutoff = Date.parse(p.createdAt) - MATCH_SKEW_MS;
      const idx = myServerMessages.findIndex(
        (m) => m.body === p.body && Date.parse(m.createdAt) >= cutoff,
      );
      if (idx >= 0) {
        myServerMessages.splice(idx, 1);
        return false;
      }
      return true;
    });
    const all: Renderable[] = [
      ...room.messages,
      ...visiblePending.map((p) => ({
        id: p.tempId,
        body: p.body,
        sentVia: "manual" as const,
        senderUserId: null,
        senderName: "You",
        senderInitials: "",
        isMine: true,
        createdAt: p.createdAt,
        pending: true,
      })),
    ];
    return buildRenderItems(all, room.roomType);
  }, [room.messages, room.roomType, pending]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    stickToBottomRef.current = true;
    const tempId = `tmp-${Date.now()}`;
    setPending((prev) => [...prev, { tempId, body, createdAt: new Date().toISOString() }]);
    setDraft("");
    try {
      const response = await fetch(key, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Could not send your message.");
      }
      await mutate();
      setPending((prev) => prev.filter((p) => p.tempId !== tempId));
    } catch (caught) {
      setPending((prev) => prev.filter((p) => p.tempId !== tempId));
      // Restore the failed message only if the user hasn't started typing
      // something new during the in-flight request.
      setDraft((current) => (current.trim() ? current : body));
      setError(caught instanceof Error ? caught.message : "Could not send your message.");
    } finally {
      setSending(false);
    }
  }

  async function toggleNotify() {
    if (notifyBusy) return;
    const next = !notify;
    setOptimisticNotify(next);
    setNotifyBusy(true);
    setNotifyError(null);
    try {
      const response = await fetch(`/api/chats/${initial.id}/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Could not update text notifications.");
      }
      await mutate(); // refresh room so server truth matches the optimistic value
    } catch (caught) {
      setNotifyError(
        caught instanceof Error ? caught.message : "Could not update text notifications.",
      );
    } finally {
      // Drop the override: on success the refreshed room already shows `next`; on
      // failure it still shows the old value, so the bell reverts on its own.
      setOptimisticNotify(null);
      setNotifyBusy(false);
    }
  }

  const isGroup = room.roomType === "apartment_group";
  const subtitleIsScore = !isGroup && room.context.matchScore != null;
  const subtitle = isGroup
    ? room.participants.map((p) => p.name.split(" ")[0]).join(", ") || "Apartment group"
    : room.context.matchScore != null
      ? `${room.context.matchScore}% fit`
      : "Match";

  return (
    <section
      ref={shellRef}
      className="flex w-full flex-col max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:h-[100dvh] max-lg:bg-[#faf9f5]"
    >
      <div className="kin-card flex min-h-[420px] flex-col overflow-hidden max-lg:h-full max-lg:min-h-0 max-lg:rounded-none max-lg:border-0 max-lg:shadow-none lg:h-[calc(100vh-6rem)]">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <Link
            href="/chats"
            aria-label="Back to chats"
            className="kin-focus grid size-9 shrink-0 place-items-center rounded-full text-[#2f4a3a] transition hover:bg-[rgba(28,51,38,0.05)]"
          >
            <ChevronLeft size={20} strokeWidth={2.1} aria-hidden="true" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {!isGroup ? (
              <Avatar
                imageUrl={room.participants[0]?.imageUrl ?? null}
                initials={room.participants[0]?.initials ?? "·"}
                seed={room.participants[0]?.userId ?? room.id}
                size={34}
                fontSize={12}
              />
            ) : null}
            <div className="min-w-0">
              <p className="serif truncate text-[16px] font-semibold leading-tight tracking-[0.1px] text-[#0f1a14]">
                {room.title}
              </p>
              <p
                className={`${subtitleIsScore ? "mono " : ""}truncate text-[11.5px] text-[#6b7a70]`}
              >
                {subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleNotify}
            disabled={notifyBusy}
            aria-pressed={notify}
            aria-label={notify ? "Turn off text notifications" : "Turn on text notifications"}
            title={
              notify
                ? "Texting you a summary + link about this chat"
                : "Get a text when there's new activity"
            }
            className={`kin-focus grid size-9 shrink-0 place-items-center rounded-full transition ${
              notify
                ? "bg-[var(--mint-100)] text-[#264a36]"
                : "text-[#8d9690] hover:bg-[rgba(28,51,38,0.05)]"
            } disabled:opacity-50`}
          >
            {notify ? (
              <Bell size={17} strokeWidth={1.9} aria-hidden="true" />
            ) : (
              <BellOff size={17} strokeWidth={1.9} aria-hidden="true" />
            )}
          </button>
        </header>

        {notifyError ? (
          <p className="border-b border-[var(--border)] px-4 py-2 text-[12px] text-[var(--rust)]">
            {notifyError}
          </p>
        ) : null}

        {isGroup && (room.context.listingLine || room.context.priceLine) ? (
          <div className="border-b border-[var(--border)] px-4 py-2">
            <p className="truncate text-center text-[12px] text-[#4b5d52]">
              {room.context.listingLine}
              {room.context.listingLine && room.context.priceLine ? " · " : ""}
              {room.context.priceLine ? (
                <span className="mono text-[#2f4a3a]">{room.context.priceLine}</span>
              ) : null}
            </p>
          </div>
        ) : null}

        {/* Thread */}
        <div
          ref={scrollerRef}
          onScroll={updateScrollStickiness}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        >
          <JoinBoundary room={room} />
          <div className="flex flex-col gap-0.5">
            {items.map((item) =>
              item.type === "divider" ? (
                <div key={item.key} className="my-3 flex justify-center">
                  <span className="mono rounded-full bg-[rgba(28,51,38,0.05)] px-3 py-1 text-[11px] text-[#8d9690]">
                    {item.label}
                  </span>
                </div>
              ) : (
                <MessageBubble
                  key={item.message.id}
                  message={item.message}
                  showSender={item.showSender}
                  topOfGroup={item.topOfGroup}
                />
              ),
            )}
          </div>
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        {room.canSend ? (
          <div className="border-t border-[var(--border)] px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
            {error ? (
              <p className="mb-1.5 px-1 text-[12px] text-[var(--rust)]">{error}</p>
            ) : null}
            <div className="flex items-end gap-2">
              {/* Composer text is 16px below lg: anything smaller makes iOS
                  Safari zoom the whole page on focus — the mobile-unreadable
                  keyboard bug. */}
              <div className="flex flex-1 items-center rounded-[20px] border border-[var(--border-strong)] bg-white px-3.5 transition focus-within:border-[#264a36] focus-within:ring-2 focus-within:ring-[rgba(38,74,54,0.18)]">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={isGroup ? `Message ${room.title}` : "Message"}
                  aria-label="Message"
                  autoComplete="off"
                  name="message"
                  rows={1}
                  className="max-h-28 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-[1.4] text-[#0f1a14] outline-none placeholder:text-[#8d9690] lg:text-[14.5px] lg:leading-5"
                />
              </div>
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || sending}
                aria-label="Send"
                className="kin-focus grid size-10 shrink-0 place-items-center rounded-full bg-[var(--forest-700)] text-white transition hover:bg-[var(--forest-600)] disabled:bg-[#b6bdb7]"
              >
                <Send size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-[var(--border)] px-4 py-4 text-center">
            <p className="text-[13px] text-[#6b7a70]">
              This conversation is closed. You can still read the history.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function JoinBoundary({ room }: { room: ChatRoomDetail }) {
  if (room.roomType === "apartment_group") {
    return (
      <div className="mb-4 flex items-center justify-center gap-3">
        <span className="h-px w-10 bg-[var(--border-strong)]" />
        <span className="mono text-[11px] text-[#8d9690]">
          You joined · {formatDayDivider(room.historyVisibleFrom)}
        </span>
        <span className="h-px w-10 bg-[var(--border-strong)]" />
      </div>
    );
  }
  return (
    <div className="mb-5 px-4 text-center">
      <p className="text-[13px] leading-6 text-[#6b7a70]">
        <span className="font-semibold text-[#2f4a3a]">
          You matched with {room.participants[0]?.name ?? "this person"}.
        </span>{" "}
        No phone numbers exchanged — this chat lives inside Kinfolk.
      </p>
    </div>
  );
}

function MessageBubble({
  message,
  showSender,
  topOfGroup,
}: {
  message: Renderable;
  showSender: boolean;
  topOfGroup: boolean;
}) {
  const mine = message.isMine;
  const agent = message.sentVia === "kinfolk_agent";
  const timeLabel = formatMessageTime(message.createdAt);
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"} ${topOfGroup ? "mt-2" : ""}`}>
      {showSender ? (
        <span className="mb-0.5 ml-3 text-[11px] font-semibold text-[#6b7a70]">
          {message.senderName}
        </span>
      ) : null}
      <span className="sr-only">
        {message.senderName}, {timeLabel}
        {agent ? ", sent via Kinfolk" : ""}
      </span>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[14.5px] leading-[1.4] ${
          mine
            ? `rounded-br-md bg-[var(--forest-700)] text-[#f1f7f2] ${message.pending ? "opacity-60" : ""}`
            : "rounded-bl-md border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--ink-800)]"
        } whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}
        title={timeLabel}
      >
        {message.body}
      </div>
      {agent ? (
        <span className="mono mt-1 mr-1 flex items-center gap-1 text-[10.5px] text-[#264a36]">
          <Sparkle size={11} className="text-[var(--ochre)]" aria-hidden="true" /> sent via Kinfolk
        </span>
      ) : null}
    </div>
  );
}
