import "server-only";

import { after } from "next/server";
import {
  normalizeOpenRouterModelId,
  readOpenRouterApiKey,
} from "../integrations/openrouter-client";
import { runWithAgentSpan } from "../integrations/otel-tracing";
import { captureProductEvent } from "../integrations/posthog-server";
import { firstConfiguredEnvValue } from "../shared/env";
import { completeAgentChat } from "./model-client";
import { textAgentOutageReplyCopy } from "./copy";
import { isViableRoommateMatch } from "../matching/roommate-match-viability";
import { buildListingShortlinkUrl } from "../apartments/listing-shortlink";
import { loadSoul } from "./soul";
import {
  buildIntakeGatedListingsResult,
  buildIntakeGatedMatchesResult,
  resolveActiveIntakeGate,
  resolveIntakeGateOutcome,
} from "./intake-gate";
import {
  asksAboutRoommates,
  asksForListings,
  interpretInboundMessage,
  type InboundIntent,
} from "./interpretation";
import { markMatchingInterviewCompleted } from "./interview-state";
import {
  composeOnboardingClose,
  decideOnboardingTurn,
} from "./onboarding-machine";
import {
  buildGroundedReplyFromToolResults,
  hasUnsupportedStrongUserCommitment,
  isMultiQuestionReply,
  isPersonProfileCardUrl,
  offersRoommateProfilesInsteadOfSending,
  replyRealityGuards,
  trimBundledQuestion,
} from "./reply-guards";
import type {
  TextThreadAgentMemory,
  TextThreadSentListingCard,
} from "./thread-data";
import {
  getHousingAgentToolDefinitions,
  runHousingAgentTool,
  type HousingAgentToolName,
  type HousingAgentToolContext,
  type HousingAgentToolResult,
} from "./tool-belt";
import type {
  SupabaseServiceClient,
  TableRow,
  TextAgentReply,
} from "./store-types";

type OpenRouterToolCall = {
  function?: {
    arguments?: string | Record<string, unknown>;
    name?: string;
  };
  id?: string;
};

type OpenRouterMessage = {
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
};

