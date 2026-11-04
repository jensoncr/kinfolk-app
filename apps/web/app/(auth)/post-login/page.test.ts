import { describe, expect, it, vi } from "vitest";
import { redirectUrlFromSearchParams } from "@/lib/shared/redirect";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import PostLoginPage from "./page";

async function expectPostLoginRedirect(
  searchParams: { redirecturl?: string | string[] },
  expectedPath: string,
) {
  redirectMock.mockClear();

  await expect(
    PostLoginPage({ searchParams: Promise.resolve(searchParams) }),
  ).rejects.toThrow(`redirect:${expectedPath}`);

  expect(redirectMock).toHaveBeenCalledWith(expectedPath);
}

describe("PostLoginPage", () => {
  it("redirects to /me when no redirect target is present", async () => {
    await expectPostLoginRedirect({}, "/me");
  });

  it("preserves safe same-origin paths with query and hash fragments", async () => {
    await expectPostLoginRedirect(
      { redirecturl: "/apartments?beds=2#map" },
      "/apartments?beds=2#map",
    );
  });

  it("uses the first redirect target when Clerk provides an array value", async () => {
    await expectPostLoginRedirect(
      { redirecturl: ["/me/profile", "/apartments"] },
      "/me/profile",
    );
  });

  it("falls back to /me for absolute external URLs", async () => {
    await expectPostLoginRedirect({ redirecturl: "https://example.com" }, "/me");
  });

  it("falls back to /me for protocol-relative URLs", async () => {
    await expectPostLoginRedirect({ redirecturl: "//example.com/path" }, "/me");
  });

  it("falls back to /me for browser-normalized external paths", async () => {
    await expectPostLoginRedirect({ redirecturl: "/\\example.com/path" }, "/me");
  });

  it("falls back to /me for dot-segment paths that normalize to protocol-relative", async () => {
    await expectPostLoginRedirect({ redirecturl: "/..//evil.com" }, "/me");
    await expectPostLoginRedirect({ redirecturl: "/path/..//evil.com/x" }, "/me");
  });

  it("falls back to /me for encoded dot-segment protocol-relative paths", async () => {
    await expectPostLoginRedirect({ redirecturl: "/%2e%2e//evil.com" }, "/me");
  });
});

describe("redirectUrlFromSearchParams", () => {
  it("defaults to /me when there are no preserved params", () => {
    expect(redirectUrlFromSearchParams()).toBe("/me");
    expect(redirectUrlFromSearchParams({ redirecturl: "" })).toBe("/me");
  });

  it("preserves scalar params for the authenticated destination", () => {
    expect(redirectUrlFromSearchParams({ tab: "plan", mode: "edit" })).toBe(
      "/me?tab=plan&mode=edit",
    );
  });

  it("appends non-empty array params in order", () => {
    expect(
      redirectUrlFromSearchParams({ filter: ["budget", "", "roommates"] }),
    ).toBe("/me?filter=budget&filter=roommates");
  });

  it("encodes nested redirect values instead of leaking raw query delimiters", () => {
    expect(
      redirectUrlFromSearchParams({
        redirecturl: "/apartments?neighborhood=Pac Heights&beds=2",
      }),
    ).toBe(
      "/me?redirecturl=%2Fapartments%3Fneighborhood%3DPac+Heights%26beds%3D2",
    );
  });
});
