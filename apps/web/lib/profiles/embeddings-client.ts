import "server-only";

import {
  fetchOpenRouterJson,
  normalizeOpenRouterModelId,
  openRouterBaseUrl,
  readOpenRouterApiKey,
} from "../integrations/openrouter-client";

const defaultProfileEmbeddingModel = "openai/text-embedding-3-small";
const defaultProfileEmbeddingDimensions = 1536;

type OpenRouterEmbeddingResponse = {
  data?: Array<{ embedding?: unknown }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

export class ProfileEmbeddingsError extends Error {
  body: string | null;
  status: number | null;

  constructor(message: string, options: { body?: string | null; status?: number | null } = {}) {
    super(message);
    this.name = "ProfileEmbeddingsError";
    this.body = options.body ?? null;
    this.status = options.status ?? null;
  }
}

export function profileEmbeddingModel() {
  return normalizeOpenRouterModelId(
    process.env.KINFOLK_EMBEDDING_MODEL?.trim() ||
      defaultProfileEmbeddingModel,
  );
}

export function profileEmbeddingDimensions() {
  const raw = Number(process.env.KINFOLK_EMBEDDING_DIMENSIONS);
  return Number.isInteger(raw) && raw > 0 ? raw : defaultProfileEmbeddingDimensions;
}

export function isProfileEmbeddingsConfigured() {
  return Boolean(readOpenRouterApiKey());
}

export async function embedProfileCards(
  inputs: string[],
  options: { model?: string } = {},
): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const model = normalizeOpenRouterModelId(options.model ?? profileEmbeddingModel());
  const dimensions = profileEmbeddingDimensions();
  const startedAt = Date.now();

  let rawBody = "";
  let status: number | null = null;

  try {
    const result = await fetchOpenRouterJson<OpenRouterEmbeddingResponse>({
      body: {
        dimensions,
        input: inputs,
        model,
      },
      operation: "profile embeddings",
      url: `${openRouterBaseUrl}/embeddings`,
    });
    rawBody = result.rawBody;
    status = result.response.status;
    const embeddings = readEmbeddings(result.data, {
      dimensions,
      expectedCount: inputs.length,
    });

    if (process.env.KINFOLK_MATCH_DEBUG === "true") {
      console.info("kinfolk.profile_embeddings.embed", {
        inputCount: inputs.length,
        latencyMs: Date.now() - startedAt,
        model,
        promptTokens: result.data.usage?.prompt_tokens ?? null,
        totalTokens: result.data.usage?.total_tokens ?? null,
      });
    }

    return embeddings;
  } catch (error) {
    if (error instanceof ProfileEmbeddingsError) {
      throw error;
    }

    throw new ProfileEmbeddingsError(
      error instanceof Error ? error.message : "Profile embedding request failed.",
      {
        body: rawBody.slice(0, 500) || null,
        status,
      },
    );
  }
}

function readEmbeddings(
  response: OpenRouterEmbeddingResponse,
  {
    dimensions,
    expectedCount,
  }: {
    dimensions: number;
    expectedCount: number;
  },
) {
  const rows = Array.isArray(response.data) ? response.data : [];
  const embeddings = rows.map((row) => row.embedding);

  if (embeddings.length === 0) {
    throw new ProfileEmbeddingsError("OpenRouter embeddings response did not include data.");
  }

  if (embeddings.length !== expectedCount) {
    throw new ProfileEmbeddingsError(
      `OpenRouter embeddings response count mismatch: expected ${expectedCount}, received ${embeddings.length}.`,
    );
  }

  return embeddings.map((embedding, index) => {
    if (!Array.isArray(embedding)) {
      throw new ProfileEmbeddingsError(`Embedding ${index} was not an array.`);
    }

    if (
      embedding.length !== dimensions ||
      embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new ProfileEmbeddingsError(
        `Embedding ${index} had invalid dimensions: expected ${dimensions}, received ${embedding.length}.`,
      );
    }

    return embedding as number[];
  });
}
