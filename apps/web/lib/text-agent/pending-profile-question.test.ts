import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildProposalExtraction: vi.fn(),
  completeAgentRun: vi.fn(async () => undefined),
  isTextAgentSkipReply: vi.fn((body: string) => body.trim() === "SKIP"),
  loadPendingProfileQuestion: vi.fn(),
  persistIncrementalTextProfileFactsNow: vi.fn(),
  resolvePendingProfileQuestion: vi.fn(async () => true),
  summarizeTextProfileFacts: vi.fn((facts: unknown[]) =>
    facts.length > 0 ? "sleep schedule: early bird" : "",
  ),
}));

vi.mock("@/lib/text-agent", () => ({
  summarizeTextProfileFacts: mocks.summarizeTextProfileFacts,
}));

vi.mock("@/lib/text-agent/fact-utils", () => ({
  isTextAgentSkipReply: mocks.isTextAgentSkipReply,
}));

vi.mock("@/lib/text-agent/profile-intake-flow", () => ({
  buildProposalExtraction: mocks.buildProposalExtraction,
}));

vi.mock("@/lib/text-agent/profile-persistence", () => ({
  persistIncrementalTextProfileFactsNow:
    mocks.persistIncrementalTextProfileFactsNow,
}));

vi.mock("@/lib/text-agent/run-data", () => ({
  completeAgentRun: mocks.completeAgentRun,
}));

vi.mock("@/lib/text-agent/thread-data", () => ({
  loadPendingProfileQuestion: mocks.loadPendingProfileQuestion,
  resolvePendingProfileQuestion: mocks.resolvePendingProfileQuestion,
}));

import { handlePendingProfileQuestionReply } from "./pending-profile-question";

const fact = {
  assertion_type: "explicit",
  confidence: 0.95,
  dimension: "daily_rhythm",
  evidence: "I am an early bird",
  fact_key: "sleep_schedule",
  importance: 0.8,
  matching_eligible: true,
  sensitivity_level: "standard",
  value: "early bird",
};

const extraction = {
  facts: [fact],
  metadata: { extractor: "openrouter", model: "model-1" },
  modelExtraction: {
    costUsd: null,
    extraction: { intent: "profile_update" },
    facts: [fact],
    inputTokens: 10,
    latencyMs: 20,
    model: "model-1",
    outputTokens: 5,
    profileActions: [],
    provider: "openrouter",
  },
};

function args(reply = vi.fn(async () => undefined)) {
  return {
    body: "I am an early bird",
    message: {
      from_phone_e164: "+14155550100",
      id: "message-1",
      provider: "linq",
      raw_payload: {},
    },
    reply,
    run: { id: "run-1" },
    thread: { id: "thread-1" },
    userId: "user-1",
  };
}

describe("pending profile question replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadPendingProfileQuestion.mockResolvedValue({
      askedAt: "2026-07-11T12:00:00.000Z",
      notificationId: "notification-1",
      step: "sleep_schedule",
    });
    mocks.buildProposalExtraction.mockResolvedValue(extraction);
    mocks.persistIncrementalTextProfileFactsNow.mockResolvedValue({
      failedFacts: [],
      failureMessage: null,
      persistedFacts: [fact],
      skippedSensitiveFacts: [],
    });
  });

  it("binds the next answer to the pending step and persists it once", async () => {
    const input = args();

    await expect(
      handlePendingProfileQuestionReply({} as never, input as never),
    ).resolves.toBe(true);

    expect(mocks.buildProposalExtraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: "I am an early bird",
        currentStep: "sleep_schedule",
        threadId: "thread-1",
        userId: "user-1",
      }),
    );
    expect(mocks.persistIncrementalTextProfileFactsNow).toHaveBeenCalledOnce();
    expect(mocks.resolvePendingProfileQuestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        notificationId: "notification-1",
        resolution: "answered",
      }),
    );
    expect(input.reply).toHaveBeenCalledWith(
      "Got it - I saved sleep schedule: early bird.",
      "profile_update",
    );
  });

  it("marks SKIP without extraction, persistence, or another question", async () => {
    const input = args();
    input.body = "SKIP";

    await handlePendingProfileQuestionReply({} as never, input as never);

    expect(mocks.buildProposalExtraction).not.toHaveBeenCalled();
    expect(mocks.persistIncrementalTextProfileFactsNow).not.toHaveBeenCalled();
    expect(mocks.resolvePendingProfileQuestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resolution: "skipped" }),
    );
    expect(input.reply).toHaveBeenCalledWith(
      "No problem, I'll leave that one blank.",
      "profile_update",
    );
  });

  it("keeps protected or sensitive answers out of matching", async () => {
    const input = args();
    mocks.buildProposalExtraction.mockResolvedValue({
      ...extraction,
      validationReply: "I can't use that detail for matching.",
    });
    mocks.persistIncrementalTextProfileFactsNow.mockResolvedValue({
      failedFacts: [],
      failureMessage: null,
      persistedFacts: [],
      skippedSensitiveFacts: [fact],
    });

    await handlePendingProfileQuestionReply({} as never, input as never);

    expect(input.reply).toHaveBeenCalledWith(
      "I can't use that detail for matching.",
      "profile_update",
    );
    expect(mocks.completeAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.any(String),
      "blocked_protected",
      expect.any(Object),
    );
  });

  it("does not persist the same inbound answer twice after a queue retry", async () => {
    const input = args();
    input.message.raw_payload = {
      incremental_profile_thread_id: "thread-1",
    };

    await handlePendingProfileQuestionReply({} as never, input as never);

    expect(mocks.persistIncrementalTextProfileFactsNow).not.toHaveBeenCalled();
    expect(mocks.resolvePendingProfileQuestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resolution: "answered" }),
    );
  });

  it("leaves ordinary inbound turns alone when no question is pending", async () => {
    mocks.loadPendingProfileQuestion.mockResolvedValue(null);

    await expect(
      handlePendingProfileQuestionReply({} as never, args() as never),
    ).resolves.toBe(false);

    expect(mocks.buildProposalExtraction).not.toHaveBeenCalled();
  });
});
