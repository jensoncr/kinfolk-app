import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHousingAgentToolDefinitions,
  runHousingAgentTool,
} from "./tool-belt";
import {
  inferListingSearchCriteriaFromBody,
  readListingSearchCriteriaFromArgs,
  searchListingsTool,
} from "./tool-belt/search-listings";
import {
  fallbackBudgetQueryMax,
  fallbackPerPersonRentForListing,
} from "../apartments/listing-fallback-rent";
import { listingFeatureSourceVersionForTests } from "../apartments/listing-feature-assessments";

vi.mock("server-only", () => ({}));

// The search tool loads scored cards through this module; mock it so we can
// drive the "carried-over saved constraint zeroed the area" path deterministically.
// searchCompatibleListingCards wraps the same mock so per-test card setups
// drive both entry points; tests that need geocode failures can override
// searchCompatibleListingCardsMock directly.
const loadCompatibleListingCardsMock = vi.fn();
const searchCompatibleListingCardsMock = vi.fn(
  async (...args: unknown[]) => ({
    cards: await loadCompatibleListingCardsMock(...args),
    geocodeFailedPlaces: [] as string[],
  }),
);
vi.mock("./listing-recommendations", () => ({
  formatGeocodeFailureGuidance: ({
    cardCount,
    geocodeFailedPlaces,
  }: {
    cardCount: number;
    geocodeFailedPlaces: string[];
  }) =>
    geocodeFailedPlaces.length === 0
      ? null
      : `Could not pin "${geocodeFailedPlaces.join(", ")}" on the map${cardCount > 0 ? "; these are area matches" : ""}.`,
  loadCompatibleListingCards: (...args: unknown[]) =>
    loadCompatibleListingCardsMock(...args),
  mergeListingRecommendationCards: (
    primary: Array<{ id: string }>,
    secondary: Array<{ id: string }>,
    limit: number,
  ) => {
    const byId = new Map<string, { id: string }>();
    for (const card of [...primary, ...secondary]) {
      if (!byId.has(card.id)) byId.set(card.id, card);
    }
    return [...byId.values()].slice(0, limit);
  },
  searchCompatibleListingCards: (...args: unknown[]) =>
    searchCompatibleListingCardsMock(...args),
}));
const persistListingRecommendationCardsMock = vi.fn<
  (...args: unknown[]) => Promise<unknown[]>
>(async () => []);
vi.mock("./listing-delivery", () => ({
  persistListingRecommendationCards: (...args: unknown[]) =>
    persistListingRecommendationCardsMock(...args),
}));
// update_prefs awaits this on its live write path; mocking it lets us drive
// the applied/skipped-sensitive/failed splits deterministically.
const persistTextProfileFactsNowMock = vi.fn();
vi.mock("./profile-persistence", () => ({
  persistIncrementalTextProfileFactsNow: (...args: unknown[]) =>
    persistTextProfileFactsNowMock(...args),
}));
// store-shared pulls in "@/..." imports that vitest can't resolve; the search
// tool only needs the public media base (empty here skips card persistence).
const getKinfolkPublicMediaBaseUrlMock = vi.fn(() => "");
vi.mock("./store-shared", () => ({
  getKinfolkPublicMediaBaseUrl: () => getKinfolkPublicMediaBaseUrlMock(),
}));

const chatStoreMocks = vi.hoisted(() => ({
  getChatRoomForUser: vi.fn(),
  getChatRoomsForUser: vi.fn(),
  sendChatMessageForUser: vi.fn(),
}));
vi.mock("../chat/store", () => chatStoreMocks);

beforeEach(() => {
  chatStoreMocks.getChatRoomForUser.mockReset();
  chatStoreMocks.getChatRoomsForUser.mockReset();
  chatStoreMocks.sendChatMessageForUser.mockReset();
  loadCompatibleListingCardsMock.mockReset();
  persistListingRecommendationCardsMock.mockClear();
  persistTextProfileFactsNowMock.mockReset();
  getKinfolkPublicMediaBaseUrlMock.mockReturnValue("");
});

// Minimal chainable Supabase stub: every query resolves to { data: null }.
function makeSupabaseStub() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = undefined;
  return { from: () => chain } as never;
}

