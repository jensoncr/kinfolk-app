import { describe, expect, it, vi } from "vitest";
import {
  appendSkippedIntakeStep,
  loadPendingProfileQuestion,
  loadTextThreadAgentMemory,
  readPendingProfileQuestionFromSummary,
  readTextThreadAgentMemoryFromSummary,
  resolvePendingProfileQuestion,
  savePendingProfileQuestion,
  saveTextThreadAgentMemory,
  updateTextThreadSummary,
} from "./thread-data";
import type { TableRow } from "./store-types";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/profiles/enrichment-intake-hints", () => ({
  isProfileQuestionSafeIntakeStep: (step: string) =>
    step !== "age_comfort",
  loadEnrichmentIntakeHints: vi.fn(async () => []),
  profileQuestionSafeIntakeSteps: [
    "sleep_schedule",
    "cleanliness",
    "neighborhoods",
  ],
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  reviewProfileImportForUserId: vi.fn(),
}));

vi.mock("@/lib/text-agent", () => ({
  buildTextAgentProfileEnrichmentHandoffReply: vi.fn(() => ""),
  buildTextAgentProfileQuestion: vi.fn(() => "question"),
  textAgentFoundationIntakeComplete: vi.fn(() => false),
}));

vi.mock("@/lib/text-agent/state", () => ({
  buildTextAgentConversationState: vi.fn(() => ({
    active_intake_step: null,
    active_mode: "intake",
    last_sent_cards: [],
  })),
}));

vi.mock("@/lib/text-agent/fact-utils", () => ({
  isInformativeTextProfileFact: () => true,
  mergeTextAgentDraftFacts: (
    draft: { facts: unknown[] },
    facts: unknown[],
  ) => ({ facts: [...draft.facts, ...facts], skippedSteps: [] }),
  nextTextAgentIntakeStepFromDraftWithCoverage: vi.fn(() => null),
  readTextProfileFactValue: (value: unknown) => value ?? null,
  serializeTextProfileFact: (fact: unknown) => fact,
}));

vi.mock("@/lib/text-agent/interview-state", () => ({
  markMatchingInterviewCompleted: vi.fn(),
}));

vi.mock("@/lib/text-agent/reply-send", () => ({
  buildReviewReply: vi.fn(() => ""),
}));

vi.mock("@/lib/text-agent/run-data", () => ({
  completeAgentRun: vi.fn(),
}));

vi.mock("@/lib/text-agent/store-shared", () => ({
  getProfileEnrichmentFormUrl: () => "",
  jsonObjectOrEmpty: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {},
}));

type FakeRow = Record<string, unknown>;

