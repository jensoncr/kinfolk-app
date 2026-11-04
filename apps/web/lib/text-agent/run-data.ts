import "server-only";
import type { SupabaseServiceClient, TableRow, TextAgentPolicyOutcome } from "@/lib/text-agent/store-types";
import type { Json } from "@/lib/supabase/types";

export async function createAgentRun(
  supabase: SupabaseServiceClient,
  {
    initialStatus,
    intent,
    messageId,
    threadId,
    traceId,
    userId,
  }: {
    initialStatus: "queued" | "running";
    intent: string;
    messageId: string;
    threadId: string;
    traceId: string | null;
    userId: string | null;
  },
) {
  const result = await supabase
    .from("text_agent_runs")
    .insert({
      intent,
      message_id: messageId,
      queued_at: initialStatus === "queued" ? new Date().toISOString() : null,
      run_status: initialStatus,
      started_at: initialStatus === "running" ? new Date().toISOString() : null,
      thread_id: threadId,
      trace_id: traceId,
      user_id: userId,
    })
    .select("*")
    .single();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

export async function completeAgentRun(
  supabase: SupabaseServiceClient,
  runId: string,
  resultSummary: string,
  policyOutcome?: TextAgentPolicyOutcome | null,
  metadata: Partial<{
    estimatedCostUsd: number | null;
    extractionResult: unknown;
    inputTokens: number | null;
    latencyMs: number | null;
    limitBucket: string | null;
    model: string | null;
    outputTokens: number | null;
    provider: string | null;
  }> = {},
) {
  const update: Partial<TableRow<"text_agent_runs">> = {
    completed_at: new Date().toISOString(),
    result_summary: resultSummary,
    run_status: "completed",
  };

  if (policyOutcome !== undefined) update.policy_outcome = policyOutcome;
  if (metadata.provider !== undefined) update.provider = metadata.provider;
  if (metadata.model !== undefined) update.model = metadata.model;
  if (metadata.inputTokens !== undefined)
    update.input_tokens = metadata.inputTokens;
  if (metadata.outputTokens !== undefined)
    update.output_tokens = metadata.outputTokens;
  if (metadata.estimatedCostUsd !== undefined)
    update.estimated_cost_usd = metadata.estimatedCostUsd;
  if (metadata.latencyMs !== undefined) update.latency_ms = metadata.latencyMs;
  if (metadata.limitBucket !== undefined)
    update.limit_bucket = metadata.limitBucket;
  if (metadata.extractionResult !== undefined)
    update.extraction_result_json = metadata.extractionResult as Json;

  const result = await supabase
    .from("text_agent_runs")
    .update(update)
    .eq("id", runId);

  if (result.error) {
    throw result.error;
  }
}

export async function updateAgentRunMetadata(
  supabase: SupabaseServiceClient,
  runId: string,
  metadata: Partial<{
    estimatedCostUsd: number | null;
    extractionResult: unknown;
    inputTokens: number | null;
    latencyMs: number | null;
    limitBucket: string | null;
    model: string | null;
    outputTokens: number | null;
    policyOutcome: TextAgentPolicyOutcome | null;
    provider: string | null;
    resultSummary: string | null;
  }>,
) {
  const update: Partial<TableRow<"text_agent_runs">> = {};

  if (metadata.provider !== undefined) update.provider = metadata.provider;
  if (metadata.model !== undefined) update.model = metadata.model;
  if (metadata.inputTokens !== undefined)
    update.input_tokens = metadata.inputTokens;
  if (metadata.outputTokens !== undefined)
    update.output_tokens = metadata.outputTokens;
  if (metadata.estimatedCostUsd !== undefined)
    update.estimated_cost_usd = metadata.estimatedCostUsd;
  if (metadata.latencyMs !== undefined) update.latency_ms = metadata.latencyMs;
  if (metadata.limitBucket !== undefined)
    update.limit_bucket = metadata.limitBucket;
  if (metadata.policyOutcome !== undefined)
    update.policy_outcome = metadata.policyOutcome;
  if (metadata.resultSummary !== undefined)
    update.result_summary = metadata.resultSummary;
  if (metadata.extractionResult !== undefined)
    update.extraction_result_json = metadata.extractionResult as Json;

  if (Object.keys(update).length === 0) {
    return;
  }

  const result = await supabase
    .from("text_agent_runs")
    .update(update)
    .eq("id", runId);
  if (result.error) {
    throw result.error;
  }
}

export async function failAgentRun(
  supabase: SupabaseServiceClient,
  runId: string,
  errorMessage: string,
) {
  const result = await supabase
    .from("text_agent_runs")
    .update({
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      policy_outcome: "error",
      run_status: "failed",
    })
    .eq("id", runId);

  if (result.error) {
    throw result.error;
  }
}

export async function setPhoneConsentState(
  supabase: SupabaseServiceClient,
  userId: string,
  phone: string,
  state: "opted_in" | "opted_out",
) {
  const result = await supabase
    .from("user_phone_numbers")
    .update({
      last_opt_out_at: state === "opted_out" ? new Date().toISOString() : null,
      sms_consent_state: state,
    })
    .eq("user_id", userId)
    .eq("phone_e164", phone);

  if (result.error) {
    throw result.error;
  }
}
