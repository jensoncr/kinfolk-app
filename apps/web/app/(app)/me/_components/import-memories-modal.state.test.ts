import { describe, expect, it, vi } from "vitest";
import type { ProfileEnrichmentSnapshot } from "@/lib/shared/types";

import {
  buildImportMemoriesRequestPayload,
  canSubmitImportMemories,
  copyAssistantProfilePrompt,
  createInitialImportMemoriesState,
  type ImportMemoriesSubmitFetch,
  importMemoriesReducer,
  submitImportMemories,
} from "./import-memories-modal-state";
import { buildAssistantProfilePrompt } from "@/lib/profiles/enrichment-prompt";

function makeSnapshot(): ProfileEnrichmentSnapshot {
  return {
    source: {
      kind: "supabase",
      status: "connected",
      detail: "test",
    },
    imports: [],
    facts: [],
    conflicts: [],
    compatibility: [],
    gaps: [],
  };
}

describe("import memories modal state", () => {
  it("copies the exact assistant prompt and reports clipboard failures", async () => {
    const writeText = vi.fn(async () => {});
    const expectedPrompt = buildAssistantProfilePrompt("chatgpt");

    await expect(
      copyAssistantProfilePrompt(" ChatGPT ", { writeText }),
    ).resolves.toEqual({ ok: true, prompt: expectedPrompt });
    expect(writeText).toHaveBeenCalledWith(expectedPrompt);

    await expect(
      copyAssistantProfilePrompt("claude", {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      error: "The browser blocked clipboard access. Select and copy the prompt below.",
      prompt: buildAssistantProfilePrompt("claude"),
    });

    await expect(
      copyAssistantProfilePrompt("chatgpt", undefined),
    ).resolves.toEqual({
      ok: false,
      error: "Clipboard access is unavailable. Select and copy the prompt below.",
      prompt: expectedPrompt,
    });
  });

  it("normalizes the initial provider and derives its source label", () => {
    expect(createInitialImportMemoriesState("claude")).toMatchObject({
      provider: "claude",
      sourceLabel: "Claude memories",
    });
    expect(createInitialImportMemoriesState("  ChatGPT  ")).toMatchObject({
      provider: "chatgpt",
      sourceLabel: "ChatGPT memories",
    });
    expect(createInitialImportMemoriesState("unknown-provider")).toMatchObject({
      provider: "manual",
      sourceLabel: "Manual profile import",
    });
  });

  it("resets the source label when the provider changes", () => {
    const state = importMemoriesReducer(createInitialImportMemoriesState("chatgpt"), {
      type: "provider-changed",
      provider: "claude",
    });

    expect(state).toMatchObject({
      provider: "claude",
      sourceLabel: "Claude memories",
    });

    expect(
      importMemoriesReducer(state, {
        type: "provider-changed",
        provider: "  CHATGPT  ",
      }),
    ).toMatchObject({
      provider: "chatgpt",
      sourceLabel: "ChatGPT memories",
    });
  });

  it("keeps import disabled while busy or while the payload is blank", () => {
    const blank = createInitialImportMemoriesState("chatgpt");
    const withWhitespacePayload = importMemoriesReducer(blank, {
      type: "payload-changed",
      value: "   \n  ",
    });
    const withPayload = importMemoriesReducer(blank, {
      type: "payload-changed",
      value: "{\"facts\":[]}",
    });
    const busy = importMemoriesReducer(withPayload, { type: "import-started" });

    expect(canSubmitImportMemories(blank)).toBe(false);
    expect(canSubmitImportMemories(withWhitespacePayload)).toBe(false);
    expect(canSubmitImportMemories(withPayload)).toBe(true);
    expect(canSubmitImportMemories(busy)).toBe(false);
  });

  it("clears stale errors on import start and clears payload after success", () => {
    const failed = importMemoriesReducer(createInitialImportMemoriesState("chatgpt"), {
      type: "import-failed",
      error: "Bad JSON.",
    });
    const started = importMemoriesReducer(failed, { type: "import-started" });
    const withPayload = importMemoriesReducer(started, {
      type: "payload-changed",
      value: "{\"facts\":[]}",
    });

    expect(started).toMatchObject({ busy: true, error: null });
    expect(importMemoriesReducer(withPayload, { type: "import-succeeded" })).toMatchObject({
      busy: false,
      error: null,
      payloadText: "",
    });
  });

  it("builds the paste import payload with a trimmed source-label fallback", () => {
    const state = importMemoriesReducer(createInitialImportMemoriesState("chatgpt"), {
      type: "source-label-changed",
      value: "   ",
    });
    const withPayload = importMemoriesReducer(state, {
      type: "payload-changed",
      value: "  {\"facts\": []}  ",
    });

    expect(buildImportMemoriesRequestPayload(withPayload)).toEqual({
      provider: "chatgpt",
      method: "paste",
      sourceLabel: "Manual profile import",
      payload: "  {\"facts\": []}  ",
    });
  });

  it("submits pasted memories to the import API and returns the snapshot", async () => {
    const snapshot = makeSnapshot();
    const state = importMemoriesReducer(
      importMemoriesReducer(createInitialImportMemoriesState("CHATGPT"), {
        type: "source-label-changed",
        value: " ChatGPT export ",
      }),
      {
        type: "payload-changed",
        value: "{\"facts\":[]}",
      },
    );
    const fetcher = vi.fn<ImportMemoriesSubmitFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ snapshot }),
    }));

    await expect(submitImportMemories(state, fetcher)).resolves.toEqual({
      ok: true,
      provider: "chatgpt",
      snapshot,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/profile-enrichment/imports",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({
      method: "paste",
      payload: "{\"facts\":[]}",
      provider: "chatgpt",
      sourceLabel: "ChatGPT export",
    });
  });

  it("surfaces import API and transport failures without throwing", async () => {
    const state = importMemoriesReducer(createInitialImportMemoriesState("claude"), {
      type: "payload-changed",
      value: "{\"facts\":[]}",
    });

    await expect(
      submitImportMemories(
        state,
        vi.fn<ImportMemoriesSubmitFetch>(async () => ({
          ok: false,
          status: 400,
          json: async () => ({ error: "Bad profile dump." }),
        })),
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Bad profile dump.",
    });

    await expect(
      submitImportMemories(
        state,
        vi.fn<ImportMemoriesSubmitFetch>(async () => ({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error("not json");
          },
        })),
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Request failed with 502.",
    });

    await expect(
      submitImportMemories(
        state,
        vi.fn<ImportMemoriesSubmitFetch>(async () => {
          throw new Error("Network offline.");
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Network offline.",
    });
  });
});
