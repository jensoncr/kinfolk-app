import { describe, expect, it } from "vitest";
import { buildRenderItems, type Renderable } from "./grouping";

function msg(over: Partial<Renderable>): Renderable {
  return {
    id: over.id ?? "1",
    body: over.body ?? "hi",
    sentVia: over.sentVia ?? "manual",
    senderUserId: over.senderUserId ?? null,
    senderName: over.senderName ?? "Someone",
    senderInitials: over.senderInitials ?? "S",
    isMine: over.isMine ?? false,
    createdAt: over.createdAt ?? "2026-06-23T17:00:00Z",
    pending: over.pending,
  };
}

function messagesOf(items: ReturnType<typeof buildRenderItems>) {
  return items.filter((item) => item.type === "message");
}

describe("buildRenderItems", () => {
  it("returns an empty list for no messages", () => {
    expect(buildRenderItems([], "match_dm")).toEqual([]);
  });

  it("collapses consecutive same-sender bubbles and labels group senders", () => {
    const items = buildRenderItems(
      [
        msg({ id: "1", senderUserId: "a", isMine: false }),
        msg({ id: "2", senderUserId: "a", isMine: false }),
        msg({ id: "3", senderUserId: "me-row", isMine: true }),
        msg({ id: "4", senderUserId: "b", isMine: false }),
      ],
      "apartment_group",
    );
    const messages = messagesOf(items);
    expect(messages.map((m) => (m.type === "message" ? m.topOfGroup : null))).toEqual([
      true,
      false,
      true,
      true,
    ]);
    // Group rooms label the first bubble of each "them" run, never the user's own.
    expect(messages.map((m) => (m.type === "message" ? m.showSender : null))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it("never shows sender labels in a 1:1 match DM", () => {
    const items = buildRenderItems(
      [
        msg({ id: "1", senderUserId: "a", isMine: false }),
        msg({ id: "2", senderUserId: "a", isMine: false }),
      ],
      "match_dm",
    );
    expect(messagesOf(items).every((m) => m.type === "message" && !m.showSender)).toBe(true);
  });

  it("inserts a day divider when the calendar day changes", () => {
    const items = buildRenderItems(
      [
        msg({ id: "1", createdAt: "2026-06-22T17:00:00Z" }),
        msg({ id: "2", createdAt: "2026-06-23T09:00:00Z" }),
      ],
      "match_dm",
    );
    expect(items.filter((item) => item.type === "divider")).toHaveLength(2);
  });
});
