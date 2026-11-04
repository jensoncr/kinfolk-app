import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backfillProfileEmbeddings,
  persistProfileEmbeddingCard,
  shouldUseProfileEmbeddings,
} from "./embeddings-store";

vi.mock("server-only", () => ({}));

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalEmbeddingDimensions = process.env.KINFOLK_EMBEDDING_DIMENSIONS;
const originalMatchUseEmbeddings = process.env.KINFOLK_MATCH_USE_EMBEDDINGS;

afterEach(() => {
  process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  process.env.KINFOLK_EMBEDDING_DIMENSIONS = originalEmbeddingDimensions;
  process.env.KINFOLK_MATCH_USE_EMBEDDINGS = originalMatchUseEmbeddings;
  vi.restoreAllMocks();
});

describe("shouldUseProfileEmbeddings", () => {
  it("honors padded false values as an explicit matching embedding disable", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.KINFOLK_MATCH_USE_EMBEDDINGS = " FALSE ";

    expect(shouldUseProfileEmbeddings()).toBe(false);

    process.env.KINFOLK_MATCH_USE_EMBEDDINGS = " true ";

    expect(shouldUseProfileEmbeddings()).toBe(true);
  });
});

describe("persistProfileEmbeddingCard", () => {
  it("skips the embedding API when the aggregate card hash is unchanged", async () => {
    process.env.KINFOLK_EMBEDDING_DIMENSIONS = "2";
    const query = makeProfileEmbeddingsQuery({
      content_hash: "same-hash",
      embedding: "[0.1,0.2]",
      id: "embedding-row",
    });
    const supabase = {
      from: vi.fn(() => query),
    };
    const embed = vi.fn();

    await expect(
      persistProfileEmbeddingCard(
        supabase as never,
        "user-1",
        {
          contentHash: "same-hash",
          sourceFactIds: [],
          text: "# Roommate profile\n## Lifestyle\ncleanliness: very tidy",
        },
        { embedProfileCards: embed as never },
      ),
    ).resolves.toMatchObject({ status: "unchanged" });

    expect(embed).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
  });

  it("refreshes unchanged aggregate cards when the stored embedding dimensions drift", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.KINFOLK_EMBEDDING_DIMENSIONS = "3";
    const query = makeProfileEmbeddingsQuery({
      content_hash: "same-hash",
      embedding: "[0.1,0.2]",
      id: "embedding-row",
    });
    const supabase = {
      from: vi.fn(() => query),
    };
    const embedding = [0.1, 0.2, 0.3];
    const embed = vi.fn(async () => [embedding]);

    await expect(
      persistProfileEmbeddingCard(
        supabase as never,
        "user-1",
        {
          contentHash: "same-hash",
          sourceFactIds: ["fact-1"],
          text: "# Roommate profile\n## Lifestyle\ncleanliness: very tidy",
        },
        { embedProfileCards: embed as never },
      ),
    ).resolves.toMatchObject({
      contentHash: "same-hash",
      sourceFactIds: ["fact-1"],
      status: "upserted",
      userId: "user-1",
    });

    expect(embed).toHaveBeenCalledWith(
      ["# Roommate profile\n## Lifestyle\ncleanliness: very tidy"],
      { model: "openai/text-embedding-3-small" },
    );
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding,
      }),
    );
    expect(query.eq).toHaveBeenCalledWith("id", "embedding-row");
    expect(query.insert).not.toHaveBeenCalled();
  });

  it("dry-runs a changed aggregate card without embedding or writing rows", async () => {
    const query = makeProfileEmbeddingsQuery({
      content_hash: "old-hash",
      embedding: "[0.1,0.2]",
      id: "embedding-row",
    });
    const supabase = {
      from: vi.fn(() => query),
    };
    const embed = vi.fn();

    await expect(
      persistProfileEmbeddingCard(
        supabase as never,
        "user-1",
        {
          contentHash: "new-hash",
          sourceFactIds: ["fact-1"],
          text: "# Roommate profile\n## Lifestyle\ncleanliness: very tidy",
        },
        { dryRun: true, embedProfileCards: embed as never },
      ),
    ).resolves.toMatchObject({
      contentHash: "new-hash",
      sourceFactIds: ["fact-1"],
      status: "dry_run",
      userId: "user-1",
    });

    expect(embed).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
  });

  it("removes an existing aggregate embedding when the card no longer has signals", async () => {
    const query = makeProfileEmbeddingsQuery({
      content_hash: "old-hash",
      embedding: "[0.1,0.2]",
      id: "embedding-row",
    });
    const supabase = {
      from: vi.fn(() => query),
    };
    const embed = vi.fn();

    await expect(
      persistProfileEmbeddingCard(
        supabase as never,
        "user-1",
        {
          contentHash: "empty-hash",
          sourceFactIds: [],
          text: "# Roommate profile",
        },
        { embedProfileCards: embed as never },
      ),
    ).resolves.toMatchObject({
      contentHash: "empty-hash",
      sourceFactIds: [],
      status: "empty",
      userId: "user-1",
    });

    expect(embed).not.toHaveBeenCalled();
    expect(query.delete).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenCalledWith("id", "embedding-row");
    expect(query.insert).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
  });

  it("dry-runs stale aggregate embedding removal without deleting rows", async () => {
    const query = makeProfileEmbeddingsQuery({
      content_hash: "old-hash",
      embedding: "[0.1,0.2]",
      id: "embedding-row",
    });
    const supabase = {
      from: vi.fn(() => query),
    };
    const embed = vi.fn();

    await expect(
      persistProfileEmbeddingCard(
        supabase as never,
        "user-1",
        {
          contentHash: "empty-hash",
          sourceFactIds: [],
          text: "# Roommate profile",
        },
        { dryRun: true, embedProfileCards: embed as never },
      ),
    ).resolves.toMatchObject({
      contentHash: "empty-hash",
      sourceFactIds: [],
      status: "dry_run",
      userId: "user-1",
    });

    expect(embed).not.toHaveBeenCalled();
    expect(query.delete).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
  });
});

