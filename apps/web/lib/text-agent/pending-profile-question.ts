import "server-only";

import { summarizeTextProfileFacts } from "@/lib/text-agent";
import { isTextAgentSkipReply } from "@/lib/text-agent/fact-utils";
import { buildProposalExtraction } from "@/lib/text-agent/profile-intake-flow";
import { persistIncrementalTextProfileFactsNow } from "@/lib/text-agent/profile-persistence";
import { completeAgentRun } from "@/lib/text-agent/run-data";
import { jsonObjectOrEmpty } from "@/lib/text-agent/store-shared";
import {
  loadPendingProfileQuestion,
  resolvePendingProfileQuestion,
} from "@/lib/text-agent/thread-data";
import type {
  SupabaseServiceClient,
  TableRow,
  TextAgentReply,
} from "@/lib/text-agent/store-types";

export async function handlePendingProfileQuestionReply(
  supabase: SupabaseServiceClient,
  {
    body,
    message,
    reply,
    run,
    thread,
    userId,
  }: {
    body: string;
    message: TableRow<"text_messages">;
    reply: TextAgentReply;
    run: { id: string; limit_bucket?: string | null };
    thread: TableRow<"text_threads">;
    userId: string;
  },
): Promise<boolean> {
  const pending = await loadPendingProfileQuestion(
    supabase,
    thread.id,
    userId,
  );
  if (!pending) {
    return false;
  }

  if (isTextAgentSkipReply(body, pending.step)) {
    await resolvePendingProfileQuestion(supabase, {
      notificationId: pending.notificationId,
      resolution: "skipped",
      threadId: thread.id,
      userId,
    });
    await completeAgentRun(
      supabase,
      run.id,
      "Skipped one proactive profile question.",
      "allowed_low_risk",
      {
        extractionResult: {
          skipped_step: pending.step,
          source: "pending_profile_question",
        },
        limitBucket: run.limit_bucket,
        model: null,
        provider: "kinfolk_tool",
      },
    );
    await reply("No problem, I'll leave that one blank.", "profile_update");
    return true;
  }

  const extraction = await buildProposalExtraction(supabase, {
    body,
    currentStep: pending.step,
    runId: run.id,
    threadId: thread.id,
    userId,
  });

  if ("rateLimited" in extraction) {
    await dismissPendingAfterExtractionFailure(supabase, {
      notificationId: pending.notificationId,
      outcome: "rate_limited",
      resultSummary: "Proactive profile answer hit the model rate limit.",
      run,
      threadId: thread.id,
      userId,
    });
    await reply(
      "I couldn't save that profile answer right now, so I left your profile unchanged.",
      "rate_limited",
    );
    return true;
  }

  if ("unavailable" in extraction) {
    await dismissPendingAfterExtractionFailure(supabase, {
      notificationId: pending.notificationId,
      outcome: "error",
      resultSummary: "Proactive profile answer extraction was unavailable.",
      run,
      threadId: thread.id,
      userId,
    });
    await reply(
      "I couldn't save that profile answer right now, so I left your profile unchanged.",
      "error",
    );
    return true;
  }

  const messagePayload = jsonObjectOrEmpty(message.raw_payload);
  const alreadyPersistedThisMessage =
    messagePayload.incremental_profile_thread_id === thread.id;
  const persistence = alreadyPersistedThisMessage
    ? {
        failedFacts: [],
        failureMessage: null,
        persistedFacts: extraction.facts,
        skippedSensitiveFacts: [],
      }
    : extraction.facts.length > 0
      ? await persistIncrementalTextProfileFactsNow(supabase, {
          body,
          facts: extraction.facts,
          message,
          metadata: extraction.metadata,
          sourceLabel: `Proactive profile question from ${message.from_phone_e164}`,
          thread,
          userId,
        })
      : {
          failedFacts: [],
          failureMessage: null,
          persistedFacts: [],
          skippedSensitiveFacts: [],
        };

  if (persistence.failedFacts.length > 0) {
    await dismissPendingAfterExtractionFailure(supabase, {
      notificationId: pending.notificationId,
      outcome: "error",
      resultSummary: "Proactive profile answer persistence failed.",
      run,
      threadId: thread.id,
      userId,
    });
    await reply(
      "I couldn't save that profile answer right now, so I left your profile unchanged.",
      "error",
    );
    return true;
  }

  await resolvePendingProfileQuestion(supabase, {
    notificationId: pending.notificationId,
    resolution: "answered",
    threadId: thread.id,
    userId,
  });
  await completeAgentRun(
    supabase,
    run.id,
    persistence.persistedFacts.length > 0
      ? "Saved one scoped proactive profile answer."
      : "Handled one proactive profile answer without saving matching facts.",
    persistence.persistedFacts.length > 0
      ? "allowed_low_risk"
      : extraction.validationReply ||
          persistence.skippedSensitiveFacts.length > 0
        ? "blocked_protected"
        : "unsupported",
    {
      estimatedCostUsd: extraction.modelExtraction.costUsd,
      extractionResult: {
        ...extraction.modelExtraction.extraction,
        pending_profile_question_step: pending.step,
      },
      inputTokens: extraction.modelExtraction.inputTokens,
      latencyMs: extraction.modelExtraction.latencyMs,
      limitBucket: run.limit_bucket,
      model: extraction.modelExtraction.model,
      outputTokens: extraction.modelExtraction.outputTokens,
      provider: extraction.modelExtraction.provider,
    },
  );

  const savedSummary = summarizeTextProfileFacts(persistence.persistedFacts);
  if (savedSummary) {
    await reply(`Got it - I saved ${savedSummary}.`, "profile_update");
  } else if (
    extraction.validationReply ||
    persistence.skippedSensitiveFacts.length > 0
  ) {
    await reply(
      extraction.validationReply ??
        "I left that out of matching. Kinfolk only uses non-sensitive housing and roommate preferences here.",
      "profile_update",
    );
  } else {
    await reply(
      "Got it. I couldn't turn that into a matching preference, so I left your profile unchanged.",
      "profile_update",
    );
  }
  return true;
}

async function dismissPendingAfterExtractionFailure(
  supabase: SupabaseServiceClient,
  {
    notificationId,
    outcome,
    resultSummary,
    run,
    threadId,
    userId,
  }: {
    notificationId: string;
    outcome: "error" | "rate_limited";
    resultSummary: string;
    run: { id: string; limit_bucket?: string | null };
    threadId: string;
    userId: string;
  },
) {
  await resolvePendingProfileQuestion(supabase, {
    notificationId,
    resolution: "dismissed",
    threadId,
    userId,
  });
  await completeAgentRun(supabase, run.id, resultSummary, outcome, {
    limitBucket: run.limit_bucket,
  });
}
