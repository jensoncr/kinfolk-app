import "server-only";
import { startMatchingInterviewForUser } from "@/lib/text-agent/interview-state";
import { runLiveHousingAgentReply } from "@/lib/text-agent/loop";
import { handlePendingProfileQuestionReply } from "@/lib/text-agent/pending-profile-question";
import { readableErrorMessage } from "@/lib/text-agent/profile-persistence";
import { shouldPrioritizeFreshProfileIntake } from "@/lib/text-agent/profile-intake-flow";
import { proposeProfileUpdateFromMessage } from "@/lib/text-agent/profile-updates";
import { sendAndRecordReply, startTextTypingHeartbeat } from "@/lib/text-agent/reply-send";
import { completeAgentRun, failAgentRun } from "@/lib/text-agent/run-data";
import { notifyFounder } from "@/lib/shared/alerts";
import { clampInteger } from "@/lib/shared/numbers";
import { normalizePhoneE164 } from "@/lib/shared/phone";
import { readTextProviderForRow } from "@/lib/integrations/text-transport";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SupabaseServiceClient, TableRow, TextAgentReply } from "@/lib/text-agent/store-types";

const maxTextAgentRunAttempts = 3;

// A running run is requeued only when it is BOTH older than this AND its
// liveness heartbeat has gone silent (see staleTextAgentHeartbeatMinutes) —
// a legitimately slow live loop keeps beating and is never requeued for age.
const staleTextAgentRunMinutes = 10;

// While the queue worker processes a claimed run it touches updated_at on
// this cadence. The stale sweep and the per-thread claim gate treat a running
// run as alive while its last beat is fresher than the staleness window.
// Runs created inline by the webhook never beat; they finish fast and stay
// protected by the started_at window instead.
const textAgentRunHeartbeatMs = 45 * 1000;

const staleTextAgentHeartbeatMinutes = 3;

// A queued run older than this was never picked up by the webhook's after()
// drain — the cron sweep claims it. A backlog of them means drainage is down.
const staleQueuedTextAgentRunSeconds = 60;

const queuedTextAgentBacklogAlertThreshold = 3;

type ProcessTextAgentRunsOptions = {
  dryRun?: boolean;
};

export async function processTextAgentRuns(
  limit: unknown = 5,
  options: ProcessTextAgentRunsOptions = {},
) {
  const supabase = createSupabaseServiceClient();
  const safeLimit = clampInteger(
    typeof limit === "number" ? Math.floor(limit) : limit,
    5,
    1,
    25,
  );

  if (options.dryRun) {
    const nowIso = new Date().toISOString();
    const staleQueued = await countStaleQueuedTextAgentRuns(supabase, nowIso);
    const queued = await readDueQueuedTextAgentRuns(supabase, nowIso, safeLimit);
    return {
      claimed: 0,
      completed: 0,
      dryRun: true,
      failed: 0,
      queued: queued.length,
      skipped: 0,
      staleQueued,
      superseded: 0,
      wouldAlertBacklog: staleQueued > queuedTextAgentBacklogAlertThreshold,
    };
  }

  await requeueStaleTextAgentRuns(supabase);
  const nowIso = new Date().toISOString();
  const staleQueued = await countStaleQueuedTextAgentRuns(supabase, nowIso);
  const queued = await readDueQueuedTextAgentRuns(supabase, nowIso, safeLimit);
  if (staleQueued > queuedTextAgentBacklogAlertThreshold) {
    await notifyTextAgentQueueFounder("text_agent_queue_backlog", {
      detail: `${staleQueued} runs queued for over ${staleQueuedTextAgentRunSeconds}s — webhook drainage may be failing.`,
    });
  }

  const result = {
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    staleQueued,
    superseded: 0,
  };
  const visitedRunIds = new Set<string>();

  const resolveQueuedRun = (
    run: TableRow<"text_agent_runs">,
  ): TableRow<"text_agent_runs"> =>
    queued.find((candidate) => candidate.id === run.id) ?? run;

  const processRun = async (run: TableRow<"text_agent_runs">): Promise<void> => {
    if (visitedRunIds.has(run.id)) {
      return;
    }
    visitedRunIds.add(run.id);

    const decision = await decideThreadClaim(supabase, run);
    result.superseded += decision.supersededCount;
    if (decision.action === "blocked") {
      // Stays queued — the minute cron and the next webhook's after() drain
      // retry it once the in-flight run for this thread finishes or goes
      // heartbeat-stale.
      result.skipped += 1;
      return;
    }
    if (decision.action === "superseded") {
      if (decision.nextRun) {
        await processRun(resolveQueuedRun(decision.nextRun));
      }
      return;
    }

    const claimed = await claimTextAgentRun(supabase, run);
    if (!claimed) {
      result.skipped += 1;
      return;
    }

    result.claimed += 1;
    const stopHeartbeat = startTextAgentRunHeartbeat(supabase, claimed.id);
    try {
      await processQueuedTextAgentRun(supabase, claimed);
      result.completed += 1;
    } catch (error) {
      const message = readableErrorMessage(error);
      console.error("[text-agent-queue] queued run failed", {
        attempt: claimed.attempt_count,
        error: message,
        runId: claimed.id,
      });
      if (claimed.attempt_count < maxTextAgentRunAttempts) {
        await scheduleAgentRunRetry(supabase, claimed, message);
        result.skipped += 1;
      } else {
        result.failed += 1;
        await failAgentRun(supabase, claimed.id, message);
        await notifyTextAgentQueueFounder("text_agent_run_failed", {
          detail: message,
          runId: claimed.id,
          threadId: claimed.thread_id,
        });
      }
    } finally {
      stopHeartbeat();
    }
  };

  const processNextRun = async (index: number): Promise<void> => {
    const run = queued[index];
    if (!run) return;

    await processRun(run);
    return processNextRun(index + 1);
  };

  await processNextRun(0);

  return result;
}

