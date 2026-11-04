import { describe, expect, it, vi } from "vitest";
import { processListingRecommendationReaction } from "./listing-reactions";
import type { TextReactionEvent } from "@/lib/integrations/text-transport";

vi.mock("server-only", () => ({}));

const sendTextMessageMock = vi.fn();
vi.mock("@/lib/integrations/text-transport", () => ({
  getTextTransportFromNumber: () => "+14155550147",
  readTextProviderForRow: (provider: string | null | undefined) =>
    provider === "sendblue" ? "sendblue" : "linq",
  sendTextMessage: (...args: unknown[]) => sendTextMessageMock(...args),
}));

vi.mock("@/lib/apartments/listing-card", () => ({
  parseListingCardSnapshot: (value: unknown) => value,
}));

vi.mock("@/lib/text-agent/listing-format", () => ({
  buildListingDetailWebUrl: (
    baseUrl: string | null | undefined,
    listingId: string | null | undefined,
  ) =>
    baseUrl && listingId ? `${baseUrl}/apartments?listing=${listingId}` : null,
  formatListingLikeFollowUpText: (
    snapshot: { address?: string } | null,
    detailUrl?: string | null,
  ) =>
    [`nice pick — saved ${snapshot?.address ?? "it"} to your shortlist.`, detailUrl]
      .filter(Boolean)
      .join("\n"),
}));

vi.mock("@/lib/text-agent/store-shared", () => ({
  getKinfolkBaseUrl: () => "https://kinfolk.test",
}));

const isPhoneOptedOutMock = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  async () => false,
);
vi.mock("@/lib/text-agent/phone-verification", () => ({
  isPhoneOptedOut: (...args: unknown[]) => isPhoneOptedOutMock(...args),
}));

type StubResult = { data?: unknown; error?: { code?: string } | null };

type StubCall = { args: unknown[]; method: string; table: string };

function createSupabaseStub(plan: Record<string, StubResult[]>) {
  const calls: StubCall[] = [];
  const client = {
    from(table: string) {
      const queue = plan[table] ?? [];
      const result = queue.length > 0 ? queue.shift()! : { data: null, error: null };
      const query: Record<string, unknown> = {};
      for (const method of [
        "delete",
        "eq",
        "in",
        "insert",
        "limit",
        "maybeSingle",
        "order",
        "select",
        "single",
        "update",
        "upsert",
      ]) {
        query[method] = (...args: unknown[]) => {
          calls.push({ args, method, table });
          return query;
        };
      }
      query.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: result.data ?? null,
          error: result.error ?? null,
        }).then(resolve, reject);
      return query;
    },
  };
  return { calls, client: client as never };
}

const chatId = "sendblue:+14155550147:+14155550111";

const recommendation = {
  card_snapshot: { address: "681 Florida St" },
  id: "rec-1",
  listing_id: "listing-1",
  outbound_message_id: "carousel-1",
  rank: 1,
  thread_id: "thread-1",
  user_id: "user-1",
};

const slimThread = {
  provider: "sendblue",
  provider_chat_id: chatId,
  to_phone_e164: "+14155550111",
};

const fullThread = {
  ...slimThread,
  id: "thread-1",
  phone_number_id: null,
};

function buildReaction(overrides: Partial<TextReactionEvent> = {}): TextReactionEvent {
  return {
    chatId,
    eventId: "evt-1",
    from: "+14155550111",
    messageId: "carousel-1",
    partIndex: null,
    provider: "sendblue",
    raw: {},
    reactionType: "like",
    removed: false,
    traceId: null,
    ...overrides,
  };
}

