import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type HeaderMap = Record<string, string | null>;
type PlanPreviewMatch = {
  components: Array<{ label: string; score: number }>;
  headline: string;
  imageUrl: string | null;
  initials: string;
  name: string;
  score: number;
  userId: string;
};
type PlanPaneProps = {
  apartmentsHref: string;
  inviteLink: { openInviteCount: number; url: string } | null;
  matches: PlanPreviewMatch[];
  people: unknown[];
  plan: Record<string, unknown>;
  requestCount: number;
  savedAreas: string[];
  savedListings: unknown[];
};
type PaneShellProps = {
  children: React.ReactNode;
  snapshot: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  getDashboardSnapshot: vi.fn(),
  getMatchesSnapshot: vi.fn(),
  getPlanSnapshotForCurrentUser: vi.fn(),
  headers: vi.fn(),
  isViableRoommateMatch: vi.fn(),
  paneShell: vi.fn(),
  planPane: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/app/(app)/me/_components/dashboard-layout", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    PaneShell: (props: PaneShellProps) => {
      mocks.paneShell(props);
      return React.createElement("main", null, props.children);
    },
  };
});

vi.mock("@/app/(app)/me/_components/plan-pane", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    PlanPane: (props: PlanPaneProps) => {
      mocks.planPane(props);
      return React.createElement("main", {
        "data-apartments-href": props.apartmentsHref,
        "data-invite-url": props.inviteLink?.url ?? "",
        "data-match-names": props.matches
          .map((match) => match.name)
          .join("|"),
        "data-request-count": String(props.requestCount),
        "data-saved-area-count": String(props.savedAreas.length),
      });
    },
  };
});

vi.mock("@/lib/matching/matches", () => ({
  getMatchesSnapshot: mocks.getMatchesSnapshot,
}));

vi.mock("@/lib/matching/roommate-match-viability", () => ({
  isViableRoommateMatch: mocks.isViableRoommateMatch,
}));

vi.mock("@/lib/plan/plan", () => ({
  getPlanSnapshotForCurrentUser: mocks.getPlanSnapshotForCurrentUser,
}));

vi.mock("@/lib/profiles/dashboard", () => ({
  getDashboardSnapshot: mocks.getDashboardSnapshot,
}));

import PlanPage from "./page";

function headerStore(values: HeaderMap) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function roommateMatch(name: string, score: number) {
  return {
    components: [
      { key: "communication_fit", label: "Communication", score },
      { key: "home_labor_fit", label: "Home labor", score: Math.max(score - 7, 0) },
    ],
    headline: `${name} headline`,
    imageUrl: null,
    initials: name
      .split(" ")
      .map((part) => part.charAt(0))
      .join(""),
    name,
    score,
    userId: `user-${name.toLowerCase().replaceAll(" ", "-")}`,
  };
}

function mockPlanSnapshot({
  inviteLink = {
    openInviteCount: 2,
    url: "https://kinfolk.example/invite/abc",
  },
}: {
  inviteLink?: { openInviteCount: number; url: string } | null;
} = {}) {
  return {
    inviteLink,
    people: [{ userId: "person-1" }],
    plan: { futureCities: ["San Francisco, CA"] },
    savedAreas: ["Pacific Heights", "Nob Hill"],
    savedListings: [{ listingId: "listing-1" }],
  };
}

