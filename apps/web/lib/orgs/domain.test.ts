import { describe, expect, it } from "vitest";
import { isFetchableLogoUrl, normalizeOrgDomain } from "./domain";

describe("normalizeOrgDomain", () => {
  it("accepts ordinary domains", () => {
    expect(normalizeOrgDomain("blueharbor.com")).toBe("blueharbor.com");
    expect(normalizeOrgDomain("  ND.EDU  ")).toBe("nd.edu");
    expect(normalizeOrgDomain("sub.example.co.uk")).toBe("sub.example.co.uk");
  });

  it("keeps only the host of a pasted URL", () => {
    expect(normalizeOrgDomain("https://blueharbor.com/team?x=1")).toBe("blueharbor.com");
    expect(normalizeOrgDomain("https://nd.edu/")).toBe("nd.edu");
  });

  it("punycodes an internationalized name instead of dropping it", () => {
    expect(normalizeOrgDomain("café.com")).toBe("xn--caf-dma.com");
  });

  // Anything that would have to be discarded to reach a hostname means the
  // input was not a hostname. Truncating instead of rejecting is how
  // "example.com:not-a-port" used to collide with a real organization's key.
  it("rejects rather than truncates when a value carries more than a host", () => {
    for (const input of [
      "example.com:not-a-port",
      "example.com:8443",
      "http://user:pw@nd.edu:8443/path",
      "https://user@blueharbor.com",
      "blueharbor.com/team",
    ]) {
      expect(normalizeOrgDomain(input)).toBeNull();
    }
  });

  // The storage key is derived from this value, so two distinct inputs must
  // never normalize onto one key — that is how one user's upload could
  // overwrite another organization's logo.
  it("rejects anything that is not a plausible hostname", () => {
    for (const input of [
      "blue harbor.com",
      "blue_harbor.com",
      "../../etc/passwd",
      "not-a-domain",
      "-leading.com",
      "trailing-.com",
      "example.c",
      "example..com",
      "",
      null,
      undefined,
    ]) {
      expect(normalizeOrgDomain(input)).toBeNull();
    }
  });

  it("does not collapse distinct inputs onto one value", () => {
    expect(normalizeOrgDomain("blue harbor.com")).not.toBe(normalizeOrgDomain("blue-harbor.com"));
  });
});

describe("isFetchableLogoUrl", () => {
  it("allows the hosts we actually fetch from", () => {
    expect(isFetchableLogoUrl("https://cdn.brandfetch.io/idxAg10C0L/w/128/icon.webp")).toBe(true);
    expect(isFetchableLogoUrl("https://www.google.com/s2/favicons?domain=nd.edu&sz=128")).toBe(
      true,
    );
  });

  // The brand record is vendor-supplied and selected by a user-supplied
  // domain, so an unrestricted fetch would let a caller steer server requests.
  it("refuses other hosts, private addresses, and non-https schemes", () => {
    for (const url of [
      "http://cdn.brandfetch.io/icon.webp",
      "https://evil.example.com/logo.png",
      "http://169.254.169.254/latest/meta-data/",
      "https://localhost/admin",
      "https://127.0.0.1:8080/",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isFetchableLogoUrl(url)).toBe(false);
    }
  });
});
