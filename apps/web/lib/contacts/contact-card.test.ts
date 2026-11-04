import { describe, expect, it } from "vitest";
import {
  buildKinfolkContactCardUrl,
  buildKinfolkVCard,
  kinfolkContactCardPath,
  normalizeKinfolkContactCardBaseUrl,
  normalizeKinfolkContactWebsiteUrl,
} from "./contact-card";

describe("Kinfolk contact card", () => {
  it("builds a public vCard URL that ends in .vcf for Sendblue", () => {
    expect(
      buildKinfolkContactCardUrl({
        baseUrl: "https://kinfolk.example.com/",
      }),
    ).toBe("https://kinfolk.example.com/api/kinfolk/contact-card.vcf");
    expect(kinfolkContactCardPath.endsWith(".vcf")).toBe(true);
  });

  it("rejects malformed or non-web base URLs before building a public vCard URL", () => {
    expect(normalizeKinfolkContactCardBaseUrl(" https://kinfolk.example.com/app ")).toBe(
      "https://kinfolk.example.com",
    );
    expect(buildKinfolkContactCardUrl({ baseUrl: "ftp://kinfolk.example.com" })).toBe("");
    expect(buildKinfolkContactCardUrl({ baseUrl: "javascript:alert(1)" })).toBe("");
    expect(buildKinfolkContactCardUrl({ baseUrl: "https://user:pass@example.com" })).toBe("");
  });

  it("includes Kinfolk identity, phone, website, note, and embedded logo", () => {
    const card = buildKinfolkVCard({
      baseUrl: "https://kinfolk.example.com",
      logoBase64: "abc123",
      phoneNumber: "+14155550147",
    });

    expect(card).toContain("BEGIN:VCARD\r\n");
    expect(card).toContain("VERSION:3.0\r\n");
    expect(card).toContain("FN:Kinfolk\r\n");
    expect(card).toContain("ORG:Kinfolk\r\n");
    expect(card).toContain("TEL;TYPE=CELL:+14155550147\r\n");
    expect(card).toContain("URL:https://kinfolk.example.com\r\n");
    expect(card).toContain("NOTE:Your Kinfolk apartment and roommate matching assistant.");
    expect(card).toContain("PHOTO;ENCODING=b;TYPE=PNG:abc123\r\n");
    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("emits only valid web URLs in the saved contact website field", () => {
    expect(normalizeKinfolkContactWebsiteUrl(" https://usekinfolk.com/help?source=vcf ")).toBe(
      "https://usekinfolk.com/help?source=vcf",
    );
    expect(normalizeKinfolkContactWebsiteUrl("https://usekinfolk.com///")).toBe(
      "https://usekinfolk.com",
    );
    expect(normalizeKinfolkContactWebsiteUrl("ftp://usekinfolk.com")).toBe("");
    expect(normalizeKinfolkContactWebsiteUrl("https://user:pass@example.com")).toBe("");

    const fallbackCard = buildKinfolkVCard({
      baseUrl: " https://kinfolk.example.com/app ",
      websiteUrl: "javascript:alert(1)",
    });
    expect(fallbackCard).toContain("URL:https://kinfolk.example.com\r\n");
    expect(fallbackCard).not.toContain("javascript:");

    const omittedCard = buildKinfolkVCard({
      baseUrl: "file:///tmp",
      websiteUrl: "not a url",
    });
    expect(omittedCard).not.toContain("\r\nURL:");
  });

  it("folds long vCard lines with continuation whitespace", () => {
    const card = buildKinfolkVCard({
      logoBase64: "a".repeat(120),
    });

    expect(card).toContain("\r\n ");
    for (const line of card.split("\r\n").filter(Boolean)) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});
