import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("next/image", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      alt = "",
      height,
      priority,
      src = "",
      width,
      ...props
    }: Record<string, unknown>) => {
      for (const key of ["fill", "quality", "sizes", "unoptimized"]) {
        delete props[key];
      }

      return React.createElement("img", {
        ...props,
        alt,
        "data-priority": priority === true ? "true" : undefined,
        height: typeof height === "number" ? height : undefined,
        src: typeof src === "string" ? src : "",
        width: typeof width === "number" ? width : undefined,
      });
    },
  };
});

import LandlordsPage from "./landlords/page";
import HowItWorksPage from "./how-it-works/page";
import Home from "./page";
import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

describe("public pages", () => {
  it("renders the landing route with renter CTA, preview sections, and footer links", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("Matching changes");
    expect(html).toContain("Talk to Kinfolk");
    expect(html).toContain('href="/me"');
    expect(html).toContain("Move in 4-12 weeks");
    expect(html).toContain("Two-sided approval");
    expect(html).toContain("Anonymous until you say");
    // Scroll-driven agent story: LinkedIn sign-in -> iMessage conversation
    expect(html).toContain("Continue with LinkedIn");
    expect(html).toContain("Welcome to Kinfolk.");
    expect(html).toContain("Sign in once with LinkedIn.");
    // New sections — statement band + FAQ
    expect(html).toContain("Together, you choose.");
    expect(html).toContain("Is Kinfolk free?");
    expect(html).toContain("Are these real apartments?");
    expect(html).toContain("How it works");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  it("renders the landlord sign-in page with Kinfolk handoff and renter link", () => {
    const html = renderToStaticMarkup(<LandlordsPage />);

    expect(html).toContain("Meet renter groups who");
    expect(html).toContain("already fit.");
    expect(html).toContain("For landlords and operators.");
    expect(html).toContain("Budget-qualified against live rent data");
    expect(html).toContain("Continue with Kinfolk");
    expect(html).toContain('href="/me"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  it("renders the how-it-works walkthrough with all five code-backed steps", () => {
    const html = renderToStaticMarkup(<HowItWorksPage />);

    expect(html).toContain("From <em");
    expect(html).toContain("What’s your LinkedIn?");
    expect(html).toContain("Hey Jenson.");
    expect(html).toContain("A few quick questions.");
    expect(html).toContain("New match, texted.");
    expect(html).toContain("Tell me more.");
    expect(html).toContain('src="/assets/flow/1.png"');
    const firstFlowImage = html.match(/<img[^>]*src="\/assets\/flow\/1\.png"[^>]*>/)?.[0] ?? "";
    expect(firstFlowImage).toContain('data-priority="true"');
    expect(html).toContain('src="/assets/flow/5.png"');
    expect(html).toContain('href="/me"');
  });

  it("renders the privacy placeholder with identity reveal copy and app return link", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain("Privacy");
    expect(html).toContain("A full privacy policy will replace this page");
    expect(html).toContain("identity and contact details hidden until the user approves");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to home");
  });

  it("renders the terms placeholder with launch-agreement copy and app return link", () => {
    const html = renderToStaticMarkup(<TermsPage />);

    expect(html).toContain("Terms");
    expect(html).toContain("These terms will be replaced before public launch");
    expect(html).toContain("do not rely on any match, listing, price, or availability as final");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to home");
  });
});
