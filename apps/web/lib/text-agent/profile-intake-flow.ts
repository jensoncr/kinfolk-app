import "server-only";
import { textAgentIntakeNoDetailsCopy, textAgentIntakeWrapCopy } from "./copy";
import { buildTextAgentProfileQuestion } from "@/lib/text-agent";
import { buildCorrectionProfileActions, isTextProfileCorrectionMessage } from "@/lib/text-agent/corrections";
import { extractTextProfileFactsWithModel, isTextAgentModelConfigured, textAgentModel, textAgentProvider } from "@/lib/text-agent/extraction";
import { buildIntakeControlResult, canAutoPersistAllTextFacts, isTextAgentSkipReply, loadRecentTextMessages, mergeTextAgentDraftFacts, nextTextAgentIntakeStepFromDraftWithCoverage, readNextIntakeStepFromSummary, readTextAgentDraftState, validateTextProfileFacts } from "@/lib/text-agent/fact-utils";
import { hasActiveMatchingInterview } from "@/lib/text-agent/interview-state";
import { completeLowRiskTextProfileUpdate, completeProfileEnrichmentHandoffFromText, createProfileUpdateProposalFromFacts, readableErrorMessage, shouldOfferProfileEnrichmentHandoff } from "@/lib/text-agent/profile-persistence";
import { hitTextAgentRateLimit } from "@/lib/text-agent/rate-limit";
import { completeAgentRun, updateAgentRunMetadata } from "@/lib/text-agent/run-data";
import { loadThreadSummary, loadUserTextAgentCoverageFacts, updateTextThreadSummary } from "@/lib/text-agent/thread-data";
import { looksLikeFreshProfileIntakeMessage } from "@/lib/text-agent/tools";
import type { TextAgentIntakeStep, TextProfileFact, TextProfileImportExtractionMetadata } from "@/lib/text-agent";
import type { TextAgentModelExtraction, TextAgentProfileAction } from "@/lib/text-agent/extraction";
import type { ProposalExtractionResult, SupabaseServiceClient, TableRow, TextAgentDraftState, TextAgentReply } from "@/lib/text-agent/store-types";

const maxModelRunsPerUserDay = 100;

export async function shouldPrioritizeFreshProfileIntake(
  supabase: SupabaseServiceClient,
  {
    body,
    threadId,
    userId,
  }: {
    body: string;
    threadId: string;
    userId: string;
  },
) {
  if (!looksLikeFreshProfileIntakeMessage(body)) {
    return false;
  }

  const [threadSummary, activeMatchingInterview, profileCoverageFacts] =
    await Promise.all([
      loadThreadSummary(supabase, threadId, userId),
      hasActiveMatchingInterview(supabase, userId),
      loadUserTextAgentCoverageFacts(supabase, userId),
    ]);
  const draft = readTextAgentDraftState(threadSummary);

  return (
    !readNextIntakeStepFromSummary(threadSummary) &&
    !activeMatchingInterview &&
    draft.facts.length === 0 &&
    draft.skippedSteps.length === 0 &&
    profileCoverageFacts.length === 0
  );
}

