import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MatchesPaneProps = {
  snapshot: {
    apartments: unknown[];
    enrichmentReview: unknown;
    requests: unknown[];
    roommates: unknown[];
    status: string;
  };
};

type DashboardChromeProps = {
  active: string;
  children: React.ReactNode;
  snapshot: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  dashboardChrome: vi.fn(),
  getDashboardSnapshot: vi.fn(),
  getMatchesSnapshot: vi.fn(),
  matchesPane: vi.fn(),
}));

vi.mock("@/app/(app)/me/_components/dashboard-layout", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    DashboardChrome: (props: DashboardChromeProps) => {
      mocks.dashboardChrome(props);
      return React.createElement(
        "main",
        { "data-user-id": String(props.snapshot.userId ?? "") },
        props.children,
      );
    },
  };
});

vi.mock("@/app/(app)/me/_components/matches-pane", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    MatchesPane: (props: MatchesPaneProps) => {
      mocks.matchesPane(props);
      return React.createElement("section", {
        "data-apartment-count": String(props.snapshot.apartments.length),
        "data-request-count": String(props.snapshot.requests.length),
        "data-roommate-count": String(props.snapshot.roommates.length),
        "data-status": props.snapshot.status,
      });
    },
  };
});

vi.mock("@/lib/matching/matches", () => ({
  getMatchesSnapshot: mocks.getMatchesSnapshot,
}));

vi.mock("@/lib/profiles/dashboard", () => ({
  getDashboardSnapshot: mocks.getDashboardSnapshot,
}));

import MatchesPage from "./page";

function makeMatchesSnapshot({
  apartments = [{ id: "apartment-match-1" }],
  enrichmentReview = {
    memoriesHref: "/me/settings/memories",
    message: "3 imported facts are waiting for review in Memories.",
    pendingBehavioralCount: 1,
    pendingFactCount: 3,
  },
  requests = [{ id: "request-1" }],
  roommates = [{ id: "roommate-match-1" }],
  status = "connected",
}: Partial<MatchesPaneProps["snapshot"]> = {}): MatchesPaneProps["snapshot"] {
  return {
    apartments,
    enrichmentReview,
    requests,
    roommates,
    status,
  };
}

describe("MatchesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardSnapshot.mockResolvedValue({
      status: "ready",
      userId: "user-1",
    });
    mocks.getMatchesSnapshot.mockResolvedValue(makeMatchesSnapshot());
  });

  it("loads dashboard and matches snapshots and renders the full matches surface", async () => {
    const html = renderToStaticMarkup(await MatchesPage());

    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getMatchesSnapshot).toHaveBeenCalledOnce();

    const chromeProps = mocks.dashboardChrome.mock.calls[0]?.[0] as
      | DashboardChromeProps
      | undefined;
    expect(chromeProps?.snapshot).toEqual({
      status: "ready",
      userId: "user-1",
    });
    const paneProps = mocks.matchesPane.mock.calls[0]?.[0] as
      | MatchesPaneProps
      | undefined;
    expect(paneProps?.snapshot).toEqual(makeMatchesSnapshot());
    expect(html).toContain('data-status="connected"');
    expect(html).toContain('data-apartment-count="1"');
    expect(html).toContain('data-roommate-count="1"');
    expect(html).toContain('data-request-count="1"');
  });

  it("passes empty matches states through without inventing fallback data", async () => {
    mocks.getMatchesSnapshot.mockResolvedValueOnce(
      makeMatchesSnapshot({
        apartments: [],
        enrichmentReview: null,
        requests: [],
        roommates: [],
        status: "empty",
      }),
    );

    const html = renderToStaticMarkup(await MatchesPage());

    const props = mocks.matchesPane.mock.calls[0]?.[0] as
      | MatchesPaneProps
      | undefined;
    expect(props?.snapshot).toEqual({
      apartments: [],
      enrichmentReview: null,
      requests: [],
      roommates: [],
      status: "empty",
    });
    expect(html).toContain('data-status="empty"');
    expect(html).toContain('data-apartment-count="0"');
    expect(html).toContain('data-roommate-count="0"');
    expect(html).toContain('data-request-count="0"');
  });
});
