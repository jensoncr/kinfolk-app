import { afterEach, describe, expect, it, vi } from "vitest";

import { searchBrands } from "./brandfetch";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchBrands", () => {
  it("searches without a Brandfetch client ID", async () => {
    vi.stubEnv("BRANDFETCH_CLIENT_ID", "");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        {
          domain: "openai.com",
          icon: "https://cdn.brandfetch.io/openai/icon.webp",
          name: "OpenAI",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchBrands(" Open ", 6)).resolves.toEqual([
      {
        domain: "openai.com",
        iconUrl: "https://cdn.brandfetch.io/openai/icon.webp",
        kind: "company",
        name: "OpenAI",
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.brandfetch.io/v2/search/Open");
  });

  it("includes an optional client ID when configured", async () => {
    vi.stubEnv("BRANDFETCH_CLIENT_ID", "client id");
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await searchBrands("Open", 6);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.brandfetch.io/v2/search/Open?c=client+id",
    );
  });
});
