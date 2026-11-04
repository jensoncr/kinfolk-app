import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildTextAgentProfileQuestion: vi.fn((step: string) => `question:${step}`),
  hasActiveMatchingInterview: vi.fn(async () => false),
  loadEnrichmentIntakeHints: vi.fn(async () => [
    "conflict_repair",
    "sleep_schedule",
  ]),
  loadThreadSummary: vi.fn(async () => ({
    summary_json: { next_intake_step: "cleanliness" },
  })),
  loadUserTextAgentCoverageFacts: vi.fn(async () => []),
  nextTextAgentIntakeStepFromDraftWithCoverage: vi.fn(
    (_draft: unknown, _coverage: unknown, steps: string[]): string | null =>
      steps[0],
  ),
  readNextIntakeStepFromSummary: vi.fn(() => "cleanliness"),
  readTextAgentDraftState: vi.fn(() => ({ facts: [], skippedSteps: [] })),
}));

vi.mock("@/lib/profiles/enrichment-intake-hints", () => ({
  loadEnrichmentIntakeHints: mocks.loadEnrichmentIntakeHints,
}));

vi.mock("./fact-utils", () => ({
  nextTextAgentIntakeStepFromDraftWithCoverage:
    mocks.nextTextAgentIntakeStepFromDraftWithCoverage,
  readNextIntakeStepFromSummary: mocks.readNextIntakeStepFromSummary,
  readTextAgentDraftState: mocks.readTextAgentDraftState,
}));

vi.mock("./thread-data", () => ({
  loadThreadSummary: mocks.loadThreadSummary,
  loadUserTextAgentCoverageFacts: mocks.loadUserTextAgentCoverageFacts,
}));

vi.mock("./interview-state", () => ({
  hasActiveMatchingInterview: mocks.hasActiveMatchingInterview,
}));

vi.mock("./index", () => ({
  buildTextAgentProfileQuestion: mocks.buildTextAgentProfileQuestion,
  textAgentFoundationIntakeSteps: [
    "neighborhoods",
    "budget",
    "move_in",
    "roommates",
    "age_comfort",
  ],
}));

import {
  buildIntakeGatedListingsResult,
  buildIntakeGatedMatchesResult,
  resolveActiveIntakeGate,
  resolveIntakeGateOutcome,
  type ActiveIntakeGate,
} from "./intake-gate";

function gate(overrides: Partial<ActiveIntakeGate> = {}): ActiveIntakeGate {
  return {
    foundationStep: "roommates",
    nextQuestion: "How many roommates are you open to?",
    step: "roommates",
    ...overrides,
  };
}

describe("active intake gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retains assistant hint priority while recomputing covered steps", async () => {
    const result = await resolveActiveIntakeGate({} as never, {
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(
      mocks.nextTextAgentIntakeStepFromDraftWithCoverage,
    ).toHaveBeenCalledWith(
      { facts: [], skippedSteps: [] },
      [],
      ["conflict_repair", "sleep_schedule"],
    );
    expect(result).toMatchObject({
      nextQuestion: "question:conflict_repair",
      step: "conflict_repair",
    });
  });

  // The hint list can surface a detail step while the foundation is unfinished,
  // so the foundation is resolved from its own list rather than read off `step`.
  it("resolves the foundation step separately from the hint-prioritized step", async () => {
    mocks.nextTextAgentIntakeStepFromDraftWithCoverage.mockImplementation(
      (_draft: unknown, _coverage: unknown, steps: string[]) => steps[0],
    );

    const result = await resolveActiveIntakeGate({} as never, {
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result?.step).toBe("conflict_repair");
    expect(result?.foundationStep).toBe("neighborhoods");
  });

  it("returns null once coverage says every intake step is answered", async () => {
    mocks.nextTextAgentIntakeStepFromDraftWithCoverage.mockReturnValue(null);

    const result = await resolveActiveIntakeGate({} as never, {
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result).toBeNull();
  });

  // "No gate" is two different facts: covered interview vs. failed read. The
  // completion path must only ever act on an explicit `complete` — a Supabase
  // timeout must never durably end an interview mid-flight.
  it("distinguishes a completed interview from a failed resolution", async () => {
    mocks.nextTextAgentIntakeStepFromDraftWithCoverage.mockReturnValue(null);
    const complete = await resolveIntakeGateOutcome({} as never, {
      threadId: "thread-1",
      userId: "user-1",
    });
    expect(complete).toEqual({ status: "complete" });

    mocks.loadThreadSummary.mockRejectedValueOnce(new Error("timeout"));
    const unavailable = await resolveIntakeGateOutcome({} as never, {
      threadId: "thread-1",
      userId: "user-1",
    });
    expect(unavailable).toEqual({ status: "unavailable" });
  });

  it("reports an active interview with its gate state", async () => {
    mocks.nextTextAgentIntakeStepFromDraftWithCoverage.mockImplementation(
      (_draft: unknown, _coverage: unknown, steps: string[]) => steps[0],
    );

    const outcome = await resolveIntakeGateOutcome({} as never, {
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(outcome.status).toBe("active");
    if (outcome.status !== "active") return;
    expect(outcome.gate.step).toBe("conflict_repair");
  });

  it("returns a failed listings result that names the next question", () => {
    const result = buildIntakeGatedListingsResult(gate());

    expect(result.ok).toBe(false);
    expect(result.toolName).toBe("search_listings");
    expect(result.data.reason).toBe("onboarding_foundation_incomplete");
    expect(result.media).toBeUndefined();
    expect(result.summary).toContain("How many roommates are you open to?");
  });

  it("returns a failed matches result that names the next question", () => {
    const result = buildIntakeGatedMatchesResult(gate());

    expect(result.ok).toBe(false);
    expect(result.toolName).toBe("get_matches");
    expect(result.data.reason).toBe("onboarding_intake_active");
    expect(result.summary).toContain("How many roommates are you open to?");
  });
});
