import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const mobileUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148";

const mocks = vi.hoisted(() => ({
  buildProfileEnrichmentFormValues: vi.fn(),
  getDashboardSnapshot: vi.fn(),
  getProfileSummarySnapshot: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/profiles/dashboard", () => ({
  getDashboardSnapshot: mocks.getDashboardSnapshot,
}));

vi.mock("@/lib/profiles/enrichment-form", () => ({
  buildProfileEnrichmentFormValues: mocks.buildProfileEnrichmentFormValues,
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  getProfileSummarySnapshot: mocks.getProfileSummarySnapshot,
}));

vi.mock("@/app/(app)/me/_components/enrichment/profile-enrichment-form", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ProfileEnrichmentForm: ({
      firstName,
      initialValues,
    }: {
      firstName: string;
      initialValues: Record<string, unknown>;
    }) =>
      React.createElement(
        "main",
        {
          "data-first-name": firstName,
          "data-full-name":
            typeof initialValues.fullName === "string"
              ? initialValues.fullName
              : "",
          "data-testid": "profile-enrichment-form",
        },
        `Enrich form for ${firstName}`,
      ),
  };
});

import EnrichProfilePage from "./page";

function searchParams(params: Record<string, string | string[] | undefined> = {}) {
  return Promise.resolve(params);
}

function headerStore({
  host,
  userAgent,
}: {
  host: string;
  userAgent: string;
}) {
  return {
    get(name: string) {
      if (name.toLowerCase() === "host") return host;
      if (name.toLowerCase() === "user-agent") return userAgent;
      return null;
    },
  };
}

function mockSnapshots(displayName = "Jamie Chen") {
  const snapshot = { user: { displayName } };
  const enrichment = { status: "connected" };
  const initialValues = { fullName: displayName || "Anonymous renter" };

  mocks.getDashboardSnapshot.mockResolvedValue(snapshot);
  mocks.getProfileSummarySnapshot.mockResolvedValue(enrichment);
  mocks.buildProfileEnrichmentFormValues.mockReturnValue(initialValues);

  return { enrichment, initialValues, snapshot };
}

describe("EnrichProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
    mockSnapshots();
  });

  it("builds the enrichment form from dashboard and enrichment snapshots", async () => {
    const { enrichment, initialValues, snapshot } = mockSnapshots("Jamie Chen");

    const html = renderToStaticMarkup(
      await EnrichProfilePage({ searchParams: searchParams({}) }),
    );

    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getProfileSummarySnapshot).toHaveBeenCalledOnce();
    expect(mocks.buildProfileEnrichmentFormValues).toHaveBeenCalledWith(
      snapshot,
      enrichment,
    );
    expect(html).toContain('data-testid="profile-enrichment-form"');
    expect(html).toContain('data-first-name="Jamie"');
    expect(html).toContain(`data-full-name="${initialValues.fullName}"`);
  });

  it("falls back to a friendly first name when the display name is blank", async () => {
    mockSnapshots("");

    const html = renderToStaticMarkup(
      await EnrichProfilePage({ searchParams: searchParams({}) }),
    );

    expect(html).toContain('data-first-name="there"');
    expect(html).toContain("Enrich form for there");
  });

  it("redirects desktop dev-tunnel SMS links to the local enrich page before loading data", async () => {
    vi.stubEnv("KINFOLK_DEV_LOCAL_BASE_URL", "http://127.0.0.1:5173");
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        host: "kinfolk.trycloudflare.com",
        userAgent: desktopUserAgent,
      }),
    );

    await expect(
      EnrichProfilePage({
        searchParams: searchParams({
          dev_local: "1",
          empty: "",
          multi: ["a", "", "b"],
          next: "/me",
          source: "sms_interview",
        }),
      }),
    ).rejects.toThrow(
      "redirect:http://127.0.0.1:5173/me/enrich?multi=a&multi=b&next=%2Fme&source=sms_interview",
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/me/enrich?multi=a&multi=b&next=%2Fme&source=sms_interview",
    );
    expect(mocks.getDashboardSnapshot).not.toHaveBeenCalled();
    expect(mocks.getProfileSummarySnapshot).not.toHaveBeenCalled();
  });

  it("does not redirect link previews or mobile users from the dev tunnel", async () => {
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        host: "kinfolk.trycloudflare.com",
        userAgent: mobileUserAgent,
      }),
    );

    const html = renderToStaticMarkup(
      await EnrichProfilePage({
        searchParams: searchParams({ source: "sms_interview" }),
      }),
    );

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(html).toContain('data-first-name="Jamie"');

    vi.clearAllMocks();
    mockSnapshots("Jamie Chen");
    mocks.headers.mockResolvedValueOnce(
      headerStore({
        host: "kinfolk.trycloudflare.com",
        userAgent: "Slackbot-LinkExpanding 1.0",
      }),
    );

    renderToStaticMarkup(
      await EnrichProfilePage({
        searchParams: searchParams({ source: "sms_interview" }),
      }),
    );

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
  });

  it("does not run dev redirect checks in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const html = renderToStaticMarkup(
      await EnrichProfilePage({
        searchParams: searchParams({ dev_local: "1", source: "sms_interview" }),
      }),
    );

    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getDashboardSnapshot).toHaveBeenCalledOnce();
    expect(html).toContain('data-testid="profile-enrichment-form"');
  });
});