function createFakeSupabase(initialSummaryRow: FakeRow | null = null) {
  const state = {
    summaryRow: initialSummaryRow,
    updates: [] as Array<{ payload: FakeRow; table: string }>,
    upserts: [] as Array<{ payload: FakeRow; table: string }>,
  };

  const makeQuery = (table: string) => {
    const query: Record<string, unknown> = {};
    const chain = () => query;
    Object.assign(query, {
      eq: chain,
      gt: chain,
      in: chain,
      limit: chain,
      maybeSingle: async () => ({
        data: table === "text_thread_summaries" ? state.summaryRow : null,
        error: null,
      }),
      order: chain,
      select: chain,
      then: (resolve: (value: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
      update: (payload: FakeRow) => {
        state.updates.push({ payload, table });
        return query;
      },
      upsert: (payload: FakeRow) => {
        state.upserts.push({ payload, table });
        if (table === "text_thread_summaries") {
          state.summaryRow = { ...(state.summaryRow ?? {}), ...payload };
        }
        return { error: null };
      },
    });
    return query;
  };

  return {
    state,
    supabase: { from: (table: string) => makeQuery(table) } as never,
  };
}

describe("text thread agent memory", () => {
  it("round-trips the sent-card registry and rolling summary through the thread store", async () => {
    const { state, supabase } = createFakeSupabase();

    await saveTextThreadAgentMemory(supabase, {
      sentListingCards: [
        {
          address: "681 Florida St",
          listingId: "listing-1",
          ordinal: 1,
          recommendationId: "rec-1",
        },
        {
          address: "12 Oak St",
          listingId: null,
          ordinal: 2,
          recommendationId: "rec-2",
        },
      ],
      threadId: "thread-1",
      userId: "user-1",
    });

    const memory = await loadTextThreadAgentMemory(
      supabase,
      "thread-1",
      "user-1",
    );
    expect(memory.sentListingCards).toEqual([
      {
        address: "681 Florida St",
        listingId: "listing-1",
        ordinal: 1,
        recommendationId: "rec-1",
      },
      {
        address: "12 Oak St",
        listingId: null,
        ordinal: 2,
        recommendationId: "rec-2",
      },
    ]);
    expect(memory.rollingSummary).toBe("");

    await saveTextThreadAgentMemory(supabase, {
      rollingSummary: "Looking in Mission under 3500; sent two cards.",
      threadId: "thread-1",
      userId: "user-1",
    });

    const updated = await loadTextThreadAgentMemory(
      supabase,
      "thread-1",
      "user-1",
    );
    expect(updated.rollingSummary).toBe(
      "Looking in Mission under 3500; sent two cards.",
    );
    expect(updated.sentListingCards).toHaveLength(2);
    expect(state.upserts).toHaveLength(2);
  });

  it("clamps the stored rolling summary to 120 words", async () => {
    const { supabase } = createFakeSupabase();

    await saveTextThreadAgentMemory(supabase, {
      rollingSummary: Array.from({ length: 200 }, (_, i) => `word${i}`).join(
        " ",
      ),
      threadId: "thread-1",
      userId: "user-1",
    });

    const memory = await loadTextThreadAgentMemory(
      supabase,
      "thread-1",
      "user-1",
    );
    expect(memory.rollingSummary.split(" ")).toHaveLength(120);
    expect(memory.rollingSummary.endsWith("word119")).toBe(true);
  });

  it("reads agent memory defensively from malformed summary rows", () => {
    expect(readTextThreadAgentMemoryFromSummary(null)).toEqual({
      rollingSummary: "",
      sentListingCards: [],
    });
    expect(
      readTextThreadAgentMemoryFromSummary({
        summary_json: {
          agent_memory: {
            last_sent_cards: [
              { address: 12, recommendation_id: "rec-1" },
              { address: "no id" },
              "garbage",
            ],
            rolling_summary: 42,
          },
        },
      } as unknown as TableRow<"text_thread_summaries">),
    ).toEqual({
      rollingSummary: "",
      sentListingCards: [
        { address: "", listingId: null, ordinal: 1, recommendationId: "rec-1" },
      ],
    });
  });

  it("keeps agent memory intact when the legacy summary writer rebuilds summary_json", async () => {
    const { state, supabase } = createFakeSupabase({
      summary_json: {
        agent_memory: {
          last_sent_cards: [
            { address: "681 Florida St", ordinal: 1, recommendation_id: "rec-1" },
          ],
          rolling_summary: "memory worth keeping",
        },
        pending_profile_question: {
          asked_at: "2026-07-11T12:00:00.000Z",
          notification_id: "notification-1",
          step: "sleep_schedule",
        },
        intake_complete: true,
      },
    });

    await updateTextThreadSummary(supabase, {
      messageId: "message-1",
      threadId: "thread-1",
      userId: "user-1",
    });

    const upsert = state.upserts.find(
      (entry) => entry.table === "text_thread_summaries",
    );
    const summaryJson = upsert?.payload.summary_json as Record<string, unknown>;
    expect(summaryJson.agent_memory).toMatchObject({
      rolling_summary: "memory worth keeping",
    });
    expect(summaryJson.pending_profile_question).toEqual({
      asked_at: "2026-07-11T12:00:00.000Z",
      notification_id: "notification-1",
      step: "sleep_schedule",
    });
    expect(
      await loadTextThreadAgentMemory(supabase, "thread-1", "user-1"),
    ).toMatchObject({
      rollingSummary: "memory worth keeping",
      sentListingCards: [
        { address: "681 Florida St", ordinal: 1, recommendationId: "rec-1" },
      ],
    });
  });

  it("stores and clears one pending profile question without starting intake", async () => {
    const { state, supabase } = createFakeSupabase();

    await savePendingProfileQuestion(supabase, {
      askedAt: "2026-07-11T12:00:00.000Z",
      notificationId: "notification-1",
      step: "cleanliness",
      threadId: "thread-1",
      userId: "user-1",
    });

    await expect(
      loadPendingProfileQuestion(supabase, "thread-1", "user-1"),
    ).resolves.toEqual({
      askedAt: "2026-07-11T12:00:00.000Z",
      notificationId: "notification-1",
      step: "cleanliness",
    });
    expect(
      (state.summaryRow?.summary_json as Record<string, unknown>)
        .next_intake_step,
    ).toBeUndefined();

    await expect(
      resolvePendingProfileQuestion(supabase, {
        notificationId: "notification-1",
        resolution: "skipped",
        threadId: "thread-1",
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    expect(
      readPendingProfileQuestionFromSummary(state.summaryRow as never),
    ).toBeNull();
    expect(state.summaryRow?.summary_json).toMatchObject({
      profile_question_skipped_steps: ["cleanliness"],
    });
    expect(state.updates).toContainEqual({
      payload: {
        card_snapshot: {
          profile_question: expect.objectContaining({
            resolution: "skipped",
            step: "cleanliness",
          }),
        },
      },
      table: "match_notifications",
    });
  });

  it("rejects malformed and protected pending question state", () => {
    expect(
      readPendingProfileQuestionFromSummary({
        summary_json: {
          pending_profile_question: {
            asked_at: "2026-07-11T12:00:00.000Z",
            notification_id: "notification-1",
            step: "age_comfort",
          },
        },
      } as never),
    ).toBeNull();
    expect(
      readPendingProfileQuestionFromSummary({
        summary_json: {
          pending_profile_question: {
            asked_at: "not-a-date",
            notification_id: "notification-1",
            step: "sleep_schedule",
          },
        },
      } as never),
    ).toBeNull();
  });
});

describe("appendSkippedIntakeStep", () => {
  it("merges the step while preserving other preference keys, touching no other columns", async () => {
    const { state, supabase } = createFakeSupabase({
      known_preferences_json: {
        facts: [{ fact_key: "budget", value: "$3000" }],
        skipped_steps: ["move_in"],
      },
      open_questions_json: ["How many roommates?"],
      summary_json: { agent_memory: { rolling_summary: "precious" } },
    });

    await appendSkippedIntakeStep(supabase, {
      messageId: "msg-1",
      step: "roommates",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(state.upserts).toHaveLength(1);
    const payload = state.upserts[0].payload;
    expect(payload.known_preferences_json).toEqual({
      facts: [{ fact_key: "budget", value: "$3000" }],
      skipped_steps: ["move_in", "roommates"],
    });
    // The payload must not carry summary_json/open_questions_json at all —
    // a conflict update overwrites every provided column, and those belong
    // to other writers.
    expect("summary_json" in payload).toBe(false);
    expect("open_questions_json" in payload).toBe(false);
  });

  it("does not deduplicate away an already-recorded skip", async () => {
    const { state, supabase } = createFakeSupabase({
      known_preferences_json: { skipped_steps: ["roommates"] },
    });

    await appendSkippedIntakeStep(supabase, {
      messageId: null,
      step: "roommates",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(
      (state.upserts[0].payload.known_preferences_json as {
        skipped_steps: string[];
      }).skipped_steps,
    ).toEqual(["roommates"]);
  });

  it("throws on a failed read and writes nothing", async () => {
    const upserts: unknown[] = [];
    const supabase = {
      from: () => ({
        eq: function chain() {
          return this;
        },
        maybeSingle: async () => ({
          data: null,
          error: { message: "transient timeout" },
        }),
        select: function chain() {
          return this;
        },
        upsert: (payload: unknown) => {
          upserts.push(payload);
          return { error: null };
        },
      }),
    } as never;

    await expect(
      appendSkippedIntakeStep(supabase, {
        messageId: null,
        step: "roommates",
        threadId: "thread-1",
        userId: "user-1",
      }),
    ).rejects.toBeTruthy();
    expect(upserts).toHaveLength(0);
  });
});
