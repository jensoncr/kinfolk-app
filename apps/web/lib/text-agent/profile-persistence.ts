import "server-only";
import { applyProfileSlotEditForUserId, createProfileImportForUserId, reviewProfileImportForUserId } from "@/lib/profiles/enrichment-store";
import { buildProfileImportPayloadFromText, buildTextAgentProfileEnrichmentHandoffReply, isTextAgentFoundationIntakeStep, riskLevelForTextFacts, summarizeTextProfileFacts, textAgentFoundationIntakeComplete, textProfileImportSourceForTransport } from "@/lib/text-agent";
import { autoPersistableTextFacts, mergeTextAgentDraftFacts, splitExclusiveSlotEditFacts } from "@/lib/text-agent/fact-utils";
import { hasActiveMatchingInterview, markMatchingInterviewCompleted, markMatchingInterviewNeedsReview } from "@/lib/text-agent/interview-state";
import { textProfileFactToImportFact } from "@/lib/text-agent/profile-actions";
import { refreshMatchingStateForTextProfileFacts } from "@/lib/text-agent/profile-promotion";
import { completeAgentRun } from "@/lib/text-agent/run-data";
import { getProfileEnrichmentFormUrl, jsonObjectOrEmpty } from "@/lib/text-agent/store-shared";
import { enforcePendingProposalLimit, expireSupersededPendingTextProposals, updateTextThreadSummary } from "@/lib/text-agent/thread-data";
import { readTextProviderForRow } from "@/lib/integrations/text-transport";
import { after } from "next/server";
import type { TextAgentIntakeStep, TextProfileFact, TextProfileImportExtractionMetadata } from "@/lib/text-agent";
import type { TextAgentModelExtraction } from "@/lib/text-agent/extraction";
import type { IncrementalTextProfileFactsPersistenceArgs, IncrementalTextProfileFactsPersistenceResult, SupabaseServiceClient, TableRow, TextAgentDraftState, TextAgentPolicyOutcome, TextAgentReply } from "@/lib/text-agent/store-types";
import type { Json } from "@/lib/supabase/types";

const proposalTtlHours = 24;

