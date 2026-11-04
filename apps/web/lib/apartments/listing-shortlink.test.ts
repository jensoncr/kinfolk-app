import { describe, expect, it } from "vitest";
import {
  buildListingShortlinkUrl,
  decodeListingShortCode,
  encodeListingShortCode,
  normalizeListingShortlinkBaseUrl,
} from "./listing-shortlink";

describe("listing shortlink codes", () => {
  it("round-trips a listing uuid through a short deterministic code", () => {
    const listingId = "8f14e45f-ceea-467f-a8d4-91b2c3d4e5f6";
    const code = encodeListingShortCode(listingId);

    expect(code).toBeTruthy();
    expect(code!.length).toBeLessThanOrEqual(22);
    expect(code).toMatch(/^[0-9A-Za-z]+$/);
    expect(encodeListingShortCode(listingId)).toBe(code);
    expect(decodeListingShortCode(code)).toBe(listingId);
  });

  it("normalizes uuid casing and whitespace before encoding", () => {
    const code = encodeListingShortCode(
      "  8F14E45F-CEEA-467F-A8D4-91B2C3D4E5F6  ",
    );
    expect(decodeListingShortCode(code)).toBe(
      "8f14e45f-ceea-467f-a8d4-91b2c3d4e5f6",
    );
  });

  it("preserves leading zero bytes of the uuid", () => {
    const listingId = "0000a1b2-0c3d-4e5f-8a9b-000000000001";
    expect(decodeListingShortCode(encodeListingShortCode(listingId))).toBe(
      listingId,
    );
  });

  it("refuses to encode anything that is not a uuid", () => {
    expect(encodeListingShortCode("listing-1")).toBeNull();
    expect(encodeListingShortCode("")).toBeNull();
    expect(encodeListingShortCode(null)).toBeNull();
    expect(encodeListingShortCode(undefined)).toBeNull();
  });

  it("rejects malformed or out-of-range codes", () => {
    expect(decodeListingShortCode(null)).toBeNull();
    expect(decodeListingShortCode("")).toBeNull();
    expect(decodeListingShortCode("not a code!")).toBeNull();
    expect(decodeListingShortCode("z".repeat(23))).toBeNull();
    expect(decodeListingShortCode("z".repeat(22))).toBeNull();
  });
});

describe("buildListingShortlinkUrl", () => {
  const listingId = "8f14e45f-ceea-467f-a8d4-91b2c3d4e5f6";

  it("builds a short /l/<code> link that decodes back to the listing", () => {
    const url = buildListingShortlinkUrl("https://usekinfolk.com", listingId);
    expect(url).toBe(
      `https://usekinfolk.com/l/${encodeListingShortCode(listingId)}`,
    );
    expect(decodeListingShortCode(url!.split("/l/")[1])).toBe(listingId);
  });

  it("strips a trailing slash from the base url", () => {
    expect(buildListingShortlinkUrl("https://usekinfolk.com/", listingId)).toBe(
      `https://usekinfolk.com/l/${encodeListingShortCode(listingId)}`,
    );
  });

  it("normalizes the configured base to a web origin", () => {
    expect(
      buildListingShortlinkUrl(
        " https://usekinfolk.com/app?from=sms#card ",
        listingId,
      ),
    ).toBe(`https://usekinfolk.com/l/${encodeListingShortCode(listingId)}`);
  });

  it("returns null without a base url or listing id", () => {
    expect(buildListingShortlinkUrl("", listingId)).toBeNull();
    expect(buildListingShortlinkUrl(null, listingId)).toBeNull();
    expect(buildListingShortlinkUrl("https://usekinfolk.com", null)).toBeNull();
  });

  it("rejects non-web, credentialed, and malformed bases", () => {
    for (const baseUrl of [
      "javascript:alert(1)",
      "ftp://usekinfolk.com",
      "https://user:pass@usekinfolk.com",
      "not a url",
    ]) {
      expect(buildListingShortlinkUrl(baseUrl, listingId)).toBeNull();
    }
  });
});

describe("normalizeListingShortlinkBaseUrl", () => {
  it("returns only safe web origins", () => {
    expect(normalizeListingShortlinkBaseUrl(" https://usekinfolk.com/app ")).toBe(
      "https://usekinfolk.com",
    );
    expect(normalizeListingShortlinkBaseUrl("http://localhost:3000/me")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeListingShortlinkBaseUrl("file:///tmp")).toBeNull();
    expect(normalizeListingShortlinkBaseUrl("https://user@usekinfolk.com")).toBeNull();
  });
});
