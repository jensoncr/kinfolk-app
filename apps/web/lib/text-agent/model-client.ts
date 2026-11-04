import "server-only";

import {
  generateText,
  jsonSchema,
  tool,
  type ModelMessage,
  type ToolChoice,
  type ToolSet,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { withTracing } from "@posthog/ai";
import { readOpenRouterApiKey } from "../integrations/openrouter-client";
import { getPostHogServerClient } from "../integrations/posthog-server";

// The agent speaks OpenAI/OpenRouter chat-completion dialect internally (the
// loop, its guards, and 1,500 lines of tests are written against it). This
// module is the single seam where that dialect meets the Vercel AI SDK: it
// converts messages/tools in, runs generateText (which emits OpenTelemetry
// gen_ai spans and PostHog $ai_generation events), and converts the result
// back out. Swapping providers or observability backends happens here only.

type AgentChatToolDefinition = {
  function: {
    description: string;
    name: string;
    parameters: Record<string, unknown>;
  };
  type: "function";
};

type AgentChatMessage =
  | { content: string; role: "system" }
  | { content: string; role: "user" }
  | {
      content: string;
      role: "assistant";
      tool_calls?: Array<{
        function: { arguments: string; name: string };
        id: string;
        type: "function";
      }>;
    }
  | { content: string; role: "tool"; tool_call_id: string };

export type AgentChatCompletion = {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        function: { arguments: string; name: string };
        id: string;
        type: "function";
      }>;
    };
  }>;
  model?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

export type AgentChatRequest = {
  maxOutputTokens?: number;
  messages: AgentChatMessage[];
  metadata?: {
    runId?: string;
    threadId?: string;
    userId?: string;
  };
  model: string;
  operation: string;
  temperature?: number;
  timeoutMs?: number;
  toolChoice?: "auto" | "none" | "required";
  tools?: AgentChatToolDefinition[];
};

export async function completeAgentChat({
  maxOutputTokens,
  messages,
  metadata,
  model,
  operation,
  temperature,
  timeoutMs = 30_000,
  toolChoice,
  tools,
}: AgentChatRequest): Promise<{ data: AgentChatCompletion }> {
  const apiKey = readOpenRouterApiKey();
  if (!apiKey) {
    throw new Error(`Agent chat ${operation} requested without OPENROUTER_API_KEY.`);
  }

  const openrouter = createOpenRouter({ apiKey });
  const languageModel = wrapWithPostHog(openrouter.chat(model), {
    metadata,
    operation,
  });

  const toolSet = buildToolSet(tools);
  const result = await generateText({
    abortSignal: AbortSignal.timeout(timeoutMs),
    experimental_telemetry: {
      functionId: operation,
      isEnabled: true,
      metadata: {
        ...(metadata?.runId ? { runId: metadata.runId } : {}),
        ...(metadata?.threadId ? { threadId: metadata.threadId } : {}),
        ...(metadata?.userId ? { userId: metadata.userId } : {}),
      },
    },
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    messages: toModelMessages(messages),
    model: languageModel,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(toolSet
      ? {
          toolChoice: (toolChoice ?? "auto") as ToolChoice<ToolSet>,
          tools: toolSet,
        }
      : {}),
  });

  return { data: toChatCompletion(result, model) };
}

function wrapWithPostHog(
  model: ReturnType<ReturnType<typeof createOpenRouter>["chat"]>,
  {
    metadata,
    operation,
  }: {
    metadata?: AgentChatRequest["metadata"];
    operation: string;
  },
) {
  const posthog = getPostHogServerClient();
  if (!posthog) {
    return model;
  }
  // Content capture stays off unless explicitly enabled: full payloads live in
  // the trace store; PostHog gets model/latency/token/cost analytics only.
  return withTracing(model as Parameters<typeof withTracing>[0], posthog, {
    posthogDistinctId: metadata?.userId,
    posthogPrivacyMode:
      process.env.KINFOLK_POSTHOG_CAPTURE_LLM_CONTENT?.trim() !== "1",
    posthogProperties: {
      operation,
      runId: metadata?.runId,
      threadId: metadata?.threadId,
    },
    posthogTraceId: metadata?.runId,
  }) as unknown as typeof model;
}

function buildToolSet(
  tools: AgentChatToolDefinition[] | undefined,
): ToolSet | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  const toolSet: ToolSet = {};
  for (const definition of tools) {
    // No execute function on purpose: the loop owns tool execution (ordering,
    // guards, tracing), so generateText returns tool calls without running them.
    toolSet[definition.function.name] = tool({
      description: definition.function.description,
      inputSchema: jsonSchema<Record<string, unknown>>(
        definition.function.parameters,
      ),
    });
  }
  return toolSet;
}

function toModelMessages(messages: AgentChatMessage[]): ModelMessage[] {
  const toolNamesByCallId = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls) {
      for (const call of message.tool_calls) {
        toolNamesByCallId.set(call.id, call.function.name);
      }
    }
  }

  return messages.map((message): ModelMessage => {
    if (message.role === "system" || message.role === "user") {
      return { content: message.content, role: message.role };
    }

    if (message.role === "tool") {
      return {
        content: [
          {
            output: { type: "text" as const, value: message.content },
            toolCallId: message.tool_call_id,
            toolName: toolNamesByCallId.get(message.tool_call_id) ?? "unknown_tool",
            type: "tool-result" as const,
          },
        ],
        role: "tool",
      };
    }

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { content: message.content, role: "assistant" };
    }

    return {
      content: [
        ...(message.content.trim()
          ? [{ text: message.content, type: "text" as const }]
          : []),
        ...message.tool_calls.map((call) => ({
          input: safeParseJsonObject(call.function.arguments),
          toolCallId: call.id,
          toolName: call.function.name,
          type: "tool-call" as const,
        })),
      ],
      role: "assistant",
    };
  });
}

function toChatCompletion(
  result: Awaited<ReturnType<typeof generateText>>,
  requestedModel: string,
): AgentChatCompletion {
  const toolCalls = result.toolCalls.map((call) => ({
    function: {
      arguments: JSON.stringify(call.input ?? {}),
      name: call.toolName,
    },
    id: call.toolCallId,
    type: "function" as const,
  }));

  return {
    choices: [
      {
        message: {
          content: result.text ?? "",
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    model: result.response?.modelId ?? requestedModel,
    usage: {
      completion_tokens: result.usage?.outputTokens ?? undefined,
      prompt_tokens: result.usage?.inputTokens ?? undefined,
      total_tokens: result.usage?.totalTokens ?? undefined,
    },
  };
}

function safeParseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
