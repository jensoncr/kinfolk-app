import "server-only";
import { loadEnrichmentIntakeHints } from "@/lib/profiles/enrichment-intake-hints";
import { applyProfileSlotEditForUserId } from "@/lib/profiles/enrichment-store";
import { buildProfileImportPayloadFromText, buildTextAgentIntakeProgressReply, buildTextAgentProfileQuestion, buildTextAgentScopeDeclineReply, summarizeTextProfileFacts, textAgentIntakeSteps, textProfileImportSourceForTransport } from "@/lib/text-agent";
import { buildCorrectionConfirmationReply, isTextProfileCorrectionMessage } from "@/lib/text-agent/corrections";
import { textAgentProvider } from "@/lib/text-agent/extraction";
import { autoPersistableTextFacts, canAutoPersistAllTextFacts, loadRecentTextMessages, markCurrentIntakeStepHandledByExtractedFacts, mergeTextAgentDraftFacts, nextTextAgentIntakeStepFromDraftWithCoverage, readNextIntakeStepFromSummary, readTextAgentDraftState } from "@/lib/text-agent/fact-utils";
import { hasActiveMatchingInterview } from "@/lib/text-agent/interview-state";
import { buildProfileActionToolPlan, formatProfileActionSummaries, textProfileFactToImportFact } from "@/lib/text-agent/profile-actions";
import { buildProposalExtraction, handleDraftSkipOrClarification, handleIntakeControlReply } from "@/lib/text-agent/profile-intake-flow";
import { completeLowRiskTextProfileUpdate, completeProfileEnrichmentHandoffFromText, createProfileUpdateProposalFromFacts, deferIncrementalTextProfileFactsPersistence, shouldOfferProfileEnrichmentHandoff } from "@/lib/text-agent/profile-persistence";
import { completeAgentRun } from "@/lib/text-agent/run-data";
import { loadThreadSummary, loadUserTextAgentCoverageFacts, updateTextThreadSummary } from "@/lib/text-agent/thread-data";
import { isOffTopicTextAgentMessage, restrictedTextAgentRefusal } from "@/lib/text-agent/tools";
import { readTextProviderForRow } from "@/lib/integrations/text-transport";
import type { TextProfileFact, TextProfileImportExtractionMetadata } from "@/lib/text-agent";
import type { TextAgentModelExtraction } from "@/lib/text-agent/extraction";
import type { SupabaseServiceClient, TableRow, TextAgentDraftState, TextAgentPolicyOutcome, TextAgentReply } from "@/lib/text-agent/store-types";
import type { TextInboundMessage } from "@/lib/integrations/text-transport";

export async function proposeProfileUpdateFromText(
  supabase: SupabaseServiceClient,
  {
    inbound,
    message,
    reply,
    runId,
    thread,
    userId,
  }: {
    inbound: TextInboundMessage;
    message: TableRow<"text_messages">;
    reply: TextAgentReply;
    runId: string;
    thread: TableRow<"text_threads">;
    userId: string;
  },
) {
  await proposeProfileUpdateFromMessage(supabase, {
    body: inbound.body,
    message,
    reply,
    run: { id: runId },
    sourceLabel: `Text from ${inbound.from}`,
    thread,
    userId,
  });
}

