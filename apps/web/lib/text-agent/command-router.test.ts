import { describe, expect, it } from "vitest";
import {
  decideApproveEntryCommand,
  decideApproveFallbackCommand,
  decideProfileUpdateCommand,
  decideVerifiedTextCommand,
} from "./command-router";

describe("text agent command router", () => {
  it("keeps deterministic verified commands out of the model path", () => {
    expect(decideVerifiedTextCommand("opt_out")).toEqual({ kind: "opt_out" });
    expect(decideVerifiedTextCommand("opt_in")).toEqual({ kind: "opt_in" });
    expect(decideVerifiedTextCommand("help")).toEqual({ kind: "help" });
    expect(decideVerifiedTextCommand("interview")).toEqual({
      kind: "start_interview",
    });
    expect(decideVerifiedTextCommand("edit")).toEqual({
      intent: "edit",
      kind: "review_link",
    });
    expect(decideVerifiedTextCommand("review")).toEqual({
      intent: "review",
      kind: "review_link",
    });
    expect(decideVerifiedTextCommand("profile_update")).toEqual({
      kind: "profile_update",
    });
  });

  it("routes approval replies through pending proposals before the default agent path", () => {
    expect(decideApproveEntryCommand({ hasPendingProposal: true })).toEqual({
      kind: "approve_pending_proposal",
    });
    expect(decideApproveEntryCommand({ hasPendingProposal: false })).toEqual({
      kind: "continue_without_pending_proposal",
    });
  });

  it("routes approval fallbacks through intake, low-risk draft persistence, or proposal approval", () => {
    expect(
      decideApproveFallbackCommand({
        canAutoPersistDraftFacts: true,
        draftFactCount: 3,
        hasNextIntakeStep: false,
      }),
    ).toEqual({ kind: "persist_draft_low_risk" });
    expect(
      decideApproveFallbackCommand({
        canAutoPersistDraftFacts: false,
        draftFactCount: 3,
        hasNextIntakeStep: false,
      }),
    ).toEqual({ kind: "approve_draft_proposal" });
    expect(
      decideApproveFallbackCommand({
        canAutoPersistDraftFacts: false,
        draftFactCount: 0,
        hasNextIntakeStep: false,
      }),
    ).toEqual({ kind: "extract_profile_update" });
    expect(
      decideApproveFallbackCommand({
        canAutoPersistDraftFacts: true,
        draftFactCount: 3,
        hasNextIntakeStep: true,
      }),
    ).toEqual({ kind: "extract_profile_update" });
  });

  it("prioritizes fresh intake before the housing agent", () => {
    expect(
      decideProfileUpdateCommand({ prioritizeFreshProfileIntake: true }),
    ).toEqual({ kind: "start_interview_then_extract" });
    expect(
      decideProfileUpdateCommand({ prioritizeFreshProfileIntake: false }),
    ).toEqual({ kind: "run_housing_agent" });
  });
});
