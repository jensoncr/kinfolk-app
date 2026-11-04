import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenRouterJson } from "./openrouter-client";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("openrouter client", () => {
  it("rejects whitespace-only API keys before sending a request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "   ");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOpenRouterJson({
        body: {},
        operation: "test operation",
        retries: 0,
        url: "https://openrouter.test/chat/completions",
      }),
    ).rejects.toThrow(
      "OpenRouter test operation requested without OPENROUTER_API_KEY.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trims API keys and referer headers before the OpenRouter request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", " test-key ");
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", " https://kinfolk.test ");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOpenRouterJson<{ ok: boolean }>({
        body: { messages: [] },
        operation: "test operation",
        retries: 0,
        url: "https://openrouter.test/chat/completions",
      }),
    ).resolves.toMatchObject({
      data: { ok: true },
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      "HTTP-Referer": "https://kinfolk.test",
      authorization: "Bearer test-key",
    });
  });
});
