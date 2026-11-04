import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getKinfolkBaseUrl,
  getKinfolkContactCardUrl,
  getKinfolkPublicMediaBaseUrl,
  getProfileEnrichmentFormUrl,
  getReviewUrl,
} from "./store-shared";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/contacts/contact-card", () => ({
  buildKinfolkContactCardUrl: ({ baseUrl }: { baseUrl: string }) =>
    `${baseUrl}/api/contacts/kinfolk.vcf`,
}));

describe("text agent shared URL helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes an HTTPS app URL for provider-fetched media", () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", " https://kinfolk.example.com/// ");

    expect(getKinfolkBaseUrl()).toBe("https://kinfolk.example.com");
    expect(getKinfolkPublicMediaBaseUrl()).toBe("https://kinfolk.example.com");
    expect(getKinfolkContactCardUrl()).toBe(
      "https://kinfolk.example.com/api/contacts/kinfolk.vcf",
    );
  });

  it("allows local HTTP app links while suppressing provider-fetched media", () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", " http://localhost:3000/app/// ");

    expect(getKinfolkBaseUrl()).toBe("http://localhost:3000");
    expect(getProfileEnrichmentFormUrl()).toBe(
      "http://localhost:3000/me/enrich?source=sms_interview",
    );
    expect(getReviewUrl()).toBe("http://localhost:3000/me/settings/memories");
    expect(getKinfolkPublicMediaBaseUrl()).toBe("");
    expect(getKinfolkContactCardUrl()).toBe("");
  });

  it.each([
    ["HTTP app URL", "http://kinfolk.example.com"],
    ["localhost app URL", "https://localhost:3000"],
    ["localhost subdomain app URL", "https://preview.localhost"],
    ["loopback app URL", "https://127.0.0.1:3000"],
    ["zero-address app URL", "https://0.0.0.0:3000"],
    ["private class A app URL", "https://10.1.2.3"],
    ["private class B app URL", "https://172.20.1.4"],
    ["link-local class B app URL", "https://169.254.1.4"],
    ["private class C app URL", "https://192.168.1.10:3000"],
    ["IPv6 loopback app URL", "https://[::1]:3000"],
    ["IPv6 unique-local app URL", "https://[fd00::1]:3000"],
    ["IPv6 link-local app URL", "https://[fe80::1]:3000"],
    ["IPv4-mapped private app URL", "https://[::ffff:192.168.1.10]:3000"],
    ["credentialed app URL", "https://user:pass@kinfolk.example.com/app"],
    ["malformed HTTPS app URL", "https://"],
  ])("rejects %s for provider-fetched media", (_label, baseUrl) => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", baseUrl);

    expect(getKinfolkPublicMediaBaseUrl()).toBe("");
    expect(getKinfolkContactCardUrl()).toBe("");
  });

  it.each([
    ["non-http app URL", "javascript:alert(1)"],
    ["FTP app URL", "ftp://kinfolk.example.com"],
    ["malformed app URL", "not a url"],
  ])("suppresses app links for %s", (_label, baseUrl) => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", baseUrl);

    expect(getKinfolkBaseUrl()).toBe("");
    expect(getProfileEnrichmentFormUrl()).toBe("");
    expect(getReviewUrl()).toBe("");
    expect(getKinfolkPublicMediaBaseUrl()).toBe("");
    expect(getKinfolkContactCardUrl()).toBe("");
  });
});
