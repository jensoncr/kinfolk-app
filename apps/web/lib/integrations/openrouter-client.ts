import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import { safeJsonParse } from "@/lib/shared/safe-json";

export const openRouterBaseUrl = "https://openrouter.ai/api/v1";

export function openRouterHeaders() {
  const headers: Record<string, string> = {
    "X-Title": "Kinfolk",
  };

  const baseUrl = process.env.NEXT_PUBLIC_KINFOLK_BASE_URL?.trim();
  if (baseUrl) {
    headers["HTTP-Referer"] = baseUrl;
  }

  return headers;
}

export function readOpenRouterApiKey() {
  return process.env.OPENROUTER_API_KEY?.trim() ?? "";
}

export function normalizeOpenRouterModelId(model: string) {
  return model.replace(/^openrouter\//, "");
}

function shouldRetryOpenRouterStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export async function fetchOpenRouterJson<T>({
  body,
  operation,
  retries = 2,
  retryDelayMs = 400,
  timeoutMs = 30_000,
  url,
}: {
  body: unknown;
  operation: string;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  url: string;
}): Promise<{ data: T; response: Response; rawBody: string }> {
  const apiKey = readOpenRouterApiKey();

  if (!apiKey) {
    throw new Error(`OpenRouter ${operation} requested without OPENROUTER_API_KEY.`);
  }

  const attemptRequest = async (
    attempt: number,
  ): Promise<{ data: T; response: Response; rawBody: string }> => {
    let response: Response;
    let rawBody: string;
    let parsed: unknown;

    try {
      response = await fetch(url, {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          ...openRouterHeaders(),
        },
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      });
      rawBody = await response.text();
      parsed = rawBody ? safeJsonParse(rawBody) : null;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      await delay(retryDelayMs * 2 ** attempt);
      return attemptRequest(attempt + 1);
    }

    if (response.ok) {
      return { data: parsed as T, response, rawBody };
    }

    const error = new Error(
      `OpenRouter ${operation} failed: ${response.status} ${response.statusText} ${rawBody.slice(0, 300)}`,
    );

    if (!shouldRetryOpenRouterStatus(response.status) || attempt === retries) {
      throw error;
    }

    await delay(retryDelayMs * 2 ** attempt);
    return attemptRequest(attempt + 1);
  };

  return attemptRequest(0);
}
