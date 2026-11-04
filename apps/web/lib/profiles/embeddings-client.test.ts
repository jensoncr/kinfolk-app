import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProfileEmbeddingsError,
  embedProfileCards,
  isProfileEmbeddingsConfigured,
} from "./embeddings-client";

vi.mock("server-only", () => ({}));

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalEmbeddingModel = process.env.KINFOLK_EMBEDDING_MODEL;

afterEach(() => {
  process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  process.env.KINFOLK_EMBEDDING_MODEL = originalEmbeddingModel;
  vi.unstubAllGlobals();
});

describe("embedProfileCards", () => {
  it("treats whitespace-only OpenRouter keys as unconfigured", () => {
    process.env.OPENROUTER_API_KEY = "   ";
    expect(isProfileEmbeddingsConfigured()).toBe(false);

    process.env.OPENROUTER_API_KEY = " test-key ";
    expect(isProfileEmbeddingsConfigured()).toBe(true);
  });

  it("returns 1536-dimensional OpenRouter embeddings", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const embedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(embedProfileCards(["quiet, tidy home"])).resolves.toEqual([
      embedding,
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/embeddings",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("uses the default embedding model when model config is blank", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.KINFOLK_EMBEDDING_MODEL = "   ";
    const embedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        void url;
        void init;
        return new Response(JSON.stringify({ data: [{ embedding }] }), {
          status: 200,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await embedProfileCards(["quiet, tidy home"]);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "openai/text-embedding-3-small",
    });
  });

  it("rejects embeddings with the wrong dimension", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
        }),
      ),
    );

    await expect(embedProfileCards(["too short"])).rejects.toBeInstanceOf(
      ProfileEmbeddingsError,
    );
  });

  it("rejects malformed embedding values instead of coercing them to zero", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const embedding = Array.from({ length: 1536 }, (_, index) =>
      index === 17 ? null : index / 1536,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ embedding }] }), {
          status: 200,
        }),
      ),
    );

    await expect(embedProfileCards(["malformed vector"])).rejects.toBeInstanceOf(
      ProfileEmbeddingsError,
    );
  });

  it("rejects provider responses that omit embeddings for requested inputs", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const embedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ embedding }] }), {
          status: 200,
        }),
      ),
    );

    await expect(
      embedProfileCards(["first card", "second card"]),
    ).rejects.toMatchObject({
      message:
        "OpenRouter embeddings response count mismatch: expected 2, received 1.",
    });
  });
});
