import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoomDetail, ChatRoomsSnapshot } from "@/lib/chat/types";
import { ChatList } from "./chat-list";
import { ChatRoom } from "./chat-room";

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string | { toString: () => string };
    }) =>
      React.createElement(
        "a",
        { ...props, href: typeof href === "string" ? href : href.toString() },
        children,
      ),
  };
});

vi.mock("next/image", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: (props: Record<string, unknown>) =>
      React.createElement("img", {
        alt: typeof props.alt === "string" ? props.alt : "",
        height: typeof props.height === "number" ? props.height : undefined,
        src: typeof props.src === "string" ? props.src : "",
        width: typeof props.width === "number" ? props.width : undefined,
      }),
  };
});

vi.mock("swr", () => ({
  default: (_key: string, _fetcher: unknown, options?: { fallbackData?: unknown }) => ({
    data: options?.fallbackData,
    mutate: vi.fn(),
  }),
  useSWRConfig: () => ({
    mutate: vi.fn(),
  }),
}));

const roomsSnapshot: ChatRoomsSnapshot = {
  status: "connected",
  rooms: [
    {
      context: {
        listingLine: null,
        matchScore: 91,
        priceLine: null,
      },
      id: "room-match",
      lastActivityAt: "2026-06-27T19:45:00.000Z",
      lastMessagePreview: "Kinfolk can tee up an intro.",
      lastMessageSentVia: "kinfolk_agent",
      participants: [
        {
          imageUrl: null,
          initials: "MC",
          isSelf: false,
          name: "Maya Chen",
          userId: "maya",
        },
      ],
      roomType: "match_dm",
      status: "active",
      textNotificationsEnabled: true,
      title: "Maya Chen",
      unreadCount: 2,
    },
    {
      context: {
        listingLine: "77 Bruton St",
        matchScore: null,
        priceLine: "$4,200/mo",
      },
      id: "room-group",
      lastActivityAt: "2026-06-27T18:15:00.000Z",
      lastMessagePreview: null,
      lastMessageSentVia: null,
      participants: [
        {
          imageUrl: null,
          initials: "LC",
          isSelf: false,
          name: "Leo Chen",
          userId: "leo",
        },
        {
          imageUrl: null,
          initials: "PS",
          isSelf: false,
          name: "Priya Shah",
          userId: "priya",
        },
      ],
      roomType: "apartment_group",
      status: "active",
      textNotificationsEnabled: false,
      title: "77 Bruton group",
      unreadCount: 0,
    },
  ],
};

const roomDetail: ChatRoomDetail = {
  canSend: true,
  context: {
    listingLine: null,
    matchScore: 91,
    priceLine: null,
  },
  historyVisibleFrom: "2026-06-27T18:00:00.000Z",
  id: "room-match",
  messages: [
    {
      body: "I am flexible on Saturday tours.",
      createdAt: "2026-06-27T19:00:00.000Z",
      id: "message-1",
      isMine: false,
      senderInitials: "MC",
      senderName: "Maya Chen",
      senderUserId: "maya",
      sentVia: "manual",
    },
    {
      body: "Kinfolk can tee up an intro.",
      createdAt: "2026-06-27T19:05:00.000Z",
      id: "message-2",
      isMine: true,
      senderInitials: "AS",
      senderName: "Avery Stone",
      senderUserId: "avery",
      sentVia: "kinfolk_agent",
    },
  ],
  participants: roomsSnapshot.rooms[0]!.participants,
  roomType: "match_dm",
  status: "active",
  textNotificationsEnabled: true,
  title: "Maya Chen",
  unreadCount: 1,
};

const groupRoomDetail: ChatRoomDetail = {
  ...roomDetail,
  canSend: false,
  context: {
    listingLine: "77 Bruton St, Pacific Heights",
    matchScore: null,
    priceLine: "$4,200/mo · 2bd",
  },
  id: "room-group",
  messages: [
    {
      body: "I can tour after work.",
      createdAt: "2026-06-27T18:10:00.000Z",
      id: "message-group-1",
      isMine: false,
      senderInitials: "LC",
      senderName: "Leo Chen",
      senderUserId: "leo",
      sentVia: "manual",
    },
  ],
  participants: roomsSnapshot.rooms[1]!.participants,
  roomType: "apartment_group",
  status: "frozen",
  textNotificationsEnabled: false,
  title: "77 Bruton group",
  unreadCount: 0,
};

describe("chat surfaces", () => {
  it("renders chat inbox rows with unread, provenance, and navigation context", () => {
    const html = renderToStaticMarkup(<ChatList initial={roomsSnapshot} />);

    expect(html).toContain("<h1");
    expect(html).toContain("Chats");
    expect(html).toContain('href="/chats/room-match"');
    expect(html).toContain("Maya Chen");
    expect(html).toContain("via Kinfolk");
    expect(html).toContain("Kinfolk can tee up an intro.");
    expect(html).toContain('aria-label="2 unread"');
    expect(html).toContain(">2</span>");
    expect(html).toContain('href="/chats/room-group"');
    expect(html).toContain("77 Bruton group");
    expect(html).toContain("Start coordinating with the group");
  });

  it("renders the empty inbox with routes back to matches and apartments", () => {
    const html = renderToStaticMarkup(
      <ChatList initial={{ status: "connected", rooms: [] }} />,
    );

    expect(html).toContain("No chats yet");
    expect(html).toContain("When you and a roommate both message interest");
    expect(html).toContain('href="/me/matches"');
    expect(html).toContain('href="/apartments"');
  });

  it("renders a match room with boundary copy, provenance, notifications, and composer", () => {
    const html = renderToStaticMarkup(<ChatRoom initial={roomDetail} />);

    expect(html).toContain('href="/chats"');
    expect(html).toContain('aria-label="Back to chats"');
    expect(html).toContain("Maya Chen");
    expect(html).toContain("91% fit");
    expect(html).toContain("You matched with Maya Chen.");
    expect(html).toContain("No phone numbers exchanged");
    expect(html).toContain("I am flexible on Saturday tours.");
    expect(html).toContain("Kinfolk can tee up an intro.");
    expect(html).toContain("sent via Kinfolk");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Turn off text notifications"');
    expect(html).toContain('aria-label="Message"');
    expect(html).toContain('aria-label="Send"');
  });

  it("renders an apartment group room with listing context and read-only closed state", () => {
    const html = renderToStaticMarkup(<ChatRoom initial={groupRoomDetail} />);

    expect(html).toContain("77 Bruton group");
    expect(html).toContain("Leo, Priya");
    expect(html).toContain("77 Bruton St, Pacific Heights");
    expect(html).toContain("$4,200/mo");
    expect(html).toContain("You joined");
    expect(html).toContain("I can tour after work.");
    expect(html).toContain("Leo Chen");
    expect(html).toContain("This conversation is closed. You can still read the history.");
    expect(html).not.toContain('aria-label="Message"');
    expect(html).not.toContain('aria-label="Send"');
  });
});
