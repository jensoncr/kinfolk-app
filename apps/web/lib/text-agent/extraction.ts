import "server-only";
import { normalizeOpenRouterModelId, openRouterBaseUrl, openRouterHeaders } from "@/lib/integrations/openrouter-client";
import { normalizeModelFact, normalizeProfileAction, parseTextAgentExtractionResult, readNumber, textAgentExtractionSchema } from "@/lib/text-agent/extraction-schema";
import { buildTextAgentPrompt, textAgentSystemPrompt } from "@/lib/text-agent/prompt";
import { z } from "zod";
import type { TextAgentIntakeStep, TextProfileFact } from "@/lib/text-agent";
import type { Json } from "@/lib/supabase/types";

const defaultTextAgentModel = "google/gemini-3.1-flash-lite";

export const textAgentModel =
  process.env.KINFOLK_TEXT_AGENT_MODEL?.trim() || defaultTextAgentModel;

export const textAgentProvider = "openrouter";

const textAgentReasoningEffort =
  process.env.KINFOLK_TEXT_AGENT_REASONING_EFFORT?.trim() || "minimal";

const textAgentReasoningEnabled = process.env.KINFOLK_TEXT_AGENT_REASONING_ENABLED?.trim();

export type RecentTextMessage = {
  direction: "inbound" | "outbound" | string;
  body: string;
  receivedAt: string;
};

type ModelExtractionArgs = {
  activeIntakeStep?: TextAgentIntakeStep | null;
  body: string;
  knownPreferences?: Json | null;
  recentMessages?: RecentTextMessage[];
  threadId?: string;
  userId: string;
};

export type TextAgentGenerationResult = {
  finishReason?: unknown;
  object?: unknown;
  steps?: Array<{ text?: string }>;
  structuredOutput?: unknown;
  text?: string;
  totalUsage?: unknown;
  usage?: unknown;
  warnings?: unknown;
};

type TextAgentExtraction = z.infer<typeof textAgentExtractionSchema>;

export type TextAgentProfileAction = {
  action:
    | "replace_profile_facts"
    | "merge_profile_facts"
    | "clear_profile_slot"
    | "clear_budget_bound";
  bound: "max" | "min" | null;
  confidence: number;
  facts: TextProfileFact[];
  revokeFactKeys: string[];
  slot:
    | "budget"
    | "move_in"
    | "household_size"
    | "neighborhoods"
    | "home_preferences"
    | "roommate_preferences"
    | "unknown";
  userFacingSummary: string;
};

export type TextAgentModelExtraction = {
  costUsd: number | null;
  extraction: TextAgentExtraction;
  facts: TextProfileFact[];
  inputTokens: number | null;
  latencyMs: number;
  model: string;
  outputTokens: number | null;
  profileActions: TextAgentProfileAction[];
  provider: typeof textAgentProvider;
};

export function isTextAgentModelConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export async function extractTextProfileFactsWithModel({
  activeIntakeStep,
  body,
  knownPreferences,
  recentMessages,
}: ModelExtractionArgs): Promise<TextAgentModelExtraction> {
  const startedAt = Date.now();
  const messages = buildTextAgentPrompt({
    activeIntakeStep,
    body,
    knownPreferences,
    recentMessages,
  });
  const result = await generateDirectOpenRouterExtraction(messages, {
    activeIntakeStep,
  });
  const extraction = parseTextAgentExtractionResult(result);

  return buildTextAgentModelExtraction({
    extraction,
    resultForUsage: result,
    startedAt,
  });
}

function buildTextAgentModelExtraction({
  extraction,
  resultForUsage,
  startedAt,
}: {
  extraction: TextAgentExtraction;
  resultForUsage: TextAgentGenerationResult;
  startedAt: number;
}): TextAgentModelExtraction {
  const usage = readOpenRouterTokenUsage(
    resultForUsage.usage ?? resultForUsage.totalUsage,
  );

  return {
    costUsd: null,
    extraction,
    facts: extraction.facts.map(normalizeModelFact),
    inputTokens: usage.inputTokens,
    latencyMs: Date.now() - startedAt,
    model: textAgentModel,
    outputTokens: usage.outputTokens,
    profileActions: extraction.profile_actions.map(normalizeProfileAction),
    provider: textAgentProvider,
  };
}

async function generateDirectOpenRouterExtraction(
  messages: string,
  {
    activeIntakeStep,
  }: {
    activeIntakeStep?: TextAgentIntakeStep | null;
  } = {},
): Promise<TextAgentGenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY.");
  }

  const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
    body: JSON.stringify({
      max_tokens: activeIntakeStep ? 1100 : 1600,
      messages: [
        { content: textAgentSystemPrompt, role: "system" },
        { content: messages, role: "user" },
      ],
      model: normalizeOpenRouterModelId(textAgentModel),
      reasoning: buildOpenRouterReasoningConfig(),
      response_format: { type: "json_object" },
      temperature: 0.35,
    }),
    headers: {
      ...openRouterHeaders(),
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenRouter extraction fallback failed: ${response.status} ${response.statusText} ${rawBody.slice(0, 300)}`,
    );
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : {};
  const message =
    firstChoice.message && typeof firstChoice.message === "object"
      ? (firstChoice.message as Record<string, unknown>)
      : {};
  const text = readOpenRouterContent(message.content);

  return {
    finishReason: firstChoice.finish_reason,
    text,
    usage: payload.usage,
    warnings: payload.error ? [payload.error] : [],
  };
}

function buildOpenRouterReasoningConfig() {
  if (textAgentReasoningEnabled === "false") {
    return { enabled: false };
  }

  if (
    textAgentReasoningEnabled === undefined &&
    normalizeOpenRouterModelId(textAgentModel).startsWith("deepseek/")
  ) {
    return { enabled: false };
  }

  return { effort: textAgentReasoningEffort };
}

function readOpenRouterContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((part) => {
        if (typeof part === "string") {
          return [part];
        }
        if (!part || typeof part !== "object") {
          return [];
        }
        const record = part as Record<string, unknown>;
        return typeof record.text === "string" ? [record.text] : [];
      })
      .join("")
      .trim();
  }

  return "";
}

function readOpenRouterTokenUsage(usage: unknown) {
  const record =
    usage && typeof usage === "object"
      ? (usage as Record<string, unknown>)
      : {};

  return {
    inputTokens: readNumber(
      record.inputTokens ?? record.promptTokens ?? record.input_tokens,
    ),
    outputTokens: readNumber(
      record.outputTokens ?? record.completionTokens ?? record.output_tokens,
    ),
  };
}
