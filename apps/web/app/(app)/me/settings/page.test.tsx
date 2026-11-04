import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SettingsPaneProps = {
  enrichment: Record<string, unknown>;
  snapshot: Record<string, unknown>;
};
type PaneShellProps = {
  children: React.ReactNode;
  snapshot: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  getDashboardSnapshot: vi.fn(),
  getProfileSummarySnapshot: vi.fn(),
  paneShell: vi.fn(),
  settingsPane: vi.fn(),
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

vi.mock("@/app/(app)/me/_components/settings-page", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    SettingsPane: (props: SettingsPaneProps) => {
      mocks.settingsPane(props);
      return React.createElement("section", {
        "data-enrichment-status": String(props.enrichment.status ?? ""),
        "data-import-count": String(
          Array.isArray(props.enrichment.imports)
            ? props.enrichment.imports.length
            : 0,
        ),
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

import SettingsPage from "./page";

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardSnapshot.mockResolvedValue({
      status: "ready",
      user: { id: "user-1" },
    });
    mocks.getProfileSummarySnapshot.mockResolvedValue({
      imports: [{ id: "import-1" }],
      status: "connected",
    });
  });

  it("loads dashboard and enrichment snapshots and renders the settings pane", async () => {
    const html = renderToStaticMarkup(await SettingsPage());

    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getProfileSummarySnapshot).toHaveBeenCalledOnce();
    expect(mocks.settingsPane).toHaveBeenCalledWith({
      enrichment: {
        imports: [{ id: "import-1" }],
        status: "connected",
      },
      snapshot: {
        status: "ready",
        user: { id: "user-1" },
      },
    });
    expect(html).toContain('data-enrichment-status="connected"');
    expect(html).toContain('data-import-count="1"');
    expect(html).toContain('data-user-id="user-1"');
  });

  it("passes empty memory state through without inventing fallback settings data", async () => {
    mocks.getProfileSummarySnapshot.mockResolvedValueOnce({
      facts: [],
      imports: [],
      status: "empty",
    });

    const html = renderToStaticMarkup(await SettingsPage());

    expect(mocks.settingsPane).toHaveBeenCalledWith({
      enrichment: {
        facts: [],
        imports: [],
        status: "empty",
      },
      snapshot: {
        status: "ready",
        user: { id: "user-1" },
      },
    });
    expect(html).toContain('data-enrichment-status="empty"');
    expect(html).toContain('data-import-count="0"');
  });
});
