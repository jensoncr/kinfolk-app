import { describe, expect, it, vi } from "vitest";
import type { ProfileEnrichmentSnapshot } from "@/lib/shared/types";

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string;
    }) => React.createElement("a", { ...props, href }, children),
  };
});

vi.mock("@/app/(app)/me/_components/sign-out-row", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    SignOutRow: () => React.createElement("button", { type: "button" }, "Log out"),
  };
});

vi.mock("@/app/(app)/me/_components/settings/connected-accounts-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ConnectedAccountsModal: ({ trigger }: { trigger: React.ReactNode }) =>
      React.createElement(React.Fragment, null, trigger),
  };
});

vi.mock("@/app/(app)/me/_components/settings/privacy-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    PrivacyModal: ({ trigger }: { trigger: React.ReactNode }) =>
      React.createElement(React.Fragment, null, trigger),
  };
});

vi.mock("@/app/(app)/me/_components/settings/profile-settings-modal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ProfileSettingsModal: ({ trigger }: { trigger: React.ReactNode }) =>
      React.createElement(React.Fragment, null, trigger),
  };
});

import { getMemoriesMeta } from "./settings-page-state";

type EnrichmentSubset = Pick<ProfileEnrichmentSnapshot, "facts" | "imports">;

function makeImport(
  overrides: Partial<ProfileEnrichmentSnapshot["imports"][number]> = {},
): ProfileEnrichmentSnapshot["imports"][number] {
  return {
    approvedFactCount: 0,
    createdAt: "2026-06-21T12:00:00.000Z",
    errorMessage: null,
    factCount: 0,
    id: "import-chatgpt",
    method: "upload",
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

function makeFact(
  overrides: Partial<ProfileEnrichmentSnapshot["facts"][number]> = {},
): ProfileEnrichmentSnapshot["facts"][number] {
  return {
    confidence: 0.9,
    createdAt: "2026-06-21T12:00:02.000Z",
    dimension: "lifestyle",
    evidenceExcerpt: "Likes quiet mornings.",
    factKey: "sleep_schedule",
    id: "fact-1",
    importId: "import-chatgpt",
    importance: 0.8,
    matchingEligible: true,
    reviewState: "approved",
    sensitivityLevel: "low",
    value: "early",
    ...overrides,
  };
}

function enrichment(overrides: Partial<EnrichmentSubset> = {}): EnrichmentSubset {
  return {
    facts: [],
    imports: [],
    ...overrides,
  };
}

describe("settings memories meta", () => {
  it("prompts enrichment when there are no assistant memory imports", () => {
    expect(
      getMemoriesMeta(
        enrichment({
          imports: [makeImport({ id: "import-linkedin", provider: "linkedin" })],
        }),
      ),
    ).toBe("Enrich with AI");
  });

  it("shows Imported when an assistant memory import has no imported facts yet", () => {
    expect(getMemoriesMeta(enrichment({ imports: [makeImport()] }))).toBe("Imported");
  });

  it("counts facts that came from assistant memory imports", () => {
    expect(
      getMemoriesMeta(
        enrichment({
          facts: [
            makeFact(),
            makeFact({ id: "fact-2", importId: "import-claude" }),
            makeFact({ id: "fact-3", importId: "import-linkedin" }),
          ],
          imports: [
            makeImport(),
            makeImport({ id: "import-claude", provider: "claude" }),
            makeImport({ id: "import-linkedin", provider: "linkedin" }),
          ],
        }),
      ),
    ).toBe("2 signals");
  });

  it("counts mixed-case assistant providers as imported memories", () => {
    expect(
      getMemoriesMeta(
        enrichment({
          facts: [makeFact()],
          imports: [makeImport({ provider: "ChatGPT" })],
        }),
      ),
    ).toBe("1 signals");
  });
});
