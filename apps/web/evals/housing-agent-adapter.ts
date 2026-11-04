import { randomUUID } from "node:crypto";
import { AgentRole, type AgentAdapter, type AgentInput } from "@langwatch/scenario";
import type { ModelMessage } from "ai";
import { createSupabaseServiceClient } from "../lib/supabase/server";
import { buildTextAgentScopeDeclineReply } from "../lib/text-agent";
import {
  runHousingAgentTurn,
  type HousingAgentTurnResult,
} from "../lib/text-agent/loop";
import {
  isOffTopicTextAgentMessage,
  restrictedTextAgentRefusal,
} from "../lib/text-agent/tools";

export type CompletedTurn = Extract<
  HousingAgentTurnResult,
  { status: "completed" }
>;

export type HousingAgentHarness = {
  adapter: AgentAdapter;
  /** Every completed turn, in order — assertions read tool calls/results here. */
  turns: CompletedTurn[];
};

/**
 * Bridges the real housing agent into Scenario simulations. Mirrors the live
 * reply path's composition (deterministic gates first, then the tool loop)
 * against the real database and tools, but keeps conversation history in
 * memory: each simulated conversation is its own hermetic thread.
 *
 * Uses a dedicated eval identity so update_prefs writes land on a throwaway
 * profile, never a real person: set KINFOLK_EVAL_USER_ID / KINFOLK_EVAL_THREAD_ID.
 */
export function createHousingAgentHarness(): HousingAgentHarness {
  const userId = requiredEnv("KINFOLK_EVAL_USER_ID");
  const threadId = requiredEnv("KINFOLK_EVAL_THREAD_ID");
  const supabase = createSupabaseServiceClient();
  const turns: CompletedTurn[] = [];

  const adapter: AgentAdapter = {
    call: async (input: AgentInput) => {
      const body = lastUserText(input.messages);
      if (!body) {
        throw new Error("Housing agent harness called without a user message.");
      }

      const recentMessages = priorConversation(input.messages);
      const refusal = restrictedTextAgentRefusal(body);
      if (refusal) {
        return refusal;
      }
      if (isOffTopicTextAgentMessage(body, recentMessages)) {
        return buildTextAgentScopeDeclineReply();
      }

      // update_prefs persists only when it gets the stored inbound message and
      // thread rows (the live path always has them). Store the turn's message
      // for real so eval write semantics — and the reality guard — match prod.
      const { message, thread } = await storeInboundEvalMessage(supabase, {
        body,
        threadId,
        userId,
      });
      const result = await runHousingAgentTurn(supabase, {
        body,
        message,
        recentMessages,
        runId: `eval-${randomUUID()}`,
        thread,
        threadId,
        userId,
      });
      if (result.status !== "completed") {
        throw new Error(`Housing agent turn skipped: ${result.reason}`);
      }
      turns.push(result);
      return result.reply;
    },
    role: AgentRole.AGENT,
  };

  return { adapter, turns };
}

/**
 * Wipes everything the previous scenario taught the eval identity — saved
 * facts, preferences, thread memory, message history. Without this, facts
 * saved in scenario 3 surface in scenario 9's "brand-new user" context block
 * and read as hallucinations (the 2026-07-05 baseline's top false finding).
 */
export async function resetEvalIdentity() {
  const userId = requiredEnv("KINFOLK_EVAL_USER_ID");
  const threadId = requiredEnv("KINFOLK_EVAL_THREAD_ID");
  const supabase = createSupabaseServiceClient();

  const deletions = [
    supabase.from("profile_facts").delete().eq("user_id", userId),
    supabase.from("profile_update_proposals").delete().eq("user_id", userId),
    supabase.from("matching_profiles").delete().eq("user_id", userId),
    supabase.from("housing_preferences").delete().eq("user_id", userId),
    supabase.from("roommate_preferences").delete().eq("user_id", userId),
    supabase.from("text_thread_summaries").delete().eq("thread_id", threadId),
    // Stamped listing cards drive ordinal resolution ("the second one") — a
    // stale card from a previous scenario makes the agent answer with a
    // listing this conversation never showed, which judges as hallucination.
    supabase.from("text_listing_recommendations").delete().eq("thread_id", threadId),
    supabase.from("text_messages").delete().eq("thread_id", threadId),
  ];
  for (const deletion of deletions) {
    const result = await deletion;
    if (result.error) {
      throw new Error(`Eval identity reset failed: ${result.error.message}`);
    }
  }
}

async function storeInboundEvalMessage(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  { body, threadId, userId }: { body: string; threadId: string; userId: string },
) {
  const threadResult = await supabase
    .from("text_threads")
    .select("*")
    .eq("id", threadId)
    .single();
  if (threadResult.error) {
    throw new Error(`Eval thread ${threadId} not found: ${threadResult.error.message}`);
  }
  const thread = threadResult.data;

  const messageResult = await supabase
    .from("text_messages")
    .insert({
      body,
      direction: "inbound",
      from_phone_e164: thread.from_phone_e164,
      provider: thread.provider,
      provider_message_id: `eval-${randomUUID()}`,
      thread_id: thread.id,
      to_phone_e164: thread.to_phone_e164,
      user_id: userId,
    })
    .select("*")
    .single();
  if (messageResult.error) {
    throw new Error(`Failed to store eval inbound message: ${messageResult.error.message}`);
  }

  return { message: messageResult.data, thread };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for agent evals. Point it at the dedicated eval user/thread (see evals/README.md).`,
    );
  }
  return value;
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part
        ? String((part as { text: unknown }).text ?? "")
        : "",
    )
    .join(" ")
    .trim();
}

function lastUserText(messages: ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return messageText(message);
    }
  }
  return "";
}

// Everything before the final user message, in the {body, direction} shape the
// loop's history builder expects (inbound = user, outbound = agent).
function priorConversation(messages: ModelMessage[]) {
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  return messages
    .slice(0, Math.max(lastUserIndex, 0))
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      body: messageText(message),
      direction: message.role === "user" ? "inbound" : "outbound",
      receivedAt: new Date().toISOString(),
    }))
    .filter((entry) => entry.body.length > 0);
}
