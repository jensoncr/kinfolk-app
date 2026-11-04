import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextProfileFact } from "@/lib/text-agent";
import type { IncrementalTextProfileFactsPersistenceArgs } from "./store-types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  applyProfileSlotEditForUserId: vi.fn(),
  completeAgentRun: vi.fn(),
  createProfileImportForUserId: vi.fn(),
  refreshMatchingStateForTextProfileFacts: vi.fn(),
  reviewProfileImportForUserId: vi.fn(),
  textMessageUpdateEq: vi.fn(async () => ({ error: null })),
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => void task(),
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  applyProfileSlotEditForUserId: mocks.applyProfileSlotEditForUserId,
  createProfileImportForUserId: mocks.createProfileImportForUserId,
  reviewProfileImportForUserId: mocks.reviewProfileImportForUserId,
}));

vi.mock("@/lib/text-agent", () => ({
  buildProfileImportPayloadFromText: (body: string, facts: unknown[]) => ({
    body,
    facts,
  }),
  buildTextAgentProfileEnrichmentHandoffReply: vi.fn(),
  isTextAgentFoundationIntakeStep: vi.fn(),
  riskLevelForTextFacts: () => "low",
  summarizeTextProfileFacts: () => "summary",
  textAgentFoundationIntakeComplete: vi.fn(),
  textProfileImportSourceForTransport: () => "sms_intake",
}));

// Mirrors the real auto-persistable rule (standard sensitivity + matching
// eligible) so the sensitive split is exercised, not stubbed away.
vi.mock("@/lib/text-agent/fact-utils", () => ({
  autoPersistableTextFacts: (facts: TextProfileFact[]) =>
    facts.filter(
      (fact) =>
        fact.sensitivity_level === "standard" &&
        fact.matching_eligible !== false,
    ),
  mergeTextAgentDraftFacts: vi.fn(),
  splitExclusiveSlotEditFacts: (facts: TextProfileFact[]) => ({
    remainingFacts: facts,
    slotEdits: [],
  }),
}));

vi.mock("@/lib/text-agent/interview-state", () => ({
  hasActiveMatchingInterview: vi.fn(),
  markMatchingInterviewCompleted: vi.fn(),
  markMatchingInterviewNeedsReview: vi.fn(),
}));

vi.mock("@/lib/text-agent/profile-actions", () => ({
  textProfileFactToImportFact: (fact: TextProfileFact) => fact,
}));

vi.mock("@/lib/text-agent/profile-promotion", () => ({
  refreshMatchingStateForTextProfileFacts:
    mocks.refreshMatchingStateForTextProfileFacts,
}));

vi.mock("@/lib/text-agent/run-data", () => ({
  completeAgentRun: mocks.completeAgentRun,
}));

vi.mock("@/lib/text-agent/store-shared", () => ({
  getProfileEnrichmentFormUrl: () => "",
  jsonObjectOrEmpty: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
}));

vi.mock("@/lib/text-agent/thread-data", () => ({
  enforcePendingProposalLimit: vi.fn(),
  expireSupersededPendingTextProposals: vi.fn(),
  updateTextThreadSummary: vi.fn(),
}));

vi.mock("@/lib/integrations/text-transport", () => ({
  readTextProviderForRow: () => "sendblue",
}));

import { persistIncrementalTextProfileFactsNow } from "./profile-persistence";

function makeFact(
  factKey: string,
  value: TextProfileFact["value"],
  overrides: Partial<TextProfileFact> = {},
): TextProfileFact {
  return {
    assertion_type: "explicit",
    confidence: 0.9,
    dimension: "feasibility",
    evidence: "test message",
    fact_key: factKey,
    importance: 0.8,
    matching_eligible: true,
    sensitivity_level: "standard",
    value,
    ...overrides,
  };
}

function makeSupabaseStub() {
  return {
    from: (table: string) => {
      if (table !== "text_messages") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        update: () => ({ eq: mocks.textMessageUpdateEq }),
      };
    },
  } as never;
}

function persistenceArgs(
  facts: TextProfileFact[],
): IncrementalTextProfileFactsPersistenceArgs {
  return {
    body: "test message",
    facts,
    message: {
      from_phone_e164: "+15550001111",
      id: "message-1",
      provider: "sendblue",
      raw_payload: {},
    } as never,
    metadata: { extractor: "kinfolk_tool", model: null },
    sourceLabel: "Housing agent text update",
    thread: { id: "thread-1" } as never,
    userId: "user-1",
  };
}

describe("persistIncrementalTextProfileFactsNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProfileImportForUserId.mockResolvedValue({
      import: { id: "import-1" },
    });
    mocks.refreshMatchingStateForTextProfileFacts.mockReturnValue(true);
    mocks.reviewProfileImportForUserId.mockResolvedValue(undefined);
    mocks.textMessageUpdateEq.mockResolvedValue({ error: null });
  });

  it("persists standard facts and reports sensitive ones as skipped, not saved", async () => {
    const budgetFact = makeFact("budget_max", 1500);
    const sensitiveFact = makeFact("dealbreakers", ["alcohol at home"], {
      sensitivity_level: "sensitive",
    });

    const result = await persistIncrementalTextProfileFactsNow(
      makeSupabaseStub(),
      persistenceArgs([budgetFact, sensitiveFact]),
    );

    expect(result).toEqual({
      failedFacts: [],
      failureMessage: null,
      persistedFacts: [budgetFact],
      skippedSensitiveFacts: [sensitiveFact],
    });
    expect(
      mocks.refreshMatchingStateForTextProfileFacts,
    ).toHaveBeenCalledWith([budgetFact]);
    expect(mocks.reviewProfileImportForUserId).toHaveBeenCalledWith(
      "user-1",
      "import-1",
      "approve_all",
      expect.objectContaining({ refreshMatchingState: true }),
    );
  });

  it("returns the facts as failed when the write throws instead of swallowing it", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.reviewProfileImportForUserId.mockRejectedValue(
      new Error("import approval failed"),
    );
    const budgetFact = makeFact("budget_max", 1500);
    const sensitiveFact = makeFact("dealbreakers", ["alcohol at home"], {
      sensitivity_level: "sensitive",
    });

    const result = await persistIncrementalTextProfileFactsNow(
      makeSupabaseStub(),
      persistenceArgs([budgetFact, sensitiveFact]),
    );

    expect(result.persistedFacts).toEqual([]);
    expect(result.failedFacts).toEqual([budgetFact]);
    expect(result.failureMessage).toContain("import approval failed");
    expect(result.skippedSensitiveFacts).toEqual([sensitiveFact]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("writes nothing when every fact is sensitive or matching-ineligible", async () => {
    const sensitiveFact = makeFact("prior_roommate_context", "left after a dispute", {
      sensitivity_level: "sensitive",
    });
    const ineligibleFact = makeFact("interests", ["climbing"], {
      matching_eligible: false,
    });

    const result = await persistIncrementalTextProfileFactsNow(
      makeSupabaseStub(),
      persistenceArgs([sensitiveFact, ineligibleFact]),
    );

    expect(result).toEqual({
      failedFacts: [],
      failureMessage: null,
      persistedFacts: [],
      skippedSensitiveFacts: [sensitiveFact, ineligibleFact],
    });
    expect(mocks.createProfileImportForUserId).not.toHaveBeenCalled();
    expect(mocks.reviewProfileImportForUserId).not.toHaveBeenCalled();
  });
});
