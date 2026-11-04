import { describe, expect, it } from "vitest";
import type { ProfileImportSummary } from "@/lib/shared/types";

import { getEnrichProviderRows } from "./enrich-profile-with-ai-state";

function makeImport(overrides: Partial<ProfileImportSummary> = {}): ProfileImportSummary {
  return {
    approvedFactCount: 0,
    createdAt: "2026-06-21T12:00:00.000Z",
    errorMessage: null,
    factCount: 0,
    id: "import-chatgpt",
    method: "paste",
    pendingFactCount: 0,
    processedAt: "2026-06-21T12:00:01.000Z",
    provider: "chatgpt",
    schemaVersion: "1",
    sensitiveFactCount: 0,
    sourceLabel: "ChatGPT memory",
    status: "processed",
    ...overrides,
  };
}

describe("enrich profile with AI row state", () => {
  it("shows fresh Claude and ChatGPT enrichment actions when there are no imports", () => {
    const rows = getEnrichProviderRows();

    expect(rows.map((row) => [row.provider, row.mode, row.label])).toEqual([
      ["claude", "enrich", "Enrich with Claude"],
      ["chatgpt", "enrich", "Enrich with ChatGPT"],
    ]);
    expect(rows[0]?.subtitle).toBe("Asks for you - paste the reply back");
    expect(rows[1]?.subtitle).toBe("Copies the prompt - paste it into ChatGPT");
    expect(rows.every((row) => row.href.startsWith("https://"))).toBe(true);
  });

  it("updates the copied provider subtitle without marking the other provider copied", () => {
    const rows = getEnrichProviderRows({ copiedProvider: "chatgpt" });

    expect(rows.find((row) => row.provider === "claude")?.copied).toBe(false);
    expect(rows.find((row) => row.provider === "chatgpt")).toMatchObject({
      copied: true,
      subtitle: "Prompt copied - paste it into ChatGPT",
    });
  });

  it("routes pending imports to Memories review instead of relaunching the assistant", () => {
    const rows = getEnrichProviderRows({
      imports: [makeImport({ pendingFactCount: 3 })],
    });

    expect(rows.find((row) => row.provider === "chatgpt")).toMatchObject({
      href: "/me/settings/memories",
      mode: "review",
      pending: 3,
      subtitle: "3 pending",
    });
    expect(rows.find((row) => row.provider === "claude")?.mode).toBe("enrich");
  });

  it("normalizes assistant import provider casing before deciding visibility", () => {
    const rows = getEnrichProviderRows({
      imports: [
        makeImport({
          id: "mixed-case-chatgpt",
          provider: "ChatGPT",
          pendingFactCount: 2,
        }),
      ],
    });

    expect(rows.find((row) => row.provider === "chatgpt")).toMatchObject({
      href: "/me/settings/memories",
      mode: "review",
      pending: 2,
      subtitle: "2 pending",
    });
    expect(rows.map((row) => row.provider)).toEqual(["claude", "chatgpt"]);
  });

  it("hides settled imports but keeps failed imports retryable", () => {
    const rows = getEnrichProviderRows({
      imports: [
        makeImport({ id: "settled-claude", provider: "claude" }),
        makeImport({ id: "failed-chatgpt", provider: "chatgpt", status: "failed" }),
      ],
    });

    expect(rows.map((row) => row.provider)).toEqual(["chatgpt"]);
    expect(rows[0]).toMatchObject({
      failed: true,
      mode: "enrich",
      subtitle: "Import failed - try again",
    });
  });

  it("forced preview can show already settled providers again", () => {
    expect(
      getEnrichProviderRows({
        imports: [
          makeImport({ id: "settled-claude", provider: "claude" }),
          makeImport({ id: "settled-chatgpt" }),
        ],
        previewAll: true,
      }).map((row) => [row.provider, row.mode]),
    ).toEqual([
      ["claude", "enrich"],
      ["chatgpt", "enrich"],
    ]);
  });

  it("respects providers hidden by the welcome flow after an import succeeds", () => {
    expect(
      getEnrichProviderRows({
        hiddenProviders: ["claude"],
      }).map((row) => row.provider),
    ).toEqual(["chatgpt"]);
  });
});