describe("backfillProfileEmbeddings", () => {
  it("normalizes malformed direct limits before reading users", async () => {
    for (const limit of [Number.NaN, "", "   ", null, false, "12.5", 12.5]) {
      const malformed = makeUsersListQuery([]);

      await expect(
        backfillProfileEmbeddings(malformed.supabase as never, {
          limit,
        }),
      ).resolves.toMatchObject({ processed: 0 });
      expect(malformed.query.limit).toHaveBeenCalledWith(50);
    }

    const oversized = makeUsersListQuery([]);
    await expect(
      backfillProfileEmbeddings(oversized.supabase as never, {
        limit: 999,
      }),
    ).resolves.toMatchObject({ processed: 0 });
    expect(oversized.query.limit).toHaveBeenCalledWith(200);
  });

  it("normalizes direct user ids before deciding between targeted and batch reads", async () => {
    const targeted = makeUsersListQuery([{ id: "user-1" }]);
    const refreshProfileEmbedding = vi.fn(async (_supabase, userId: string) => ({
      embeddingModel: "test-model",
      status: "unchanged" as const,
      userId,
    }));

    await expect(
      backfillProfileEmbeddings(targeted.supabase as never, {
        upsertProfileEmbeddingForUser: refreshProfileEmbedding as never,
        userId: "  user-1  ",
      }),
    ).resolves.toMatchObject({
      failed: 0,
      processed: 1,
      unchanged: 1,
    });
    expect(targeted.query.eq).toHaveBeenCalledWith("id", "user-1");
    expect(targeted.query.order).not.toHaveBeenCalled();
    expect(targeted.query.limit).toHaveBeenCalledWith(1);
    expect(refreshProfileEmbedding).toHaveBeenCalledWith(
      targeted.supabase,
      "user-1",
      {
        dryRun: false,
        force: false,
      },
    );

    const blank = makeUsersListQuery([]);
    await expect(
      backfillProfileEmbeddings(blank.supabase as never, {
        userId: "   ",
      }),
    ).resolves.toMatchObject({ processed: 0 });
    expect(blank.query.eq).not.toHaveBeenCalled();
    expect(blank.query.order).toHaveBeenCalledWith("updated_at", {
      ascending: false,
    });
    expect(blank.query.limit).toHaveBeenCalledWith(50);
  });

  it("bounds profile embedding refresh concurrency during batch backfills", async () => {
    const users = Array.from({ length: 10 }, (_, index) => ({
      id: `user-${index + 1}`,
    }));
    const { query, supabase } = makeUsersListQuery(users);
    const deferreds: Array<() => void> = [];
    const refreshed: string[] = [];
    let active = 0;
    let maxActive = 0;
    const refreshProfileEmbedding = vi.fn(async (_supabase, userId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => deferreds.push(resolve));
      active -= 1;
      refreshed.push(userId);
      return {
        embeddingModel: "test-model",
        status: "unchanged" as const,
        userId,
      };
    });

    const run = backfillProfileEmbeddings(supabase as never, {
      limit: 10,
      upsertProfileEmbeddingForUser: refreshProfileEmbedding as never,
    });

    await Promise.resolve();
    expect(deferreds).toHaveLength(4);
    expect(maxActive).toBeLessThanOrEqual(4);

    while (deferreds.length > 0) {
      deferreds.splice(0, deferreds.length).forEach((resolve) => resolve());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await expect(run).resolves.toMatchObject({
      failed: 0,
      processed: 10,
      unchanged: 10,
    });
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(refreshProfileEmbedding).toHaveBeenCalledTimes(10);
    expect(refreshed.sort()).toEqual(users.map((user) => user.id).sort());
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("continues batch backfills when one profile embedding refresh fails", async () => {
    const users = [{ id: "user-1" }, { id: "user-2" }, { id: "user-3" }];
    const { query, supabase } = makeUsersListQuery(users);
    const refreshProfileEmbedding = vi.fn(async (_supabase, userId: string) => {
      if (userId === "user-2") {
        throw new Error("OpenRouter embeddings response did not include data.");
      }

      return {
        embeddingModel: "test-model",
        status: userId === "user-1" ? ("unchanged" as const) : ("upserted" as const),
        userId,
      };
    });

    await expect(
      backfillProfileEmbeddings(supabase as never, {
        force: true,
        limit: 3,
        upsertProfileEmbeddingForUser: refreshProfileEmbedding as never,
      }),
    ).resolves.toEqual({
      disabled: 0,
      dryRun: 0,
      empty: 0,
      failed: 1,
      failures: [
        {
          error: "OpenRouter embeddings response did not include data.",
          userId: "user-2",
        },
      ],
      processed: 2,
      unchanged: 1,
      upserted: 1,
    });

    expect(query.limit).toHaveBeenCalledWith(3);
    expect(refreshProfileEmbedding).toHaveBeenCalledTimes(3);
    expect(refreshProfileEmbedding).toHaveBeenNthCalledWith(1, supabase, "user-1", {
      dryRun: false,
      force: true,
    });
    expect(refreshProfileEmbedding).toHaveBeenNthCalledWith(3, supabase, "user-3", {
      dryRun: false,
      force: true,
    });
  });
});

function makeProfileEmbeddingsQuery(existing: unknown) {
  const query = {
    delete: vi.fn(() => query),
    eq: vi.fn(() => query),
    insert: vi.fn(async () => ({ data: null, error: null })),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: existing, error: null })),
    select: vi.fn(() => query),
    update: vi.fn(() => query),
  };

  return query;
}

function makeUsersListQuery(users: Array<{ id: string }>) {
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: users, error: null })),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
  };
  const supabase = {
    from: vi.fn(() => query),
  };

  return { query, supabase };
}
