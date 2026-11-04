import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countSentNotificationsSince: vi.fn(async () => 0),
  deliverMatchNotificationText: vi.fn(
    async (
      _supabase: unknown,
      options: {
        onDelivered?: (delivery: {
          notificationId: string;
          threadId: string;
        }) => Promise<void>;
      },
    ) => {
      await options.onDelivered?.({
        notificationId: "notification-1",
        threadId: "thread-1",
      });
      return { notificationId: "notification-1", sent: true };
    },
  ),
  loadProfileQuestionIntakeSteps: vi.fn(async () => ["sleep_schedule"]),
  loadProfileQuestionStateForUser: vi.fn(async () => ({
    pending: null,
    skippedSteps: [],
  })),
  loadUserTextAgentCoverageFacts: vi.fn(async () => []),
  nextTextAgentIntakeStepFromDraftWithCoverage: vi.fn(
    (_draft: unknown, _coverage: unknown, steps: string[]) => steps[0] ?? null,
  ),
  runMatchNotificationGates: vi.fn(async () => ({
    existingNotification: null,
    now: new Date("2026-07-11T19:00:00.000Z"),
    phone: { phone_e164: "+14155550100" },
    prefs: { profile_questions_enabled: true },
    provider: "linq",
  })),
  savePendingProfileQuestion: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/profiles/enrichment-intake-hints", () => ({
  isProfileQuestionSafeIntakeStep: (step: string) =>
    step !== "age_comfort" && ["sleep_schedule", "cleanliness"].includes(step),
  loadProfileQuestionIntakeSteps: mocks.loadProfileQuestionIntakeSteps,
}));

vi.mock("@/lib/text-agent", () => ({
  buildTextAgentProfileQuestion: (step: string) =>
    step === "sleep_schedule"
      ? "What's your sleep schedule like — early bird, night owl, somewhere in between?"
      : `canonical:${step}`,
}));

vi.mock("@/lib/text-agent/fact-utils", () => ({
  nextTextAgentIntakeStepFromDraftWithCoverage:
    mocks.nextTextAgentIntakeStepFromDraftWithCoverage,
}));

vi.mock("@/lib/text-agent/thread-data", () => ({
  loadProfileQuestionStateForUser: mocks.loadProfileQuestionStateForUser,
  loadUserTextAgentCoverageFacts: mocks.loadUserTextAgentCoverageFacts,
  savePendingProfileQuestion: mocks.savePendingProfileQuestion,
}));

vi.mock("@/lib/notifications/delivery", () => ({
  countSentNotificationsSince: mocks.countSentNotificationsSince,
  deliverMatchNotificationText: mocks.deliverMatchNotificationText,
  normalizeRequiredMatchNotificationId: (value: string) =>
    value.trim() || null,
  runMatchNotificationGates: mocks.runMatchNotificationGates,
}));

vi.mock("@/lib/text-agent/store-shared", () => ({
  jsonObjectOrEmpty: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
}));

import {
  buildProfileQuestionIdempotencyKey,
  buildProfileQuestionNotificationBody,
  sendProfileQuestionNotification,
} from "./profile-question-notifications";