export async function handleIntakeControlReply(
  supabase: SupabaseServiceClient,
  {
    body,
    currentDraft,
    currentStep,
    enrichmentHintSteps,
    activeMatchingInterview,
    message,
    profileCoverageFacts,
    reply,
    run,
    thread,
    userId,
  }: {
    body: string;
    currentDraft: TextAgentDraftState;
    currentStep: TextAgentIntakeStep;
    enrichmentHintSteps?: TextAgentIntakeStep[];
    activeMatchingInterview?: boolean;
    message: TableRow<"text_messages">;
    profileCoverageFacts?: TextProfileFact[];
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    thread: TableRow<"text_threads">;
    userId: string;
  },
): Promise<{ handled: boolean }> {
  const result = buildIntakeControlResult(body, currentStep);

  if (!result?.skipped) {
    return { handled: false };
  }

  const draft: TextAgentDraftState = {
    facts: currentDraft.facts,
    skippedSteps: [...new Set([...currentDraft.skippedSteps, currentStep])],
  };
  const nextStep = nextTextAgentIntakeStepFromDraftWithCoverage(
    draft,
    profileCoverageFacts,
    enrichmentHintSteps,
  );

  if (
    shouldOfferProfileEnrichmentHandoff({
      activeMatchingInterview,
      draft,
      nextStep,
      profileCoverageFacts,
      suppressHandoff: isTextProfileCorrectionMessage(body),
    })
  ) {
    await completeProfileEnrichmentHandoffFromText(supabase, {
      body,
      draft,
      message,
      metadata: { extractor: "kinfolk_tool", model: null },
      profileCoverageFacts,
      reply,
      run,
      thread,
      userId,
    });
    return { handled: true };
  }

  await Promise.all([
    updateTextThreadSummary(supabase, {
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
      nextStep
        ? "Skipped intake question and asked the next one."
        : "Skipped final intake question.",
      nextStep ? "clarification_needed" : "allowed_low_risk",
      {
        extractionResult: {
          intent: "skip",
          skipped_step: currentStep,
          source: "text_control_reply",
        },
        limitBucket: run.limit_bucket,
        model: null,
        provider: "kinfolk_tool",
      },
    ),
  ]);
  await reply(
    nextStep
      ? `${result.replyPrefix} ${buildTextAgentProfileQuestion(nextStep)}`
      : `${result.replyPrefix} ${textAgentIntakeWrapCopy()}`,
    "profile_prompt",
  );

  return { handled: true };
}

export async function handleDraftSkipOrClarification(
  supabase: SupabaseServiceClient,
  {
    body,
    currentDraft,
    currentStep,
    enrichmentHintSteps,
    activeMatchingInterview,
    extraction,
    message,
    metadata,
    profileCoverageFacts,
    reply,
    run,
    sourceLabel,
    thread,
    userId,
  }: {
    body: string;
    currentDraft: TextAgentDraftState;
    currentStep: TextAgentIntakeStep;
    enrichmentHintSteps?: TextAgentIntakeStep[];
    activeMatchingInterview?: boolean;
    extraction: TextAgentModelExtraction;
    message: TableRow<"text_messages">;
    metadata: TextProfileImportExtractionMetadata;
    profileCoverageFacts?: TextProfileFact[];
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    sourceLabel?: string;
    thread: TableRow<"text_threads">;
    userId: string;
  },
): Promise<{ handled: boolean }> {
  if (!isTextAgentSkipReply(body, currentStep)) {
    return { handled: false };
  }

  const draft: TextAgentDraftState = {
    facts: currentDraft.facts,
    skippedSteps: [...new Set([...currentDraft.skippedSteps, currentStep])],
  };
  const nextStep = nextTextAgentIntakeStepFromDraftWithCoverage(
    draft,
    profileCoverageFacts,
    enrichmentHintSteps,
  );

  if (nextStep) {
    if (
      shouldOfferProfileEnrichmentHandoff({
        activeMatchingInterview,
        draft,
        nextStep,
        profileCoverageFacts,
        suppressHandoff: isTextProfileCorrectionMessage(body),
      })
    ) {
      await completeProfileEnrichmentHandoffFromText(supabase, {
        body,
        draft,
        message,
        metadata,
        modelExtraction: extraction,
        profileCoverageFacts,
        reply,
        run,
        sourceLabel,
        thread,
        userId,
      });
      return { handled: true };
    }

    const assistantReply = extraction.extraction.assistant_reply.trim();
    await Promise.all([
      updateTextThreadSummary(supabase, {
        extraction,
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
        "Skipped intake question and asked the next one.",
        "clarification_needed",
        {
          estimatedCostUsd: extraction.costUsd,
          extractionResult: extraction.extraction,
          inputTokens: extraction.inputTokens,
          latencyMs: extraction.latencyMs,
          limitBucket: run.limit_bucket,
          model: extraction.model,
          outputTokens: extraction.outputTokens,
          provider: extraction.provider ?? metadata.extractor ?? null,
        },
      ),
    ]);
    await reply(
      assistantReply ||
        `No problem, I'll skip that for now. ${buildTextAgentProfileQuestion(nextStep)}`,
      "profile_prompt",
    );
    return { handled: true };
  }

  if (draft.facts.length > 0) {
    if (canAutoPersistAllTextFacts(draft.facts)) {
      await completeLowRiskTextProfileUpdate(supabase, {
        body,
        facts: draft.facts,
        message,
        metadata,
        modelExtraction: extraction,
        reply,
        run,
        skippedSteps: draft.skippedSteps,
        sourceLabel,
        summaryFacts: mergeTextAgentDraftFacts(
          { facts: profileCoverageFacts ?? [], skippedSteps: [] },
          draft.facts,
        ).facts,
        thread,
        userId,
      });
      return { handled: true };
    }

    await createProfileUpdateProposalFromFacts(supabase, {
      autoApprove: await hasActiveMatchingInterview(supabase, userId),
      body,
      facts: draft.facts,
      message,
      metadata,
      modelExtraction: extraction,
      reply,
      run,
      skippedSteps: draft.skippedSteps,
      sourceLabel,
      summaryFacts: mergeTextAgentDraftFacts(
        { facts: profileCoverageFacts ?? [], skippedSteps: [] },
        draft.facts,
      ).facts,
      thread,
      userId,
    });
    return { handled: true };
  }

  await Promise.all([
    updateTextThreadSummary(supabase, {
      extraction,
      facts: draft.facts,
      messageId: message.id,
      skippedSteps: draft.skippedSteps,
      threadId: thread.id,
      userId,
    }),
    completeAgentRun(
      supabase,
      run.id,
      "All intake questions were skipped before any facts were collected.",
      "unsupported",
      {
        estimatedCostUsd: extraction.costUsd,
        extractionResult: extraction.extraction,
        inputTokens: extraction.inputTokens,
        latencyMs: extraction.latencyMs,
        limitBucket: run.limit_bucket,
        model: extraction.model,
        outputTokens: extraction.outputTokens,
        provider: extraction.provider ?? metadata.extractor ?? null,
      },
    ),
  ]);
  await reply(
    `${textAgentIntakeNoDetailsCopy()}\n\n${buildTextAgentProfileQuestion(currentStep, { includeIntro: true })}`,
    "profile_prompt",
  );
  return { handled: true };
}

export async function buildProposalExtraction(
  supabase: SupabaseServiceClient,
  {
    body,
    currentStep,
    runId,
    threadId,
    userId,
  }: {
    body: string;
    currentStep?: TextAgentIntakeStep | null;
    runId: string;
    threadId: string;
    userId: string;
  },
): Promise<
  | ProposalExtractionResult
  | { rateLimited: true; bucket: string }
  | { unavailable: true; reason: string }
> {
  if (!isTextAgentModelConfigured()) {
    return { unavailable: true, reason: "Missing OPENROUTER_API_KEY." };
  }

  const modelLimit = await hitTextAgentRateLimit(supabase, {
    bucketKey: userId,
    bucketType: "model_user_day",
    limit: maxModelRunsPerUserDay,
    window: "day",
  });

  if (!modelLimit.allowed) {
    return { bucket: modelLimit.bucket, rateLimited: true };
  }

  try {
    const [recentMessages, threadSummary] = await Promise.all([
      loadRecentTextMessages(supabase, threadId, userId),
      loadThreadSummary(supabase, threadId, userId),
    ]);
    const modelExtraction = await extractTextProfileFactsWithModel({
      activeIntakeStep: currentStep,
      body,
      knownPreferences: threadSummary?.known_preferences_json ?? null,
      recentMessages,
      threadId,
      userId,
    });
    const isCorrection = isTextProfileCorrectionMessage(body);
    const validation = await validateTextProfileFacts(
      supabase,
      modelExtraction.facts,
      {
        activeIntakeStep: isCorrection ? null : currentStep,
      },
    );
    const synthesizedCorrectionActions = buildCorrectionProfileActions(
      body,
      validation.facts,
    ) as TextAgentProfileAction[];
    const profileActions =
      modelExtraction.profileActions.length > 0
        ? modelExtraction.profileActions
        : synthesizedCorrectionActions;
    let effectiveModelExtraction: TextAgentModelExtraction = {
      ...modelExtraction,
      extraction: {
        ...modelExtraction.extraction,
        facts:
          validation.facts as TextAgentModelExtraction["extraction"]["facts"],
      },
      facts: validation.facts,
      profileActions,
    };
    if (
      currentStep &&
      validation.facts.length > 0 &&
      effectiveModelExtraction.extraction.intent !== "profile_update"
    ) {
      effectiveModelExtraction = {
        ...effectiveModelExtraction,
        extraction: {
          ...effectiveModelExtraction.extraction,
          clarifying_question: "",
          facts:
            validation.facts as TextAgentModelExtraction["extraction"]["facts"],
          intent: "profile_update",
          reply_kind: "confirmation",
          should_create_proposal: true,
          warnings: [
            ...effectiveModelExtraction.extraction.warnings,
            "accepted_active_intake_facts",
          ],
        },
        facts: validation.facts,
      };
    }
    const warnings = [
      ...new Set([
        ...effectiveModelExtraction.extraction.warnings,
        ...validation.warnings,
      ]),
    ];
    await updateAgentRunMetadata(supabase, runId, {
      estimatedCostUsd: effectiveModelExtraction.costUsd,
      extractionResult: {
        ...effectiveModelExtraction.extraction,
        validation_warnings: validation.warnings,
      },
      inputTokens: effectiveModelExtraction.inputTokens,
      latencyMs: effectiveModelExtraction.latencyMs,
      limitBucket: modelLimit.bucket,
      model: effectiveModelExtraction.model,
      outputTokens: effectiveModelExtraction.outputTokens,
      provider: effectiveModelExtraction.provider,
    });
    return {
      facts: validation.facts,
      metadata: {
        extractor: "openrouter",
        model: effectiveModelExtraction.model,
        warnings,
      },
      modelExtraction: effectiveModelExtraction,
      validationNotice: validation.notice,
      validationReply: validation.reply,
    };
  } catch (error) {
    const message = readableErrorMessage(error);
    await updateAgentRunMetadata(supabase, runId, {
      limitBucket: modelLimit.bucket,
      model: textAgentModel,
      provider: textAgentProvider,
      resultSummary: `Model extraction failed: ${message}`,
    });
    return { unavailable: true, reason: message };
  }
}