describe("processListingRecommendationReaction", () => {
  it("flips the recommendation and match rows on a like and sends the in-voice follow-up with a tappable link", async () => {
    sendTextMessageMock.mockReset();
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [
        { data: [recommendation] },
        { data: null },
      ],
      text_messages: [{ data: { id: "m1" } }, { data: null }],
      text_threads: [{ data: slimThread }, { data: fullThread }],
    });
    sendTextMessageMock.mockImplementation(async () => {
      calls.push({ args: [], method: "transport_send", table: "-" });
      return {
        chatId,
        deliveryStatus: "queued",
        messageId: "followup-1",
        service: "iMessage",
      };
    });

    const result = await processListingRecommendationReaction(
      client,
      buildReaction(),
    );

    expect(result).toEqual({ handled: true });

    const recommendationUpdate = calls.find(
      (call) =>
        call.table === "text_listing_recommendations" &&
        call.method === "update",
    );
    expect(recommendationUpdate?.args[0]).toMatchObject({
      feedback_value: 1,
      reaction_type: "like",
      status: "liked",
    });

    const matchUpdate = calls.find(
      (call) =>
        call.table === "apartment_listing_matches" && call.method === "update",
    );
    expect(matchUpdate?.args[0]).toEqual({ status: "saved" });

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    const followUpBody = (
      sendTextMessageMock.mock.calls[0][0] as {
        parts: Array<{ type: string; value: string }>;
      }
    ).parts[0].value;
    expect(followUpBody).toContain("681 Florida St");
    expect(followUpBody).toContain(
      "https://kinfolk.test/apartments?listing=listing-1",
    );

    const claim = calls.find(
      (call) => call.table === "text_messages" && call.method === "insert",
    );
    expect(claim?.args[0]).toMatchObject({
      delivery_status: "sending",
      outbound_idempotency_key: "kinfolk:reaction:evt-1:like-followup",
    });
    const sendAt = calls.findIndex((call) => call.method === "transport_send");
    expect(calls.indexOf(claim!)).toBeLessThan(sendAt);
  });

  it("stores the dislike signal the recommender excludes on without sending a follow-up", async () => {
    sendTextMessageMock.mockReset();
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [
        { data: [recommendation] },
        { data: null },
      ],
      text_threads: [{ data: slimThread }],
    });

    const result = await processListingRecommendationReaction(
      client,
      buildReaction({ reactionType: "dislike" }),
    );

    expect(result).toEqual({ handled: true });

    const recommendationUpdate = calls.find(
      (call) =>
        call.table === "text_listing_recommendations" &&
        call.method === "update",
    );
    expect(recommendationUpdate?.args[0]).toMatchObject({
      feedback_value: -1,
      reaction_type: "dislike",
      status: "passed",
    });

    const matchUpdate = calls.find(
      (call) =>
        call.table === "apartment_listing_matches" && call.method === "update",
    );
    expect(matchUpdate?.args[0]).toEqual({ status: "passed" });

    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("resolves a carousel tapback to the card at the tapped part index", async () => {
    sendTextMessageMock.mockReset();
    const second = {
      ...recommendation,
      card_snapshot: { address: "12 Oak St" },
      id: "rec-2",
      listing_id: "listing-2",
      rank: 2,
    };
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [
        { data: [recommendation, second] },
        { data: null },
      ],
      text_threads: [{ data: slimThread }],
    });

    const result = await processListingRecommendationReaction(
      client,
      buildReaction({ partIndex: 1, reactionType: "dislike" }),
    );

    expect(result).toEqual({ handled: true });
    const updateTarget = calls.find(
      (call) =>
        call.table === "text_listing_recommendations" &&
        call.method === "eq" &&
        call.args[0] === "id",
    );
    expect(updateTarget?.args[1]).toBe("rec-2");
  });

  it("does not treat a text-part reaction as feedback for the only stamped listing card", async () => {
    sendTextMessageMock.mockReset();
    const stampedCard = {
      ...recommendation,
      rank: 2,
    };
    const { calls, client } = createSupabaseStub({
      text_listing_recommendations: [{ data: [stampedCard] }],
    });

    const result = await processListingRecommendationReaction(
      client,
      buildReaction({ partIndex: 0, provider: "linq" }),
    );

    expect(result).toEqual({ handled: false });
    expect(
      calls.some(
        (call) =>
          call.table === "text_listing_recommendations" &&
          call.method === "update",
      ),
    ).toBe(false);
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("resolves a single-card reaction when the provider part index matches the stamped card rank", async () => {
    sendTextMessageMock.mockReset();
    const stampedCard = {
      ...recommendation,
      rank: 2,
    };
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [
        { data: [stampedCard] },
        { data: null },
      ],
      text_threads: [{ data: { ...slimThread, provider: "linq" } }],
    });

    const result = await processListingRecommendationReaction(
      client,
      buildReaction({ partIndex: 1, provider: "linq", reactionType: "dislike" }),
    );

    expect(result).toEqual({ handled: true });
    const updateTarget = calls.find(
      (call) =>
        call.table === "text_listing_recommendations" &&
        call.method === "eq" &&
        call.args[0] === "id",
    );
    expect(updateTarget?.args[1]).toBe("rec-1");
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("skips the like follow-up when the reacting phone has opted out", async () => {
    sendTextMessageMock.mockReset();
    isPhoneOptedOutMock.mockResolvedValueOnce(true);
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [{ data: [recommendation] }, { data: null }],
      text_threads: [{ data: slimThread }, { data: fullThread }],
    });

    const result = await processListingRecommendationReaction(
      client,
      buildReaction(),
    );

    // The reaction is still recorded (the like flips the recommendation/match),
    // but no outbound SMS is sent and no idempotency claim is inserted.
    expect(result).toEqual({ handled: true });
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(
      calls.some(
        (call) => call.table === "text_messages" && call.method === "insert",
      ),
    ).toBe(false);
  });

  it("ignores reactions that match no stamped outbound message", async () => {
    sendTextMessageMock.mockReset();
    const { client } = createSupabaseStub({
      text_listing_recommendations: [{ data: [] }],
    });

    const result = await processListingRecommendationReaction(
      client,
      buildReaction({ messageId: "unknown-handle" }),
    );

    expect(result).toEqual({ handled: false });
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("mirrors a heart into saved_places so SMS taste reaches the shared spine", async () => {
    sendTextMessageMock.mockReset();
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [
        { data: [recommendation] },
        { data: null },
      ],
      text_messages: [{ data: { id: "m1" } }, { data: null }],
      text_threads: [{ data: slimThread }, { data: fullThread }],
    });
    sendTextMessageMock.mockResolvedValue({
      chatId,
      deliveryStatus: "queued",
      messageId: "followup-1",
      service: "iMessage",
    });

    await processListingRecommendationReaction(client, buildReaction());

    const savedInsert = calls.find(
      (call) => call.table === "saved_places" && call.method === "insert",
    );
    expect(savedInsert?.args[0]).toMatchObject({
      kind: "listing",
      listing_id: "listing-1",
      user_id: "user-1",
    });
  });

  it("removes the saved place when the heart is removed", async () => {
    sendTextMessageMock.mockReset();
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [
        { data: [recommendation] },
        { data: null },
      ],
      text_threads: [{ data: slimThread }],
    });

    await processListingRecommendationReaction(
      client,
      buildReaction({ removed: true }),
    );

    const savedDelete = calls.find(
      (call) => call.table === "saved_places" && call.method === "delete",
    );
    expect(savedDelete).toBeDefined();
    const listingFilter = calls.find(
      (call) =>
        call.table === "saved_places" &&
        call.method === "eq" &&
        call.args[0] === "listing_id",
    );
    expect(listingFilter?.args[1]).toBe("listing-1");
    expect(
      calls.some(
        (call) => call.table === "saved_places" && call.method === "insert",
      ),
    ).toBe(false);
  });

  it("removes the saved place on a dislike", async () => {
    sendTextMessageMock.mockReset();
    const { calls, client } = createSupabaseStub({
      apartment_listing_matches: [{ data: null }],
      text_listing_recommendations: [
        { data: [recommendation] },
        { data: null },
      ],
      text_threads: [{ data: slimThread }],
    });

    await processListingRecommendationReaction(
      client,
      buildReaction({ reactionType: "dislike" }),
    );

    expect(
      calls.some(
        (call) => call.table === "saved_places" && call.method === "delete",
      ),
    ).toBe(true);
  });
});