export async function createProfileUpdateProposalFromFacts(
  supabase: SupabaseServiceClient,
  {
    autoApprove = false,
    body,
    facts,
    message,
    metadata,
    modelExtraction,
    reply,
    run,
    skippedSteps,
    sourceLabel,
    summaryFacts,
    thread,
    userId,
    validationNotice,
  }: {
    autoApprove?: boolean;
    body: string;
    facts: TextProfileFact[];
    message: TableRow<"text_messages">;
    metadata: TextProfileImportExtractionMetadata;
    modelExtraction?: TextAgentModelExtraction;
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    skippedSteps: TextAgentIntakeStep[];
    sourceLabel?: string;
    summaryFacts?: TextProfileFact[];
    thread: TableRow<"text_threads">;
    userId: string;
    validationNotice?: string;
  },
) {
  const pendingLimit = await enforcePendingProposalLimit(supabase, {
    threadId: thread.id,
    userId,
  });
  if (!pendingLimit.allowed) {
    await completeAgentRun(
      supabase,
      run.id,
      "Pending proposal limit reached.",
      "rate_limited",
      {
        limitBucket: run.limit_bucket,
      },
    );
    await reply(
      "You already have Kinfolk profile updates waiting. Reply YES to save, EDIT to correct, or REVIEW to open Kinfolk.",
    );
    return;
  }

  const riskLevel = riskLevelForTextFacts(facts);
  const factsForSummary = summaryFacts?.length ? summaryFacts : facts;
  const summary = summarizeTextProfileFacts(factsForSummary);
  const replySummary = summarizeTextProfileFacts(facts) || summary;
  const provider = readTextProviderForRow(message.provider);
  const payload = buildProfileImportPayloadFromText(body, facts, {
    ...metadata,
    source: textProfileImportSourceForTransport(provider),
  });
  const { import: importRow } = await createProfileImportForUserId(
    userId,
    {
      method: "text_message",
      payload,
      provider,
      sourceLabel: sourceLabel ?? `Text from ${message.from_phone_e164}`,
    },
    { snapshotMode: "none" },
  );
  const proposalStatus = riskLevel === "low" ? "pending" : "needs_review";
  const proposal = await supabase
    .from("profile_update_proposals")
    .insert({
      expires_at: new Date(
        Date.now() + proposalTtlHours * 60 * 60 * 1000,
      ).toISOString(),
      patch_json: payload as Json,
      risk_level: riskLevel,
      source_import_id: importRow.id,
      status: proposalStatus,
      summary,
      thread_id: thread.id,
      user_id: userId,
    })
    .select("*")
    .single();

  if (proposal.error) {
    throw proposal.error;
  }

  await expireSupersededPendingTextProposals(supabase, {
    exceptProposalId: proposal.data.id,
    threadId: thread.id,
    userId,
  });

  const rawPayload = jsonObjectOrEmpty(message.raw_payload);
  await supabase
    .from("text_messages")
    .update({
      raw_payload: {
        ...rawPayload,
        profile_update_proposal_id: proposal.data.id,
      },
    })
    .eq("id", message.id);

  await updateTextThreadSummary(supabase, {
    extraction: modelExtraction,
    facts: factsForSummary,
    messageId: message.id,
    skippedSteps,
    threadId: thread.id,
    userId,
  });

  const policyOutcome: TextAgentPolicyOutcome =
    riskLevel === "low"
      ? "allowed_low_risk"
      : riskLevel === "medium"
        ? "needs_review_sensitive"
        : "blocked_protected";

  if (autoApprove && riskLevel === "low") {
    await reviewProfileImportForUserId(userId, importRow.id, "approve_all", {
      refreshMatchingState: refreshMatchingStateForTextProfileFacts(facts),
      snapshotMode: "none",
    });
    const [update] = await Promise.all([
      supabase
        .from("profile_update_proposals")
        .update({ approved_at: new Date().toISOString(), status: "approved" })
        .eq("id", proposal.data.id),
      markMatchingInterviewCompleted(supabase, {
        summary,
        userId,
      }),
    ]);

    if (update.error) {
      throw update.error;
    }

    await completeAgentRun(
      supabase,
      run.id,
      "Staged profile facts approved from text confirmation.",
      policyOutcome,
      {
        estimatedCostUsd: modelExtraction?.costUsd ?? null,
        extractionResult: modelExtraction?.extraction ?? {
          source: "staged_thread_facts",
        },
        inputTokens: modelExtraction?.inputTokens ?? null,
        latencyMs: modelExtraction?.latencyMs ?? null,
        limitBucket: run.limit_bucket,
        model: modelExtraction?.model ?? metadata.model ?? null,
        outputTokens: modelExtraction?.outputTokens ?? null,
        provider: modelExtraction?.provider ?? metadata.extractor ?? null,
      },
    );
    await reply(
      `Done - I saved these details to your Kinfolk profile:\n${replySummary}`,
      "approve",
    );
    return;
  }

  await markMatchingInterviewNeedsReview(supabase, {
    summary,
    userId,
  });

  await completeAgentRun(
    supabase,
    run.id,
    `Profile proposal ${proposalStatus}.`,
    policyOutcome,
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
  );

  const replyText =
    riskLevel === "low"
      ? `${validationNotice ? `${validationNotice}\n\n` : ""}I have these profile details ready:\n${replySummary}\n\nReply YES to save them, EDIT to correct them, or REVIEW to open Kinfolk.`
      : `${validationNotice ? `${validationNotice}\n\n` : ""}I found profile details that need in-app review before Kinfolk can use them:\n${replySummary}\n\nReply REVIEW to open Kinfolk.`;

  await reply(replyText, "profile_update");
}