export async function proposeProfileUpdateFromMessage(
  supabase: SupabaseServiceClient,
  {
    body,
    message,
    reply,
    run,
    sourceLabel,
    thread,
    userId,
  }: {
    body: string;
    message: TableRow<"text_messages">;
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    sourceLabel?: string;
    thread: TableRow<"text_threads">;
    userId: string;
  },
) {
  const recentMessagesForScope = await loadRecentTextMessages(
    supabase,
    thread.id,
    userId,
  );
  const restrictedRefusal = restrictedTextAgentRefusal(body);
  if (restrictedRefusal) {
    await completeAgentRun(
      supabase,
      run.id,
      "Restricted request refused.",
      "unsupported",
    );
    await reply(restrictedRefusal, "unsupported");
    return;
  }
  if (isOffTopicTextAgentMessage(body, recentMessagesForScope)) {
    await completeAgentRun(
      supabase,
      run.id,
      "Off-topic message declined.",
      "unsupported",
    );
    await reply(buildTextAgentScopeDeclineReply(), "unsupported");
    return;
  }

  const threadSummary = await loadThreadSummary(supabase, thread.id, userId);
  const currentDraft = readTextAgentDraftState(threadSummary);
  const [profileCoverageFacts, enrichmentHintSteps] = await Promise.all([
    loadUserTextAgentCoverageFacts(supabase, userId),
    loadEnrichmentIntakeHints(supabase, userId),
  ]);
  const activeSummaryStep = readNextIntakeStepFromSummary(threadSummary);
  const activeMatchingInterview = activeSummaryStep
    ? true
    : await hasActiveMatchingInterview(supabase, userId);
  const pendingDraft =
    activeSummaryStep
      ? currentDraft
      : {
          facts: [] as TextProfileFact[],
          skippedSteps: currentDraft.skippedSteps,
        };
  const hasActiveIntakeState =
    Boolean(activeSummaryStep) ||
    pendingDraft.facts.length > 0 ||
    pendingDraft.skippedSteps.length > 0;
  // The genuine remaining gap (null = profile already covers every intake step).
  // Keep it nullable so control replies don't re-ask a step that's complete.
  const resolvedNextStep =
    activeSummaryStep ??
    nextTextAgentIntakeStepFromDraftWithCoverage(
      pendingDraft,
      profileCoverageFacts,
      enrichmentHintSteps,
    );
  const currentStep =
    resolvedNextStep ?? textAgentIntakeSteps[0] ?? "sleep_schedule";

  // Keep rule-based handling here to explicit control replies only. Profile
  // semantics go through the model-first extractor below.
  const controlReply = resolvedNextStep
    ? await handleIntakeControlReply(supabase, {
        body,
        currentDraft: pendingDraft,
        currentStep: resolvedNextStep,
        enrichmentHintSteps,
        activeMatchingInterview,
        message,
        profileCoverageFacts,
        reply,
        run,
        thread,
        userId,
      })
    : { handled: false };

  if (controlReply.handled) {
    return;
  }

  const isCorrection = isTextProfileCorrectionMessage(body);
  const extraction = await buildProposalExtraction(supabase, {
    body,
    // Pass the GENUINE next step (nullable). On a complete profile this is null, so
    // extraction runs in general mode and captures volunteered facts (dealbreakers,
    // must-haves) instead of being narrowed to the fallback "neighborhoods" step and
    // silently dropping them.
    currentStep: resolvedNextStep,
    runId: run.id,
    threadId: thread.id,
    userId,
  });

  if ("rateLimited" in extraction) {
    await completeAgentRun(
      supabase,
      run.id,
      "Model extraction rate limited.",
      "rate_limited",
      {
        limitBucket: extraction.bucket,
      },
    );
    await reply(
      "Kinfolk hit today's AI intake limit for this profile. Reply REVIEW to open Kinfolk instead.",
      "rate_limited",
    );
    return;
  }

  if ("unavailable" in extraction) {
    await completeAgentRun(
      supabase,
      run.id,
      `Model extraction unavailable: ${extraction.reason}`,
      "error",
      {
        provider: textAgentProvider,
      },
    );
    await reply(
      "Kinfolk's AI text intake is temporarily unavailable. Reply REVIEW to open Kinfolk instead.",
      "error",
    );
    return;
  }

  const {
    facts,
    metadata,
    modelExtraction,
    validationNotice,
    validationReply,
  } = extraction;
  const modelIntent = modelExtraction.extraction.intent;
  const profileActionResult = await executeProfileActionsFromExtraction(
    supabase,
    {
      body,
      currentDraft: pendingDraft,
      message,
      metadata,
      modelExtraction,
      reply,
      run,
      sourceLabel,
      thread,
      userId,
      validationNotice,
    },
  );

  if (profileActionResult.handled) {
    return;
  }

  const shouldCreateProposal =
    modelIntent === "profile_update" &&
    modelExtraction.extraction.should_create_proposal;

  if (!shouldCreateProposal || facts.length === 0) {
    const nextReply = await handleDraftSkipOrClarification(supabase, {
      body,
      currentStep,
      currentDraft: pendingDraft,
      enrichmentHintSteps,
      activeMatchingInterview,
      extraction: modelExtraction,
      message,
      metadata,
      profileCoverageFacts,
      reply,
      run,
      sourceLabel,
      thread,
      userId,
    });

    if (nextReply.handled) {
      return;
    }

    const assistantReply = modelExtraction.extraction.assistant_reply.trim();
    const question = modelExtraction.extraction.clarifying_question.trim();
    const outcome: TextAgentPolicyOutcome =
      modelIntent === "clarification_needed"
        ? "clarification_needed"
        : "unsupported";
    await Promise.all([
      updateTextThreadSummary(supabase, {
        extraction: modelExtraction,
        facts: pendingDraft.facts,
        messageId: message.id,
        nextIntakeStep: resolvedNextStep ?? undefined,
        skippedSteps: pendingDraft.skippedSteps,
        threadId: thread.id,
        userId,
      }),
      completeAgentRun(
        supabase,
        run.id,
        "No profile facts found.",
        outcome,
        {
          extractionResult: modelExtraction?.extraction,
          inputTokens: modelExtraction.inputTokens,
          latencyMs: modelExtraction.latencyMs,
          model: modelExtraction.model,
          outputTokens: modelExtraction.outputTokens,
          provider: modelExtraction.provider ?? metadata.extractor ?? null,
          estimatedCostUsd: modelExtraction.costUsd,
        },
      ),
    ]);
    await reply(
      validationReply
        ? validationReply
          : assistantReply
        ? assistantReply
        : outcome === "clarification_needed" && question
          ? question
          : resolvedNextStep
            ? buildTextAgentProfileQuestion(resolvedNextStep, {
                includeIntro: !hasActiveIntakeState,
              })
          : outcome === "unsupported"
            ? buildTextAgentScopeDeclineReply()
            : buildTextAgentProfileQuestion(currentStep, {
                includeIntro: !hasActiveIntakeState,
                }),
      outcome,
    );
    return;
  }

  const draft = markCurrentIntakeStepHandledByExtractedFacts(
    mergeTextAgentDraftFacts(pendingDraft, facts),
    currentStep,
    facts,
  );
  const nextStep = nextTextAgentIntakeStepFromDraftWithCoverage(
    draft,
    profileCoverageFacts,
    enrichmentHintSteps,
  );
  const currentAutoPersistableFactCount = autoPersistableTextFacts(facts).length;

  if (nextStep) {
    if (
      shouldOfferProfileEnrichmentHandoff({
        activeMatchingInterview,
        draft,
        nextStep,
        profileCoverageFacts,
        suppressHandoff: isCorrection,
      })
    ) {
      await completeProfileEnrichmentHandoffFromText(supabase, {
        body,
        draft,
        message,
        metadata,
        modelExtraction,
        profileCoverageFacts,
        reply,
        run,
        sourceLabel,
        thread,
        userId,
        validationNotice,
      });
      return;
    }

    const incrementalPersistence =
      currentAutoPersistableFactCount > 0
        ? deferIncrementalTextProfileFactsPersistence(supabase, {
            body,
            facts: draft.facts,
            message,
            metadata,
            sourceLabel,
            thread,
            userId,
          })
        : { applied: false, factCount: 0 };

    await Promise.all([
      updateTextThreadSummary(supabase, {
        extraction: modelExtraction,
        facts: draft.facts,
        messageId: message.id,
        nextIntakeStep: nextStep,
        skippedSteps: draft.skippedSteps,
        threadId: thread.id,
        userId,
      }),
      completeAgentRun(
        supabase,
        run.id,
        incrementalPersistence.applied
          ? "Queued profile facts and asked the next intake question."
          : "Collected profile facts and asked the next intake question.",
        "clarification_needed",
        {
          estimatedCostUsd: modelExtraction?.costUsd ?? null,
          extractionResult: modelExtraction?.extraction,
          inputTokens: modelExtraction?.inputTokens ?? null,
          latencyMs: modelExtraction?.latencyMs ?? null,
          limitBucket: run.limit_bucket,
          model: modelExtraction?.model ?? metadata.model ?? null,
          outputTokens: modelExtraction?.outputTokens ?? null,
          provider: modelExtraction?.provider ?? metadata.extractor ?? null,
        },
      ),
    ]);
    await reply(
      [
        validationNotice,
        buildTextAgentIntakeProgressReply({
          currentStep,
          facts,
          nextStep,
        }),
      ]
        .filter(Boolean)
        .join("\n\n"),
      "profile_prompt",
    );
    return;
  }

  if (canAutoPersistAllTextFacts(draft.facts)) {
    await completeLowRiskTextProfileUpdate(supabase, {
      body,
      facts: draft.facts,
      message,
      metadata,
      modelExtraction,
      reply,
      run,
      skippedSteps: draft.skippedSteps,
      sourceLabel,
      summaryFacts: mergeTextAgentDraftFacts(
        { facts: profileCoverageFacts, skippedSteps: [] },
        draft.facts,
      ).facts,
      thread,
      userId,
      validationNotice,
    });
    return;
  }

  await createProfileUpdateProposalFromFacts(supabase, {
    autoApprove: activeMatchingInterview,
    body,
    facts: draft.facts,
    message,
    metadata,
    modelExtraction,
    reply,
    run,
    skippedSteps: draft.skippedSteps,
    sourceLabel,
    summaryFacts: mergeTextAgentDraftFacts(
      { facts: profileCoverageFacts, skippedSteps: [] },
      draft.facts,
    ).facts,
    thread,
    userId,
    validationNotice,
  });
}

