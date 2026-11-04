import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

type SignUpProps = {
  appearance?: {
    elements?: Record<string, string>;
    variables?: Record<string, string>;
  };
  fallbackRedirectUrl?: string;
  forceRedirectUrl?: string;
  path?: string;
  routing?: string;
  signInUrl?: string;
};

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
}));

vi.mock("@clerk/nextjs", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    SignUp: (props: SignUpProps) => {
      mocks.signUp(props);
      return React.createElement("section", {
        "data-fallback-redirect-url": props.fallbackRedirectUrl,
        "data-force-redirect-url": props.forceRedirectUrl,
        "data-path": props.path,
        "data-routing": props.routing,
        "data-sign-in-url": props.signInUrl,
        "data-testid": "clerk-sign-up",
      });
    },
  };
});

import { ClerkAuthShell } from "./clerk-auth-shell";

describe("ClerkAuthShell", () => {
  it("wraps the Clerk sign-up form with Kinfolk branding and default workspace redirect", () => {
    const html = renderToStaticMarkup(<ClerkAuthShell path="/sign-up" />);

    expect(html).toContain("Create your Kinfolk account.");
    expect(html).toContain("Sign up to start matching with roommates");
    expect(html).toContain('data-testid="clerk-sign-up"');
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackRedirectUrl: "/me",
        forceRedirectUrl: "/post-login?redirecturl=%2Fme",
        path: "/sign-up",
        routing: "path",
        signInUrl: "/me",
      }),
    );
    expect(mocks.signUp.mock.calls[0][0].appearance).toMatchObject({
      variables: {
        colorPrimary: "#264a36",
        colorBackground: "#fdfcf8",
      },
      elements: {
        rootBox: "w-full",
      },
    });
  });

  it("preserves the requested destination through Clerk and post-login redirect", () => {
    const html = renderToStaticMarkup(
      <ClerkAuthShell
        path="/sign-up/continue"
        redirectUrl="/me/plan?invite=abc 123&tab=profile"
      />,
    );

    expect(html).toContain("Finish your Kinfolk account.");
    expect(html).toContain("LinkedIn is connected.");

    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackRedirectUrl: "/me/plan?invite=abc 123&tab=profile",
        forceRedirectUrl:
          "/post-login?redirecturl=%2Fme%2Fplan%3Finvite%3Dabc%20123%26tab%3Dprofile",
        path: "/sign-up/continue",
        routing: "path",
        signInUrl: "/me/plan?invite=abc 123&tab=profile",
      }),
    );
  });
});
