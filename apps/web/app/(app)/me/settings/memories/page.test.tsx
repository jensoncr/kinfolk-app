import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ProfileEnrichmentPanelProps = {
  initialImportOpen?: boolean;
  initialProvider?: string;
  initialSnapshot: Record<string, unknown>;
};
type PaneShellProps = {
  children: React.ReactNode;
  snapshot: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  getDashboardSnapshot: vi.fn(),
  getProfileSummarySnapshot: vi.fn(),
  paneShell: vi.fn(),
  profileEnrichmentPanel: vi.fn(),
}));

vi.mock("@/app/(app)/me/_components/dashboard-layout", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    PaneShell: (props: PaneShellProps) => {
      mocks.paneShell(props);
      const user = props.snapshot.user as { id?: string } | undefined;
      return React.createElement(
        "main",
        { "data-user-id": String(user?.id ?? "") },
        props.children,
      );
    },
  };
});

vi.mock("@/app/(app)/me/_components/profile-enrichment-panel", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ProfileEnrichmentPanel: (props: ProfileEnrichmentPanelProps) => {
      mocks.profileEnrichmentPanel(props);
      return React.createElement("section", {
        "data-enrichment-status": String(props.initialSnapshot.status ?? ""),
        "data-fact-count": String(
          Array.isArray(props.initialSnapshot.facts)
            ? props.initialSnapshot.facts.length
            : 0,
        ),
        "data-import-open": String(Boolean(props.initialImportOpen)),
        "data-import-provider": String(props.initialProvider ?? ""),
      });
    },
  };
});

vi.mock("@/lib/profiles/dashboard", () => ({
  getDashboardSnapshot: mocks.getDashboardSnapshot,
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  getProfileSummarySnapshot: mocks.getProfileSummarySnapshot,
}));

import MemoriesSettingsPage from "./page";

describe("MemoriesSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardSnapshot.mockResolvedValue({
      status: "ready",
      user: { id: "user-1" },
    });
    mocks.getProfileSummarySnapshot.mockResolvedValue({
      facts: [{ id: "fact-1" }],
      imports: [{ id: "import-1" }],
      status: "connected",
    });
  });

  it("loads dashboard and enrichment snapshots and opens the requested import provider", async () => {
    const html = renderToStaticMarkup(
      await MemoriesSettingsPage({
        searchParams: Promise.resolve({ import: "1", provider: "chatgpt" }),
      }),
    );

    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getProfileSummarySnapshot).toHaveBeenCalledOnce();
    expect(mocks.profileEnrichmentPanel).toHaveBeenCalledWith({
      initialSnapshot: {
        facts: [{ id: "fact-1" }],
        imports: [{ id: "import-1" }],
        status: "connected",
      },
      initialImportOpen: true,
      initialProvider: "chatgpt",
    });
    expect(html).toContain('data-enrichment-status="connected"');
    expect(html).toContain('data-fact-count="1"');
    expect(html).toContain('data-import-open="true"');
    expect(html).toContain('data-import-provider="chatgpt"');
    expect(html).toContain('data-user-id="user-1"');
  });

  it("uses first search param values without opening import when import is not one", async () => {
    const html = renderToStaticMarkup(
      await MemoriesSettingsPage({
        searchParams: Promise.resolve({
          import: ["0", "1"],
          provider: ["claude", "chatgpt"],
        }),
      }),
    );

    expect(mocks.profileEnrichmentPanel).toHaveBeenCalledWith({
      initialSnapshot: {
        facts: [{ id: "fact-1" }],
        imports: [{ id: "import-1" }],
        status: "connected",
      },
      initialImportOpen: false,
      initialProvider: "claude",
    });
    expect(html).toContain('data-import-open="false"');
    expect(html).toContain('data-import-provider="claude"');
  });

  it("passes empty memory state through without inventing fallback import state", async () => {
    mocks.getProfileSummarySnapshot.mockResolvedValueOnce({
      facts: [],
      imports: [],
      status: "empty",
    });

    const html = renderToStaticMarkup(await MemoriesSettingsPage({}));

    expect(mocks.profileEnrichmentPanel).toHaveBeenCalledWith({
      initialSnapshot: {
        facts: [],
        imports: [],
        status: "empty",
      },
      initialImportOpen: false,
      initialProvider: undefined,
    });
    expect(html).toContain('data-enrichment-status="empty"');
    expect(html).toContain('data-fact-count="0"');
    expect(html).toContain('data-import-open="false"');
  });
});