async function executeProfileActionsFromExtraction(
  supabase: SupabaseServiceClient,
  {
    body,
    currentDraft,
    message,
    metadata,
    modelExtraction,
    reply,
    run,
    sourceLabel,
    thread,
    userId,
    validationNotice,
  }: {
    body: string;
    currentDraft: TextAgentDraftState;
    message: TableRow<"text_messages">;
    metadata: TextProfileImportExtractionMetadata;
    modelExtraction: TextAgentModelExtraction;
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    sourceLabel?: string;
    thread: TableRow<"text_threads">;
    userId: string;
    validationNotice?: string;
  },
): Promise<{ handled: boolean }> {
  const actions = modelExtraction.profileActions.filter(
    (action) => action.confidence >= 0.5,
  );
  if (actions.length === 0) {
    return { handled: false };
  }

  const appliedFacts: TextProfileFact[] = [];
  const appliedSummaries: string[] = [];
  const actionWarnings: string[] = [];
  const applicablePlans: Array<{
    plan: Awaited<ReturnType<typeof buildProfileActionToolPlan>>;
    provider: ReturnType<typeof readTextProviderForRow>;
  }> = [];

  const actionPlans = await Promise.all(
    actions.map(async (action) => ({
      action,
      plan: await buildProfileActionToolPlan(supabase, {
        action,
        body,
        userId,
      }),
    })),
  );

  const clarifyingAction = actionPlans.find(({ plan }) => plan.clarifyingReply);
  if (clarifyingAction?.plan.clarifyingReply) {
    await Promise.all([
      updateTextThreadSummary(supabase, {
        extraction: modelExtraction,
        facts: currentDraft.facts,
        messageId: message.id,
        skippedSteps: currentDraft.skippedSteps,
        threadId: thread.id,
        userId,
      }),
      completeAgentRun(
        supabase,
        run.id,
        "Profile action needs clarification.",
        "clarification_needed",
        {
          estimatedCostUsd: modelExtraction.costUsd,
          extractionResult: {
            ...modelExtraction.extraction,
            action: clarifyingAction.action,
            tool: "profile_slot_edit",
          },
          inputTokens: modelExtraction.inputTokens,
          latencyMs: modelExtraction.latencyMs,
          limitBucket: run.limit_bucket,
          model: modelExtraction.model,
          outputTokens: modelExtraction.outputTokens,
          provider: modelExtraction.provider ?? metadata.extractor ?? null,
        },
      ),
    ]);
    await reply(clarifyingAction.plan.clarifyingReply, "profile_prompt");
    return { handled: true };
  }

  for (const { action, plan } of actionPlans) {

    if (!plan.revokeKeys.length) {
      actionWarnings.push(`Skipped unsupported profile action slot: ${action.slot}.`);
      continue;
    }

    applicablePlans.push({
      plan,
      provider: readTextProviderForRow(message.provider),
    });
    appliedFacts.push(...plan.facts);
    appliedSummaries.push(plan.summary);
  }

  if (appliedSummaries.length === 0) {
    return { handled: false };
  }

  await Promise.all(
    applicablePlans.map(({ plan, provider }) =>
      applyProfileSlotEditForUserId(
        userId,
        {
          facts: plan.facts.map(textProfileFactToImportFact),
          method: "text_message",
          payload: buildProfileImportPayloadFromText(body, plan.facts, {
            extractor: "kinfolk_tool",
            model: "profile-action-tool",
            source: textProfileImportSourceForTransport(provider),
            warnings: [
              ...(metadata.warnings ?? []),
              "profile_action_tool",
              ...actionWarnings,
            ],
          }),
          provider,
          revokeKeys: plan.revokeKeys,
          sourceLabel: sourceLabel ?? `Text from ${message.from_phone_e164}`,
        },
        { refreshMatchingState: "deferred", snapshotMode: "none" },
      ),
    ),
  );

  await Promise.all([
    updateTextThreadSummary(supabase, {
      extraction: modelExtraction,
      facts: mergeTextAgentDraftFacts(currentDraft, appliedFacts).facts,
      messageId: message.id,
      skippedSteps: currentDraft.skippedSteps,
      threadId: thread.id,
      userId,
    }),
    completeAgentRun(
      supabase,
      run.id,
      "Profile actions executed.",
      "allowed_low_risk",
      {
        estimatedCostUsd: modelExtraction.costUsd,
        extractionResult: {
          ...modelExtraction.extraction,
          applied_facts: appliedFacts,
          applied_summaries: appliedSummaries,
          tool: "profile_slot_edit",
          warnings: [
            ...modelExtraction.extraction.warnings,
            ...actionWarnings,
          ],
        },
        inputTokens: modelExtraction.inputTokens,
        latencyMs: modelExtraction.latencyMs,
        limitBucket: run.limit_bucket,
        model: modelExtraction.model,
        outputTokens: modelExtraction.outputTokens,
        provider: modelExtraction.provider ?? metadata.extractor ?? null,
      },
    ),
  ]);

  const actionSummary =
    appliedFacts.length > 0
      ? summarizeTextProfileFacts(appliedFacts)
      : appliedSummaries.join("\n");
  const correctionReply = isTextProfileCorrectionMessage(body)
    ? buildCorrectionConfirmationReply(appliedFacts)
    : null;
  await reply(
    [
      validationNotice,
      correctionReply ?? `Done - ${formatProfileActionSummaries(appliedSummaries)}.`,
      !correctionReply && appliedFacts.length > 0 ? actionSummary : null,
      "Reply REVIEW to open Kinfolk.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    "approve",
  );

  return { handled: true };
}