function makeSupabase(existingNotification: Record<string, unknown> | null = null) {
  const updates: Record<string, unknown>[] = [];
  const query: Record<string, unknown> = {};
  const chain = () => query;
  Object.assign(query, {
    eq: chain,
    maybeSingle: async () => ({ data: existingNotification, error: null }),
    select: chain,
    then: (
      resolve: (value: { data: null; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    update: (payload: Record<string, unknown>) => {
      updates.push(payload);
      return query;
    },
  });
  return {
    supabase: { from: vi.fn(() => query) } as never,
    updates,
  };
}

describe("profile question notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadProfileQuestionStateForUser.mockResolvedValue({
      pending: null,
      skippedSteps: [],
    });
    mocks.loadProfileQuestionIntakeSteps.mockResolvedValue(["sleep_schedule"]);
    mocks.nextTextAgentIntakeStepFromDraftWithCoverage.mockReturnValue(
      "sleep_schedule",
    );
    mocks.countSentNotificationsSince.mockResolvedValue(0);
    mocks.runMatchNotificationGates.mockResolvedValue({
      existingNotification: null,
      now: new Date("2026-07-11T19:00:00.000Z"),
      phone: { phone_e164: "+14155550100" },
      prefs: { profile_questions_enabled: true },
      provider: "linq",
    });
    mocks.deliverMatchNotificationText.mockImplementation(
      async (_supabase, options) => {
        await options.onDelivered?.({
          notificationId: "notification-1",
          threadId: "thread-1",
        });
        return { notificationId: "notification-1", sent: true };
      },
    );
  });

  it("requires explicit profile-question opt-in", async () => {
    mocks.runMatchNotificationGates.mockResolvedValueOnce(
      { skipped: "disabled_by_user" } as never,
    );
    const { supabase } = makeSupabase();

    await expect(
      sendProfileQuestionNotification(supabase, { userId: "user-1" }),
    ).resolves.toEqual({ sent: false, skipped: "disabled_by_user" });
    const [, gateOptions] = mocks.runMatchNotificationGates.mock
      .calls[0] as unknown as [
      unknown,
      { prefsEnabled: (prefs: { profile_questions_enabled: boolean }) => boolean },
    ];
    expect(
      gateOptions.prefsEnabled({ profile_questions_enabled: false }),
    ).toBe(false);
    expect(mocks.deliverMatchNotificationText).not.toHaveBeenCalled();
  });

  it("enforces one question per rolling seven days", async () => {
    mocks.countSentNotificationsSince.mockResolvedValueOnce(1);
    const { supabase } = makeSupabase();

    await expect(
      sendProfileQuestionNotification(supabase, {
        nowUtc: new Date("2026-07-11T19:00:00.000Z"),
        userId: "user-1",
      }),
    ).resolves.toEqual({
      sent: false,
      skipped: "profile_question_cadence",
    });
    expect(mocks.countSentNotificationsSince).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        kind: "profile_question",
        since: new Date("2026-07-04T19:00:00.000Z"),
      }),
    );
    expect(mocks.deliverMatchNotificationText).not.toHaveBeenCalled();
  });

  it("does not send while another profile question is unresolved", async () => {
    mocks.loadProfileQuestionStateForUser.mockResolvedValueOnce({
      pending: {
        askedAt: "2026-07-10T19:00:00.000Z",
        notificationId: "notification-old",
        step: "cleanliness",
        threadId: "thread-1",
      },
      skippedSteps: [],
    } as never);
    const { supabase } = makeSupabase();

    await expect(
      sendProfileQuestionNotification(supabase, { userId: "user-1" }),
    ).resolves.toEqual({
      sent: false,
      skipped: "pending_profile_question",
    });
    expect(mocks.runMatchNotificationGates).not.toHaveBeenCalled();
  });

  it("recovers pending state from an already-sent duplicate", async () => {
    const { supabase } = makeSupabase({
      card_snapshot: null,
      created_at: "2026-07-11T19:00:00.000Z",
      id: "notification-existing",
      outbound_message_id: "provider-message-1",
      thread_id: "thread-existing",
    });

    await expect(
      sendProfileQuestionNotification(supabase, {
        nowUtc: new Date("2026-07-11T19:00:00.000Z"),
        userId: "user-1",
      }),
    ).resolves.toEqual({ sent: false, skipped: "already_sent" });
    expect(mocks.savePendingProfileQuestion).toHaveBeenCalledWith(supabase, {
      askedAt: "2026-07-11T19:00:00.000Z",
      notificationId: "notification-existing",
      step: "sleep_schedule",
      threadId: "thread-existing",
      userId: "user-1",
    });
    expect(mocks.deliverMatchNotificationText).not.toHaveBeenCalled();
  });

  it("sends only canonical wording and records the scoped step", async () => {
    mocks.loadProfileQuestionIntakeSteps.mockResolvedValueOnce([
      "sleep_schedule",
    ]);
    const { supabase, updates } = makeSupabase();

    await expect(
      sendProfileQuestionNotification(supabase, {
        nowUtc: new Date("2026-07-11T19:00:00.000Z"),
        userId: "user-1",
      }),
    ).resolves.toMatchObject({ sent: true });

    expect(mocks.deliverMatchNotificationText).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        kind: "profile_question",
        messageParts: [
          {
            type: "text",
            value:
              "What's your sleep schedule like — early bird, night owl, somewhere in between? Reply SKIP if you would rather leave this one blank.",
          },
        ],
        rawPayloadExtra: { step: "sleep_schedule" },
      }),
    );
    expect(updates).toEqual([
      expect.objectContaining({
        card_snapshot: {
          profile_question: expect.objectContaining({
            step: "sleep_schedule",
          }),
        },
      }),
    ]);
    expect(mocks.savePendingProfileQuestion).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ step: "sleep_schedule" }),
    );
  });

  it("never builds a proactive age-comfort question", () => {
    expect(() => buildProfileQuestionNotificationBody("age_comfort")).toThrow(
      "Unsafe proactive profile question step",
    );
  });

  it("uses a stable idempotency key within one cadence bucket", () => {
    const first = buildProfileQuestionIdempotencyKey({
      nowUtc: new Date("2026-07-11T19:00:00.000Z"),
      userId: "user-1",
    });
    const second = buildProfileQuestionIdempotencyKey({
      nowUtc: new Date("2026-07-12T19:00:00.000Z"),
      userId: "user-1",
    });

    expect(second).toBe(first);
  });
});
