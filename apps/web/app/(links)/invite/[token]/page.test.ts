import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContactInviteLanding: vi.fn(),
}));

vi.mock("@/lib/contacts/network", () => ({
  getContactInviteLanding: mocks.getContactInviteLanding,
}));

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string | { toString: () => string };
    }) =>
      React.createElement(
        "a",
        { ...props, href: typeof href === "string" ? href : href.toString() },
        children,
      ),
  };
});

import InvitePage from "./page";

function renderInvitePage({ token = "share token" }: { token?: string } = {}) {
  return InvitePage({
    params: Promise.resolve({ token }),
  });
}

describe("InvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an inactive state when the invite is missing", async () => {
    mocks.getContactInviteLanding.mockResolvedValueOnce({ status: "missing" });

    const html = renderToStaticMarkup(await renderInvitePage());

    expect(mocks.getContactInviteLanding).toHaveBeenCalledWith("share token");
    expect(html).toContain("Invite not found");
    expect(html).toContain("This Kinfolk invite is no longer active.");
    expect(html).toContain('href="/"');
    expect(html).toContain("Open Kinfolk");
  });

  it("renders valid shared invite copy and unverified join links", async () => {
    mocks.getContactInviteLanding.mockResolvedValueOnce({
      groupLabel: "Future SF",
      inviterName: "Jamie",
      status: "found",
    });

    const html = renderToStaticMarkup(await renderInvitePage());

    expect(html).toContain("Roommate invite");
    expect(html).toContain("Future SF");
    expect(html).toContain(
      "Jamie invited you to compare apartments as a Kinfolk roommate group.",
    );
    expect(html).toContain(
      "You can review the group, add your preferences, and see apartments together.",
    );
    expect(html).not.toContain("Phone verified.");
    expect(html).toContain('href="/sign-up?invite=share%20token"');
    expect(html).toContain('href="/me?invite=share%20token"');
  });
});