type OpenRouterChatCompletion = {
  choices?: Array<{ message?: OpenRouterMessage }>;
  model?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

function accumulateAgentUsage(
  total: OpenRouterChatCompletion["usage"] | null,
  next: OpenRouterChatCompletion["usage"] | null,
): OpenRouterChatCompletion["usage"] | null {
  if (!next) return total;
  if (!total) return { ...next };
  return {
    completion_tokens:
      (total.completion_tokens ?? 0) + (next.completion_tokens ?? 0),
    prompt_tokens: (total.prompt_tokens ?? 0) + (next.prompt_tokens ?? 0),
    total_tokens: (total.total_tokens ?? 0) + (next.total_tokens ?? 0),
  };
}

type ChatMessage =
  | { content: string; role: "system" | "user" | "assistant" }
  | {
      content: string;
      role: "assistant";
      tool_calls: Array<{
        function: { arguments: string; name: string };
        id: string;
        type: "function";
      }>;
    }
  | { content: string; role: "tool"; tool_call_id: string };

export type HousingAgentToolCall = {
  args: Record<string, unknown>;
  id: string | null;
  name: string;
};

type NormalizedHousingAgentToolCall = Omit<HousingAgentToolCall, "id"> & {
  id: string;
};

type HousingAgentToolExecutionResult = {
  call: NormalizedHousingAgentToolCall;
  result: HousingAgentToolResult;
};

export type HousingAgentTurnResult =
  | {
      reason: "missing_openrouter_key";
      status: "skipped";
    }
  | {
      latencyMs: number;
      mediaUrls: string[];
      model: string;
      reply: string;
      rounds: number;
      status: "completed";
      toolCalls: HousingAgentToolCall[];
      toolResults: HousingAgentToolResult[];
      usage: OpenRouterChatCompletion["usage"] | null;
    };

// One charming agent in a bounded tool loop. The model's prose IS the reply —
// it is never post-processed into a template. Tools ground every factual claim.
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS_PER_ROUND = 4;
const RECENT_MESSAGE_TURNS = 12;
const DEFAULT_HOUSING_AGENT_MODEL = "google/gemini-3.1-flash-lite";
// The outage bubble shares the live reply's idempotency intent so an
// error-then-retry turn can deliver at most one outbound, never both.
const HOUSING_AGENT_REPLY_INTENT = "agent_reply";

/**
 * Live entry point used on the inbound reply path. Runs the deterministic
 * safety pre-gate (kept out of the model path), runs the conversational tool
 * loop, sends the model's own prose as the reply, and records the run.
 *
 * Owns the reply for returning users. Missing keys, empty replies, and model
 * errors get a small outage response instead of falling back to the retired
 * planner/template path.
 */
export async function runLiveHousingAgentReply(
  supabase: SupabaseServiceClient,
  {
    body,
    message,
    reply,
    runId,
    thread,
    userId,
  }: {
    body: string;
    message: TableRow<"text_messages">;
    reply: TextAgentReply;
    runId: string;
    thread: TableRow<"text_threads">;
    userId: string;
  },
): Promise<void> {
  if (!readOpenRouterApiKey()) {
    await sendHousingAgentUnavailableReply(supabase, {
      reason: "missing_openrouter_key",
      reply,
      runId,
      threadId: thread.id,
      userId,
    });
    return;
  }

  const factUtilsModule = import("./fact-utils");
  const [{ completeAgentRun }, tools, recentMessages] = await Promise.all([
    import("./run-data"),
    import("./tools"),
    factUtilsModule.then(({ loadRecentTextMessages }) =>
      loadRecentTextMessages(supabase, thread.id, userId),
    ),
  ]);

  // Deterministic safety spine: refuse discriminatory/fraud asks and decline
  // off-topic tasks before the model ever sees them.
  const restrictedRefusal = tools.restrictedTextAgentRefusal(body);
  if (restrictedRefusal) {
    await Promise.all([
      completeAgentRun(
        supabase,
        runId,
        "Restricted request refused.",
        "unsupported",
      ),
      reply(restrictedRefusal, "unsupported"),
    ]);
    return;
  }

  if (tools.isOffTopicTextAgentMessage(body, recentMessages)) {
    const [{ buildTextAgentScopeDeclineReply }] = await Promise.all([
      import("./index"),
      completeAgentRun(
        supabase,
        runId,
        "Off-topic message declined.",
        "unsupported",
      ),
    ]);
    await reply(buildTextAgentScopeDeclineReply(), "unsupported");
    return;
  }

  try {
    const result = await runWithAgentSpan(
      {
        attributes: {
          "kinfolk.run_id": runId,
          "kinfolk.thread_id": thread.id,
          "kinfolk.user_id": userId,
        },
        name: "housing_agent_live_reply",
      },
      () =>
        runHousingAgentTurn(supabase, {
          body,
          message,
          recentMessages,
          runId,
          thread,
          threadId: thread.id,
          userId,
        }),
    );

    if (result.status !== "completed" || !result.reply.trim()) {
      await sendHousingAgentUnavailableReply(supabase, {
        reason:
          result.status === "skipped"
            ? result.reason
            : "empty_housing_agent_reply",
        reply,
        runId,
        threadId: thread.id,
        userId,
      });
      return;
    }

    await reply(result.reply, HOUSING_AGENT_REPLY_INTENT, result.mediaUrls);
    scheduleHousingAgentThreadMemoryWrite(supabase, {
      body,
      result,
      threadId: thread.id,
      userId,
    });
    await completeAgentRun(
      supabase,
      runId,
      "Housing agent reply sent.",
      "allowed_low_risk",
      {
        extractionResult: {
          provider: "kinfolk_housing_agent",
          reply_chars: result.reply.length,
          rounds: result.rounds,
          tool_calls: result.toolCalls.map((call) => call.name),
        },
        inputTokens: result.usage?.prompt_tokens ?? null,
        latencyMs: result.latencyMs,
        model: result.model,
        outputTokens: result.usage?.completion_tokens ?? null,
        provider: "kinfolk_housing_agent",
      },
    );
    captureHousingAgentTurnEvents({
      result,
      runId,
      threadId: thread.id,
      userId,
    });
    return;
  } catch (error) {
    console.error("[text-agent-loop] live turn failed", {
      error,
      runId,
      threadId: thread.id,
      userId,
    });
    await sendHousingAgentUnavailableReply(supabase, {
      reason: "housing_agent_error",
      reply,
      runId,
      threadId: thread.id,
      userId,
    });
  }
}

async function sendHousingAgentUnavailableReply(
  supabase: SupabaseServiceClient,
  {
    reason,
    reply,
    runId,
    threadId,
    userId,
  }: {
    reason: string;
    reply: TextAgentReply;
    runId: string;
    threadId: string;
    userId: string;
  },
) {
  const [{ completeAgentRun }, { notifyFounder }] = await Promise.all([
    import("./run-data"),
    import("../shared/alerts"),
  ]);
  console.error("[text-agent-loop] housing agent unavailable", {
    reason,
    runId,
    threadId,
    userId,
  });
  captureProductEvent({
    distinctId: userId,
    event: "agent_unavailable",
    properties: { reason, run_id: runId, thread_id: threadId },
  });
  await notifyFounder(`housing_agent_unavailable:${reason}`, {
    detail: reason,
    runId,
    threadId,
  });
  await Promise.all([
    completeAgentRun(
      supabase,
      runId,
      "Housing agent unavailable.",
      "error",
      {
        extractionResult: {
          provider: "kinfolk_housing_agent",
          reason,
        },
        provider: "kinfolk_housing_agent",
      },
    ),
    reply(textAgentOutageReplyCopy(runId), HOUSING_AGENT_REPLY_INTENT),
  ]);
}

export async function runHousingAgentTurn(
  supabase: SupabaseServiceClient,
  {
    body,
    message,
    recentMessages,
    runId,
    thread,
    threadId,
    userId,
  }: {
    body: string;
    message?: TableRow<"text_messages">;
    recentMessages?: Array<{
      body: string | null;
      direction: string;
      receivedAt?: string | null;
    }>;
    runId?: string;
    thread?: TableRow<"text_threads">;
    threadId: string;
    userId: string;
  },
): Promise<HousingAgentTurnResult> {
  if (!readOpenRouterApiKey()) {
    return { reason: "missing_openrouter_key", status: "skipped" };
  }

  const startedAt = Date.now();
  const allowWrites = true;
  const model = resolveHousingAgentTurnModel();
  const temperature = readEnvNumber(
    process.env.KINFOLK_TEXT_AGENT_LOOP_TEMPERATURE,
    0.6,
  );
  const tools = getHousingAgentToolDefinitions();

  // Sequential on purpose (same reason as inside buildConversationHistory):
  // racing dynamic imports of ./thread-data in one Promise.all makes vitest's
  // module runner load the real module past its mock.
  const history = await buildConversationHistory(supabase, {
    body,
    recentMessages,
    threadId,
    userId,
  });
  // One structured interpretation per turn: the gate, tool permissions, and
  // media policy all consume the same classified intent instead of each
  // re-reading the raw text through its own heuristic. Grounding context is
  // the previous assistant SEND (all its bubbles), computed by the history
  // builder. Runs concurrently with gate resolution: independent reads, and
  // the classifier call dominates the added latency. Classifier tokens are
  // deliberately NOT folded into this turn's `usage` — completeAgentChat
  // already emits a per-call gen_ai span and PostHog $ai_generation event
  // with the correct model, and the run row's usage is scoped to the reply
  // model it names.
  const [intakeGate, inboundIntent] = await Promise.all([
    resolveActiveIntakeGate(supabase, {
      threadId,
      userId,
    }),
    interpretInboundMessage({
      body,
      metadata: { runId, threadId, userId },
      previousAssistantMessage: history.previousAssistantTurn,
    }),
  ]);
  const onboarding = intakeGate
    ? decideOnboardingTurn(intakeGate, inboundIntent)
    : null;
  const messages: ChatMessage[] = [
    { content: buildHousingAgentSystemPrompt(), role: "system" },
    { content: history.contextBlock, role: "system" },
    ...(onboarding
      ? [
          {
            content: onboarding.directive,
            role: "system" as const,
          },
        ]
      : []),
    ...history.turns,
    { content: body.slice(0, 1600), role: "user" },
  ];

  const allToolCalls: HousingAgentToolCall[] = [];
  const allToolResults: HousingAgentToolResult[] = [];
  const cardRegistry: Array<{ label: string; url: string }> = [];
  let reply = "";
  let optOutConfirmation: string | null = null;
  let usage: OpenRouterChatCompletion["usage"] | null = null;
  let resolvedModel = model;
  // Counts actual model CALLS — guard reruns re-enter runRound at fixed
  // round indices, so `round + 1` would report ≤MAX_TOOL_ROUNDS even for a
  // turn that made twice that many calls, undercounting exactly the
  // expensive turns.
  let rounds = 0;

  const runRound = async (round: number): Promise<void> => {
    if (round >= MAX_TOOL_ROUNDS) return;
    rounds += 1;
    const forceProse = round === MAX_TOOL_ROUNDS - 1;
    const response = await completeAgentChat({
      maxOutputTokens: 800,
      messages,
      metadata: { runId, threadId, userId },
      model,
      operation: "housing_agent_turn",
      temperature,
      timeoutMs: 25_000,
      ...(forceProse ? {} : { toolChoice: "auto" as const, tools }),
    });

    const responseMessage = response.data.choices?.[0]?.message ?? {};
    // Accumulate across every call in the turn — keeping only the final
    // call's usage systematically underreports cost.
    usage = accumulateAgentUsage(usage, response.data.usage ?? null);
    resolvedModel = response.data.model ?? resolvedModel;
    const toolCalls = parseHousingAgentToolCalls(responseMessage).slice(
      0,
      MAX_TOOL_CALLS_PER_ROUND,
    );

    if (toolCalls.length === 0 || forceProse) {
      reply = (responseMessage.content ?? "").trim();
      return;
    }

    const normalizedToolCalls = toolCalls.map((call, index) => ({
      ...call,
      id: call.id ?? `call_${round}_${index}`,
    }));

    messages.push({
      content: responseMessage.content ?? "",
      role: "assistant",
      tool_calls: normalizedToolCalls.map((call) => ({
        function: {
          arguments: JSON.stringify(call.args),
          name: call.name,
        },
        id: call.id,
        type: "function",
      })),
    });

    // Onboarding gate: while the intake questions are unfinished and the user
    // did not explicitly ask, the fetch tools are answered deterministically
    // (continue-intake, no data, no cards) instead of run — the model cannot
    // pitch what it never received. The machine already folded the classified
    // intent into these permissions: an explicit ask opens its tool, anything
    // else stays closed until coverage says otherwise.
    const matchGate =
      intakeGate && onboarding && !onboarding.allowGetMatches
        ? intakeGate
        : null;
    const listingGate =
      intakeGate && onboarding && !onboarding.allowSearchListings
        ? intakeGate
        : null;
    const gatedResults = normalizedToolCalls.flatMap((call) => {
      if (matchGate && call.name === "get_matches") {
        return [{ call, result: buildIntakeGatedMatchesResult(matchGate) }];
      }
      if (listingGate && call.name === "search_listings") {
        return [{ call, result: buildIntakeGatedListingsResult(listingGate) }];
      }
      return [];
    });
    const gatedCallIds = new Set(gatedResults.map(({ call }) => call.id));
    const runnableCalls = normalizedToolCalls.filter(
      (call) => !gatedCallIds.has(call.id),
    );

    const toolResults = [
      ...gatedResults,
      ...(await runHousingAgentToolsForRound(runnableCalls, {
        allowWrites,
        body,
        message,
        runId,
        // Score motion is the give-a-fact → see-it-matter payoff, but mid-intake
        // it is the same premature match talk the gate exists to stop: soul.md
        // tells the model to narrate whatever motion update_prefs reports, so
        // suppressing it at the source removes the contradiction instead of
        // asking the model to arbitrate two conflicting instructions.
        suppressScoreMotion: Boolean(matchGate),
        supabase,
        thread,
        threadId,
        userId,
      })),
    ];

    for (const { call, result } of toolResults) {
      allToolCalls.push(call);
      allToolResults.push(result);
      for (const card of result.media ?? []) {
        cardRegistry.push(card);
      }
      messages.push({
        content: JSON.stringify({
          data: result.data,
          ok: result.ok,
          summary: result.summary,
        }).slice(0, 4000),
        role: "tool",
        tool_call_id: call.id,
      });
    }

    // A successful opt-out ends the turn here: the goodbye is a TCPA consent
    // confirmation, so it must be the tool's own words, never the model's echo.
    const optedOut = toolResults.find(
      ({ result }) =>
        result.toolName === "opt_out" &&
        result.ok &&
        typeof result.data.confirmation === "string" &&
        result.data.confirmation.trim(),
    );
    if (optedOut) {
      optOutConfirmation = (
        optedOut.result.data.confirmation as string
      ).trim();
      return;
    }
    return runRound(round + 1);
  };

  await runRound(0);

  // Explicit listing asks are served, not narrated: if the user directed a
  // search mid-interview and the model replied with prose only, run the
  // search anyway and give the model one round to present what actually came
  // back. Slots the interpretation extracted seed the args; the tool also
  // re-reads the message body for criteria, so sparse slots are fine.
  if (
    onboarding?.forceListingSearch &&
    !optOutConfirmation &&
    !allToolCalls.some((call) => call.name === "search_listings")
  ) {
    const forcedCall = {
      args: buildForcedListingSearchArgs(inboundIntent),
      id: "forced_listing_search",
      name: "search_listings",
    };
    const [execution] = await runHousingAgentToolsForRound([forcedCall], {
      allowWrites,
      body,
      message,
      runId,
      suppressScoreMotion: Boolean(onboarding && !onboarding.allowGetMatches),
      supabase,
      thread,
      threadId,
      userId,
    });
    allToolCalls.push(execution.call);
    allToolResults.push(execution.result);
    for (const card of execution.result.media ?? []) {
      cardRegistry.push(card);
    }
    messages.push({
      content: reply,
      role: "assistant",
      tool_calls: [
        {
          function: {
            arguments: JSON.stringify(forcedCall.args),
            name: forcedCall.name,
          },
          id: forcedCall.id,
          type: "function",
        },
      ],
    });
    messages.push({
      content: JSON.stringify({
        data: execution.result.data,
        ok: execution.result.ok,
        summary: execution.result.summary,
      }).slice(0, 4000),
      role: "tool",
      tool_call_id: forcedCall.id,
    });
    messages.push({
      content:
        "The user explicitly asked for listings, so the search above already ran. Rewrite your reply around what it actually returned — real results get presented, an empty or failed search gets said plainly. Do not invent inventory.",
      role: "system",
    });
    reply = "";
    await runRound(MAX_TOOL_ROUNDS - 1);
    if (!reply.trim()) {
      reply = buildGroundedReplyFromToolResults([execution.result]);
    }
  }

  // Reality guards (see reply-guards.ts): flash-tier models sometimes narrate
  // an action — a save, a sent intro — that no tool performed. Each fired
  // guard gets one corrective round to make the action real or drop the
  // claim, then falls back to a grounded reply, never to silence. Run in
  // order so a later guard re-checks the corrected reply of an earlier one.
  for (const guard of replyRealityGuards) {
    if (
      optOutConfirmation ||
      !reply.trim() ||
      !guard.detect(reply, allToolResults)
    ) {
      continue;
    }
    messages.push({ content: reply, role: "assistant" });
    messages.push({ content: guard.directive, role: "system" });
    reply = "";
    await runRound(MAX_TOOL_ROUNDS - 2);
    if (!reply.trim()) {
      reply = buildGroundedReplyFromToolResults(allToolResults);
    }
    if (!reply.trim()) {
      reply = guard.fallbackReply;
    }
  }

  // One-question guard: the soul caps messages at a single question, but
  // flash-tier models bundle two ("budget? and when are you moving?") often
  // enough that the judge flags it roughly every third intake conversation.
  // Same shape as the reality guard: one corrective regeneration, then accept.
  if (!optOutConfirmation && reply.trim() && isMultiQuestionReply(reply)) {
    const multiQuestionReply = reply;
    messages.push({ content: multiQuestionReply, role: "assistant" });
    messages.push({
      content:
        "Rewrite that reply so it asks exactly ONE question — keep the single most important one, drop or defer the rest, and keep everything else about the reply the same. Output only the rewritten message.",
      role: "system",
    });
    reply = "";
    await runRound(MAX_TOOL_ROUNDS - 1);
    if (!reply.trim() || isMultiQuestionReply(reply)) {
      // The model rewrite failed or still bundles. Before accepting the
      // original, try the deterministic trim: cut an and-conjoined second
      // question off the offending sentence. Only if that also fails does the
      // original stand — never trade a good reply for silence.
      const trimmed = trimBundledQuestion(multiQuestionReply);
      reply =
        trimmed && !isMultiQuestionReply(trimmed) ? trimmed : multiQuestionReply;
    }
  }

  if (optOutConfirmation) {
    return {
      latencyMs: Date.now() - startedAt,
      mediaUrls: [],
      model: resolvedModel,
      reply: optOutConfirmation,
      rounds,
      status: "completed",
      toolCalls: allToolCalls,
      toolResults: allToolResults,
      usage,
    };
  }

  if (!reply.trim()) {
    // A model that did real tool work occasionally returns an empty final
    // message. Successful work must never read as an outage — fall back to a
    // minimal reply grounded in the last tool result so the turn stays honest.
    reply = buildGroundedReplyFromToolResults(allToolResults);
  }

  // Deterministic onboarding close: the canonical question is generated onto
  // the reply from durable state, never trusted to model prose. Facts written
  // (or a step skipped) re-resolve the gate so the APPENDED question reflects
  // post-write coverage; when durable state says coverage cleared, the
  // interview is durably completed and the reply carries no new question.
  if (intakeGate) {
    // Skip is the one intent that must MUTATE durable state: without
    // recording the skipped step, coverage still names it and the canonical
    // close would re-ask the question the user just declined, forever.
    // Refresh only when the skip actually persisted: an unrecorded skip
    // cannot have changed coverage, and its safe degradation is re-asking
    // the canonical question once.
    let skipPersisted = false;
    if (inboundIntent.kind === "skip") {
      try {
        const { appendSkippedIntakeStep } = await import("./thread-data");
        await appendSkippedIntakeStep(supabase, {
          messageId: message?.id ?? null,
          step: intakeGate.step as Parameters<
            typeof appendSkippedIntakeStep
          >[1]["step"],
          threadId,
          userId,
        });
        skipPersisted = true;
      } catch (error) {
        console.error("[text-agent-loop] skip persistence failed", {
          error,
          step: intakeGate.step,
          userId,
        });
      }
    }
    // Partial writes still advance coverage: update_prefs reports ok=false
    // when ANY fact failed while data.persisted lists the ones that saved.
    const wroteFacts = allToolResults.some(
      (result) =>
        result.toolName === "update_prefs" &&
        (result.ok ||
          (Array.isArray((result.data as { persisted?: unknown })?.persisted) &&
            ((result.data as { persisted: unknown[] }).persisted.length > 0))),
    );
    let closingQuestion: string | null = intakeGate.nextQuestion || null;
    if (wroteFacts || skipPersisted) {
      const refreshed = await resolveIntakeGateOutcome(supabase, {
        threadId,
        userId,
      });
      if (refreshed.status === "active") {
        closingQuestion = refreshed.gate.nextQuestion || null;
      } else if (refreshed.status === "complete") {
        closingQuestion = null;
        try {
          await markMatchingInterviewCompleted(supabase, { userId });
        } catch (error) {
          console.error("[text-agent-loop] interview completion failed", {
            error,
            userId,
          });
        }
      }
      // "unavailable" keeps the pre-write canonical question: re-asking an
      // answered question once is recoverable; completing an interview off a
      // transient read failure is not.
    }
    // A model clarification may stand in for the canonical question only when
    // an explicitly requested task genuinely failed (not when the gate
    // deterministically declined it) — the one case where the user needs to
    // answer the model, not the interview.
    const explicitAskFailed =
      (asksForListings(inboundIntent) || asksAboutRoommates(inboundIntent)) &&
      allToolResults.some(
        (result) =>
          !result.ok &&
          ["get_matches", "search_listings"].includes(result.toolName) &&
          !String(
            (result.data as { reason?: unknown } | null)?.reason ?? "",
          ).startsWith("onboarding_"),
      );
    reply = composeOnboardingClose(reply, closingQuestion, {
      allowModelQuestion: explicitAskFailed,
      // If the completion turn's whole reply was questions, fall back to
      // grounded tool output before the canned acknowledgment — a final-turn
      // listing delivery must not be swallowed by the close.
      completionFallback: buildGroundedReplyFromToolResults(allToolResults),
    });
  }

  const mediaPolicy = resolveReplyMediaPolicy({
    intent: inboundIntent,
    toolResults: allToolResults,
  });
  const cardRegistryForReply = filterCardsToRequestTargets(body, cardRegistry);
  let mediaUrls = mediaPolicy.allowToolMedia
    ? selectMediaForReply(reply, cardRegistryForReply)
    : [];
  // A reply whose closing question OFFERS the profiles must not preempt its
  // own question by attaching them ("Want me to pull up their profiles?" +
  // three cards is an absurd bubble). Mention-based attach can't tell an
  // offer from a delivery, so the offer wins here — unless the user already
  // asked to see them this turn.
  const withholdOfferedProfileCards =
    offersRoommateProfilesInsteadOfSending(reply) &&
    !asksAboutRoommates(inboundIntent) &&
    !inboundIntent.wantsMediaCards;
  if (withholdOfferedProfileCards && mediaUrls.length > 0) {
    mediaUrls = mediaUrls.filter((url) => !isPersonProfileCardUrl(url));
  }
  // Safety net for explicit "show me my matches" turns where the model answers
  // from memory without calling get_matches. This is deliberately narrow:
  // chat/context answers can name people without asking for profile cards.
  if (
    mediaPolicy.allowRoommateRecovery &&
    !withholdOfferedProfileCards &&
    mediaUrls.length === 0 &&
    reply.trim()
  ) {
    mediaUrls = await recoverRoommateCardsForReply(
      supabase,
      userId,
      `${body}\n${reply}`,
      body,
    );
  }

  return {
    latencyMs: Date.now() - startedAt,
    mediaUrls,
    model: resolvedModel,
    reply,
    rounds,
    status: "completed",
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    usage,
  };
}

async function runHousingAgentToolsForRound(
  calls: NormalizedHousingAgentToolCall[],
  context: HousingAgentToolContext,
): Promise<HousingAgentToolExecutionResult[]> {
  const executions: Array<HousingAgentToolExecutionResult | undefined> =
    new Array(calls.length);
  const runToolCall = async (
    call: NormalizedHousingAgentToolCall,
    index: number,
  ) => {
    executions[index] = {
      call,
      result: await runHousingAgentTool(
        context,
        call.name as HousingAgentToolName,
        call.args,
      ),
    };
  };

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (call.name === "update_prefs") {
      await runToolCall(call, index);
    }
  }

  await Promise.all(
    calls.map((call, index) =>
      call.name === "update_prefs"
        ? Promise.resolve()
        : runToolCall(call, index),
    ),
  );

  return executions.map((execution, index) => {
    if (!execution) {
      throw new Error(`Housing agent tool did not run: ${calls[index]?.name}`);
    }
    return execution;
  });
}

