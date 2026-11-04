export type VerifiedTextCommand =
  | { kind: "approve" }
  | { kind: "help" }
  | { kind: "opt_in" }
  | { kind: "opt_out" }
  | { kind: "profile_update" }
  | { intent: "edit" | "review"; kind: "review_link" }
  | { kind: "start_interview" }
  | { kind: "unsupported" };

export type ApproveEntryCommand =
  | { kind: "approve_pending_proposal" }
  | { kind: "continue_without_pending_proposal" };

export type ApproveFallbackCommand =
  | { kind: "approve_draft_proposal" }
  | { kind: "extract_profile_update" }
  | { kind: "persist_draft_low_risk" };

export type ProfileUpdateCommand =
  | { kind: "start_interview_then_extract" }
  | { kind: "run_housing_agent" };

export function decideVerifiedTextCommand(intent: string): VerifiedTextCommand {
  if (intent === "opt_out") return { kind: "opt_out" };
  if (intent === "opt_in") return { kind: "opt_in" };
  if (intent === "help") return { kind: "help" };
  if (intent === "interview") return { kind: "start_interview" };
  if (intent === "approve") return { kind: "approve" };
  if (intent === "edit" || intent === "review") {
    return { intent, kind: "review_link" };
  }
  if (intent === "profile_update") return { kind: "profile_update" };
  return { kind: "unsupported" };
}

export function decideApproveEntryCommand({
  hasPendingProposal,
}: {
  hasPendingProposal: boolean;
}): ApproveEntryCommand {
  return hasPendingProposal
    ? { kind: "approve_pending_proposal" }
    : { kind: "continue_without_pending_proposal" };
}

export function decideApproveFallbackCommand({
  canAutoPersistDraftFacts,
  draftFactCount,
  hasNextIntakeStep,
}: {
  canAutoPersistDraftFacts: boolean;
  draftFactCount: number;
  hasNextIntakeStep: boolean;
}): ApproveFallbackCommand {
  if (hasNextIntakeStep || draftFactCount === 0) {
    return { kind: "extract_profile_update" };
  }

  return canAutoPersistDraftFacts
    ? { kind: "persist_draft_low_risk" }
    : { kind: "approve_draft_proposal" };
}

export function decideProfileUpdateCommand({
  prioritizeFreshProfileIntake,
}: {
  prioritizeFreshProfileIntake: boolean;
}): ProfileUpdateCommand {
  return prioritizeFreshProfileIntake
    ? { kind: "start_interview_then_extract" }
    : { kind: "run_housing_agent" };
}