async function notifyTextAgentQueueFounder(
  reason: string,
  context: Parameters<typeof notifyFounder>[1],
) {
  try {
    await notifyFounder(reason, context);
  } catch (error) {
    console.error("[text-agent-queue] founder notification failed", {
      error: readableErrorMessage(error),
      reason,
      runId: context?.runId ?? null,
      threadId: context?.threadId ?? null,
    });
  }
}

async function readDueQueuedTextAgentRuns(
  supabase: SupabaseServiceClient,
  nowIso: string,
  limit: number,
) {
  const queued = await supabase
    .from("text_agent_runs")
    .select("*")
    .eq("run_status", "queued")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("queued_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (queued.error) {
    throw queued.error;
  }

  return queued.data ?? [];
}

// Best-effort depth gauge: a count failure must not block the drain itself —
// if the table is truly unreachable, the queued select right after will throw
// and the jobs route alerts on that instead.
async function countStaleQueuedTextAgentRuns(
  supabase: SupabaseServiceClient,
  nowIso: string,
) {
  const cutoff = new Date(
    Date.now() - staleQueuedTextAgentRunSeconds * 1000,
  ).toISOString();
  const result = await supabase
    .from("text_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("run_status", "queued")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .lt("queued_at", cutoff);

  if (result.error) {
    console.error("[text-agent-queue] stale queued count failed", {
      error: result.error.message,
    });
    return 0;
  }

  return result.count ?? 0;
}

async function requeueStaleTextAgentRuns(supabase: SupabaseServiceClient) {
  const startedCutoff = new Date(
    Date.now() - staleTextAgentRunMinutes * 60 * 1000,
  ).toISOString();
  const heartbeatCutoff = new Date(
    Date.now() - staleTextAgentHeartbeatMinutes * 60 * 1000,
  ).toISOString();
  const now = new Date().toISOString();
  // Requeue only runs that are BOTH old and heartbeat-silent. A live multi-
  // round loop keeps refreshing updated_at, so it is never requeued merely
  // for being old — that used to burn duplicate model calls.
  const result = await supabase
    .from("text_agent_runs")
    .update({
      error_message: "Retrying stale running text agent job.",
      next_retry_at: now,
      queued_at: now,
      run_status: "queued",
      started_at: null,
    })
    .eq("run_status", "running")
    .lt("started_at", startedCutoff)
    .lt("updated_at", heartbeatCutoff)
    .lt("attempt_count", maxTextAgentRunAttempts);

  if (result.error) {
    throw result.error;
  }
}

async function scheduleAgentRunRetry(
  supabase: SupabaseServiceClient,
  run: TableRow<"text_agent_runs">,
  errorMessage: string,
) {
  const delaySeconds = Math.min(60 * 5, 15 * 2 ** Math.max(0, run.attempt_count - 1));
  const result = await supabase
    .from("text_agent_runs")
    .update({
      error_message: errorMessage,
      next_retry_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      queued_at: new Date().toISOString(),
      run_status: "queued",
    })
    .eq("id", run.id)
    .eq("run_status", "running");

  if (result.error) {
    throw result.error;
  }
}

type ThreadClaimDecision = {
  action: "blocked" | "claim" | "superseded";
  nextRun?: TableRow<"text_agent_runs"> | null;
  supersededCount: number;
};

// Multi-bubble texts each create a run, and the claim CAS alone is per-run.
// Claiming is therefore serialized per thread — never start a second loop
// while one is actively running over an older history prefix — and a burst of
// queued runs coalesces into its newest one: that run's loop sees the full
// inbound history (earlier bubbles included), so one coherent reply answers
// the whole burst. Older queued runs are marked ignored and never reply.
async function decideThreadClaim(
  supabase: SupabaseServiceClient,
  run: TableRow<"text_agent_runs">,
): Promise<ThreadClaimDecision> {
  if (!run.thread_id) {
    return { action: "claim", nextRun: null, supersededCount: 0 };
  }

  const siblings = await supabase
    .from("text_agent_runs")
    .select("*")
    .eq("thread_id", run.thread_id)
    .in("run_status", ["queued", "running"]);

  if (siblings.error) {
    throw siblings.error;
  }

  const heartbeatCutoffMs =
    Date.now() - staleTextAgentHeartbeatMinutes * 60 * 1000;
  const others = (siblings.data ?? []).filter((row) => row.id !== run.id);
  const hasActiveRun = others.some(
    (row) =>
      row.run_status === "running" &&
      Date.parse(row.updated_at) >= heartbeatCutoffMs,
  );
  if (hasActiveRun) {
    return { action: "blocked", nextRun: null, supersededCount: 0 };
  }

  const queuedSiblings = others.filter((row) => row.run_status === "queued");
  // Only DUE siblings may be picked as the burst owner: a failure-requeued
  // run has a fresh queued_at (often the newest) but a future next_retry_at —
  // claiming it here would bypass its backoff and supersede a fresh user
  // message's run. Not-due runs can still be superseded below.
  const nowMs = Date.now();
  const dueQueuedSiblings = queuedSiblings.filter(
    (row) => !row.next_retry_at || timestampMs(row.next_retry_at) <= nowMs,
  );
  const newestQueuedSibling = dueQueuedSiblings.reduce<
    (typeof dueQueuedSiblings)[number] | null
  >(
    (newest, row) =>
      !newest || compareTextAgentRunBurstOrder(row, newest) > 0
        ? row
        : newest,
    null,
  );

  if (
    newestQueuedSibling &&
    compareTextAgentRunBurstOrder(newestQueuedSibling, run) > 0
  ) {
    return {
      action: "superseded",
      nextRun: newestQueuedSibling as TableRow<"text_agent_runs">,
      supersededCount: await supersedeQueuedTextAgentRunsBefore(
        supabase,
        run.thread_id,
        newestQueuedSibling,
        [run, ...queuedSiblings],
      ),
    };
  }

  const hasOlderQueuedSibling = queuedSiblings.some(
    (row) => compareTextAgentRunBurstOrder(row, run) < 0,
  );
  return {
    action: "claim",
    nextRun: null,
    supersededCount: hasOlderQueuedSibling
      ? await supersedeQueuedTextAgentRunsBefore(
          supabase,
          run.thread_id,
          run,
          queuedSiblings,
        )
      : 0,
  };
}

function compareTextAgentRunBurstOrder(
  left: TableRow<"text_agent_runs">,
  right: TableRow<"text_agent_runs">,
) {
  const leftQueuedAt = timestampMs(left.queued_at);
  const rightQueuedAt = timestampMs(right.queued_at);
  if (leftQueuedAt !== rightQueuedAt) {
    return leftQueuedAt - rightQueuedAt;
  }

  const leftCreatedAt = timestampMs(left.created_at);
  const rightCreatedAt = timestampMs(right.created_at);
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return left.id.localeCompare(right.id);
}

function timestampMs(value: string | null) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

// Idempotent: the run_status guard means a concurrently claimed or already
// superseded run is left alone, and superseded runs complete without ever
// reaching the reply path.
async function supersedeQueuedTextAgentRunsBefore(
  supabase: SupabaseServiceClient,
  threadId: string,
  newestRun: TableRow<"text_agent_runs">,
  queuedSiblings: Array<TableRow<"text_agent_runs">>,
) {
  const supersededRunIds = queuedSiblings
    .filter(
      (row) =>
        row.id !== newestRun.id &&
        compareTextAgentRunBurstOrder(row, newestRun) < 0,
    )
    .map((row) => row.id);
  if (supersededRunIds.length === 0) {
    return 0;
  }

  const result = await supabase
    .from("text_agent_runs")
    .update({
      completed_at: new Date().toISOString(),
      result_summary:
        "Superseded by a newer message in this thread; the newest run replies to the whole burst.",
      run_status: "ignored",
    })
    .eq("thread_id", threadId)
    .eq("run_status", "queued")
    .in("id", supersededRunIds)
    .select("id");

  if (result.error) {
    throw result.error;
  }

  return result.data?.length ?? 0;
}

async function claimTextAgentRun(
  supabase: SupabaseServiceClient,
  run: TableRow<"text_agent_runs">,
) {
  const now = new Date().toISOString();
  const result = await supabase
    .from("text_agent_runs")
    .update({
      attempt_count: run.attempt_count + 1,
      run_status: "running",
      started_at: now,
      updated_at: now,
    })
    .eq("id", run.id)
    .eq("run_status", "queued")
    .select("*")
    .maybeSingle();

  // The one-running-per-thread partial unique index is the DB backstop for
  // the read-then-CAS serialization: losing to it means another worker's live
  // loop owns the thread right now — a lost race, not an error.
  if (result.error && result.error.code === "23505") {
    return null;
  }

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

// Liveness heartbeat for a claimed run: refresh updated_at so the stale sweep
// and the per-thread claim gate can tell "alive but slow" (four tool rounds
// plus retries) from "worker died mid-run".
function startTextAgentRunHeartbeat(
  supabase: SupabaseServiceClient,
  runId: string,
) {
  const interval = setInterval(() => {
    void beatTextAgentRunHeartbeat(supabase, runId);
  }, textAgentRunHeartbeatMs);
  return () => clearInterval(interval);
}

async function beatTextAgentRunHeartbeat(
  supabase: SupabaseServiceClient,
  runId: string,
) {
  try {
    const result = await supabase
      .from("text_agent_runs")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("run_status", "running");
    if (result.error) {
      throw result.error;
    }
  } catch (error) {
    // Best-effort: a missed beat only risks an early requeue, never a crash.
    console.error("[text-agent-queue] run heartbeat failed", {
      error: readableErrorMessage(error),
      runId,
    });
  }
}

async function processQueuedTextAgentRun(
  supabase: SupabaseServiceClient,
  run: TableRow<"text_agent_runs">,
) {
  if (run.intent !== "profile_update") {
    await completeAgentRun(
      supabase,
      run.id,
      "Queued run had no model-eligible intent.",
      "unsupported",
    );
    return;
  }

  if (!run.message_id || !run.thread_id) {
    await completeAgentRun(
      supabase,
      run.id,
      "Queued run missing message or thread.",
      "error",
    );
    return;
  }

  const [messageResult, threadResult] = await Promise.all([
    supabase
      .from("text_messages")
      .select("*")
      .eq("id", run.message_id)
      .single(),
    supabase.from("text_threads").select("*").eq("id", run.thread_id).single(),
  ]);

  if (messageResult.error) {
    throw messageResult.error;
  }

  if (threadResult.error) {
    throw threadResult.error;
  }

  const message = messageResult.data;
  const thread = threadResult.data;
  const userId = run.user_id ?? message.user_id;

  if (!userId) {
    await completeAgentRun(
      supabase,
      run.id,
      "Queued run missing user.",
      "unsupported",
    );
    return;
  }

  const recipientPhone = normalizePhoneE164(message.from_phone_e164);
  if (!recipientPhone) {
    await completeAgentRun(
      supabase,
      run.id,
      "Queued run missing sender phone.",
      "error",
    );
    return;
  }

  const reply: TextAgentReply = (body, intentOverride, mediaUrls) =>
    sendAndRecordReply(supabase, {
      body,
      chatId: message.provider_chat_id ?? thread.provider_chat_id ?? "",
      intent: intentOverride ?? run.intent,
      mediaUrls,
      phoneNumberId: message.phone_number_id,
      sourceMessageId: message.provider_message_id ?? message.id,
      thread,
      to: recipientPhone,
      userId,
    });

  const stopTyping = startTextTypingHeartbeat({
    chatId: message.provider_chat_id ?? thread.provider_chat_id,
    provider: readTextProviderForRow(thread.provider),
    to: recipientPhone,
  });

  try {
    if (
      await handlePendingProfileQuestionReply(supabase, {
        body: message.body,
        message,
        reply,
        run,
        thread,
        userId,
      })
    ) {
      return;
    }

    if (
      await shouldPrioritizeFreshProfileIntake(supabase, {
        body: message.body,
        threadId: thread.id,
        userId,
      })
    ) {
      await startMatchingInterviewForUser(supabase, userId);
      await proposeProfileUpdateFromMessage(supabase, {
        body: message.body,
        message,
        reply,
        run,
        thread,
        userId,
      });
      return;
    }

    // One charming agent in a bounded tool loop owns the live reply for
    // returning users. It writes its own prose, honors free-form modifiers, and
    // grounds claims in tools.
    await runLiveHousingAgentReply(supabase, {
      body: message.body,
      message,
      reply,
      runId: run.id,
      thread,
      userId,
    });
  } finally {
    stopTyping();
  }
}
