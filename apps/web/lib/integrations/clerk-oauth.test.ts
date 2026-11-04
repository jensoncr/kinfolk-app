import { describe, expect, it } from "vitest";
import { buildAuthRedirectUrls } from "./clerk-oauth";

describe("buildAuthRedirectUrls", () => {
  it("bundles a path-only redirecturl pointing back at the current page", () => {
    const { completeUrl } = buildAuthRedirectUrls({
      origin: "https://kinfolk.app",
      pathname: "/me",
      searchParams: new URLSearchParams("tab=plan"),
    });

    const parsed = new URL(completeUrl);
    expect(parsed.origin).toBe("https://kinfolk.app");
    expect(parsed.pathname).toBe("/post-login");
    expect(parsed.searchParams.get("redirecturl")).toBe("/me?tab=plan");
  });

  it("does not let a spread redirecturl param clobber the bundled safe value", () => {
    // An attacker link like /me?redirecturl=/..//evil.com must not be able to
    // overwrite the bundled, path-only redirecturl carried into /post-login.
    const { completeUrl } = buildAuthRedirectUrls({
      origin: "https://kinfolk.app",
      pathname: "/me",
      searchParams: new URLSearchParams("redirecturl=/..//evil.com"),
      spreadSearchParams: true,
    });

    const redirecturl = new URL(completeUrl).searchParams.get("redirecturl");
    expect(redirecturl).not.toBe("/..//evil.com");
    // The bundled value stays same-origin (a path on /me), so /post-login keeps
    // the user on Kinfolk rather than following the off-site target.
    expect(redirecturl?.startsWith("/me")).toBe(true);
  });

  it("still spreads non-redirect params onto the complete URL", () => {
    const { completeUrl } = buildAuthRedirectUrls({
      origin: "https://kinfolk.app",
      pathname: "/me",
      searchParams: new URLSearchParams("tab=plan&redirecturl=/evil"),
      spreadSearchParams: true,
    });

    const parsed = new URL(completeUrl);
    expect(parsed.searchParams.get("tab")).toBe("plan");
    expect(parsed.searchParams.get("redirecturl")?.startsWith("/me")).toBe(true);
  });
});
