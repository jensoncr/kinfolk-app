import { describe, expect, it } from "vitest";
import {
  isPrivateOrLocalHostname,
  normalizePublicHttpsOrigin,
  parsePublicHttpsUrl,
} from "./public-url";

describe("public URL helpers", () => {
  it("normalizes public HTTPS origins while dropping paths and slashes", () => {
    expect(
      normalizePublicHttpsOrigin(" https://kinfolk.example.com/app/// "),
    ).toBe("https://kinfolk.example.com");
  });

  it("preserves public HTTPS URL paths and query strings", () => {
    expect(
      parsePublicHttpsUrl(
        "https://images.example.com/path/photo.jpg?size=large#preview",
      )?.toString(),
    ).toBe("https://images.example.com/path/photo.jpg?size=large#preview");
  });

  it.each([
    ["HTTP", "http://kinfolk.example.com"],
    ["localhost", "https://localhost:3000"],
    ["localhost subdomain", "https://preview.localhost"],
    ["credentialed", "https://user:pass@kinfolk.example.com"],
    ["loopback IPv4", "https://127.0.0.1/avatar.jpg"],
    ["integer loopback IPv4", "https://2130706433/avatar.jpg"],
    ["octal loopback IPv4", "https://0177.0.0.1/avatar.jpg"],
    ["hex loopback IPv4", "https://0x7f.0.0.1/avatar.jpg"],
    ["private IPv4", "https://192.168.1.20/avatar.jpg"],
    ["CGNAT IPv4", "https://100.64.0.1/avatar.jpg"],
    ["IPv6 loopback", "https://[::1]/avatar.jpg"],
    ["IPv6 unspecified", "https://[::]/avatar.jpg"],
    ["IPv6 unique local", "https://[fd00::1]/avatar.jpg"],
    ["IPv6 link local", "https://[febf::1]/avatar.jpg"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/avatar.jpg"],
    ["IPv4-mapped private", "https://[::ffff:192.168.1.20]/avatar.jpg"],
    ["malformed", "not a url"],
  ])("rejects unsafe %s URLs", (_label, value) => {
    expect(parsePublicHttpsUrl(value)).toBeNull();
    expect(normalizePublicHttpsOrigin(value)).toBeNull();
  });

  it("does not treat public hosts as private or local", () => {
    expect(isPrivateOrLocalHostname("kinfolk.example.com")).toBe(false);
    expect(isPrivateOrLocalHostname("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalHostname("[::ffff:808:808]")).toBe(false);
  });

  it("blocks non-decimal IPv4 hostnames even when called directly", () => {
    expect(isPrivateOrLocalHostname("0177.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHostname("0x7f.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHostname("2130706433")).toBe(true);
    expect(isPrivateOrLocalHostname("::ffff:0177.0.0.1")).toBe(true);
  });
});