export async function completeLowRiskTextProfileUpdate(
  supabase: SupabaseServiceClient,
  {
    body,
    facts,
    message,
    metadata,
    modelExtraction,
    reply,
    run,
    skippedSteps,
    sourceLabel,
    summaryFacts,
    thread,
    userId,
    validationNotice,
  }: {
    body: string;
    facts: TextProfileFact[];
    message: TableRow<"text_messages">;
    metadata: TextProfileImportExtractionMetadata;
    modelExtraction?: TextAgentModelExtraction;
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    skippedSteps: TextAgentIntakeStep[];
    sourceLabel?: string;
    summaryFacts?: TextProfileFact[];
    thread: TableRow<"text_threads">;
    userId: string;
    validationNotice?: string;
  },
) {
  const factsForSummary = summaryFacts?.length ? summaryFacts : facts;
  const summary = summarizeTextProfileFacts(factsForSummary);
  const replySummary = summarizeTextProfileFacts(facts) || summary;
  await persistIncrementalTextProfileFacts(
    supabase,
    {
      body,
      facts,
      message,
      metadata,
      sourceLabel,
      thread,
      userId,
    },
    {
      refreshMatchingState: refreshMatchingStateForTextProfileFacts(facts),
      snapshotMode: "none",
    },
  );
  await updateTextThreadSummary(supabase, {
    extraction: modelExtraction,
    facts: factsForSummary,
    messageId: message.id,
    skippedSteps,
    threadId: thread.id,
    userId,
  });

  if (await hasActiveMatchingInterview(supabase, userId)) {
    await markMatchingInterviewCompleted(supabase, {
      summary,
      userId,
    });
  }

  await completeAgentRun(
    supabase,
    run.id,
    "Low-risk profile facts saved incrementally.",
    "allowed_low_risk",
    {
      estimatedCostUsd: modelExtraction?.costUsd ?? null,
      extractionResult: modelExtraction?.extraction ?? {
        source: "incremental_text_persistence",
      },
      inputTokens: modelExtraction?.inputTokens ?? null,
      latencyMs: modelExtraction?.latencyMs ?? null,
      limitBucket: run.limit_bucket,
        model: modelExtraction?.model ?? metadata.model ?? null,
      outputTokens: modelExtraction?.outputTokens ?? null,
      provider: modelExtraction?.provider ?? metadata.extractor ?? null,
    },
  );

  await reply(
    [
      validationNotice,
      `Done - I saved these details to your Kinfolk profile:\n${replySummary}`,
      "Reply EDIT to correct anything, or REVIEW to open Kinfolk.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    "approve",
  );
}

export type LiveTextProfileFactsPersistenceResult = {
  failedFacts: TextProfileFact[];
  failureMessage: string | null;
  persistedFacts: TextProfileFact[];
  skippedSensitiveFacts: TextProfileFact[];
};

// Awaited variant for the live tool loop: the agent confirms saves in its own
// voice, so it must know what actually persisted, what stayed off the matching
// profile as sensitive, and what failed - before it replies.
export async function persistIncrementalTextProfileFactsNow(
  supabase: SupabaseServiceClient,
  args: IncrementalTextProfileFactsPersistenceArgs,
): Promise<LiveTextProfileFactsPersistenceResult> {
  const factsToPersist = autoPersistableTextFacts(args.facts);
  const persistable = new Set(factsToPersist);
  const skippedSensitiveFacts = args.facts.filter(
    (fact) => !persistable.has(fact),
  );

  if (factsToPersist.length === 0) {
    return {
      failedFacts: [],
      failureMessage: null,
      persistedFacts: [],
      skippedSensitiveFacts,
    };
  }

  try {
    await persistIncrementalTextProfileFacts(supabase, args, {
      refreshMatchingState:
        refreshMatchingStateForTextProfileFacts(factsToPersist),
      snapshotMode: "none",
    });
  } catch (error) {
    console.error("[text-agent] Live profile fact persistence failed.", {
      error,
      messageId: args.message.id,
      threadId: args.thread.id,
      userId: args.userId,
    });
    return {
      failedFacts: factsToPersist,
      failureMessage: readableErrorMessage(error),
      persistedFacts: [],
      skippedSensitiveFacts,
    };
  }

  return {
    failedFacts: [],
    failureMessage: null,
    persistedFacts: factsToPersist,
    skippedSensitiveFacts,
  };
}

export function deferIncrementalTextProfileFactsPersistence(
  supabase: SupabaseServiceClient,
  args: IncrementalTextProfileFactsPersistenceArgs,
): IncrementalTextProfileFactsPersistenceResult {
  const factsToPersist = autoPersistableTextFacts(args.facts);

  if (factsToPersist.length === 0) {
    return { applied: false, factCount: 0 };
  }

  scheduleTextAgentBackgroundTask(async () => {
    try {
      await persistIncrementalTextProfileFacts(supabase, args, {
        // This task already runs after the SMS response, so refresh projection inline
        // here rather than nesting another after() callback that can be skipped.
        refreshMatchingState: true,
        snapshotMode: "none",
      });
    } catch (error) {
      console.error("[text-agent] Deferred profile fact persistence failed.", {
        error,
        messageId: args.message.id,
        threadId: args.thread.id,
        userId: args.userId,
      });
    }
  });

  return {
    applied: true,
    deferred: true,
    factCount: factsToPersist.length,
  };
}

function scheduleTextAgentBackgroundTask(task: () => Promise<void>) {
  try {
    after(task);
  } catch (error) {
    console.error("[text-agent] after() unavailable; running task inline.", {
      error,
    });
    void task();
  }
}

async function persistIncrementalTextProfileFacts(
  supabase: SupabaseServiceClient,
  {
    body,
    facts,
    message,
    metadata,
    sourceLabel,
    thread,
    userId,
  }: IncrementalTextProfileFactsPersistenceArgs,
  options: {
    refreshMatchingState?: boolean | "deferred";
    snapshotMode?: "full" | "summary" | "none";
  } = {},
): Promise<IncrementalTextProfileFactsPersistenceResult> {
  const factsToPersist = autoPersistableTextFacts(facts);

  if (factsToPersist.length === 0) {
    return { applied: false, factCount: 0 };
  }

  const warnings = [
    ...(metadata.warnings ?? []),
    "incremental_text_persistence",
  ];
  const { remainingFacts, slotEdits } =
    splitExclusiveSlotEditFacts(factsToPersist);
  const importIds: string[] = [];
  const provider = readTextProviderForRow(message.provider);
  const resolvedSourceLabel =
    sourceLabel ?? `Text intake from ${message.from_phone_e164}`;

  await Promise.all(
    slotEdits.map((slotEdit) =>
      applyProfileSlotEditForUserId(
        userId,
        {
          facts: slotEdit.facts.map(textProfileFactToImportFact),
          method: "text_message",
          payload: buildProfileImportPayloadFromText(body, slotEdit.facts, {
            ...metadata,
            source: textProfileImportSourceForTransport(provider),
            warnings: [...new Set([...warnings, "profile_slot_edit_from_text"])],
          }),
          provider,
          revokeKeys: slotEdit.revokeKeys,
          sourceLabel: resolvedSourceLabel,
        },
        {
          refreshMatchingState: options.refreshMatchingState,
          snapshotMode: "none",
        },
      ),
    ),
  );

  if (remainingFacts.length > 0) {
    const { import: importRow } = await createProfileImportForUserId(
      userId,
      {
        method: "text_message",
        payload: buildProfileImportPayloadFromText(body, remainingFacts, {
          ...metadata,
          source: textProfileImportSourceForTransport(provider),
          warnings: [...new Set(warnings)],
        }),
        provider,
        sourceLabel: resolvedSourceLabel,
      },
      { snapshotMode: options.snapshotMode },
    );
    importIds.push(importRow.id);
    await reviewProfileImportForUserId(userId, importRow.id, "approve_all", {
      refreshMatchingState: options.refreshMatchingState,
      snapshotMode: options.snapshotMode,
    });
  }

  const rawPayload = jsonObjectOrEmpty(message.raw_payload);
  const update = await supabase
    .from("text_messages")
    .update({
      raw_payload: {
        ...rawPayload,
        incremental_profile_import_id: importIds.at(-1) ?? null,
        incremental_profile_import_ids: importIds,
        incremental_profile_thread_id: thread.id,
      },
    })
    .eq("id", message.id);

  if (update.error) {
    throw update.error;
  }

  return {
    applied: true,
    factCount: factsToPersist.length,
    importId: importIds.at(-1),
  };
}

export function shouldOfferProfileEnrichmentHandoff({
  activeMatchingInterview,
  draft,
  nextStep,
  profileCoverageFacts = [],
  suppressHandoff = false,
}: {
  activeMatchingInterview?: boolean;
  draft: TextAgentDraftState;
  nextStep: TextAgentIntakeStep | null;
  profileCoverageFacts?: TextProfileFact[];
  suppressHandoff?: boolean;
}) {
  if (suppressHandoff) {
    return false;
  }

  if (
    !activeMatchingInterview ||
    !nextStep ||
    isTextAgentFoundationIntakeStep(nextStep)
  ) {
    return false;
  }

  return textAgentFoundationIntakeComplete({
    facts: mergeTextAgentDraftFacts(
      { facts: profileCoverageFacts, skippedSteps: [] },
      draft.facts,
    ).facts,
    skippedSteps: draft.skippedSteps,
  });
}

export async function completeProfileEnrichmentHandoffFromText(
  supabase: SupabaseServiceClient,
  {
    body,
    draft,
    message,
    metadata,
    modelExtraction,
    profileCoverageFacts = [],
    reply,
    run,
    sourceLabel,
    thread,
    userId,
    validationNotice,
  }: {
    body: string;
    draft: TextAgentDraftState;
    message: TableRow<"text_messages">;
    metadata: TextProfileImportExtractionMetadata;
    modelExtraction?: TextAgentModelExtraction;
    profileCoverageFacts?: TextProfileFact[];
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    sourceLabel?: string;
    thread: TableRow<"text_threads">;
    userId: string;
    validationNotice?: string;
  },
) {
  const summaryFacts = mergeTextAgentDraftFacts(
    { facts: profileCoverageFacts, skippedSteps: [] },
    draft.facts,
  ).facts;
  const summary =
    summarizeTextProfileFacts(summaryFacts) ||
    "Core SMS intake complete; waiting for profile enrichment form.";
  const incrementalPersistence = deferIncrementalTextProfileFactsPersistence(
    supabase,
    {
      body,
      facts: draft.facts,
      message,
      metadata,
      sourceLabel,
      thread,
      userId,
    },
  );

  await Promise.all([
    updateTextThreadSummary(supabase, {
      extraction: modelExtraction,
      facts: summaryFacts,
      lastIntent: "profile_enrichment_handoff",
      messageId: message.id,
      pendingAction: "profile_enrichment_form",
      skippedSteps: draft.skippedSteps,
      threadId: thread.id,
      userId,
    }),
    markMatchingInterviewNeedsReview(supabase, {
      summary,
      userId,
    }),
    completeAgentRun(
      supabase,
      run.id,
      incrementalPersistence.applied
        ? "Core SMS intake completed; queued facts and sent profile enrichment handoff."
        : "Core SMS intake completed; sent profile enrichment handoff.",
      "clarification_needed",
      {
        estimatedCostUsd: modelExtraction?.costUsd ?? null,
        extractionResult: modelExtraction?.extraction ?? {
          source: "foundation_profile_enrichment_handoff",
        },
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
      buildTextAgentProfileEnrichmentHandoffReply({
        enrichmentUrl: getProfileEnrichmentFormUrl(),
      }),
    ]
      .filter(Boolean)
      .join("\n\n"),
    "profile_prompt",
  );
}

export function readableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    const cause: string =
      errorWithCause.cause !== undefined
        ? ` cause=${readableErrorMessage(errorWithCause.cause)}`
        : "";
    return `${error.name}: ${error.message}${cause}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
