import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type PaneShellProps = {
  active: string;
  children: React.ReactNode;
  snapshot: Record<string, unknown>;
  title: string;
};

type ProfilePaneProps = {
  continueOnPhoneConfig: Record<string, unknown>;
  view: {
    enrichment: Record<string, unknown>;
    snapshot: Record<string, unknown>;
  };
};

const mocks = vi.hoisted(() => ({
  buildProfileViewModel: vi.fn(),
  getDashboardSnapshot: vi.fn(),
  getContinueOnPhoneConfig: vi.fn(),
  getProfileSummarySnapshot: vi.fn(),
  paneShell: vi.fn(),
  profilePane: vi.fn(),
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

vi.mock("@/app/(app)/me/_components/profile-page", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ProfilePane: (props: ProfilePaneProps) => {
      mocks.profilePane(props);
      return React.createElement("section", {
        "data-enrichment-status": String(props.view.enrichment.status ?? ""),
        "data-fact-count": String(
          Array.isArray(props.view.enrichment.facts)
            ? props.view.enrichment.facts.length
            : 0,
        ),
      });
    },
  };
});

vi.mock("@/lib/integrations/continue-on-phone-server", () => ({
  getContinueOnPhoneConfig: mocks.getContinueOnPhoneConfig,
}));

vi.mock("@/lib/profiles/dashboard", () => ({
  getDashboardSnapshot: mocks.getDashboardSnapshot,
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  getProfileSummarySnapshot: mocks.getProfileSummarySnapshot,
}));

vi.mock("@/lib/profiles/view", () => ({
  buildProfileViewModel: mocks.buildProfileViewModel,
}));

import ProfilePage from "./page";

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardSnapshot.mockResolvedValue(dashboardSnapshot());
    mocks.getProfileSummarySnapshot.mockResolvedValue({
      facts: [{ id: "fact-1" }],
      status: "connected",
    });
    mocks.getContinueOnPhoneConfig.mockReturnValue({ enabled: true });
    mocks.buildProfileViewModel.mockImplementation((snapshot, enrichment) => ({
      enrichment,
      snapshot,
    }));
  });

  it("loads dashboard and enrichment snapshots and renders the profile pane", async () => {
    const html = renderToStaticMarkup(await ProfilePage());

    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getProfileSummarySnapshot).toHaveBeenCalledOnce();
    expect(mocks.buildProfileViewModel).toHaveBeenCalledWith(
      dashboardSnapshot(),
      { facts: [{ id: "fact-1" }], status: "connected" },
    );
    expect(mocks.profilePane).toHaveBeenCalledWith(
      expect.objectContaining({
        continueOnPhoneConfig: { enabled: true },
        view: {
          enrichment: { facts: [{ id: "fact-1" }], status: "connected" },
          snapshot: dashboardSnapshot(),
        },
      }),
    );
    expect(html).toContain('data-enrichment-status="connected"');
    expect(html).toContain('data-fact-count="1"');
    expect(html).toContain('data-user-id="user-1"');
  });

  it("passes empty enrichment state through without inventing profile facts", async () => {
    mocks.getProfileSummarySnapshot.mockResolvedValueOnce({
      facts: [],
      imports: [],
      status: "empty",
    });

    const html = renderToStaticMarkup(await ProfilePage());

    expect(mocks.profilePane).toHaveBeenCalledWith(
      expect.objectContaining({
        view: {
          enrichment: { facts: [], imports: [], status: "empty" },
          snapshot: dashboardSnapshot(),
        },
      }),
    );
    expect(html).toContain('data-enrichment-status="empty"');
    expect(html).toContain('data-fact-count="0"');
  });
});

function dashboardSnapshot() {
  return {
    housing: {
      dealbreakers: [],
      mustHaves: [],
      neighborhoods: [],
      pets: null,
    },
    interview: { status: "complete" },
    linkedinProfile: {
      education: [],
      enrichedAt: null,
      enrichmentStatus: "ready",
      workExperience: [],
    },
    profile: {
      aboutText: "Quiet mornings and dinner with friends.",
      budgetMax: 2600,
      budgetMin: 1800,
      householdSizeMax: 2,
      householdSizeMin: 1,
      moveInEnd: null,
      moveInStart: null,
      targetMarkets: [],
    },
    roommate: {
      cleanliness: null,
      hostingExpectations: null,
      sleepSchedule: null,
      socialEnergy: null,
    },
    status: "ready",
    user: { id: "user-1" },
  };
}
