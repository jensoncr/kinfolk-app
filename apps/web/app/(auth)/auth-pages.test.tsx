import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthShellProps = {
  path: string;
  redirectUrl?: string;
};

const mocks = vi.hoisted(() => ({
  clerkAuthShell: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  ssoCallbackClient: vi.fn(),
}));

vi.mock("@/components/auth/clerk-auth-shell", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ClerkAuthShell: (props: AuthShellProps) => {
      mocks.clerkAuthShell(props);
      return React.createElement("main", {
        "data-path": props.path,
        "data-redirect-url": props.redirectUrl,
      });
    },
  };
});

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("./sso-callback/sso-callback-client", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    SsoCallbackClient: () => {
      mocks.ssoCallbackClient();
      return React.createElement("main", { "data-testid": "sso-callback" });
    },
  };
});

import SignInPage from "./sign-in/[[...sign-in]]/page";
import ContinueSignUpPage from "./sign-up/continue/[[...continue]]/page";
import SignUpPage from "./sign-up/[[...sign-up]]/page";
import SsoCallbackPage from "./sso-callback/page";

describe("auth pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects sign-in traffic to the authenticated workspace", () => {
    expect(() => SignInPage()).toThrow("redirect:/me");
    expect(mocks.redirect).toHaveBeenCalledWith("/me");
  });

  it("renders the primary sign-up shell with preserved destination params", async () => {
    const html = renderToStaticMarkup(
      await SignUpPage({
        searchParams: Promise.resolve({
          code: "join-123",
          invite: "invite-abc",
        }),
      }),
    );

    expect(mocks.clerkAuthShell).toHaveBeenCalledWith({
      path: "/sign-up",
      redirectUrl: "/me?code=join-123&invite=invite-abc",
    });
    expect(html).toContain('data-path="/sign-up"');
    expect(html).toContain("data-redirect-url=");
    expect(html).toContain("/me?code=join-123&amp;invite=invite-abc");
  });

  it("renders the continue sign-up shell on the nested Clerk path", async () => {
    const html = renderToStaticMarkup(
      await ContinueSignUpPage({
        searchParams: Promise.resolve({
          tab: ["profile", "matches"],
        }),
      }),
    );

    expect(mocks.clerkAuthShell).toHaveBeenCalledWith({
      path: "/sign-up/continue",
      redirectUrl: "/me?tab=profile&tab=matches",
    });
    expect(html).toContain('data-path="/sign-up/continue"');
    expect(html).toContain("/me?tab=profile&amp;tab=matches");
  });

  it("renders the SSO callback client wrapper for Clerk redirect completion", () => {
    const html = renderToStaticMarkup(<SsoCallbackPage />);

    expect(mocks.ssoCallbackClient).toHaveBeenCalledOnce();
    expect(html).toContain('data-testid="sso-callback"');
  });
});