// Bubbles of one outbound send land seconds apart; distinct sends (a reply
// now, a proactive question hours later) do not. Joining across that gap
// would hand the classifier stale listing prose and misread "what about Nob
// Hill?" as a refinement of a search from yesterday.
const ASSISTANT_TURN_MAX_BUBBLE_GAP_MS = 3 * 60 * 1000;

// The previous assistant SEND, not the last bubble: outbound replies insert
// one text_messages row per bubble, so the trailing assistant entry is often
// just the canonical intake question. Refinement and name grounding need the
// prose above it — join the trailing run of assistant rows, bounded by the
// inter-bubble time gap so separate sends never merge. Rows without
// timestamps join unconditionally (test fixtures, legacy rows).
function lastAssistantTurnText(
  rows: Array<{
    body: string | null;
    direction: string;
    receivedAt?: string | null;
  }>,
): string | null {
  let index = rows.length - 1;
  while (index >= 0 && rows[index].direction === "inbound") {
    index -= 1;
  }
  if (index < 0) {
    return null;
  }
  const parts: string[] = [];
  let newerAt: number | null = null;
  while (index >= 0 && rows[index].direction !== "inbound") {
    const row = rows[index];
    const rowAt = row.receivedAt ? Date.parse(row.receivedAt) : Number.NaN;
    if (
      newerAt !== null &&
      Number.isFinite(rowAt) &&
      Number.isFinite(newerAt) &&
      newerAt - rowAt > ASSISTANT_TURN_MAX_BUBBLE_GAP_MS
    ) {
      break;
    }
    const content = (row.body ?? "").trim();
    if (content) {
      parts.unshift(content.slice(0, 1200));
    }
    newerAt = Number.isFinite(rowAt) ? rowAt : newerAt;
    index -= 1;
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

// Seed args for a forced mid-interview search from the interpretation's
// extracted slots; the tool itself re-reads the message body for anything
// the classifier left null.
function buildForcedListingSearchArgs(intent: InboundIntent) {
  return {
    ...(intent.area ? { neighborhoods: [intent.area] } : {}),
    ...(intent.maxRent ? { budgetMax: intent.maxRent } : {}),
    ...(intent.bedrooms
      ? { bedroomsMax: intent.bedrooms, bedroomsMin: intent.bedrooms }
      : {}),
  };
}

function resolveReplyMediaPolicy({
  intent,
  toolResults,
}: {
  intent: InboundIntent;
  toolResults: HousingAgentToolResult[];
}) {
  const hasSuccessfulChatSend = toolResults.some(
    (result) => result.toolName === "send_chat_message" && result.ok,
  );
  if (hasSuccessfulChatSend) {
    return { allowRoommateRecovery: false, allowToolMedia: false };
  }

  const hasChatContextTool = toolResults.some((result) =>
    ["list_chats", "read_chat"].includes(result.toolName),
  );
  const explicitMediaRequest = intent.wantsMediaCards;
  const roommateMatchMediaRequest = asksAboutRoommates(intent);
  if (
    hasChatContextTool &&
    !explicitMediaRequest &&
    !roommateMatchMediaRequest
  ) {
    return { allowRoommateRecovery: false, allowToolMedia: false };
  }

  return {
    allowRoommateRecovery:
      // ok-only: an intake-gated (or otherwise failed) get_matches result must
      // not license the recovery path to fetch cards the turn withheld.
      toolResults.some(
        (result) => result.toolName === "get_matches" && result.ok,
      ) ||
      (toolResults.length === 0 &&
        (explicitMediaRequest || roommateMatchMediaRequest)) ||
      (hasChatContextTool && (explicitMediaRequest || roommateMatchMediaRequest)),
    allowToolMedia: true,
  };
}

type CompletedHousingAgentTurn = Extract<
  HousingAgentTurnResult,
  { status: "completed" }
>;

// Product analytics for a completed live turn. One reply event always; the
// derived events (facts saved, cards sent, opt-out) exist so funnels can be
// built without parsing tool-call arrays in every insight.
function captureHousingAgentTurnEvents({
  result,
  runId,
  threadId,
  userId,
}: {
  result: CompletedHousingAgentTurn;
  runId: string;
  threadId: string;
  userId: string;
}) {
  const shared = { run_id: runId, thread_id: threadId };
  captureProductEvent({
    distinctId: userId,
    event: "agent_reply_sent",
    properties: {
      ...shared,
      cards_sent: result.mediaUrls.length,
      input_tokens: result.usage?.prompt_tokens ?? null,
      latency_ms: result.latencyMs,
      model: result.model,
      output_tokens: result.usage?.completion_tokens ?? null,
      reply_chars: result.reply.length,
      rounds: result.rounds,
      tool_calls: result.toolCalls.map((call) => call.name),
    },
  });

  if (result.mediaUrls.length > 0) {
    captureProductEvent({
      distinctId: userId,
      event: "agent_cards_sent",
      properties: { ...shared, count: result.mediaUrls.length },
    });
  }

  const persistedFactCount = result.toolResults
    .filter((toolResult) => toolResult.toolName === "update_prefs" && toolResult.ok)
    .reduce((total, toolResult) => {
      const persisted = (toolResult.data as Record<string, unknown>).persisted;
      return total + (Array.isArray(persisted) ? persisted.length : 0);
    }, 0);
  if (persistedFactCount > 0) {
    captureProductEvent({
      distinctId: userId,
      event: "intake_facts_saved",
      properties: { ...shared, count: persistedFactCount },
    });
  }

  if (
    result.toolResults.some(
      (toolResult) => toolResult.toolName === "opt_out" && toolResult.ok,
    )
  ) {
    captureProductEvent({
      distinctId: userId,
      event: "agent_opt_out",
      properties: shared,
    });
  }
}

const listingCardUrlPattern = /\/api\/listing-card\/([^/?#]+)/;

// Map the cards actually attached to the outbound reply, in mention order,
// back to their persisted recommendation ids so "the second one" resolves
// deterministically next turn. Roommate/profile card urls don't match the
// listing-card path and drop out.
export function collectSentListingCards(
  mediaUrls: string[],
  toolResults: HousingAgentToolResult[],
): TextThreadSentListingCard[] {
  const labelsByUrl = new Map<string, string>();
  for (const result of toolResults) {
    for (const media of result.media ?? []) {
      if (!labelsByUrl.has(media.url)) {
        labelsByUrl.set(media.url, media.label);
      }
    }
  }

  const cards: TextThreadSentListingCard[] = [];
  for (const url of mediaUrls) {
    const recommendationId = url.match(listingCardUrlPattern)?.[1];
    if (!recommendationId) {
      continue;
    }
    cards.push({
      address: labelsByUrl.get(url)?.trim() ?? "",
      listingId: null,
      ordinal: cards.length + 1,
      recommendationId,
    });
  }
  return cards;
}

// Thread memory (sent-card registry + rolling summary) is written AFTER the
// reply is on the wire and never awaited on the reply path: a memory failure
// must never cost the user their answer. Opt-out turns write nothing — the
// thread is over and the goodbye already said everything.
function scheduleHousingAgentThreadMemoryWrite(
  supabase: SupabaseServiceClient,
  args: {
    body: string;
    result: CompletedHousingAgentTurn;
    threadId: string;
    userId: string;
  },
) {
  if (
    args.result.toolResults.some(
      (result) => result.toolName === "opt_out" && result.ok,
    )
  ) {
    return;
  }
  const task = async () => {
    try {
      await recordHousingAgentThreadMemory(supabase, args);
    } catch (error) {
      console.error("[text-agent-loop] thread memory write failed", {
        error,
        threadId: args.threadId,
        userId: args.userId,
      });
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

async function recordHousingAgentThreadMemory(
  supabase: SupabaseServiceClient,
  {
    body,
    result,
    threadId,
    userId,
  }: {
    body: string;
    result: CompletedHousingAgentTurn;
    threadId: string;
    userId: string;
  },
) {
  const { loadTextThreadAgentMemory, saveTextThreadAgentMemory } =
    await import("./thread-data");

  let previousSummary = "";
  try {
    const memory = await loadTextThreadAgentMemory(supabase, threadId, userId);
    previousSummary = memory.rollingSummary;
  } catch {
    previousSummary = "";
  }

  // Only a reply that actually carried listing cards replaces the registry, so
  // "the second one" keeps pointing at the cards the person last saw.
  const sentCards = collectSentListingCards(
    result.mediaUrls,
    result.toolResults,
  );
  const resolvedSentCards =
    sentCards.length > 0
      ? await resolveSentListingCardListingIds(supabase, sentCards)
      : null;

  const rollingSummary = await buildHousingAgentRollingSummary({
    body,
    previousSummary,
    reply: result.reply,
    sentCards,
    toolCalls: result.toolCalls,
  });

  // One combined write: two sequential read-modify-write upserts doubled the
  // round-trips and widened the last-writer-wins window on summary_json (a
  // concurrent intake-path write could drop the just-saved card registry).
  if (resolvedSentCards || rollingSummary) {
    await saveTextThreadAgentMemory(supabase, {
      ...(resolvedSentCards ? { sentListingCards: resolvedSentCards } : {}),
      ...(rollingSummary ? { rollingSummary } : {}),
      threadId,
      userId,
    });
  }
}

async function resolveSentListingCardListingIds(
  supabase: SupabaseServiceClient,
  cards: TextThreadSentListingCard[],
): Promise<TextThreadSentListingCard[]> {
  // The write path persists resolved listing ids, so only legacy rows (or
  // fresh cards the collector couldn't resolve) still need the lookup.
  const unresolved = cards.filter((card) => !card.listingId);
  if (unresolved.length === 0) {
    return cards;
  }
  try {
    const result = await supabase
      .from("text_listing_recommendations")
      .select("id,listing_id")
      .in(
        "id",
        unresolved.map((card) => card.recommendationId),
      );
    if (result.error) {
      return cards;
    }
    const listingIdByRecommendation = new Map(
      (result.data ?? []).map((row) => [row.id, row.listing_id]),
    );
    return cards.map((card) =>
      card.listingId
        ? card
        : {
            ...card,
            listingId:
              listingIdByRecommendation.get(card.recommendationId) ?? null,
          },
    );
  } catch {
    return cards;
  }
}

async function buildHousingAgentRollingSummary({
  body,
  previousSummary,
  reply,
  sentCards,
  toolCalls,
}: {
  body: string;
  previousSummary: string;
  reply: string;
  sentCards: TextThreadSentListingCard[];
  toolCalls: HousingAgentToolCall[];
}): Promise<string> {
  const model = resolveHousingAgentSummaryModel();
  const response = await completeAgentChat({
    maxOutputTokens: 220,
    messages: [
        {
          content:
            "You keep the running memory of one iMessage thread between Kinfolk's SF housing agent and one person. Rewrite the whole memory in at most 120 words of plain prose covering: searches run and their filters, listing or roommate cards sent (addresses or names, in order), explicit rejections or dislikes, saved preference changes, and open questions. The user's message and previous_memory are the only sources for user preferences, dislikes, rejections, or commitments; agent_reply is only evidence of what Kinfolk sent. Never write rejected, disliked, exclusively, only wants, or decided unless the user explicitly said that. Merge previous_memory with this_turn, drop anything superseded, and output only the memory text -- no markdown, no lists, no preamble.",
          role: "system",
        },
        {
          content: JSON.stringify({
            previous_memory: previousSummary.slice(0, 1200),
            this_turn: {
              agent_reply: reply.slice(0, 1200),
              cards_sent: sentCards.map((card) => card.address),
              tools_run: toolCalls.map((call) => ({
                args: JSON.stringify(call.args).slice(0, 280),
                name: call.name,
              })),
              user_message: body.slice(0, 800),
            },
          }),
          role: "user",
        },
      ],
    model,
    operation: "housing_agent_thread_summary",
    temperature: 0.2,
    timeoutMs: 20_000,
  });

  const summary = (response.data.choices?.[0]?.message?.content ?? "").trim();
  if (
    hasUnsupportedStrongUserCommitment(summary, {
      body,
      previousSummary,
    })
  ) {
    return previousSummary.trim();
  }
  return summary;
}

async function recoverRoommateCardsForReply(
  supabase: SupabaseServiceClient,
  userId: string,
  reply: string,
  requestBody = "",
): Promise<string[]> {
  try {
    const [
      { getMatchesSnapshotForUserId },
      { buildRoommateProfileCardUrl },
      { buildRoommateMatchProfileCardSnapshot },
      { getKinfolkPublicMediaBaseUrl },
    ] = await Promise.all([
      import("../matching/matches"),
      import("../profiles/profile-card"),
      import("./roommate-cards"),
      import("./store-shared"),
    ]);
    const baseUrl = getKinfolkPublicMediaBaseUrl();
    if (!baseUrl) {
      return [];
    }
    const snapshot = await getMatchesSnapshotForUserId(userId, supabase);
    if (snapshot.status !== "connected") {
      return [];
    }
    const registry = snapshot.roommates
      .filter(isViableRoommateMatch)
      .slice(0, 10)
      .map((roommate) => ({
        label: roommate.name,
        url: buildRoommateProfileCardUrl({
          baseUrl,
          snapshot: buildRoommateMatchProfileCardSnapshot(roommate),
        }),
      }));
    return selectMediaForReply(
      reply,
      filterCardsToRequestTargets(requestBody, registry),
    );
  } catch {
    return [];
  }
}

// Find `needle` in `haystack` only as a whole word, so a short name like "Sam"
// matches "Sam" but not the inside of "same" or "analysis".
function indexOfWholeWord(haystack: string, needle: string): number {
  if (!needle) return -1;
  for (let from = 0; from <= haystack.length; ) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    const before = idx === 0 ? "" : haystack[idx - 1];
    const after = haystack[idx + needle.length] ?? "";
    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return idx;
    from = idx + 1;
  }
  return -1;
}

// How a card's label is matched against free text: the full label, its first
// two words, and — only when that first word is unique across the registry —
// the bare first word. Shared by reply-media selection (mention order) and
// request-target filtering (membership) so the matching rule lives in one place.
function buildFirstWordCounts(
  registry: ReadonlyArray<{ label: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of registry) {
    const firstWord = card.label.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (firstWord.length >= 3) {
      counts.set(firstWord, (counts.get(firstWord) ?? 0) + 1);
    }
  }
  return counts;
}

function cardLabelMatchCandidates(
  label: string,
  firstWordCounts: Map<string, number>,
): string[] {
  const trimmed = label.trim();
  const parts = trimmed.split(/\s+/);
  const candidates = [trimmed, parts.slice(0, 2).join(" ")]
    .map((value) => value.toLowerCase())
    .filter((value) => value.length >= 3);
  const firstWord = parts[0]?.toLowerCase() ?? "";
  // A bare first word is only a safe mention proxy when it's a name-like
  // token. An address's street number ("500" of "500 Larkin St") matches any
  // rent or deposit figure in the prose and attaches cards nobody mentioned.
  if (
    (firstWordCounts.get(firstWord) ?? 0) === 1 &&
    !/^\d+$/.test(firstWord)
  ) {
    candidates.push(firstWord);
  }
  return candidates;
}

// Attach a card only when the agent actually named its subject in the reply, in
// the order they're mentioned. This makes exclusions/filters automatic: a
// roommate or listing the agent left out of its prose never gets a card.
function selectMediaForReply(
  reply: string,
  registry: Array<{ label: string; url: string }>,
): string[] {
  const haystack = reply.toLowerCase();
  const firstWordCounts = buildFirstWordCounts(registry);
  const mentioned = registry
    .flatMap((card) => {
      const candidates = cardLabelMatchCandidates(card.label, firstWordCounts);
      let at = -1;
      for (const candidate of candidates) {
        const idx = indexOfWholeWord(haystack, candidate);
        if (idx !== -1 && (at === -1 || idx < at)) at = idx;
      }
      return at === -1 ? [] : [{ at, label: card.label, url: card.url }];
    })
    .sort((left, right) => left.at - right.at);

  // Dedupe by address stem (first two label words) as well as url: re-searches
  // mint fresh recommendation ids for the same listing, and unit- vs
  // building-level entries ("330 Alemany Blvd Apt 6" / "330 Alemany Blvd")
  // otherwise both attach for one mention.
  const seenUrls = new Set<string>();
  const seenStems = new Set<string>();
  const urls: string[] = [];
  for (const entry of mentioned) {
    const stem = entry.label
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    if (seenUrls.has(entry.url) || seenStems.has(stem)) continue;
    seenUrls.add(entry.url);
    seenStems.add(stem);
    urls.push(entry.url);
    if (urls.length >= 5) break;
  }
  return urls;
}

function filterCardsToRequestTargets<T extends { label: string }>(
  requestBody: string,
  registry: T[],
) {
  if (registry.length === 0) {
    return registry;
  }

  const body = requestBody.toLowerCase();
  const firstWordCounts = buildFirstWordCounts(registry);
  const targets = registry.filter((card) => {
    const candidates = cardLabelMatchCandidates(card.label, firstWordCounts);
    return candidates.some(
      (candidate) => indexOfWholeWord(body, candidate) !== -1,
    );
  });

  return targets.length > 0 ? targets : registry;
}

async function buildConversationHistory(
  supabase: SupabaseServiceClient,
  {
    body,
    recentMessages,
    threadId,
    userId,
  }: {
    body: string;
    recentMessages?: Array<{
      body: string | null;
      direction: string;
      receivedAt?: string | null;
    }>;
    threadId: string;
    userId: string;
  },
): Promise<{
  contextBlock: string;
  previousAssistantTurn: string | null;
  turns: ChatMessage[];
}> {
  let messages = recentMessages;
  if (!messages) {
    try {
      const { loadRecentTextMessages } =
        await import("./fact-utils");
      messages = await loadRecentTextMessages(supabase, threadId, userId);
    } catch {
      messages = [];
    }
  }

  const trimmed = messages.slice(-RECENT_MESSAGE_TURNS);
  // The current inbound message is already stored, so it is usually the last
  // inbound row. Drop that trailing duplicate; we append `body` ourselves.
  const last = trimmed.at(-1);
  const withoutCurrent =
    last &&
    last.direction === "inbound" &&
    (last.body ?? "").trim() === body.trim()
      ? trimmed.slice(0, -1)
      : trimmed;

  const turns: ChatMessage[] = withoutCurrent.flatMap((entry) => {
    const content = (entry.body ?? "").trim();
    return content.length > 0
      ? [
          {
            content: content.slice(0, 1200),
            role:
              entry.direction === "inbound"
                ? ("user" as const)
                : ("assistant" as const),
          },
        ]
      : [];
  });

  // Sequential on purpose: racing these two helpers' dynamic imports inside one
  // Promise.all makes vitest's module runner load the real ./thread-data past
  // its mock. The extra await costs one DB roundtrip on a turn that already
  // spends seconds in the model.
  const threadMemory = await loadThreadMemorySafely(supabase, threadId, userId);
  // Resolve each sent card's listing id so the context line can carry the real
  // tappable Kinfolk link — otherwise the model improvises /l/<recommendationId>,
  // which the shortlink decoder rejects (it bounces to the generic map).
  const sentCardsWithLinks =
    threadMemory.sentListingCards.length > 0
      ? await resolveSentListingCardListingIds(
          supabase,
          threadMemory.sentListingCards,
        )
      : threadMemory.sentListingCards;
  const profileSummary = await loadProfileSummaryText(supabase, userId);
  const livingPlanSummary = await loadLivingPlanSummaryText(supabase, userId);
  const today = new Date().toISOString().slice(0, 10);
  const contextBlock = [
    "Context for this turn:",
    `- Today is ${today}. Kinfolk operates in San Francisco only.`,
    profileSummary
      ? `- What you already know about this person (don't re-ask these): ${profileSummary}`
      : "- Their saved profile is still empty — but the conversation below is ground truth: anything they told you in it, you know. Beyond that, learn one thing at a time, conversationally.",
    ...(livingPlanSummary
      ? [
          `- Their living plan (future intent from the web app — background context, NOT current search filters; don't turn it into profile facts or ask them to re-confirm it): ${livingPlanSummary}`,
        ]
      : []),
    ...(threadMemory.rollingSummary
      ? [
          `- Thread memory from earlier in this conversation (trust it for what happened, but re-verify specifics with tools): ${threadMemory.rollingSummary}`,
        ]
      : []),
    ...(sentCardsWithLinks.length > 0
      ? [
          `- Listing cards already sent, in order — resolve "the first one"/"the second one" against this. When they want the link to one, send that card's link verbatim; never build a link from a recommendationId: ${sentCardsWithLinks
            .map((card) => {
              const link = buildListingShortlinkUrl(
                process.env.NEXT_PUBLIC_KINFOLK_BASE_URL,
                card.listingId,
              );
              return `${card.ordinal}) ${card.address}${link ? ` [link: ${link}]` : ""} (recommendationId ${card.recommendationId})`;
            })
            .join("; ")}`,
        ]
      : []),
  ].join("\n");

  return {
    contextBlock,
    previousAssistantTurn: lastAssistantTurnText(withoutCurrent),
    turns,
  };
}

async function loadThreadMemorySafely(
  supabase: SupabaseServiceClient,
  threadId: string,
  userId: string,
): Promise<TextThreadAgentMemory> {
  try {
    const { loadTextThreadAgentMemory } = await import("./thread-data");
    return await loadTextThreadAgentMemory(supabase, threadId, userId);
  } catch {
    return { rollingSummary: "", sentListingCards: [] };
  }
}

async function loadProfileSummaryText(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<string> {
  try {
    const [{ summarizeTextProfileFacts }, { loadUserTextAgentCoverageFacts }] =
      await Promise.all([
        import("./profile-summary"),
        import("./thread-data"),
      ]);
    const facts = await loadUserTextAgentCoverageFacts(supabase, userId);
    return summarizeTextProfileFacts(facts).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function loadLivingPlanSummaryText(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<string> {
  try {
    const { loadLivingPlanPromptSummary } = await import("./living-plan-context");
    return await loadLivingPlanPromptSummary(supabase, userId);
  } catch {
    return "";
  }
}

export function parseHousingAgentToolCalls(
  message: OpenRouterMessage,
): HousingAgentToolCall[] {
  return (message.tool_calls ?? []).flatMap((toolCall) => {
    const name = toolCall.function?.name?.trim();
    if (!name) {
      return [];
    }

    return [
      {
        args: parseToolArguments(toolCall.function?.arguments),
        id: toolCall.id ?? null,
        name,
      },
    ];
  });
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readEnvNumber(value: string | undefined, fallback: number) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveHousingAgentTurnModel() {
  return normalizeOpenRouterModelId(
    firstConfiguredEnvValue(
      process.env.KINFOLK_TEXT_AGENT_LOOP_MODEL,
      process.env.KINFOLK_TEXT_AGENT_MODEL,
      DEFAULT_HOUSING_AGENT_MODEL,
    ),
  );
}

function resolveHousingAgentSummaryModel() {
  return normalizeOpenRouterModelId(
    firstConfiguredEnvValue(
      process.env.KINFOLK_TEXT_AGENT_SUMMARY_MODEL,
      DEFAULT_HOUSING_AGENT_MODEL,
    ),
  );
}

function buildHousingAgentSystemPrompt() {
  return [
    loadSoul(),
    "",
    "You are texting this person right now, live, as Kinfolk over iMessage. Whatever you write is sent to them verbatim as the text message — so write only the message itself. No JSON, no labels, no narration of tools, steps, or scores.",
    "Ground every concrete claim — rents, fit, scores, matches, listings, saved details — in a tool result. Call tools to look things up; never invent a number, name, address, or match. You may reason, compare, and have an honest opinion over real data.",
    "For ANY question about a neighborhood or area (safe, sketchy, quiet, loud, walkable, good area, vibe), call get_area_signals first and speak only from what it returns. Use topic coffee for cafe, coffee, bakery, laptop, study, or work-spot questions; do not treat bars/nightlife as coffee-work evidence. Use topic commute with a destination for any commute, transit-time, or how-far-from-work question ('how long to FiDi from the second one') — never estimate travel times from memory. Never label an area definitively safe or unsafe — give the public signals plainly and let them judge. Don't claim listings exist or that options 'opened up' unless search_listings actually returned them.",
    "When a neighborhood comparison mentions budget, rent, affordability, availability, options, roommate openness, or a per-person split, call search_listings as well as get_area_signals before answering. Compare both public area signals and current listing fit; if one area has per-person fits and another does not, say so plainly.",
    "Keep the user's budget unit consistent from input through reply. If they explicitly give a total or combined household budget, divide it by householdSize before saving it with update_prefs or passing it to search_listings, then narrate and compare every result using the listing's total rent. Otherwise treat their budget as per-person, lead with each listing's perPersonRent when available, and use total rent only for a solo or studio without a split. Every rent you mention must say which number it is — per-person or total (e.g. '$1,998 each, $3,995 total') — and you must never call a unit within budget by switching units. The tool's rent is already final after any move-in concession. Show at most a few; for a 'near <place>' search lead with the closest listing and its walk time, otherwise best fit first.",
    "When search_listings returns featureAssessments for a flexible apartment feature like office/workspace fit, use those assessments as the only source for that feature. Say a listing has the feature only when status is explicit or likely. If status is no, say the evidence argues against it. If status is unclear, say the listing does not confirm it; never upgrade generic fit evidence, raw photos, square footage, or your own layout guess into 'dedicated office' or 'room for an office'.",
    "For listing requests about being near or not near a place, transit line, station, cafe, office, school, or landmark, pass that as search_listings proximityConstraints. Treat 'not near X', 'away from X', and 'far from X' as avoid/dealbreaker proximity constraints; do not convert them into positive transitTargets.",
    "Honor their framing exactly. If they say to exclude, skip, drop, or ignore someone, leave that person out of your answer. If they want only some (cheaper, quieter, closer, just two), narrow to those. If they ask you to compare or for your honest read, actually do it — never just relist. A fresh explicit search request overrides saved neighborhoods for that turn, so search the named SF area instead of refusing because it was previously removed. When they name a new area or place (a neighborhood, or a landmark like a coffee shop), don't carry their SAVED must-haves, transit preferences, or bedroom count into search_listings — only filter by what they say this turn — or you'll wrongly report the area as empty. But a place they named earlier in THIS conversation is still active intent: when they then say 'relax the budget' or 'just show me what's available', re-pass that place as proximityConstraints (and any neighborhood they named) so the results stay ranked by closeness to it instead of becoming a blank search.",
    "Treat short affirmations like 'yes', 'yeah', 'sure', 'yep', or 'recommend me one' as an answer to your immediately previous question, not a new unrelated search. If your last question offered option A vs. 'a different neighborhood', an affirmation picks option A. If they ask for one, call search_listings with limit 1 and reply with exactly one listing plus the reason it is the pick; do not dump a rundown.",
    "Save durable preferences with update_prefs the moment they clearly state one (a budget, neighborhoods, move-in timing, roommate openness), then confirm it in one natural sentence. Save only what they actually said — never infer household_size or group_size_flexibility from how a budget was phrased. 'Per person' is your framing of the rent, not their answer about group size; saving a household size they never gave makes Kinfolk skip asking how many roommates they want. You CANNOT message landlords or buildings, schedule tours, or submit applications yet — never offer to; when they want to act on a listing, point them at its source link instead. Group membership moves on the web for now — when someone wants to start a group, join one, or commit, point them at the listing on usekinfolk.com/apartments instead of claiming you can create, join, or lock in a group from this thread.",
    "When they reference a listing with a bare 'this', 'that one', or a reply to an old card — without an address or a position — only resolve it yourself if exactly one listing has come up recently. If several have (different batches, different addresses), DO NOT guess which one: ask in one short line ('the Fremont tower or the Cypress place?'). A wrong guess reads like you weren't listening. iMessage does not tell you which message they replied to, so a reply to an older card looks identical to a fresh text.",
    "Keep replies to one or two short lines unless they asked for depth. Mirror their tone and length. Never send a 'Reply X to do Y' menu, a templated confirmation, or a wall of options. If you genuinely don't know something yet, go find it with a tool before answering.",
    "PLAIN TEXT ONLY. This is iMessage — it shows Markdown literally. Never use *, **, _, #, backticks, or list markers of any kind: no leading dashes, no bullet characters like • or ·, no 'Label:' headers above stacked lines. Write in natural prose sentences.",
    "When you run down roommate matches or listings, give each one its own short, natural sentence on its own line, with a blank line between them so it's easy to read — full sentences, never a 'Name: reason' list, table, or stacked colon layout. Name each with its score in parentheses and the one thing that makes it fit, then a blank line and a short closing line. Exactly one sentence per match — the single biggest reason, not several — and don't tack on separate lines about their age, budget, or caveats unless they ask. Format it like this (note the blank line between each):",
    "Jack (75%) is your strongest right now — you share a schedule and an easy communication style.",
    "",
    "Priya (73%) is right behind, aligned on your daily rhythm and how tidy you keep things.",
    "",
    "Nora (70%) lines up on guests and weeknight noise.",
    "",
    "Want me to pull up any of them?",
    "Always name specific roommates or listings plainly (e.g. 'Priya' or '681 Florida St') so Kinfolk attaches their cards automatically — don't paste links or describe the images.",
    "Whenever they ask to see, show, compare, discuss risks, explain why, introduce, or be reminded of their matches or listings, call get_matches (roommates) or search_listings (places) fresh this turn even if you already discussed them — that fresh call is what lets Kinfolk attach the cards. Never answer a match/listing request from memory alone.",
    "When they ask about one specific listing's details — pets, square footage, availability or move-in date, deals or concessions, lease terms, amenities, parking, fees, or what's nearby — call get_listing_details for that listing instead of answering from memory or declining; resolve 'the first one'/'the second one' to its recommendationId using the sent-cards context line. When get_listing_details returns an address, name that address in your first sentence so the reply stands on its own.",
  ].join("\n");
}
