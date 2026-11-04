import { describe, expect, it, vi } from "vitest";
import { sendAndRecordReply } from "./reply-send";

vi.mock("server-only", () => ({}));

const sendTextTextMock = vi.fn();
const sendTextMessageMock = vi.fn();
vi.mock("@/lib/integrations/text-transport", () => ({
  getTextTransportFromNumber: () => "+14155550147",
  readTextProviderForRow: (provider: string | null | undefined) =>
    provider === "sendblue" ? "sendblue" : "linq",
  sendTextMessage: (...args: unknown[]) => sendTextMessageMock(...args),
  sendTextText: (...args: unknown[]) => sendTextTextMock(...args),
  startTextTyping: async () => {},
}));

vi.mock("@/lib/apartments/listing-card", () => ({
  parseListingCardSnapshot: (value: unknown) => value,
}));

const notifyFounderMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("@/lib/shared/alerts", () => ({
  notifyFounder: (...args: unknown[]) => notifyFounderMock(...args),
}));

vi.mock("@/lib/text-agent/store-shared", () => ({
  getKinfolkBaseUrl: () => "https://kinfolk.test",
  getKinfolkContactCardUrl: () => "",
  getReviewUrl: () => "",
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
        "lt",
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

const thread = { id: "thread-1", provider: "sendblue" } as never;

const baseArgs = {
  chatId: "sendblue:+14155550147:+14155550111",
  intent: "agent_reply",
  phoneNumberId: null,
  sourceMessageId: "msg-1",
  thread,
  to: "+14155550111",
  userId: "user-1",
};

function textSendResult(messageId: string) {
  return {
    chatId: "sendblue:+14155550147:+14155550111",
    deliveryStatus: "queued",
    messageId,
    service: "iMessage",
  };
}

describe("sendAndRecordReply", () => {
  it("splits a three-paragraph reply into at most three paced bubbles with distinct idempotency keys and no truncation tail", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const longMiddle = `The second spot deserves the full story. ${"It has a sunny kitchen and the rent splits well across three people, which keeps everyone comfortably under budget. ".repeat(9)}`.trim();
    const body = [
      "First up is the Mission spot — it fits the budget and the vibe you described.",
      longMiddle,
      "Third is the SoMa loft, a bit louder but the cheapest split of the three by a wide margin.",
    ].join("\n\n");
    const { calls, client } = createSupabaseStub({
      text_messages: [
        { data: { id: "m1" } },
        { data: null },
        { data: { id: "m2" } },
        { data: null },
        { data: { id: "m3" } },
        { data: null },
      ],
    });
    sendTextTextMock.mockImplementation(async () => textSendResult("handle"));

    await sendAndRecordReply(client, { ...baseArgs, body });

    expect(sendTextTextMock).toHaveBeenCalledTimes(3);
    const sentBodies = sendTextTextMock.mock.calls.map(
      (call) => (call[0] as { body: string }).body,
    );
    expect(sentBodies[0]).toContain("First up is the Mission spot");
    expect(sentBodies[1].length).toBeGreaterThan(900);
    expect(sentBodies[1]).not.toContain("…");
    expect(sentBodies[2]).toContain("SoMa loft");
    for (const sent of sentBodies) {
      expect(sent).not.toContain("Reply HELP");
    }

    const keys = sendTextTextMock.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual([
      "kinfolk:msg-1:agent_reply",
      "kinfolk:msg-1:agent_reply:part2",
      "kinfolk:msg-1:agent_reply:part3",
    ]);
    expect(new Set(keys).size).toBe(3);

    const claimKeys = calls
      .filter((call) => call.table === "text_messages" && call.method === "insert")
      .map(
        (call) =>
          (call.args[0] as { outbound_idempotency_key: string })
            .outbound_idempotency_key,
      );
    expect(claimKeys).toEqual(keys);
  }, 10_000);

  it("releases the claim and alerts the founder when the transport call fails", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    notifyFounderMock.mockClear();
    const { calls, client } = createSupabaseStub({
      text_messages: [{ data: { id: "m1" } }, { data: null }],
    });
    sendTextTextMock.mockRejectedValue(new Error("Sendblue 503"));

    await expect(
      sendAndRecordReply(client, {
        ...baseArgs,
        body: "Quick single bubble answer that never makes it out.",
      }),
    ).rejects.toThrow("Sendblue 503");

    const released = calls.filter(
      (call) => call.table === "text_messages" && call.method === "delete",
    );
    expect(released).toHaveLength(1);
    expect(notifyFounderMock).toHaveBeenCalledTimes(1);
    expect(notifyFounderMock).toHaveBeenCalledWith("text_reply_send_failed", {
      detail: "Sendblue 503",
      threadId: "thread-1",
    });
  });

  it("claims the outbound row before the transport call and defers to a retry when it loses the unique-insert race", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const { client } = createSupabaseStub({
      text_messages: [{ error: { code: "23505" } }],
    });

    // Losing the claim race must NOT read as delivery: if the claim holder
    // dies before sending, a completed run would never retry. The throw keeps
    // the run on the retry path.
    await expect(
      sendAndRecordReply(client, {
        ...baseArgs,
        body: "Quick single bubble answer that someone else is already sending.",
      }),
    ).rejects.toThrow(/freshly claimed by another worker/);

    expect(sendTextTextMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("skips a part a prior attempt already delivered and keeps sending the rest of the sequence", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const { client } = createSupabaseStub({
      text_messages: [
        { error: { code: "23505" } },
        {
          data: {
            delivery_status: "queued",
            id: "m1",
            received_at: new Date().toISOString(),
          },
        },
        { data: { id: "m2" } },
        { data: null },
      ],
    });
    sendTextTextMock.mockResolvedValue(textSendResult("provider-2"));

    await sendAndRecordReply(client, {
      ...baseArgs,
      body: "First bubble that a crashed prior attempt already delivered to the user.\n\nSecond bubble that still needs to go out so the reply is not truncated.",
    });

    expect(sendTextTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextTextMock.mock.calls[0][0]).toMatchObject({
      body: "Second bubble that still needs to go out so the reply is not truncated.",
      idempotencyKey: "kinfolk:msg-1:agent_reply:part2",
    });
  });

  it("defers to a retry when a fresh concurrent claim owns the reply", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const { client } = createSupabaseStub({
      text_messages: [
        { error: { code: "23505" } },
        {
          data: {
            delivery_status: "sending",
            id: "m1",
            received_at: new Date().toISOString(),
          },
        },
      ],
    });

    await expect(
      sendAndRecordReply(client, {
        ...baseArgs,
        body: "Single bubble another worker is actively sending right now.",
      }),
    ).rejects.toThrow(/freshly claimed by another worker/);

    expect(sendTextTextMock).not.toHaveBeenCalled();
  });

  it("takes over a stale orphaned sending claim and delivers through it", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const { calls, client } = createSupabaseStub({
      text_messages: [
        { error: { code: "23505" } },
        {
          data: {
            delivery_status: "sending",
            id: "m-stale",
            received_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
        },
        { data: { id: "m-stale" } },
        { data: null },
      ],
    });
    sendTextTextMock.mockResolvedValue(textSendResult("provider-1"));

    await sendAndRecordReply(client, {
      ...baseArgs,
      body: "Single bubble whose first attempt crashed after claiming.",
    });

    expect(sendTextTextMock).toHaveBeenCalledTimes(1);
    const takeoverUpdate = calls.find(
      (call) =>
        call.table === "text_messages" &&
        call.method === "update" &&
        (call.args[0] as { body?: string }).body ===
          "Single bubble whose first attempt crashed after claiming.",
    );
    expect(takeoverUpdate?.args[0]).toMatchObject({
      body: "Single bubble whose first attempt crashed after claiming.",
      delivery_status: "sending",
      outbound_idempotency_key: "kinfolk:msg-1:agent_reply",
      provider_chat_id: baseArgs.chatId,
      to_phone_e164: baseArgs.to,
    });
    expect(
      calls.some(
        (call) =>
          call.table === "text_messages" &&
          call.method === "eq" &&
          call.args[0] === "delivery_status" &&
          call.args[1] === "sending",
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.table === "text_messages" &&
          call.method === "lt" &&
          call.args[0] === "received_at",
      ),
    ).toBe(true);
  });

  it("stamps outbound message ids onto recommendation rows without injecting listing links into prose", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const cardUrlOne =
      "https://kinfolk.test/api/listing-card/rec-1?expires=1&token=t1";
    const cardUrlTwo =
      "https://kinfolk.test/api/listing-card/rec-2?expires=1&token=t2";
    const { calls, client } = createSupabaseStub({
      text_listing_recommendations: [
        {
          data: [
            {
              card_snapshot: { address: "681 Florida St" },
              id: "rec-1",
              listing_id: "listing-1",
            },
            {
              card_snapshot: { address: "12 Oak St" },
              id: "rec-2",
              listing_id: "listing-2",
            },
          ],
        },
        { data: null },
        { data: null },
      ],
      text_messages: [{ data: { id: "m1" } }, { data: null }],
    });
    sendTextMessageMock.mockImplementation(async () => ({
      ...textSendResult("text-handle"),
      partRefs: [
        {
          mediaUrl: cardUrlOne,
          messageId: "carousel-1",
          partIndex: 0,
          service: "iMessage",
        },
        {
          mediaUrl: cardUrlTwo,
          messageId: "carousel-1",
          partIndex: 1,
          service: "iMessage",
        },
      ],
    }));

    await sendAndRecordReply(client, {
      ...baseArgs,
      body: "681 Florida St is the closest at $2,950 each, with 12 Oak St right behind it.\n\nwant a tour?",
      mediaUrls: [cardUrlOne, cardUrlTwo],
    });

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    const sentParts = (
      sendTextMessageMock.mock.calls[0][0] as {
        parts: Array<{ type: string; url?: string; value?: string }>;
      }
    ).parts;
    expect(sentParts[0].type).toBe("text");
    expect(sentParts[0].value).toBe(
      "681 Florida St is the closest at $2,950 each, with 12 Oak St right behind it.\n\nwant a tour?",
    );
    expect(sentParts[0].value).not.toContain("https://");
    expect(sentParts[0].value).not.toContain("more on");
    expect(sentParts.slice(1)).toEqual([
      { type: "media", url: cardUrlOne },
      { type: "media", url: cardUrlTwo },
    ]);

    const stampUpdates = calls.filter(
      (call) =>
        call.table === "text_listing_recommendations" &&
        call.method === "update",
    );
    expect(stampUpdates).toHaveLength(2);
    expect(stampUpdates[0].args[0]).toMatchObject({
      outbound_message_id: "carousel-1",
      rank: 1,
    });
    expect(stampUpdates[1].args[0]).toMatchObject({
      outbound_message_id: "carousel-1",
      rank: 2,
    });
    const stampTargets = calls
      .filter(
        (call) =>
          call.table === "text_listing_recommendations" &&
          call.method === "eq" &&
          call.args[0] === "id",
      )
      .map((call) => call.args[1]);
    expect(stampTargets).toEqual(["rec-1", "rec-2"]);
  });

  it("decodes listing-card path ids before stamping recommendation rows", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const recommendationId = "rec/one?two";
    const cardUrl =
      "https://kinfolk.test/api/listing-card/rec%2Fone%3Ftwo?expires=1&token=t1";
    const { calls, client } = createSupabaseStub({
      text_listing_recommendations: [
        {
          data: [
            {
              card_snapshot: { address: "681 Florida St" },
              id: recommendationId,
              listing_id: "listing-1",
            },
          ],
        },
        { data: null },
      ],
      text_messages: [{ data: { id: "m1" } }, { data: null }],
    });
    sendTextMessageMock.mockResolvedValue({
      ...textSendResult("provider-1"),
      partRefs: [
        {
          mediaUrl: cardUrl,
          messageId: "provider-1",
          partIndex: 0,
          service: "iMessage",
        },
      ],
    });

    await sendAndRecordReply(client, {
      ...baseArgs,
      body: "681 Florida St is still my favorite.",
      mediaUrls: [cardUrl],
    });

    expect(
      calls.find(
        (call) =>
          call.table === "text_listing_recommendations" &&
          call.method === "in" &&
          call.args[0] === "id",
      )?.args[1],
    ).toEqual([recommendationId]);
    const stampTargets = calls
      .filter(
        (call) =>
          call.table === "text_listing_recommendations" &&
          call.method === "eq" &&
          call.args[0] === "id",
      )
      .map((call) => call.args[1]);
    expect(stampTargets).toEqual([recommendationId]);
    expect(sendTextMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: "text", value: "681 Florida St is still my favorite." },
          { type: "media", url: cardUrl },
        ],
      }),
    );
  });

  it("trims blank media URLs before applying the text reply card limit", async () => {
    sendTextTextMock.mockReset();
    sendTextMessageMock.mockReset();
    const cardUrls = Array.from(
      { length: 6 },
      (_, index) =>
        `https://kinfolk.test/api/listing-card/rec-${index + 1}?expires=1&token=t${index + 1}`,
    );
    const { calls, client } = createSupabaseStub({
      text_listing_recommendations: [
        {
          data: cardUrls.slice(0, 5).map((mediaUrl, index) => ({
            card_snapshot: { address: `${index + 1} Main St` },
            id: `rec-${index + 1}`,
            listing_id: `listing-${index + 1}`,
            mediaUrl,
          })),
        },
      ],
      text_messages: [{ data: { id: "m1" } }, { data: null }],
    });
    sendTextMessageMock.mockResolvedValue({
      ...textSendResult("provider-1"),
      partRefs: cardUrls.slice(0, 5).map((mediaUrl, index) => ({
        mediaUrl,
        messageId: "provider-1",
        partIndex: index,
        service: "iMessage",
      })),
    });

    await sendAndRecordReply(client, {
      ...baseArgs,
      body: "Here are five good cards; one blank slot should not crowd out the fifth.",
      mediaUrls: [
        cardUrls[0],
        "   ",
        cardUrls[1],
        cardUrls[2],
        "\n",
        cardUrls[3],
        cardUrls[4],
        cardUrls[5],
      ],
    });

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    const sentParts = (
      sendTextMessageMock.mock.calls[0][0] as {
        parts: Array<{ type: string; url?: string; value?: string }>;
      }
    ).parts;
    const sentMediaUrls = sentParts.flatMap((part) =>
      part.type === "media" && part.url ? [part.url] : [],
    );
    expect(sentMediaUrls).toEqual(cardUrls.slice(0, 5));
    expect(sentMediaUrls).not.toContain(cardUrls[5]);

    const rawPayloadInsert = calls.find(
      (call) => call.table === "text_messages" && call.method === "insert",
    );
    expect(rawPayloadInsert?.args[0]).toMatchObject({
      raw_payload: {
        media_urls: cardUrls.slice(0, 5),
        original_media_url_count: 8,
      },
    });
    const stampTargets = calls
      .filter(
        (call) =>
          call.table === "text_listing_recommendations" &&
          call.method === "eq" &&
          call.args[0] === "id",
      )
      .map((call) => call.args[1]);
    expect(stampTargets).toEqual(["rec-1", "rec-2", "rec-3", "rec-4", "rec-5"]);
  });
});
