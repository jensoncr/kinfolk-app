import { describe, expect, it } from "vitest";
import { buildDevLocalEnrichRedirectUrl } from "./dev-local-enrich-redirect-url";

const desktopUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const mobileUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148";

describe("dev local enrichment redirect", () => {
  it("redirects desktop SMS handoff clicks from the dev tunnel to localhost", () => {
    expect(
      buildDevLocalEnrichRedirectUrl({
        host: "example.trycloudflare.com",
        localBaseUrl: "http://localhost:3000",
        searchParams: { source: "sms_interview" },
        userAgent: desktopUserAgent,
      }),
    ).toBe("http://localhost:3000/me/enrich?source=sms_interview");
  });

  it("does not redirect mobile tunnel clicks", () => {
    expect(
      buildDevLocalEnrichRedirectUrl({
        host: "example.trycloudflare.com",
        localBaseUrl: "http://localhost:3000",
        searchParams: { source: "sms_interview" },
        userAgent: mobileUserAgent,
      }),
    ).toBe("");
  });

  it("does not redirect normal localhost visits", () => {
    expect(
      buildDevLocalEnrichRedirectUrl({
        host: "localhost:3000",
        localBaseUrl: "http://localhost:3000",
        searchParams: { source: "sms_interview" },
        userAgent: desktopUserAgent,
      }),
    ).toBe("");
  });

  it("does not redirect link-preview crawlers", () => {
    expect(
      buildDevLocalEnrichRedirectUrl({
        host: "example.trycloudflare.com",
        localBaseUrl: "http://localhost:3000",
        searchParams: { source: "sms_interview" },
        userAgent: "facebookexternalhit/1.1",
      }),
    ).toBe("");
  });

  it("drops the one-shot dev flag while preserving other query values", () => {
    expect(
      buildDevLocalEnrichRedirectUrl({
        host: "example.trycloudflare.com",
        localBaseUrl: "http://localhost:3000/path",
        searchParams: { dev_local: "1", provider: ["chatgpt", "claude"] },
        userAgent: desktopUserAgent,
      }),
    ).toBe(
      "http://localhost:3000/me/enrich?provider=chatgpt&provider=claude",
    );
  });
});
