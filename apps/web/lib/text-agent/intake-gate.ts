import type { SupabaseServiceClient } from "./store-types";
import type { HousingAgentToolResult } from "./tool-belt";

// ---------------------------------------------------------------------------
// Onboarding intake gate — durable STATE resolution only.
//
// The loop owns mid-interview turns (the run queue only routes FRESH intake to
// the stepper), so without this the model can derail onboarding: the live
// failure was a user answering the age question and getting an unprompted
// three-match pitch with invented reasons instead of the next question.
//
// This module answers one question from durable state: is the interview
// mid-flight, and if so which step/question is open? What the current MESSAGE
// asks for is a separate, semantic question answered by interpretation.ts;
// how the two combine into tool permissions is onboarding-machine.ts. Keeping
// the state read pure of message inspection is what lets the loop re-resolve
// it after an update_prefs write to learn the post-write question.
// ---------------------------------------------------------------------------

export type ActiveIntakeGate = {
  // First unanswered FOUNDATION step, or null once the foundation is complete.
  // Distinct from `step`, which is the next unanswered step of any kind.
  foundationStep: string | null;
  nextQuestion: string;
  step: string;
};

// "No gate" is two different facts and callers must not conflate them:
// `complete` means durable state says the interview is done or inactive;
// `unavailable` means resolution itself failed and nothing is known. The
// completion path acts only on an explicit `complete` — treating a Supabase
// timeout as "coverage complete" would durably end an interview mid-flight.
export type IntakeGateOutcome =
  | { gate: ActiveIntakeGate; status: "active" }
  | { status: "complete" }
  | { status: "unavailable" };

/**
 * Non-null only while the onboarding interview is genuinely mid-flight: an
 * intake step is recorded on the thread summary (or the matching interview is
 * active) AND coverage says at least one step is still unanswered. Coverage —
 * not the possibly-stale summary step — decides the question, so a step the
 * user already answered through update_prefs is never re-asked. Fails open
 * (null) on any load error: a broken gate must never block a live reply.
 */
export async function resolveActiveIntakeGate(
  supabase: SupabaseServiceClient,
  args: { threadId: string; userId: string },
): Promise<ActiveIntakeGate | null> {
  const outcome = await resolveIntakeGateOutcome(supabase, args);
  return outcome.status === "active" ? outcome.gate : null;
}

export async function resolveIntakeGateOutcome(
  supabase: SupabaseServiceClient,
  { threadId, userId }: { threadId: string; userId: string },
): Promise<IntakeGateOutcome> {
  try {
    // Sequential dynamic imports on purpose: racing them in one Promise.all
    // makes vitest's module runner load the real module past its mock.
    const factUtils = await import("./fact-utils");
    const threadData = await import("./thread-data");
    const interviewState = await import("./interview-state");
    const summary = await threadData.loadThreadSummary(
      supabase,
      threadId,
      userId,
    );
    const summaryStep = factUtils.readNextIntakeStepFromSummary(summary);
    const interviewActive =
      Boolean(summaryStep) ||
      (await interviewState.hasActiveMatchingInterview(supabase, userId));
    if (!interviewActive) {
      return { status: "complete" };
    }

    const coverageFacts = await threadData.loadUserTextAgentCoverageFacts(
      supabase,
      userId,
    );
    const { loadEnrichmentIntakeHints } = await import(
      "../profiles/enrichment-intake-hints"
    );
    let enrichmentHintSteps: Awaited<
      ReturnType<typeof loadEnrichmentIntakeHints>
    > = [];
    try {
      enrichmentHintSteps = await loadEnrichmentIntakeHints(supabase, userId);
    } catch (error) {
      console.warn("[text-agent-loop] enrichment intake hints unavailable", {
        error,
        userId,
      });
    }
    const draft = factUtils.readTextAgentDraftState(summary);
    const nextStep = factUtils.nextTextAgentIntakeStepFromDraftWithCoverage(
      draft,
      coverageFacts,
      enrichmentHintSteps,
    );
    if (!nextStep) {
      return { status: "complete" };
    }

    // Recomputed against the foundation list rather than read off nextStep:
    // enrichment hints can reorder the queue and surface a detail step while a
    // foundation step is still open, and the listing gate keys off the
    // foundation specifically. Failing here keeps listings gated — withholding
    // a search is recoverable, a studio dump built on a guessed group size is
    // what this gate exists to prevent.
    let foundationStep: string | null = nextStep;
    let nextQuestion = "";
    try {
      const { textAgentFoundationIntakeSteps } = await import("./index");
      foundationStep = factUtils.nextTextAgentIntakeStepFromDraftWithCoverage(
        draft,
        coverageFacts,
        [...textAgentFoundationIntakeSteps],
      );
    } catch (error) {
      console.warn("[text-agent-loop] foundation intake step unresolved", {
        error,
      });
    }
    try {
      const { buildTextAgentProfileQuestion } = await import("./index");
      nextQuestion = buildTextAgentProfileQuestion(nextStep);
    } catch {
      nextQuestion = "";
    }

    return {
      gate: {
        foundationStep,
        nextQuestion,
        step: nextStep,
      },
      status: "active",
    };
  } catch (error) {
    console.error("[text-agent-loop] intake gate resolution failed", { error });
    return { status: "unavailable" };
  }
}

export function buildIntakeGatedMatchesResult(
  gate: ActiveIntakeGate,
): HousingAgentToolResult {
  return {
    data: { reason: "onboarding_intake_active", step: gate.step },
    ok: false,
    summary: `Roommate matches stay hidden until the quick intake questions are done (or the user explicitly asks for them). ${continueOnboardingInstruction(gate)}`,
    toolName: "get_matches",
  };
}

export function buildIntakeGatedListingsResult(
  gate: ActiveIntakeGate,
): HousingAgentToolResult {
  return {
    data: {
      foundationStep: gate.foundationStep,
      reason: "onboarding_foundation_incomplete",
      step: gate.step,
    },
    ok: false,
    summary: `Listing search stays closed until the foundation questions (neighborhoods, budget, move-in timing, group size, age comfort) are answered — without a group size the per-person split defaults to one person, so the results would be studios regardless of what they want. No listings were returned, so do not describe or promise any. ${continueOnboardingInstruction(gate)}`,
    toolName: "search_listings",
  };
}

function continueOnboardingInstruction(gate: ActiveIntakeGate) {
  return gate.nextQuestion
    ? `Continue onboarding: acknowledge their message, then ask exactly: "${gate.nextQuestion}"`
    : "Continue onboarding: acknowledge their message, then ask the next intake question.";
}