// Table-aware stub: awaited queries resolve to the configured rows for the
// table, single-row reads return the first row (or null).
function makeSupabaseStubWithTables(rowsByTable: Record<string, unknown[]>) {
  return {
    from: (table: string) => {
      const rows = rowsByTable[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "limit"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return chain;
    },
  } as never;
}

function fakeListingCard(overrides: Record<string, unknown> = {}) {
  return {
    address: "2525 Larkin St",
    bathrooms: 1,
    bedrooms: 1,
    description: "A Russian Hill one-bedroom.",
    effectivePerPersonRent: null,
    effectiveRent: 4495,
    evidence: ["Active Russian Hill listing."],
    fitScore: 70,
    id: "listing-1",
    imageUrl: null,
    monthlyRent: 4495,
    neighborhood: "Russian Hill",
    perPersonRent: null,
    recommendedHouseholdSize: null,
    sourceUrl: null,
    ...overrides,
  };
}

describe("text agent tool belt", () => {
  it("exposes a small readable tool set for the housing agent loop", () => {
    expect(
      getHousingAgentToolDefinitions().map((tool) => tool.function.name),
    ).toEqual([
      "update_prefs",
      "search_listings",
      "get_listing_details",
      "get_matches",
      "get_area_signals",
      "get_profile_summary",
      "list_chats",
      "read_chat",
      "send_chat_message",
      "message_roommate_match",
      "manage_group",
      "set_notification_prefs",
      "opt_out",
    ]);
  });

  it("lists Kinfolk product chats visible to the text-agent user", async () => {
    chatStoreMocks.getChatRoomsForUser.mockResolvedValue({
      rooms: [
        {
          context: { listingLine: null, matchScore: 91, priceLine: null },
          id: "room-1",
          lastActivityAt: "2026-06-23T18:00:00Z",
          lastMessagePreview: "Saturday works.",
          lastMessageSentVia: "manual",
          participants: [{ name: "Priya Shah" }],
          roomType: "match_dm",
          status: "active",
          textNotificationsEnabled: false,
          title: "Priya Shah",
          unreadCount: 1,
        },
      ],
      status: "connected",
    });

    const result = await runHousingAgentTool(
      {
        supabase: { from: vi.fn() } as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "list_chats",
      { limit: 5 },
    );

    expect(result.ok).toBe(true);
    expect(chatStoreMocks.getChatRoomsForUser).toHaveBeenCalledWith(
      { from: expect.any(Function) },
      "user-1",
    );
    expect(result.data.rooms).toEqual([
      expect.objectContaining({
        id: "room-1",
        participantNames: ["Priya Shah"],
        unreadCount: 1,
      }),
    ]);
  });

  it("reads recent messages from one Kinfolk product chat", async () => {
    chatStoreMocks.getChatRoomForUser.mockResolvedValue({
      canSend: true,
      context: { listingLine: null, matchScore: 91, priceLine: null },
      id: "room-1",
      messages: [
        {
          body: "Could do Saturday.",
          createdAt: "2026-06-23T18:00:00Z",
          isMine: false,
          senderName: "Priya Shah",
          sentVia: "manual",
        },
      ],
      participants: [{ name: "Priya Shah" }],
      roomType: "match_dm",
      status: "active",
      textNotificationsEnabled: false,
      title: "Priya Shah",
    });

    const result = await runHousingAgentTool(
      {
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "read_chat",
      { limit: 10, roomId: "room-1" },
    );

    expect(result.ok).toBe(true);
    expect(chatStoreMocks.getChatRoomForUser).toHaveBeenCalledWith(
      {},
      "room-1",
      "user-1",
    );
    expect(result.data.room).toMatchObject({
      messages: [
        {
          body: "Could do Saturday.",
          senderName: "Priya Shah",
          sentVia: "manual",
        },
      ],
      title: "Priya Shah",
    });
  });

  it("sends into product chat with Kinfolk-agent provenance when writes are enabled", async () => {
    chatStoreMocks.sendChatMessageForUser.mockResolvedValue({
      body: "Saturday at 2 works for me.",
      createdAt: "2026-06-23T18:05:00Z",
      id: "chat-msg-1",
      sentVia: "kinfolk_agent",
    });

    const result = await runHousingAgentTool(
      {
        allowWrites: true,
        message: { id: "text-msg-1" } as never,
        runId: "run-1",
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "send_chat_message",
      { body: "Saturday at 2 works for me.", roomId: "room-1" },
    );

    expect(result.ok).toBe(true);
    expect(chatStoreMocks.sendChatMessageForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      "room-1",
      "Saturday at 2 works for me.",
      {
        agentRunId: "run-1",
        sentVia: "kinfolk_agent",
        sourceTextMessageId: "text-msg-1",
      },
    );
    expect(result.summary).toContain("sent via Kinfolk marker");
    expect(result.data.message).toMatchObject({ id: "chat-msg-1", sentVia: "kinfolk_agent" });
  });

  it("keeps preference updates preview-only unless writes are explicitly allowed", async () => {
    const result = await runHousingAgentTool(
      {
        allowWrites: false,
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "update_prefs",
      {
        facts: [
          {
            evidence: "$1500 in Mission",
            fact_key: "budget_max",
            value: 1500,
          },
          {
            evidence: "ignore this",
            fact_key: "unknown",
            value: "nope",
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      persisted: [],
      previewOnly: true,
      skippedCount: 1,
    });
    expect(result.data.deferredForApproval).toEqual([
      expect.objectContaining({
        fact_key: "budget_max",
        value: 1500,
      }),
    ]);
  });

  it("awaits the live write and reports the honest applied/skipped-sensitive split", async () => {
    persistTextProfileFactsNowMock.mockImplementation(
      async (_supabase, args: { facts: Array<{ sensitivity_level: string }> }) => ({
        failedFacts: [],
        failureMessage: null,
        persistedFacts: args.facts.filter(
          (fact) => fact.sensitivity_level === "standard",
        ),
        skippedSensitiveFacts: args.facts.filter(
          (fact) => fact.sensitivity_level !== "standard",
        ),
      }),
    );

    const result = await runHousingAgentTool(
      {
        allowWrites: true,
        body: "Budget is $1500, and please keep the sobriety thing private",
        message: { id: "message-1" } as never,
        supabase: {} as never,
        thread: { id: "thread-1" } as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "update_prefs",
      {
        facts: [
          {
            evidence: "$1500 max",
            fact_key: "budget_max",
            value: 1500,
          },
          {
            evidence: "sober household",
            fact_key: "dealbreakers",
            sensitivity_level: "sensitive",
            value: ["alcohol at home"],
          },
        ],
      },
    );

    expect(persistTextProfileFactsNowMock).toHaveBeenCalledTimes(1);
    expect(persistTextProfileFactsNowMock.mock.calls[0][1].facts).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      failed: [],
      persisted: [{ fact_key: "budget_max", value: 1500 }],
      previewOnly: false,
      skippedSensitive: [
        expect.objectContaining({ fact_key: "dealbreakers" }),
      ],
    });
    expect(result.summary).toContain("Saved 1 preference");
    expect(result.summary).toContain("off their matching profile");
    expect(result.summary).toContain("do not claim it was saved");
  });

  it("surfaces live write failures instead of pretending the save happened", async () => {
    persistTextProfileFactsNowMock.mockResolvedValue({
      failedFacts: [{ fact_key: "budget_max", value: 1500 }],
      failureMessage: "Error: text_messages update failed",
      persistedFacts: [],
      skippedSensitiveFacts: [],
    });

    const result = await runHousingAgentTool(
      {
        allowWrites: true,
        body: "Budget is $1500",
        message: { id: "message-1" } as never,
        supabase: {} as never,
        thread: { id: "thread-1" } as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "update_prefs",
      {
        facts: [
          {
            evidence: "$1500 max",
            fact_key: "budget_max",
            value: 1500,
          },
        ],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      failed: [{ fact_key: "budget_max", value: 1500 }],
      failureReason: "Error: text_messages update failed",
      persisted: [],
      skippedSensitive: [],
    });
    expect(result.summary).not.toContain("Saved");
    expect(result.summary).toContain("did not go through");
  });

  it("keeps group-management requests web-only and clamps unsupported actions", async () => {
    const result = await runHousingAgentTool(
      {
        allowWrites: true,
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "manage_group",
      {
        action: "delete_everything",
        groupId: " group-1 ",
        targetUserId: " user-2 ",
      },
    );

    expect(result).toMatchObject({
      data: {
        action: "start",
        groupId: "group-1",
        previewRequired: true,
        targetUserId: "user-2",
      },
      ok: true,
      toolName: "manage_group",
    });
    expect(result.summary).toContain("not over text");
    expect(result.summary).toContain("never claim the change happened");
  });

  it("normalizes common model aliases before staging preference updates", async () => {
    const result = await runHousingAgentTool(
      {
        allowWrites: false,
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "update_prefs",
      {
        facts: [
          {
            evidence: "$1500 max",
            fact_key: "budget_max_per_person",
            value: "1500",
          },
          {
            evidence: "Mission, Hayes Valley",
            fact_key: "neighborhoods",
            value: "Mission, Hayes Valley",
          },
          {
            evidence: "move-in August 2026",
            fact_key: "move_in_date",
            value: "2026-08-01",
          },
          {
            evidence: "open to one roommate",
            fact_key: "roommate_count_preference",
            value: "1",
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      previewOnly: true,
      skippedCount: 0,
    });
    expect(result.data.deferredForApproval).toEqual([
      expect.objectContaining({ fact_key: "budget_max", value: 1500 }),
      expect.objectContaining({
        fact_key: "neighborhoods",
        value: ["Mission", "Hayes Valley"],
      }),
      expect.objectContaining({
        fact_key: "move_in_window",
        value: { end: "2026-08-01", start: "2026-08-01" },
      }),
      expect.objectContaining({
        fact_key: "household_size",
        value: { max: 2, min: 1 },
      }),
    ]);
  });

  it("recovers obvious month ranges from move-in evidence", async () => {
    const result = await runHousingAgentTool(
      {
        allowWrites: false,
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "update_prefs",
      {
        facts: [
          {
            evidence: "User said move-in is flexible from late July through September.",
            fact_key: "move_in_window",
            value: { end: "2026-07-20", start: "2026-07-20" },
          },
        ],
      },
    );

    expect(result.data.deferredForApproval).toEqual([
      expect.objectContaining({
        fact_key: "move_in_window",
        value: { end: "2026-09-30", start: "2026-07-20" },
      }),
    ]);
  });

  it("recovers month-day move-in answers with a flexible window from evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    try {
      const result = await runHousingAgentTool(
        {
          allowWrites: false,
          supabase: {} as never,
          threadId: "thread-1",
          userId: "user-1",
        },
        "update_prefs",
        {
          facts: [
            {
              evidence:
                "user said move-in date is September 1, but flexible a couple weeks either way",
              fact_key: "move_in_window",
              value: { end: "2026-08-15", start: "2026-08-15" },
            },
          ],
        },
      );

      expect(result.data.deferredForApproval).toEqual([
        expect.objectContaining({
          fact_key: "move_in_window",
          value: { end: "2026-09-15", start: "2026-08-18" },
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("converts explicit roommate-count ranges into total household size", async () => {
    const result = await runHousingAgentTool(
      {
        allowWrites: false,
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      "update_prefs",
      {
        facts: [
          {
            evidence: "User wants 2-3 roommates but not a huge house.",
            fact_key: "household_size",
            value: { max: 3, min: 3 },
          },
        ],
      },
    );

    expect(result.data.deferredForApproval).toEqual([
      expect.objectContaining({
        fact_key: "household_size",
        value: { max: 4, min: 3 },
      }),
    ]);
  });

  it("infers obvious listing criteria when the model omits tool args", () => {
    expect(
      inferListingSearchCriteriaFromBody(
        "Show me three studios under $3500 in the Mission near Caltrain.",
      ),
    ).toMatchObject({
      bedroomsMax: 0,
      bedroomsMin: 0,
      budgetMax: 3500,
      transitTargets: ["Caltrain"],
    });

    expect(
      inferListingSearchCriteriaFromBody(
        "Find me a luxury doorman highrise under $2500.",
      ),
    ).toMatchObject({
      budgetMax: 2500,
      desiredTerms: ["doorman", "high-rise", "luxury"],
    });

    expect(
      inferListingSearchCriteriaFromBody(
        "Find me apartments in pac heights with room for an office",
      ),
    ).toMatchObject({
      desiredTerms: ["work-from-home friendly"],
      neighborhoods: ["Pacific Heights"],
    });

    expect(readListingSearchCriteriaFromArgs("Yes recommend me one", {})).toMatchObject({
      limit: 1,
    });

    expect(
      readListingSearchCriteriaFromArgs(
        "Find 2 bedrooms where my share is under $2500.",
        {},
      ),
    ).toMatchObject({
      bedroomsMax: 2,
      bedroomsMin: 2,
      budgetMax: 2500,
      limit: 5,
    });

    expect(
      inferListingSearchCriteriaFromBody(
        "Cutover smoke test: my budget is $2,400 each, I want Dogpatch or Mission Bay, and I'm open to 1 roommate.",
      ),
    ).toMatchObject({
      budgetMax: 2400,
      neighborhoods: ["Mission Bay", "Dogpatch"],
    });

    expect(
      readListingSearchCriteriaFromArgs(
        "Around $2,800 per month, stretch to $3,200 for the right fit.",
        { budgetMax: 3200 },
      ),
    ).toMatchObject({
      budgetMax: 3200,
      budgetPreferredMax: 2800,
    });

    expect(
      readListingSearchCriteriaFromArgs(
        "Trying to stay under $2,800 but could flex up to $3,200.",
        { budgetMax: 2800 },
      ),
    ).toMatchObject({
      budgetMax: 3200,
      budgetPreferredMax: 2800,
    });
  });

  it("lets model args win over the body re-parse and flags the divergence", () => {
    const diverging = readListingSearchCriteriaFromArgs(
      "My budget is $2,400 each, I want Dogpatch or Mission Bay.",
      {
        budgetMax: 3400,
        neighborhoods: ["Pacific Heights"],
      },
    );
    expect(diverging).toMatchObject({
      budgetMax: 3400,
      neighborhoods: ["Pacific Heights"],
    });
    expect(diverging.validationSignals.join(" ")).toContain("$2,400");
    expect(diverging.validationSignals.join(" ")).toContain("Pacific Heights");

    expect(
      readListingSearchCriteriaFromArgs(
        "My budget is $2,400 each, I want Dogpatch or Mission Bay.",
        {},
      ),
    ).toMatchObject({
      budgetMax: 2400,
      neighborhoods: ["Mission Bay", "Dogpatch"],
      validationSignals: [],
    });
  });

  it("treats 'I pay $3,800 now' as current rent, never a budget cap", () => {
    expect(
      readListingSearchCriteriaFromArgs(
        "I pay $3,800 now, find me something cheaper",
        { budgetMax: 3000 },
      ),
    ).toMatchObject({
      budgetMax: 3000,
      currentRent: 3800,
    });

    const withoutArgs = readListingSearchCriteriaFromArgs(
      "I pay $3,800 now, find me something cheaper",
      {},
    );
    expect(withoutArgs.budgetMax).toBeNull();
    expect(withoutArgs.currentRent).toBe(3800);
    expect(withoutArgs.validationSignals.join(" ")).toContain("current rent");
  });

  it("treats additive neighborhood preference updates as saved-neighborhood searches", () => {
    expect(
      readListingSearchCriteriaFromArgs(
        "Add north beach to my neighborhoods",
        {
          neighborhoods: ["North Beach"],
        },
      ),
    ).toMatchObject({
      mergeSavedNeighborhoods: true,
      neighborhoods: ["North Beach"],
    });

    expect(
      readListingSearchCriteriaFromArgs("What is available in North Beach?", {}),
    ).toMatchObject({
      mergeSavedNeighborhoods: false,
      neighborhoods: ["North Beach"],
    });
  });

  it("understands Pacific Heights shorthand in live listing requests", () => {
    expect(
      inferListingSearchCriteriaFromBody(
        "Can you show me some spots in pac heights? Im willing to increase my budget",
      ),
    ).toMatchObject({
      budgetMax: null,
      ignoreBudget: true,
      neighborhoods: ["Pacific Heights"],
    });
  });

  it("keeps model bedroom and area args ahead of the body re-parse, with signals", () => {
    const criteria = readListingSearchCriteriaFromArgs(
      "No let's do pac heights, just show me the cheapest one bedrooms. Show me 5 of them",
      {
        bedroomsMax: 2,
        bedroomsMin: 2,
        neighborhoods: ["Mission Bay"],
      },
    );
    expect(criteria).toMatchObject({
      bedroomsMax: 2,
      bedroomsMin: 2,
      neighborhoods: ["Mission Bay"],
      sortMode: "rent_asc",
    });
    expect(criteria.validationSignals.join(" ")).toContain("bedroom count");
    expect(criteria.validationSignals.join(" ")).toContain("Pacific Heights");
  });

  it("represents negative and named-place proximity as generic constraints", () => {
    expect(
      readListingSearchCriteriaFromArgs(
        "Show me a North Beach apartment that is not near Caltrain.",
        { transitTargets: ["Caltrain"] },
      ),
    ).toMatchObject({
      neighborhoods: ["North Beach"],
      proximityConstraints: [
        expect.objectContaining({
          hardness: "dealbreaker",
          polarity: "avoid",
          target: { name: "Caltrain", type: "transit" },
        }),
      ],
      transitTargets: [],
    });

    expect(
      readListingSearchCriteriaFromArgs(
        "Show me apartments near Compton's Coffee in North Beach.",
        { transitTargets: ["Caltrain"] },
      ),
    ).toMatchObject({
      neighborhoods: ["North Beach"],
      proximityConstraints: [
        expect.objectContaining({
          hardness: "preference",
          polarity: "prefer",
          target: {
            area: "North Beach",
            name: "Compton's Coffee",
            type: "place",
          },
        }),
      ],
      transitTargets: [],
    });
  });

  it("does not hang on an adversarial proximity body (ReDoS guard)", () => {
    // "near "×k followed by a recognized neighborhood word is the O(n^2)
    // backtracking trigger for the proximity-inference regex. With the body cap
    // in place this resolves in well under a budget that a quadratic blowup on
    // a ~120KB body would never meet.
    const adversarialBody = `${"near ".repeat(24_000)}mission`;
    const start = performance.now();
    const criteria = readListingSearchCriteriaFromArgs(adversarialBody, {});
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(250);
    expect(Array.isArray(criteria.proximityConstraints)).toBe(true);
  });

  it("clears budget and bedroom filters when the latest text relaxes them", () => {
    expect(
      readListingSearchCriteriaFromArgs(
        "Ignore the budget just show me the cheapest available",
        {
          budgetMax: 3500,
          neighborhoods: ["Pacific Heights"],
        },
      ),
    ).toMatchObject({
      budgetMax: null,
      ignoreBudget: true,
      neighborhoods: ["Pacific Heights"],
    });

    expect(
      readListingSearchCriteriaFromArgs(
        "What about all unit types, what is available in pac heights? I feel like that is not true on the 1bd",
        {
          bedroomsMax: 1,
          bedroomsMin: 1,
          budgetMax: 3500,
        },
      ),
    ).toMatchObject({
      bedroomsMax: null,
      bedroomsMin: null,
      ignoreBedrooms: true,
      neighborhoods: ["Pacific Heights"],
    });

    expect(
      readListingSearchCriteriaFromArgs("I don't need a 2bd", {
        bedroomsMax: 2,
        bedroomsMin: 2,
      }),
    ).toMatchObject({
      bedroomsMax: null,
      bedroomsMin: null,
      ignoreBedrooms: true,
    });
  });

  it("applies fallback listing budgets to the effective per-person split", () => {
    const householdPreference = {
      householdSizeMax: 2,
      householdSizeMin: 2,
    };

    expect(fallbackBudgetQueryMax(3000, householdPreference)).toBe(6000);
    expect(
      fallbackPerPersonRentForListing(
        {
          bedrooms: 2,
          effective_monthly_rent: 5850,
          monthly_rent: 5850,
        },
        householdPreference,
      ),
    ).toEqual({ householdSize: 2, rent: 2925 });
    // A 1-bed can only be occupied by one person, so there is no split — it
    // shows full rent (never nulls out just because the group's min is higher).
    expect(
      fallbackPerPersonRentForListing(
        {
          bedrooms: 1,
          effective_monthly_rent: 3695,
          monthly_rent: 3695,
        },
        householdPreference,
      ),
    ).toEqual({ householdSize: 1, rent: 3695 });
  });

  it("splits an under-bedroomed listing at realistic occupancy for an 'up to N' group", () => {
    // household_size_max is an upper bound, not a requirement: a group of up to
    // 5 should still see a 2-bed and split it by 2 (one person per bedroom).
    const upToFive = { householdSizeMax: 5, householdSizeMin: 5 };
    expect(
      fallbackPerPersonRentForListing(
        { bedrooms: 2, effective_monthly_rent: 7895, monthly_rent: 7895 },
        upToFive,
      ),
    ).toEqual({ householdSize: 2, rent: 3948 });
    expect(
      fallbackPerPersonRentForListing(
        { bedrooms: 1, effective_monthly_rent: 4495, monthly_rent: 4495 },
        upToFive,
      ),
    ).toEqual({ householdSize: 1, rent: 4495 });
    // A 3-bed splits 3 ways; a 6-bed is capped at the group's max of 5.
    expect(
      fallbackPerPersonRentForListing(
        { bedrooms: 3, effective_monthly_rent: 9000, monthly_rent: 9000 },
        upToFive,
      ),
    ).toEqual({ householdSize: 3, rent: 3000 });
    expect(
      fallbackPerPersonRentForListing(
        { bedrooms: 6, effective_monthly_rent: 10000, monthly_rent: 10000 },
        upToFive,
      ),
    ).toEqual({ householdSize: 5, rent: 2000 });
  });

  it("broadens past a carried-over saved must-have when an explicit area search dead-ends", async () => {
    // Model echoed the saved "near Caltrain" must-have into a Russian Hill
    // request; the strict passes return nothing because no Russian Hill listing
    // is near Caltrain. The tool should drop the carried constraint and surface
    // what's actually available, telling the agent it widened the search.
    loadCompatibleListingCardsMock.mockImplementation(async (_supabase, options) => {
      const mustHaves = options.requestContext.mustHaves ?? [];
      const transitTargets = options.requestContext.transitTargets ?? [];
      const hasBedFloor =
        options.requestContext.bedroomsMin != null ||
        options.requestContext.bedroomsMax != null;
      if (mustHaves.length > 0 || transitTargets.length > 0 || hasBedFloor) {
        return [];
      }
      return [fakeListingCard()];
    });

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Relax the budget, just show me what is available",
        supabase: {} as never,
        threadId: "thread-1",
        userId: "user-1",
      },
      { desiredTerms: ["near Caltrain"], neighborhoods: ["Russian Hill"] },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      broadenedPast: ["your saved must-haves"],
    });
    expect(
      (result.data as { listings: unknown[] }).listings,
    ).toHaveLength(1);
    expect(result.summary).toContain("widened the search");
  });

  it("does not persist listing-card media when no public media base is available", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([fakeListingCard()]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "show me listings",
        supabase: makeSupabaseStub(),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.media).toHaveLength(0);
    expect(persistListingRecommendationCardsMock).not.toHaveBeenCalled();
  });

  it("prioritizes a preferred budget cap before the stretch ceiling", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard({
        address: "Target Apt",
        effectiveRent: 2700,
        id: "listing-target",
        monthlyRent: 2700,
      }),
      fakeListingCard({
        address: "Stretch Apt",
        effectiveRent: 3100,
        id: "listing-stretch",
        monthlyRent: 3100,
      }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Around $2,800 per month, stretch to $3,200 for the right fit.",
        supabase: makeSupabaseStub(),
        threadId: "thread-1",
        userId: "user-1",
      },
      { budgetMax: 3200 },
    );

    expect(result.ok).toBe(true);
    expect(loadCompatibleListingCardsMock.mock.calls[0][1]).toMatchObject({
      requestContext: { budgetMax: 3200 },
    });
    expect(result.data).toMatchObject({
      budgetMax: 2800,
      budgetPreferredMax: 2800,
      budgetStretchMax: 3200,
    });
    expect(
      (result.data as { listings: Array<{ address: string }> }).listings,
    ).toEqual([expect.objectContaining({ address: "Target Apt" })]);
    expect(result.summary).toContain("under the $2,800/person target");
    expect(result.summary).toContain("do not call $2,800-$3,200 a saved range");
  });

  it("falls back to the stretch ceiling when nothing fits the preferred cap", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard({
        address: "Stretch Apt",
        effectiveRent: 3100,
        id: "listing-stretch",
        monthlyRent: 3100,
      }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Around $2,800 per month, stretch to $3,200 for the right fit.",
        supabase: makeSupabaseStub(),
        threadId: "thread-1",
        userId: "user-1",
      },
      { budgetMax: 3200 },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      budgetMax: 3200,
      budgetPreferredMax: 2800,
      budgetStretchMax: 3200,
      budgetUsedStretch: true,
    });
    expect(
      (result.data as { listings: Array<{ address: string }> }).listings,
    ).toEqual([expect.objectContaining({ address: "Stretch Apt" })]);
    expect(result.summary).toContain("Nothing fit the $2,800/person target");
    expect(result.summary).toContain("use the $3,200/person stretch cap");
  });

  it("does not broaden away a constraint the person stated this turn", async () => {
    // "2 bedrooms near Caltrain" is what they asked for right now, so an empty
    // result should stay empty (prompt them to relax) rather than silently
    // dropping their own filters.
    loadCompatibleListingCardsMock.mockResolvedValue([]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Show me 2 bedrooms near Caltrain in Russian Hill",
        supabase: makeSupabaseStub(),
        threadId: "thread-1",
        userId: "user-1",
      },
      {
        bedroomsMin: 2,
        neighborhoods: ["Russian Hill"],
        transitTargets: ["Caltrain"],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.data).not.toHaveProperty("broadenedPast", expect.anything());
    expect((result.data as { listings: unknown[] }).listings).toHaveLength(0);
  });

  it("downgrades unsupported office claims to unclear feature assessments", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard({
        address: "2055 Sacramento St",
        description: "Classic Pacific Heights one-bedroom.",
        evidence: ["$4,495/person fits your $4,500 cap."],
        id: "listing-office-unclear",
      }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Find me apartments in pac heights with room for an office",
        supabase: makeSupabaseStubWithTables({
          agent_context_evidence: [],
          apartment_listings: [
            {
              address_line: "2055 Sacramento St",
              amenities: ["Dishwasher", "Walker's paradise"],
              bathrooms: 1,
              bedrooms: 1,
              description: "Classic Pacific Heights one-bedroom.",
              id: "listing-office-unclear",
              provider_detail_payload: {
                about: {
                  description:
                    "Nestled in Pacific Heights with modern conveniences and resident support.",
                },
              },
              provider_payload_hash: "hash-1",
              source_url: null,
              square_feet: 612,
            },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    const [listing] = result.data.listings as Array<{
      featureAssessments?: Array<{ status: string; summary: string }>;
    }>;
    expect(listing.featureAssessments?.[0]).toMatchObject({
      status: "unclear",
      summary:
        "No stored office, den, desk, or workspace evidence found for this listing.",
    });
    expect(result.summary).toContain(
      "Only call a listing office/workspace-friendly when featureAssessments.status is explicit or likely",
    );
  });

  it("keeps office/workspace searches grounded when evidence argues against the feature", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard({
        address: "2055 Sacramento St",
        description: "Classic Pacific Heights one-bedroom without an office.",
        evidence: ["$4,495/person fits your $4,500 cap."],
        id: "listing-office-no",
      }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Find me apartments in pac heights with room for an office",
        supabase: makeSupabaseStubWithTables({
          agent_context_evidence: [],
          apartment_listings: [
            {
              address_line: "2055 Sacramento St",
              amenities: [],
              bathrooms: 1,
              bedrooms: 1,
              description: "Classic Pacific Heights one-bedroom without an office.",
              id: "listing-office-no",
              provider_detail_payload: {},
              provider_payload_hash: "hash-1",
              source_url: null,
              square_feet: 612,
            },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    const [listing] = result.data.listings as Array<{
      featureAssessments?: Array<{ status: string; summary: string }>;
    }>;
    expect(listing.featureAssessments?.[0]).toMatchObject({
      status: "no",
    });
    expect(listing.featureAssessments?.[0].summary).toContain(
      "Listing evidence argues against office/workspace fit",
    );
    expect(result.summary).toContain(
      "Feature evidence included for 1 listing checks (0 supported, 1 unsupported, 0 unclear).",
    );
    expect(result.summary).toContain(
      "if status is no, say the evidence argues against it",
    );
  });

  it("ranks office searches by persisted visual/text feature evidence before generic fit", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard({
        address: "Generic High Fit",
        fitScore: 92,
        id: "listing-generic",
      }),
      fakeListingCard({
        address: "Desk Nook Apt",
        fitScore: 60,
        id: "listing-desk",
      }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Find me apartments in pac heights with room for an office",
        supabase: makeSupabaseStubWithTables({
          agent_context_evidence: [
            {
              claim_key: "office_workspace",
              claim_text: "Photo shows a desk-sized nook off the living room.",
              confidence: 0.76,
              evidence_excerpt:
                "Photo shows a desk-sized nook off the living room.",
              listing_id: "listing-desk",
              metadata: {
                listingId: "listing-desk",
                photoUrl: "https://images.example.com/desk.jpg",
                source: "photo_vision",
                sourceVersion: listingFeatureSourceVersionForTests(),
              },
              source_column: "url",
              source_json_path: null,
              source_table: "apartment_listing_photos",
            },
          ],
          apartment_listings: [
            {
              address_line: "Generic High Fit",
              amenities: [],
              bathrooms: 1,
              bedrooms: 1,
              description: "A nice Pacific Heights one-bedroom.",
              id: "listing-generic",
              provider_detail_payload: {},
              provider_payload_hash: "hash-generic",
              source_url: null,
              square_feet: null,
            },
            {
              address_line: "Desk Nook Apt",
              amenities: [],
              bathrooms: 1,
              bedrooms: 1,
              description: "A nice Pacific Heights one-bedroom.",
              id: "listing-desk",
              provider_detail_payload: {},
              provider_payload_hash: "hash-desk",
              source_url: null,
              square_feet: null,
            },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    const listings = result.data.listings as Array<{
      address: string;
      featureAssessments?: Array<{ evidence: unknown[]; status: string }>;
    }>;
    expect(listings[0].address).toBe("Desk Nook Apt");
    expect(listings[0].featureAssessments?.[0]).toMatchObject({
      status: "likely",
    });
    expect(listings[0].featureAssessments?.[0].evidence).toHaveLength(1);
  });

  it("excludes already-shown listings on a 'show me more' search and says they're new", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard(),
      fakeListingCard({ address: "600 Oak St", id: "listing-2" }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "show me more options",
        supabase: makeSupabaseStubWithTables({
          text_listing_recommendations: [
            {
              id: "rec-1",
              listing_id: "listing-1",
              outbound_message_id: "provider-1",
            },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ excludedAlreadyShownCount: 1 });
    expect(
      (result.data as { listings: Array<{ address: string }> }).listings,
    ).toEqual([expect.objectContaining({ address: "600 Oak St" })]);
    expect(result.summary).toContain("already texted in this thread");
  });

  it("does not exclude unstamped card rows as already shown", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard(),
      fakeListingCard({ address: "600 Oak St", id: "listing-2" }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "show me more options",
        supabase: makeSupabaseStubWithTables({
          text_listing_recommendations: [
            {
              id: "rec-1",
              listing_id: "listing-1",
              outbound_message_id: null,
            },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ excludedAlreadyShownCount: undefined });
    expect(
      (result.data as { listings: Array<{ address: string }> }).listings,
    ).toEqual([
      expect.objectContaining({ address: "2525 Larkin St" }),
      expect.objectContaining({ address: "600 Oak St" }),
    ]);
  });

  it("maps explicit excludeIds through recommendation rows to listing ids", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard(),
      fakeListingCard({ address: "600 Oak St", id: "listing-2" }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Show me what is available",
        supabase: makeSupabaseStubWithTables({
          text_listing_recommendations: [
            { id: "rec-1", listing_id: "listing-1" },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { excludeIds: ["rec-1"] },
    );

    expect(result.ok).toBe(true);
    expect(
      (result.data as { listings: Array<{ address: string }> }).listings,
    ).toEqual([expect.objectContaining({ address: "600 Oak St" })]);
  });

  it("says when nothing new remains beyond the already-shown listings", async () => {
    loadCompatibleListingCardsMock.mockResolvedValue([fakeListingCard()]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "show me more options",
        supabase: makeSupabaseStubWithTables({
          text_listing_recommendations: [
            {
              id: "rec-1",
              listing_id: "listing-1",
              outbound_message_id: "provider-1",
            },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("No new listings beyond the 1 already shown");
  });

  it("passes availableBy through to the card pipeline and filters late availability", async () => {
    loadCompatibleListingCardsMock.mockClear();
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard(),
      fakeListingCard({ address: "600 Oak St", id: "listing-2" }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Show me places",
        supabase: makeSupabaseStubWithTables({
          apartment_listings: [
            { available_at: "2026-09-15", id: "listing-1" },
            { available_at: "2026-07-15", id: "listing-2" },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { availableBy: "2026-08-01", budgetMax: 5000 },
    );

    expect(loadCompatibleListingCardsMock.mock.calls[0]?.[1]).toMatchObject({
      availableBy: "2026-08-01",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ availableBy: "2026-08-01" });
    expect(
      (result.data as { listings: Array<{ address: string }> }).listings,
    ).toEqual([expect.objectContaining({ address: "600 Oak St" })]);
    expect(result.summary).toContain("available by 2026-08-01");
  });

  it("infers availableBy from the text when model args omit it", async () => {
    loadCompatibleListingCardsMock.mockClear();
    loadCompatibleListingCardsMock.mockResolvedValue([
      fakeListingCard(),
      fakeListingCard({ address: "600 Oak St", id: "listing-2" }),
    ]);

    const result = await searchListingsTool.run(
      {
        allowWrites: true,
        body: "Show me places available by 2026-08-01",
        supabase: makeSupabaseStubWithTables({
          apartment_listings: [
            { available_at: "2026-09-15", id: "listing-1" },
            { available_at: "2026-07-15", id: "listing-2" },
          ],
        }),
        threadId: "thread-1",
        userId: "user-1",
      },
      { budgetMax: 5000 },
    );

    expect(loadCompatibleListingCardsMock.mock.calls[0]?.[1]).toMatchObject({
      availableBy: "2026-08-01",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ availableBy: "2026-08-01" });
    expect(
      (result.data as { listings: Array<{ address: string }> }).listings,
    ).toEqual([expect.objectContaining({ address: "600 Oak St" })]);
  });
});