describe("PlanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(
      headerStore({ origin: "https://kinfolk.example" }),
    );
    mocks.getDashboardSnapshot.mockResolvedValue({
      status: "ready",
      user: { displayName: "Jenson Cripps" },
    });
    mocks.getPlanSnapshotForCurrentUser.mockResolvedValue(mockPlanSnapshot());
    mocks.getMatchesSnapshot.mockResolvedValue({
      requests: [{ id: "request-1" }, { id: "request-2" }],
      roommates: [
        roommateMatch("Mina Lee", 92),
        roommateMatch("Zero Score", 0),
        roommateMatch("Avery Reed", 88),
        roommateMatch("Theo Park", 81),
        roommateMatch("Sam Rivera", 79),
        roommateMatch("Fifth Viable", 77),
      ],
    });
    mocks.isViableRoommateMatch.mockImplementation(
      (match: { score: number }) => match.score > 0,
    );
  });

  it("loads plan data with the request origin and renders the top four viable matches", async () => {
    const html = renderToStaticMarkup(await PlanPage());

    expect(mocks.headers).toHaveBeenCalledOnce();
    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getPlanSnapshotForCurrentUser).toHaveBeenCalledWith(
      "https://kinfolk.example",
    );
    expect(mocks.getMatchesSnapshot).toHaveBeenCalledOnce();
    expect(mocks.isViableRoommateMatch).toHaveBeenCalledTimes(6);

    const props = mocks.planPane.mock.calls[0]?.[0] as
      | PlanPaneProps
      | undefined;
    expect(props?.matches.map((match) => match.name)).toEqual([
      "Mina Lee",
      "Avery Reed",
      "Theo Park",
      "Sam Rivera",
    ]);
    expect(props?.matches[0]).toMatchObject({
      components: [
        { label: "Communication", score: 92 },
        { label: "Home labor", score: 85 },
      ],
      headline: "Mina Lee headline",
      imageUrl: null,
      initials: "ML",
      name: "Mina Lee",
      score: 92,
      userId: "user-mina-lee",
    });
    expect(props?.requestCount).toBe(2);
    expect(props?.inviteLink).toEqual({
      openInviteCount: 2,
      url: "https://kinfolk.example/invite/abc",
    });
    expect(props?.apartmentsHref).toBe("/apartments");
    expect(html).toContain('data-match-names="Mina Lee|Avery Reed|Theo Park|Sam Rivera"');
    expect(html).toContain('data-request-count="2"');
  });

  it("passes a null origin and null invite link through safely", async () => {
    mocks.headers.mockResolvedValueOnce(headerStore({ origin: null }));
    mocks.getPlanSnapshotForCurrentUser.mockResolvedValueOnce(
      mockPlanSnapshot({ inviteLink: null }),
    );

    const html = renderToStaticMarkup(await PlanPage());

    expect(mocks.getPlanSnapshotForCurrentUser).toHaveBeenCalledWith(null);

    const props = mocks.planPane.mock.calls[0]?.[0] as
      | PlanPaneProps
      | undefined;
    expect(props?.inviteLink).toBeNull();
    expect(html).toContain('data-invite-url=""');
    expect(html).toContain('data-saved-area-count="2"');
  });

  it("falls back to forwarded request headers when Origin is absent", async () => {
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        origin: null,
        "x-forwarded-host": "plans.kinfolk.example, proxy.internal",
        "x-forwarded-proto": "https",
      }),
    );

    await PlanPage();

    expect(mocks.getPlanSnapshotForCurrentUser).toHaveBeenCalledWith(
      "https://plans.kinfolk.example",
    );
  });

  it("ignores non-http origin values before building invite links", async () => {
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        origin: "null",
        "x-forwarded-host": "plans.kinfolk.example",
        "x-forwarded-proto": "https",
      }),
    );

    await PlanPage();

    expect(mocks.getPlanSnapshotForCurrentUser).toHaveBeenCalledWith(
      "https://plans.kinfolk.example",
    );
  });

  it("ignores unsupported forwarded protocols before building invite links", async () => {
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        origin: null,
        "x-forwarded-host": "plans.kinfolk.example",
        "x-forwarded-proto": "javascript",
      }),
    );

    await PlanPage();

    expect(mocks.getPlanSnapshotForCurrentUser).toHaveBeenCalledWith(
      "https://plans.kinfolk.example",
    );
  });

  it("rejects malformed forwarded hosts before building invite links", async () => {
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        host: null,
        origin: null,
        "x-forwarded-host": "plans.kinfolk.example/path",
        "x-forwarded-proto": "https",
      }),
    );

    await PlanPage();

    expect(mocks.getPlanSnapshotForCurrentUser).toHaveBeenCalledWith(null);
  });

  it("uses a local host fallback when forwarded headers are absent", async () => {
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        host: "localhost:3000",
        origin: null,
      }),
    );

    await PlanPage();

    expect(mocks.getPlanSnapshotForCurrentUser).toHaveBeenCalledWith(
      "http://localhost:3000",
    );
  });
});
