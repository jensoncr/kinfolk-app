import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const defaultTextAgentModel = "google/gemini-3.1-flash-lite";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("text agent model extraction config", () => {
  it("treats a blank OpenRouter key as unconfigured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "   ");
    const { extractTextProfileFactsWithModel, isTextAgentModelConfigured } =
      await import("./extraction");

    expect(isTextAgentModelConfigured()).toBe(false);
    await expect(
      extractTextProfileFactsWithModel({
        body: "I like sunny apartments.",
        userId: "user-1",
      }),
    ).rejects.toThrow("Missing OPENROUTER_API_KEY.");
  });

  it("defaults a blank text-agent model and trims the OpenRouter key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "  test-key  ");
    vi.stubEnv("KINFOLK_TEXT_AGENT_MODEL", "   ");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      void _input;
      void init;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    assistant_reply: "Got it.",
                    facts: [],
                    profile_actions: [],
                  }),
                },
              },
            ],
            usage: { completion_tokens: 4, prompt_tokens: 12 },
          }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { extractTextProfileFactsWithModel, textAgentModel } = await import(
      "./extraction"
    );

    const result = await extractTextProfileFactsWithModel({
      body: "I like sunny apartments.",
      userId: "user-1",
    });
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const requestBody = JSON.parse(String(requestInit?.body)) as {
      model: string;
    };
    const requestHeaders = requestInit?.headers as Record<string, string>;

    expect(textAgentModel).toBe(defaultTextAgentModel);
    expect(result.model).toBe(defaultTextAgentModel);
    expect(requestBody.model).toBe(defaultTextAgentModel);
    expect(requestHeaders.Authorization).toBe("Bearer test-key");
  });
});
