import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `--font-${name}` });

  return {
    Bricolage_Grotesque: font("display"),
    DM_Mono: font("mono"),
    Onest: font("sans"),
  };
});

import { siteMetadataBase } from "./layout";

describe("siteMetadataBase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured web origin for social metadata", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_KINFOLK_BASE_URL",
      " https://kinfolk.example.com/app/// ",
    );

    expect(siteMetadataBase().toString()).toBe("https://kinfolk.example.com/");
  });

  it("keeps local http metadata bases for development", () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", " http://localhost:3000/me ");

    expect(siteMetadataBase().toString()).toBe("http://localhost:3000/");
  });

  it.each([
    ["missing", ""],
    ["non-web", "javascript:alert(1)"],
    ["FTP", "ftp://kinfolk.example.com"],
    ["malformed", "not a url"],
  ])("falls back to localhost for %s metadata base config", (_, value) => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", value);

    expect(siteMetadataBase().toString()).toBe("http://localhost:3000/");
  });
});
