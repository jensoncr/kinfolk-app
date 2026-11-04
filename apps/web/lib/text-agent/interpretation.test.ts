import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const completeAgentChatMock = vi.fn();
vi.mock("./model-client", () => ({
  completeAgentChat: (...args: unknown[]) => completeAgentChatMock(...args),
}));

const readOpenRouterApiKeyMock = vi.fn(() => "test-key");
vi.mock("../integrations/openrouter-client", () => ({
  normalizeOpenRouterModelId: (value: string) => value,
  readOpenRouterApiKey: () => readOpenRouterApiKeyMock(),
}));

const captureProductEventMock = vi.fn();
vi.mock("../integrations/posthog-server", () => ({
  captureProductEvent: (...args: unknown[]) => captureProductEventMock(...args),
}));

import {
  fallbackInterpretation,
  interpretInboundMessage,
} from "./interpretation";

function classifierReply(payload: unknown) {
  return {
    data: {
      choices: [{ message: { content: JSON.stringify(payload) } }],
      model: "test-model",
    },
  };
}

describe("interpretInboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readOpenRouterApiKeyMock.mockReturnValue("test-key");
  });

  it("returns the classifier's intent with extracted listing slots", async () => {
    completeAgentChatMock.mockResolvedValue(
      classifierReply({
        area: "Nob Hill",
        bedrooms: 2,
        kind: "listing_request",
        maxRent: 3000,
        personName: null,
        wantsMediaCards: false,
      }),
    );

    const intent = await interpretInboundMessage({ body: "any 2brs under 3k in nob hill?" });

    expect(intent).toMatchObject({
      area: "Nob Hill",
      bedrooms: 2,
      kind: "listing_request",
      maxRent: 3000,
      source: "classifier",
    });
    const call = completeAgentChatMock.mock.calls[0][0] as {
      operation: string;
      temperature: number;
    };
    expect(call.operation).toBe("message_interpretation");
    expect(call.temperature).toBe(0);
  });

  it("accepts code-fenced JSON from the classifier", async () => {
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: '```json\n{"kind":"match_request","area":null,"maxRent":null,"bedrooms":null,"personName":null,"wantsMediaCards":true}\n```',
            },
          },
        ],
        model: "test-model",
      },
    });

    const intent = await interpretInboundMessage({ body: "show me my matches" });

    expect(intent.kind).toBe("match_request");
    expect(intent.wantsMediaCards).toBe(true);
  });

  it("drops listing slots the classifier attached to a non-listing kind", async () => {
    completeAgentChatMock.mockResolvedValue(
      classifierReply({
        area: "the Mission",
        kind: "intake_answer",
        maxRent: 3000,
        wantsMediaCards: false,
      }),
    );

    const intent = await interpretInboundMessage({
      body: "i'm looking for a two bedroom in the mission",
    });

    expect(intent.kind).toBe("intake_answer");
    expect(intent.area).toBeNull();
    expect(intent.maxRent).toBeNull();
  });

  it("falls back to the regex heuristics when the classifier returns garbage", async () => {
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [{ message: { content: "sure! here's my analysis..." } }],
        model: "test-model",
      },
    });

    const intent = await interpretInboundMessage({
      body: "can you show me some apartments in nob hill?",
    });

    expect(intent.source).toBe("fallback");
    expect(intent.kind).toBe("listing_request");
  });

  it("falls back when the classifier call throws, and reports the outage", async () => {
    completeAgentChatMock.mockRejectedValue(new Error("timeout"));

    const intent = await interpretInboundMessage({
      body: "who are my best matches?",
      metadata: { runId: "run-1", threadId: "thread-1", userId: "user-1" },
    });

    expect(intent.source).toBe("fallback");
    expect(intent.kind).toBe("match_request");
    expect(captureProductEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-1",
        event: "text_agent_intent_fallback",
        properties: expect.objectContaining({ reason: "call_failed" }),
      }),
    );
  });

  it("forces wantsMediaCards off for declined and skipped turns", async () => {
    completeAgentChatMock.mockResolvedValue(
      classifierReply({
        kind: "negated_request",
        wantsMediaCards: true,
      }),
    );

    const intent = await interpretInboundMessage({
      body: "I'd rather not see roommate matches",
    });

    expect(intent.kind).toBe("negated_request");
    expect(intent.wantsMediaCards).toBe(false);
  });

  it("pins the classifier model independent of the reply-model env chain", async () => {
    vi.stubEnv("KINFOLK_TEXT_AGENT_LOOP_MODEL", "some/reasoning-model");
    vi.stubEnv("KINFOLK_TEXT_AGENT_MODEL", "some/other-model");
    completeAgentChatMock.mockResolvedValue(
      classifierReply({ kind: "intake_answer", wantsMediaCards: false }),
    );

    await interpretInboundMessage({ body: "$3000 max" });

    const call = completeAgentChatMock.mock.calls[0][0] as { model: string };
    expect(call.model).toBe("google/gemini-3.1-flash-lite");
    vi.unstubAllEnvs();
  });

  it("clamps the grounding context head-biased so listing prose survives", async () => {
    completeAgentChatMock.mockResolvedValue(
      classifierReply({ kind: "listing_refinement", wantsMediaCards: false }),
    );
    const listingProse = "Two in Nob Hill: 1234 Jones St at $2,950.";
    const longTail = "x".repeat(2000);

    await interpretInboundMessage({
      body: "what about the marina?",
      previousAssistantMessage: `${listingProse}\n\n${longTail}`,
    });

    const call = completeAgentChatMock.mock.calls[0][0] as {
      messages: Array<{ content: string; role: string }>;
    };
    const payload = JSON.parse(
      call.messages.find((entry) => entry.role === "user")?.content ?? "{}",
    ) as { previous_assistant_message: string };
    expect(
      payload.previous_assistant_message.startsWith(listingProse),
    ).toBe(true);
    expect(payload.previous_assistant_message.length).toBeLessThanOrEqual(1600);
  });

  it("skips the model call entirely without an API key", async () => {
    readOpenRouterApiKeyMock.mockReturnValue("");

    const intent = await interpretInboundMessage({ body: "$3000 max" });

    expect(completeAgentChatMock).not.toHaveBeenCalled();
    expect(intent).toMatchObject({ kind: "intake_answer", source: "fallback" });
  });
});

describe("fallbackInterpretation", () => {
  it("reads a plain intake answer as neither a match nor a listing ask", () => {
    expect(fallbackInterpretation("$3000 max").kind).toBe("intake_answer");
  });

  it("reads a direct request to see places as a listing request", () => {
    expect(
      fallbackInterpretation("can you show me some apartments in nob hill?").kind,
    ).toBe("listing_request");
  });

  it("reads an explicit match ask as a match request with media", () => {
    const intent = fallbackInterpretation("show me my roommate matches");

    expect(intent.kind).toBe("match_request");
    expect(intent.wantsMediaCards).toBe(true);
  });
});
