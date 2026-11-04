import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimContactInviteForCurrentUser: vi.fn(),
  getDashboardSnapshot: vi.fn(),
  getProfileSummarySnapshot: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/contacts/network", () => ({
  claimContactInviteForCurrentUser: mocks.claimContactInviteForCurrentUser,
}));

vi.mock("@/lib/profiles/dashboard", () => ({
  getDashboardSnapshot: mocks.getDashboardSnapshot,
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  getProfileSummarySnapshot: mocks.getProfileSummarySnapshot,
}));

vi.mock("@/app/(app)/me/_components/dashboard-shell", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    DashboardShell: ({
      enrichment,
      snapshot,
    }: {
      enrichment: { status: string };
      snapshot: { status: string };
    }) =>
      React.createElement("main", {
        "data-enrichment-status": enrichment.status,
        "data-snapshot-status": snapshot.status,
      }),
  };
});

import MePage from "./page";

function searchParams(
  params: Record<string, string | string[] | undefined> = {},
) {
  return Promise.resolve(params);
}

async function expectRedirect(
  params: Record<string, string | string[] | undefined>,
  claimStatus: string,
  expectedPath: string,
) {
  mocks.claimContactInviteForCurrentUser.mockResolvedValueOnce({
    status: claimStatus,
  });

  await expect(MePage({ searchParams: searchParams(params) })).rejects.toThrow(
    `redirect:${expectedPath}`,
  );

  expect(mocks.redirect).toHaveBeenCalledWith(expectedPath);
}

describe("MePage invite handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardSnapshot.mockResolvedValue({ status: "ready" });
    mocks.getProfileSummarySnapshot.mockResolvedValue({ status: "connected" });
  });

  it("redirects claimed invite recipients to the plan claimed state", async () => {
    await expectRedirect(
      { invite: [" invite-token "] },
      "claimed",
      "/me/plan?invite=claimed",
    );

    expect(mocks.claimContactInviteForCurrentUser).toHaveBeenCalledWith({
      token: "invite-token",
    });
    expect(mocks.getDashboardSnapshot).not.toHaveBeenCalled();
    expect(mocks.getProfileSummarySnapshot).not.toHaveBeenCalled();
  });

  it("redirects existing owners to the same claimed plan state", async () => {
    await expectRedirect(
      { invite: "group-token" },
      "already_owner",
      "/me/plan?invite=claimed",
    );
  });

  it("redirects missing invites to a dashboard error flag", async () => {
    await expectRedirect(
      { invite: "missing-token" },
      "missing",
      "/me?invite_error=missing",
    );
  });

  it("preserves the invite when sign-in is required", async () => {
    await expectRedirect(
      { invite: "invite token" },
      "sign_in_required",
      "/sign-up?invite=invite+token",
    );
  });

  it("renders the dashboard when no invite claim is requested", async () => {
    const element = await MePage({ searchParams: searchParams({}) });

    expect(mocks.claimContactInviteForCurrentUser).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(element)).toBe(
      '<main data-enrichment-status="connected" data-snapshot-status="ready"></main>',
    );
  });

  it("ignores an empty invite parameter and renders the dashboard", async () => {
    const element = await MePage({ searchParams: searchParams({ invite: " " }) });

    expect(mocks.claimContactInviteForCurrentUser).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(element)).toContain(
      'data-snapshot-status="ready"',
    );
  });
});
