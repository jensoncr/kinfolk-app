import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSentListingCards,
  parseHousingAgentToolCalls,
  runHousingAgentTurn,
  runLiveHousingAgentReply,
} from "./loop";
import {
  buildGroundedReplyFromToolResults,
  claimsSaveWithoutWrite,
  claimsSendWithoutDelivery,
  trimBundledQuestion,
} from "./reply-guards";
import type { HousingAgentToolResult } from "./tool-belt";

vi.mock("server-only", () => ({}));

const afterTasks: Array<() => Promise<void>> = [];
vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    afterTasks.push(task);
  },
}));

const completeAgentChatMock = vi.fn();
vi.mock("./model-client", () => ({
  completeAgentChat: (...args: unknown[]) => completeAgentChatMock(...args),
}));

vi.mock("../integrations/openrouter-client", () => ({
  normalizeOpenRouterModelId: (value: string) => value,
  readOpenRouterApiKey: () => process.env.OPENROUTER_API_KEY?.trim() ?? "",
}));

vi.mock("../integrations/otel-tracing", () => ({
  runWithAgentSpan: (_config: unknown, fn: () => Promise<unknown>) => fn(),
  setActiveSpanAttributes: () => {},
}));

vi.mock("../integrations/posthog-server", () => ({
  captureProductEvent: () => {},
}));

const runHousingAgentToolMock = vi.fn();
vi.mock("./tool-belt", () => ({
  getHousingAgentToolDefinitions: () => [],
  runHousingAgentTool: (...args: unknown[]) => runHousingAgentToolMock(...args),
}));

const getMatchesSnapshotForUserIdMock = vi.fn();
vi.mock("../matching/matches", () => ({
  getMatchesSnapshotForUserId: (...args: unknown[]) =>
    getMatchesSnapshotForUserIdMock(...args),
}));
vi.mock("../profiles/profile-card", () => ({
  buildRoommateProfileCardUrl: ({
    baseUrl,
    snapshot,
  }: {
    baseUrl: string;
    snapshot: { name: string };
  }) => `${baseUrl}/profile-card/${snapshot.name.toLowerCase().replace(/\s+/g, "-")}`,
}));
vi.mock("./roommate-cards", () => ({
  buildRoommateMatchProfileCardSnapshot: (roommate: { name: string }) => ({
    name: roommate.name,
  }),
}));
const getKinfolkBaseUrlMock = vi.fn();
vi.mock("./store-shared", () => ({
  getKinfolkBaseUrl: () => getKinfolkBaseUrlMock(),
  getKinfolkPublicMediaBaseUrl: () => getKinfolkBaseUrlMock(),
}));

const loadTextThreadAgentMemoryMock = vi.fn();
const saveTextThreadAgentMemoryMock = vi.fn();
const loadThreadSummaryMock = vi.fn();
const appendSkippedIntakeStepMock = vi.fn();
vi.mock("./thread-data", () => ({
  appendSkippedIntakeStep: (...args: unknown[]) =>
    appendSkippedIntakeStepMock(...args),
  loadTextThreadAgentMemory: (...args: unknown[]) =>
    loadTextThreadAgentMemoryMock(...args),
  loadThreadSummary: (...args: unknown[]) => loadThreadSummaryMock(...args),
  loadUserTextAgentCoverageFacts: vi.fn(async () => []),
  saveTextThreadAgentMemory: (...args: unknown[]) =>
    saveTextThreadAgentMemoryMock(...args),
}));

const hasActiveMatchingInterviewMock = vi.fn();
const markMatchingInterviewCompletedMock = vi.fn();
vi.mock("./interview-state", () => ({
  hasActiveMatchingInterview: (...args: unknown[]) =>
    hasActiveMatchingInterviewMock(...args),
  markMatchingInterviewCompleted: (...args: unknown[]) =>
    markMatchingInterviewCompletedMock(...args),
}));

// The classifier is mocked to the deterministic regex fallback by default so
// every phrase-driven test below keeps its meaning without a model call;
// semantic-class tests override this per test with a structured intent.
const interpretInboundMessageMock = vi.fn();
vi.mock("./interpretation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./interpretation")>();
  return {
    ...actual,
    interpretInboundMessage: (...args: unknown[]) =>
      interpretInboundMessageMock(...args),
  };
});

const completeAgentRunMock = vi.fn();
vi.mock("./run-data", () => ({
  completeAgentRun: (...args: unknown[]) => completeAgentRunMock(...args),
}));

vi.mock("./tools", () => ({
  isOffTopicTextAgentMessage: () => false,
  restrictedTextAgentRefusal: () => null,
}));

const readNextIntakeStepFromSummaryMock = vi.fn();
const nextIntakeStepFromDraftWithCoverageMock = vi.fn();
vi.mock("./fact-utils", () => ({
  loadRecentTextMessages: vi.fn(async () => []),
  nextTextAgentIntakeStepFromDraftWithCoverage: (...args: unknown[]) =>
    nextIntakeStepFromDraftWithCoverageMock(...args),
  readNextIntakeStepFromSummary: (...args: unknown[]) =>
    readNextIntakeStepFromSummaryMock(...args),
  readTextAgentDraftState: vi.fn(() => ({ facts: [], skippedSteps: [] })),
}));

import { fallbackInterpretation } from "./interpretation";

beforeEach(() => {
  loadTextThreadAgentMemoryMock.mockResolvedValue({
    rollingSummary: "",
    sentListingCards: [],
  });
  saveTextThreadAgentMemoryMock.mockResolvedValue(undefined);
  loadThreadSummaryMock.mockResolvedValue(null);
  readNextIntakeStepFromSummaryMock.mockReturnValue(null);
  nextIntakeStepFromDraftWithCoverageMock.mockReturnValue(null);
  hasActiveMatchingInterviewMock.mockResolvedValue(false);
  markMatchingInterviewCompletedMock.mockResolvedValue(undefined);
  appendSkippedIntakeStepMock.mockResolvedValue(undefined);
  interpretInboundMessageMock.mockImplementation(
    async ({ body }: { body: string }) => fallbackInterpretation(body),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  afterTasks.length = 0;
  completeAgentChatMock.mockReset();
  runHousingAgentToolMock.mockReset();
  getMatchesSnapshotForUserIdMock.mockReset();
  getKinfolkBaseUrlMock.mockReset();
  loadTextThreadAgentMemoryMock.mockReset();
  saveTextThreadAgentMemoryMock.mockReset();
  completeAgentRunMock.mockReset();
  loadThreadSummaryMock.mockReset();
  readNextIntakeStepFromSummaryMock.mockReset();
  nextIntakeStepFromDraftWithCoverageMock.mockReset();
  hasActiveMatchingInterviewMock.mockReset();
  markMatchingInterviewCompletedMock.mockReset();
  appendSkippedIntakeStepMock.mockReset();
  interpretInboundMessageMock.mockReset();
});

describe("text agent loop", () => {
  it("parses OpenRouter tool calls for the housing agent loop", () => {
    expect(
      parseHousingAgentToolCalls({
        tool_calls: [
          {
            function: {
              arguments: "{\"budgetMax\":1500,\"neighborhoods\":[\"Mission\"]}",
              name: "search_listings",
            },
            id: "call_1",
          },
          {
            function: {
              arguments: { facts: [] },
              name: "update_prefs",
            },
            id: "call_2",
          },
        ],
      }),
    ).toEqual([
      {
        args: { budgetMax: 1500, neighborhoods: ["Mission"] },
        id: "call_1",
        name: "search_listings",
      },
      {
        args: { facts: [] },
        id: "call_2",
        name: "update_prefs",
      },
    ]);
  });

  it("defaults to the housing agent without the old loop flag", () => {
    const source = readFileSync(
      new URL("./loop.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("KINFOLK_TEXT_AGENT_LOOP_ENABLED");
    expect(source).not.toContain("shadow mode");
  });

  it("loads the live agent entry point and skips cleanly without a model key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await expect(
      runHousingAgentTurn({} as never, {
        body: "show me mission apartments under 3500",
        threadId: "thread-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      reason: "missing_openrouter_key",
      status: "skipped",
    });
  });

  it("treats whitespace-only OpenRouter keys as missing before model calls", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "   ");

    await expect(
      runHousingAgentTurn({} as never, {
        body: "show me mission apartments under 3500",
        threadId: "thread-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      reason: "missing_openrouter_key",
      status: "skipped",
    });
    expect(completeAgentChatMock).not.toHaveBeenCalled();
  });

  it("ignores blank loop model overrides and falls back to the configured text-agent model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("KINFOLK_TEXT_AGENT_LOOP_MODEL", "   ");
    vi.stubEnv("KINFOLK_TEXT_AGENT_MODEL", " google/test-model ");
    vi.stubEnv("KINFOLK_TEXT_AGENT_LOOP_TEMPERATURE", "   ");
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [{ message: { content: "found one worth seeing." } }],
        model: "test-model",
      },
    });

    await expect(
      runHousingAgentTurn({} as never, {
        body: "show me mission apartments under 3500",
        recentMessages: [],
        threadId: "thread-1",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      reply: "found one worth seeing.",
      status: "completed",
    });

    const request = completeAgentChatMock.mock.calls[0][0] as {
      model: string;
      temperature: number;
    };
    expect(request.model).toBe("google/test-model");
    expect(request.temperature).toBe(0.6);
  });

  it("builds a grounded fallback reply from the last useful tool result when the model returns empty prose", () => {
    const results: HousingAgentToolResult[] = [
      {
        data: {},
        ok: false,
        summary: "No active listings matched that search.",
        toolName: "search_listings",
      },
      {
        data: {
          listings: [
            {
              address: "681 Florida St",
              neighborhood: "Mission",
              perPersonRent: 2950,
              rent: 5900,
            },
            { address: "12 Oak St", neighborhood: "Hayes Valley", rent: 3400 },
          ],
        },
        ok: true,
        summary: "Found 2 listings that fit.",
        toolName: "search_listings",
      },
    ];

    const reply = buildGroundedReplyFromToolResults(results);

    expect(reply).toContain("681 Florida St in Mission at $2,950 each.");
    expect(reply).toContain("12 Oak St in Hayes Valley at $3,400/mo.");
    expect(reply.split("\n\n").length).toBeGreaterThanOrEqual(3);
    expect(
      buildGroundedReplyFromToolResults([
        {
          data: { persisted: [{ key: "budget_max", value: 3200 }] },
          ok: true,
          summary: "Saved 1 preference.",
          toolName: "update_prefs",
        },
      ]),
    ).toBe("got it — that's saved to your profile.");
    expect(
      buildGroundedReplyFromToolResults([
        {
          data: { failed: [], persisted: [], skippedSensitive: ["health_note"] },
          ok: true,
          summary: "Kept health_note off their matching profile.",
          toolName: "update_prefs",
        },
      ]),
    ).toBe("");
    expect(buildGroundedReplyFromToolResults([])).toBe("");
  });

  it("sends the outage bubble and the live reply under one idempotency intent", () => {
    const source = readFileSync(
      new URL("./loop.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "reply(result.reply, HOUSING_AGENT_REPLY_INTENT, result.mediaUrls)",
    );
    expect(source).toContain(
      "reply(textAgentOutageReplyCopy(runId), HOUSING_AGENT_REPLY_INTENT)",
    );
    expect(source).not.toContain("HOUSING_AGENT_UNAVAILABLE_REPLY");
  });

  it("ends the turn with the opt-out tool's own confirmation instead of trusting the model to echo it", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const confirmation =
      "Done — I'll stop texting you. If you ever want back in, text START and we'll pick it right back up.";
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: "sad to see you go!! you're opted out now, friend.",
              tool_calls: [
                {
                  function: { arguments: "{}", name: "opt_out" },
                  id: "call_1",
                },
              ],
            },
          },
        ],
        model: "test-model",
      },
    });
    runHousingAgentToolMock.mockResolvedValue({
      data: { confirmation, optedOut: true },
      ok: true,
      summary: `Texts are now off for this person. Close out by sending exactly this and nothing else: ${confirmation}`,
      toolName: "opt_out",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "stop texting me",
      recentMessages: [],
      runId: "run-1",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result).toMatchObject({
      mediaUrls: [],
      reply: confirmation,
      rounds: 1,
      status: "completed",
    });
    expect(completeAgentChatMock).toHaveBeenCalledTimes(1);
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
    expect(runHousingAgentToolMock.mock.calls[0][1]).toBe("opt_out");
  });

  it("flags save claims with no successful update_prefs behind them", () => {
    expect(claimsSaveWithoutWrite("I have saved your criteria for a 2bd.", [])).toBe(
      true,
    );
    expect(claimsSaveWithoutWrite("noted that — no pets it is.", [])).toBe(true);
    expect(claimsSaveWithoutWrite("I'll save that for next time.", [])).toBe(true);
    expect(
      claimsSaveWithoutWrite(
        "Got it, I've updated your preferences to prioritize 1-bedroom units.",
        [],
      ),
    ).toBe(true);
    expect(
      claimsSaveWithoutWrite("the spot you saved yesterday is still open.", []),
    ).toBe(false);
    expect(
      claimsSaveWithoutWrite(
        "you told me $2,600 a month for your share — that's saved on your profile.",
        [],
      ),
    ).toBe(false);
    expect(
      claimsSaveWithoutWrite("you said $2,600, and I've got it noted.", []),
    ).toBe(false);
    expect(
      claimsSaveWithoutWrite("here's your updated list for the Mission.", []),
    ).toBe(false);
    expect(
      claimsSaveWithoutWrite("I have saved your criteria.", [
        {
          data: { persisted: [{ key: "bedrooms_min", value: 2 }] },
          ok: true,
          summary: "Saved 1 preference.",
          toolName: "update_prefs",
        } as HousingAgentToolResult,
      ]),
    ).toBe(false);
    expect(
      claimsSaveWithoutWrite("I have saved your criteria.", [
        {
          data: { failed: [], persisted: [], skippedSensitive: ["x"] },
          ok: true,
          summary: "Kept x off their matching profile.",
          toolName: "update_prefs",
        } as HousingAgentToolResult,
      ]),
    ).toBe(true);
  });

  it("trims an and-conjoined second question deterministically", () => {
    expect(
      trimBundledQuestion(
        "love it. where in SF are you looking, and are you moving solo or with a group?",
      ),
    ).toBe("love it. where in SF are you looking?");
    expect(
      trimBundledQuestion("got your budget. what neighborhoods and how many roommates?"),
    ).toBe("got your budget. what neighborhoods?");
    expect(trimBundledQuestion("sounds good — when do you want to move?")).toBeNull();
  });

  it("flags send claims with no delivered message behind them", () => {
    expect(
      claimsSendWithoutDelivery("I've sent that intro over to Jack for you.", []),
    ).toBe(true);
    expect(claimsSendWithoutDelivery("I just messaged Priya for you.", [])).toBe(
      true,
    );
    expect(
      claimsSendWithoutDelivery("sent the message — he'll see it in the app.", []),
    ).toBe(true);
    expect(
      claimsSendWithoutDelivery(
        "your interest is in — the chat opens as soon as Jack accepts.",
        [],
      ),
    ).toBe(false);
    expect(
      claimsSendWithoutDelivery("want me to send him a quick hello?", []),
    ).toBe(false);
    expect(
      claimsSendWithoutDelivery("I've sent that intro over to Jack for you.", [
        {
          data: { delivered: true, roomId: "room-1", status: "delivered" },
          ok: true,
          summary: "Delivered.",
          toolName: "message_roommate_match",
        } as HousingAgentToolResult,
      ]),
    ).toBe(false);
    expect(
      claimsSendWithoutDelivery("I've sent that intro over to Jack for you.", [
        {
          data: { delivered: false, intentRecorded: true, status: "pending" },
          ok: true,
          summary: "Pending.",
          toolName: "message_roommate_match",
        } as HousingAgentToolResult,
      ]),
    ).toBe(true);
    expect(
      claimsSendWithoutDelivery("sent your reply into the group chat.", [
        {
          data: { previewOnly: false, roomId: "room-2" },
          ok: true,
          summary: "Sent the message into the Kinfolk chat.",
          toolName: "send_chat_message",
        } as HousingAgentToolResult,
      ]),
    ).toBe(false);
  });

  it("forces a corrective round when the model claims a save it never made", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "Done! I saved your criteria for a 2 bedroom in the Mission.",
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments:
                        '{"facts":[{"key":"bedrooms_min","value":2}]}',
                      name: "update_prefs",
                    },
                    id: "call_fix",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "Saved your 2 bedroom Mission criteria — I'll have a fresh list ready next time you check in.",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: { failed: [], persisted: [{ key: "bedrooms_min", value: 2 }] },
      ok: true,
      summary: "Saved 1 preference.",
      toolName: "update_prefs",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "tell me when a 2 bedroom in the mission drops",
      recentMessages: [],
      runId: "run-guard",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(completeAgentChatMock).toHaveBeenCalledTimes(3);
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
    expect(runHousingAgentToolMock.mock.calls[0][1]).toBe("update_prefs");
    expect(result.status).toBe("completed");
    expect(result.status === "completed" && result.reply).toContain(
      "fresh list ready",
    );
  });

  it("finishes same-round preference writes before reading matches", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments:
                        '{"facts":[{"key":"cleanliness","value":"tidy"}]}',
                      name: "update_prefs",
                    },
                    id: "call_update",
                  },
                  {
                    function: {
                      arguments: '{"limit":3}',
                      name: "get_matches",
                    },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "Priya is the strongest updated roommate fit.",
              },
            },
          ],
          model: "test-model",
        },
      });

    const events: string[] = [];
    runHousingAgentToolMock.mockImplementation(async (_context, name: string) => {
      if (name === "update_prefs") {
        events.push("update-start");
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        events.push("update-finish");
        return {
          data: {
            failed: [],
            persisted: [{ key: "cleanliness", value: "tidy" }],
          },
          ok: true,
          summary: "Saved 1 preference.",
          toolName: "update_prefs",
        };
      }
      if (name === "get_matches") {
        events.push("get-matches");
        return {
          data: { roommates: [{ name: "Priya Nair", score: 68 }] },
          ok: true,
          summary: "Found 1 roommate match.",
          toolName: "get_matches",
        };
      }
      throw new Error(`unexpected tool ${name}`);
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "I'm tidy, now show me roommate matches.",
      recentMessages: [],
      runId: "run-write-before-match",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(events).toEqual(["update-start", "update-finish", "get-matches"]);
    expect(result.toolCalls.map((call) => call.name)).toEqual([
      "update_prefs",
      "get_matches",
    ]);
    expect(result.reply).toBe("Priya is the strongest updated roommate fit.");
  });

  it("runs a grounded tool-call transcript and attaches only named cards", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const floridaCard =
      "https://kinfolk.test/api/listing-card/rec-florida?expires=1&token=a";
    const oakCard =
      "https://kinfolk.test/api/listing-card/rec-oak?expires=1&token=b";
    const priyaCard = "https://kinfolk.test/api/profile-card/priya";
    const noraCard = "https://kinfolk.test/api/profile-card/nora";
    const reply =
      "681 Florida St is the best apartment fit here, and Priya is the roommate I would look at first. Group joins still happen on the web.";

    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments:
                        '{"neighborhoods":["Mission"],"limit":2,"includeRoommateSplits":true}',
                      name: "search_listings",
                    },
                    id: "call_listings",
                  },
                  {
                    function: {
                      arguments: '{"limit":2}',
                      name: "get_matches",
                    },
                    id: "call_matches",
                  },
                  {
                    function: {
                      arguments: '{"action":"request_join","groupId":" group-1 "}',
                      name: "manage_group",
                    },
                    id: "call_group",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: reply } }],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockImplementation(
      async (_context, name: string, args: Record<string, unknown>) => {
        if (name === "search_listings") {
          expect(args).toMatchObject({
            includeRoommateSplits: true,
            limit: 2,
            neighborhoods: ["Mission"],
          });
          return {
            data: {
              listings: [
                {
                  address: "681 Florida St",
                  neighborhood: "Mission",
                  perPersonRent: 2950,
                  rent: 5900,
                },
                {
                  address: "12 Oak St",
                  neighborhood: "Hayes Valley",
                  rent: 3400,
                },
              ],
            },
            media: [
              { label: "681 Florida St", url: floridaCard },
              { label: "12 Oak St", url: oakCard },
            ],
            ok: true,
            summary: "Found 2 listings that fit.",
            toolName: "search_listings",
          };
        }
        if (name === "get_matches") {
          return {
            data: {
              roommates: [
                { name: "Priya", score: 91 },
                { name: "Nora", score: 84 },
              ],
            },
            media: [
              { label: "Priya", url: priyaCard },
              { label: "Nora", url: noraCard },
            ],
            ok: true,
            summary: "Found 2 roommate matches.",
            toolName: "get_matches",
          };
        }
        if (name === "manage_group") {
          return {
            data: {
              action: "request_join",
              groupId: "group-1",
              previewRequired: true,
            },
            ok: true,
            summary:
              "Group membership moves on the web for now, not over text.",
            toolName: "manage_group",
          };
        }
        throw new Error(`unexpected tool ${name}`);
      },
    );

    const result = await runHousingAgentTurn({} as never, {
      body: "show me mission listings, my roommate matches, and can i join a group?",
      recentMessages: [],
      runId: "run-transcript",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.reply).toBe(reply);
    expect(result.rounds).toBe(2);
    expect(result.mediaUrls).toEqual([floridaCard, priyaCard]);
    expect(result.toolCalls.map((call) => call.name)).toEqual([
      "search_listings",
      "get_matches",
      "manage_group",
    ]);
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(3);

    const secondRequest = completeAgentChatMock.mock.calls[1][0] as {
      messages: Array<{ content: string; role: string }>;
    };
    const toolMessages = secondRequest.messages.filter(
      (message) => message.role === "tool",
    );
    expect(toolMessages).toHaveLength(3);
    expect(toolMessages[0].content).toContain("681 Florida St");
    expect(toolMessages[1].content).toContain("Priya");
    expect(toolMessages[2].content).toContain("web");
  });

  it("does not attach recommendation cards to successful chat-send confirmations", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const priyaShahCard = "https://kinfolk.test/api/profile-card/priya-shah";
    const priyaNairCard = "https://kinfolk.test/api/profile-card/priya-nair";

    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments: '{"limit":2}',
                      name: "get_matches",
                    },
                    id: "call_matches",
                  },
                  {
                    function: {
                      arguments:
                        '{"roomId":"room-priya-shah","body":"Saturday at 2 works."}',
                      name: "send_chat_message",
                    },
                    id: "call_send_chat",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "OK, I've sent that message to your chat with Priya Shah.",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockImplementation(
      async (_context, name: string) => {
        if (name === "get_matches") {
          return {
            data: {
              roommates: [
                { name: "Priya Shah", score: 91 },
                { name: "Priya Nair", score: 70 },
              ],
            },
            media: [
              { label: "Priya Shah", url: priyaShahCard },
              { label: "Priya Nair", url: priyaNairCard },
            ],
            ok: true,
            summary: "Found 2 roommate matches.",
            toolName: "get_matches",
          };
        }
        if (name === "send_chat_message") {
          return {
            data: {
              message: {
                id: "chat-message-1",
                sentVia: "kinfolk_agent",
              },
            },
            ok: true,
            summary:
              "Sent the message into the Kinfolk chat. It will appear as the user's message with the sent via Kinfolk marker.",
            toolName: "send_chat_message",
          };
        }
        throw new Error(`unexpected tool ${name}`);
      },
    );

    const result = await runHousingAgentTurn({} as never, {
      body: 'send "Saturday at 2 works" to Priya Shah',
      recentMessages: [],
      runId: "run-chat-send",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.reply).toBe(
      "OK, I've sent that message to your chat with Priya Shah.",
    );
    expect(result.mediaUrls).toEqual([]);
  });

  it("requires enough name specificity before attaching cards for shared first names", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const priyaShahCard = "https://kinfolk.test/api/profile-card/priya-shah";
    const priyaNairCard = "https://kinfolk.test/api/profile-card/priya-nair";

    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments: '{"limit":2}',
                      name: "get_matches",
                    },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "Priya Shah is the strongest fit here. Ask me if you want to compare her with the other Priya.",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: {
        roommates: [
          { name: "Priya Shah", score: 91 },
          { name: "Priya Nair", score: 70 },
        ],
      },
      media: [
        { label: "Priya Shah", url: priyaShahCard },
        { label: "Priya Nair", url: priyaNairCard },
      ],
      ok: true,
      summary: "Found 2 roommate matches.",
      toolName: "get_matches",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "who is my best Priya match?",
      recentMessages: [],
      runId: "run-shared-first-name",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([priyaShahCard]);
  });

  it("withholds profile cards when the reply closes by OFFERING them", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const sofiaCard = "https://kinfolk.test/api/profile-card/sofia";
    const jackCard = "https://kinfolk.test/api/profile-card/jack";

    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "get_matches" },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "Sofia (68%) and Jack (67%) look promising early on.\n\nWant me to pull up any of their full profiles?",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: {
        roommates: [
          { name: "Sofia Alvarez", score: 68 },
          { name: "Jack Munhall", score: 67 },
        ],
      },
      media: [
        { label: "Sofia Alvarez", url: sofiaCard },
        { label: "Jack Munhall", url: jackCard },
      ],
      ok: true,
      summary: "Found 2 roommate matches.",
      toolName: "get_matches",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "Pets are fine, especially cats.",
      recentMessages: [],
      runId: "run-offer-withhold",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.mediaUrls).toEqual([]);
  });

  it("still attaches profile cards on an offer-closing reply when the user asked to see them", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const sofiaCard = "https://kinfolk.test/api/profile-card/sofia";

    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "get_matches" },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "Here's Sofia — your strongest match.\n\nWant me to pull up more of her profile?",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: { roommates: [{ name: "Sofia Alvarez", score: 68 }] },
      media: [{ label: "Sofia Alvarez", url: sofiaCard }],
      ok: true,
      summary: "Found 1 roommate match.",
      toolName: "get_matches",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "show me my matches",
      recentMessages: [],
      runId: "run-offer-explicit",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.mediaUrls).toEqual([sofiaCard]);
  });

  it("does not recover roommate cards for chat-list replies that name participants", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    getKinfolkBaseUrlMock.mockReturnValue("https://kinfolk.test");
    getMatchesSnapshotForUserIdMock.mockResolvedValue({
      roommates: [
        { name: "Priya Shah", score: 91 },
        { name: "Leo Martinez", score: 84 },
        { name: "Maya Chen", score: 82 },
      ],
      status: "connected",
    });
    const reply =
      "You have two chats open right now.\n\nYou have a direct match thread with Priya Shah.\n\nThere is also a group chat for the 1487 14th Ave apartment with Leo Martinez and Maya Chen.";

    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments: '{"limit":8}',
                      name: "list_chats",
                    },
                    id: "call_chats",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: reply } }],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: {
        rooms: [
          {
            id: "room-priya",
            participantNames: ["Priya Shah"],
            title: "Priya Shah",
          },
          {
            id: "room-group",
            participantNames: ["Leo Martinez", "Maya Chen"],
            title: "1487 14th Ave",
          },
        ],
      },
      ok: true,
      summary: "Found 2 Kinfolk chats.",
      toolName: "list_chats",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "Actually, can you remind me what chats are open for me right now?",
      recentMessages: [],
      runId: "run-list-chats",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.reply).toBe(reply);
    expect(result.mediaUrls).toEqual([]);
    expect(getMatchesSnapshotForUserIdMock).not.toHaveBeenCalled();
  });

  it("does not recover roommate cards for incidental names in non-match replies", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    getKinfolkBaseUrlMock.mockReturnValue("https://kinfolk.test");
    getMatchesSnapshotForUserIdMock.mockResolvedValue({
      roommates: [{ name: "Priya Shah", score: 91 }],
      status: "connected",
    });
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: "Priya Shah said Saturday works in the latest chat.",
            },
          },
        ],
        model: "test-model",
      },
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "what did Priya say last?",
      recentMessages: [],
      runId: "run-incidental-name",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([]);
    expect(getMatchesSnapshotForUserIdMock).not.toHaveBeenCalled();
  });

  it("detects bundled questions with and without extra question marks", async () => {
    const { isMultiQuestionReply } = await import("./reply-guards");
    expect(
      isMultiQuestionReply(
        "do you have a specific month in mind for the move, and are you looking to find your own place or join up with roommates?",
      ),
    ).toBe(true);
    expect(
      isMultiQuestionReply("what's your budget? and when are you moving?"),
    ).toBe(true);
    expect(
      isMultiQuestionReply(
        "would you want to look at Mission Bay, or should we stretch the budget a bit?",
      ),
    ).toBe(false);
    expect(isMultiQuestionReply("what's your budget?")).toBe(false);
    expect(isMultiQuestionReply("got it — that's saved.")).toBe(false);
  });

  it("rewrites multi-question replies down to a single question", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "nice, sf in the fall is doable. what's your budget? and how many of you are moving?",
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "nice, sf in the fall is doable. what's your budget?",
              },
            },
          ],
          model: "test-model",
        },
      });

    const result = await runHousingAgentTurn({} as never, {
      body: "we're thinking about moving to sf in the fall",
      recentMessages: [],
      runId: "run-question-cap",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.reply).toBe("nice, sf in the fall is doable. what's your budget?");
    expect(completeAgentChatMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the original reply when the single-question rewrite fails", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const original =
      "what's your budget? and when exactly are you hoping to move?";
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: original } }],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: "" } }],
          model: "test-model",
        },
      });

    const result = await runHousingAgentTurn({} as never, {
      body: "we're thinking about moving to sf",
      recentMessages: [],
      runId: "run-question-cap-fallback",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.reply).toBe(original);
  });

  it("never attaches a card because its street number matches a dollar figure in the reply", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const floridaCard = "https://kinfolk.test/api/listing-card/rec-florida";
    const larkinCard = "https://kinfolk.test/api/listing-card/rec-larkin";
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "search_listings" },
                    id: "call_1",
                    type: "function",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "681 Florida St is a solid pick — it's $500 under your budget.",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: { listings: [] },
      media: [
        { label: "681 Florida St", url: floridaCard },
        { label: "500 Larkin St", url: larkinCard },
      ],
      ok: true,
      summary: "Found 2 listings.",
      toolName: "search_listings",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "show me mission listings",
      recentMessages: [],
      runId: "run-numeric-label",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.mediaUrls).toEqual([floridaCard]);
  });

  it("attaches one card per listing label even when re-searches minted duplicate recommendations", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const alemanyFirst = "https://kinfolk.test/api/listing-card/rec-alemany-1";
    const alemanySecond = "https://kinfolk.test/api/listing-card/rec-alemany-2";
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "search_listings" },
                    id: "call_1",
                    type: "function",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "330 Alemany Blvd Apt 6 is the standout at $2,150 each.",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: { listings: [] },
      media: [
        { label: "330 Alemany Blvd Apt 6", url: alemanyFirst },
        { label: "330 Alemany Blvd", url: alemanySecond },
      ],
      ok: true,
      summary: "Found listings.",
      toolName: "search_listings",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "anything near alemany?",
      recentMessages: [],
      runId: "run-duplicate-label",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.mediaUrls).toEqual([alemanyFirst]);
  });

  it("recovers roommate cards from memory for explicit match asks", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    getKinfolkBaseUrlMock.mockReturnValue("https://kinfolk.test");
    getMatchesSnapshotForUserIdMock.mockResolvedValue({
      roommates: [
        { name: "Priya Shah", score: 91 },
        { name: "Maya Chen", score: 82 },
      ],
      status: "connected",
    });
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: "Your strongest roommate match right now is Priya Shah.",
            },
          },
        ],
        model: "test-model",
      },
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "who are my roommate matches?",
      recentMessages: [],
      runId: "run-match-memory-recovery",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([
      "https://kinfolk.test/profile-card/priya-shah",
    ]);
    expect(getMatchesSnapshotForUserIdMock).toHaveBeenCalledTimes(1);
  });

  it("recovers cards for explicit compatible-roommate discovery asks", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    getKinfolkBaseUrlMock.mockReturnValue("https://kinfolk.test");
    getMatchesSnapshotForUserIdMock.mockResolvedValue({
      roommates: [
        { name: "Priya Shah", score: 91 },
        { name: "Maya Chen", score: 82 },
      ],
      status: "connected",
    });
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content:
                "Priya Shah is your most compatible roommate match right now.",
            },
          },
        ],
        model: "test-model",
      },
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "show me my most compatible roommates",
      recentMessages: [],
      runId: "run-compatible-roommates",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([
      "https://kinfolk.test/profile-card/priya-shah",
    ]);
    expect(getMatchesSnapshotForUserIdMock).toHaveBeenCalledTimes(1);
  });

  it("recovers a named person's card for explicit detail asks even when the reply uses a pronoun", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    getKinfolkBaseUrlMock.mockReturnValue("https://kinfolk.test");
    getMatchesSnapshotForUserIdMock.mockResolvedValue({
      roommates: [
        { name: "Priya Shah", score: 91 },
        { name: "Maya Chen", score: 82 },
      ],
      status: "connected",
    });
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content:
                "She's a strong fit on quiet hours, weekend routines, and commute overlap.",
            },
          },
        ],
        model: "test-model",
      },
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "give me more information on Priya Shah",
      recentMessages: [],
      runId: "run-person-detail",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([
      "https://kinfolk.test/profile-card/priya-shah",
    ]);
    expect(getMatchesSnapshotForUserIdMock).toHaveBeenCalledTimes(1);
  });

  it("recovers a named person's card for explicit profile-card asks", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    getKinfolkBaseUrlMock.mockReturnValue("https://kinfolk.test");
    getMatchesSnapshotForUserIdMock.mockResolvedValue({
      roommates: [
        { name: "Priya Shah", score: 91 },
        { name: "Maya Chen", score: 82 },
      ],
      status: "connected",
    });
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: "Here's Priya Shah's profile card.",
            },
          },
        ],
        model: "test-model",
      },
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "show me Priya Shah's profile card",
      recentMessages: [],
      runId: "run-profile-card",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([
      "https://kinfolk.test/profile-card/priya-shah",
    ]);
    expect(getMatchesSnapshotForUserIdMock).toHaveBeenCalledTimes(1);
  });

  it("allows explicit person-detail card recovery after reading a chat", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    getKinfolkBaseUrlMock.mockReturnValue("https://kinfolk.test");
    getMatchesSnapshotForUserIdMock.mockResolvedValue({
      roommates: [
        { name: "Priya Shah", score: 91 },
        { name: "Leo Martinez", score: 84 },
      ],
      status: "connected",
    });
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments: '{"roomId":"room-priya","limit":5}',
                      name: "read_chat",
                    },
                    id: "call_read_chat",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "She's been responsive and seems aligned on a quieter shared-space rhythm.",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: {
        messages: [
          {
            body: "Quiet weekdays are ideal for me too.",
            senderName: "Priya Shah",
          },
        ],
      },
      ok: true,
      summary: "Read 1 recent chat message from Priya Shah.",
      toolName: "read_chat",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "tell me more about Priya Shah as a person",
      recentMessages: [],
      runId: "run-read-chat-person-detail",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([
      "https://kinfolk.test/profile-card/priya-shah",
    ]);
    expect(getMatchesSnapshotForUserIdMock).toHaveBeenCalledTimes(1);
  });

  it("does not attach incidental person cards while answering a named detail request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const mayaCard = "https://kinfolk.test/api/profile-card/maya-chen";
    const leoCard = "https://kinfolk.test/api/profile-card/leo-martinez";

    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: {
                      arguments: '{"limit":5}',
                      name: "get_matches",
                    },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "Maya Chen is a solid match on daily rhythm. The main thing to check is how often Leo comes by.",
              },
            },
          ],
          model: "test-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: {
        roommates: [
          { name: "Maya Chen", score: 61 },
          { name: "Leo Martinez", score: 84 },
        ],
      },
      media: [
        { label: "Maya Chen", url: mayaCard },
        { label: "Leo Martinez", url: leoCard },
      ],
      ok: true,
      summary: "Found 2 roommate matches.",
      toolName: "get_matches",
    });

    const result = await runHousingAgentTurn({} as never, {
      body: "tell me more about Maya Chen as a roommate",
      recentMessages: [],
      runId: "run-named-detail-incidental-person",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(result.mediaUrls).toEqual([mayaCard]);
  });

  it("keeps live prompt guardrails aligned with stress-test regressions", () => {
    const source = readFileSync(
      new URL("./loop.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("DO NOT guess which one");
    expect(source).toContain("iMessage does not tell you which message they replied to");
    expect(source).toContain("CANNOT message landlords or buildings");
    expect(source).toContain("no bullet characters like •");
    expect(source).toContain("discuss risks");
    expect(source).toContain("fresh explicit search request overrides saved neighborhoods");
    expect(source).toContain("call search_listings as well as get_area_signals");
    expect(source).toContain("per-person fits and another does not");
    expect(source).toContain("total or combined household budget");
    expect(source).not.toContain("lead with each one's per-person rent whenever");
    expect(source).toContain("Treat short affirmations");
    expect(source).toContain("call search_listings with limit 1");
    expect(source).toContain("call get_listing_details for that listing instead of answering from memory or declining");
    expect(source).toContain("name that address in your first sentence");
  });

  it("collects sent listing cards in send order and drops non-listing cards", () => {
    const toolResults = [
      {
        data: {},
        media: [
          {
            label: "681 Florida St",
            url: "https://kinfolk.test/api/listing-card/rec-1?expires=1&token=a",
          },
          {
            label: "12 Oak St",
            url: "https://kinfolk.test/api/listing-card/rec-2?expires=1&token=b",
          },
        ],
        ok: true,
        summary: "Found 2 listings that fit.",
        toolName: "search_listings",
      },
      {
        data: {},
        media: [
          { label: "Priya", url: "https://kinfolk.test/api/profile-card/p-1" },
        ],
        ok: true,
        summary: "Found matches.",
        toolName: "get_matches",
      },
    ] as HousingAgentToolResult[];

    expect(
      collectSentListingCards(
        [
          "https://kinfolk.test/api/profile-card/p-1",
          "https://kinfolk.test/api/listing-card/rec-2?expires=1&token=b",
          "https://kinfolk.test/api/listing-card/rec-1?expires=1&token=a",
        ],
        toolResults,
      ),
    ).toEqual([
      { address: "12 Oak St", listingId: null, ordinal: 1, recommendationId: "rec-2" },
      { address: "681 Florida St", listingId: null, ordinal: 2, recommendationId: "rec-1" },
    ]);
  });

  it("injects the rolling thread summary and sent-card registry into the turn context", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    loadTextThreadAgentMemoryMock.mockResolvedValue({
      rollingSummary: "Hunting a 2bd in Mission under $3,500; rejected SoMa.",
      sentListingCards: [
        { address: "681 Florida St", listingId: "listing-1", ordinal: 1, recommendationId: "rec-1" },
        { address: "12 Oak St", listingId: null, ordinal: 2, recommendationId: "rec-2" },
      ],
    });
    completeAgentChatMock.mockResolvedValue({
      data: {
        choices: [{ message: { content: "the second one is 12 Oak St." } }],
        model: "test-model",
      },
    });

    await runHousingAgentTurn({} as never, {
      body: "what was the second one again?",
      recentMessages: [],
      threadId: "thread-1",
      userId: "user-1",
    });

    const request = completeAgentChatMock.mock.calls[0][0] as {
      messages: Array<{ content: string; role: string }>;
    };
    const contextBlock = request.messages[1].content;
    expect(request.messages[1].role).toBe("system");
    expect(contextBlock).toContain(
      "Hunting a 2bd in Mission under $3,500; rejected SoMa.",
    );
    expect(contextBlock).toContain("1) 681 Florida St (recommendationId rec-1)");
    expect(contextBlock).toContain("2) 12 Oak St (recommendationId rec-2)");
  });

  it("persists the sent-card registry and rolling summary after the live reply, off the reply path", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("KINFOLK_TEXT_AGENT_SUMMARY_MODEL", "   ");
    const cardUrl = "https://kinfolk.test/api/listing-card/rec-9?expires=1&token=t";
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "search_listings" },
                    id: "call_1",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "681 Florida St is the move — want a tour?",
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "Sent 681 Florida St card; user weighing a tour.",
              },
            },
          ],
          model: "summary-model",
        },
      });
    runHousingAgentToolMock.mockResolvedValue({
      data: { listings: [{ address: "681 Florida St" }] },
      media: [{ label: "681 Florida St", url: cardUrl }],
      ok: true,
      summary: "Found 1 listing that fit.",
      toolName: "search_listings",
    });
    const supabase = {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [{ id: "rec-9", listing_id: "listing-9" }],
            error: null,
          }),
        }),
      }),
    } as never;
    const reply = vi.fn(async () => {});

    await runLiveHousingAgentReply(supabase, {
      body: "show me mission spots",
      message: {} as never,
      reply,
      runId: "run-1",
      thread: { id: "thread-1" } as never,
      userId: "user-1",
    });

    expect(reply).toHaveBeenCalledWith(
      "681 Florida St is the move — want a tour?",
      "agent_reply",
      [cardUrl],
    );
    expect(saveTextThreadAgentMemoryMock).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);

    await afterTasks[0]();

    // One combined write: cards + summary together, so a concurrent
    // summary_json writer can't land between two separate upserts and drop
    // the just-saved card registry.
    expect(saveTextThreadAgentMemoryMock).toHaveBeenCalledTimes(1);
    expect(saveTextThreadAgentMemoryMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        rollingSummary: "Sent 681 Florida St card; user weighing a tour.",
        sentListingCards: [
          {
            address: "681 Florida St",
            listingId: "listing-9",
            ordinal: 1,
            recommendationId: "rec-9",
          },
        ],
        threadId: "thread-1",
        userId: "user-1",
      },
    );
    const summaryRequest = completeAgentChatMock.mock.calls[2][0] as {
      model: string;
      operation: string;
    };
    expect(summaryRequest.model).toBe("google/gemini-3.1-flash-lite");
    expect(summaryRequest.operation).toBe("housing_agent_thread_summary");
  });

  it("does not persist unsupported rejection or exclusive-focus claims in thread memory", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    loadTextThreadAgentMemoryMock.mockResolvedValue({
      rollingSummary: "Previously compared Pacific Heights and the Mission.",
      sentListingCards: [],
    });
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "The Richmond is empty for solo one-bedrooms under $2,800 right now.",
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "You rejected 2841 Sacramento St and the Mission listings and want to focus exclusively on solo Richmond inventory under $2,800.",
              },
            },
          ],
          model: "summary-model",
        },
      });
    const reply = vi.fn(async () => {});

    await runLiveHousingAgentReply({} as never, {
      body: "Actually, just make it Richmond under 2800 and skip the big comparison.",
      message: {} as never,
      reply,
      runId: "run-unsafe-summary",
      thread: { id: "thread-1" } as never,
      userId: "user-1",
    });

    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]();

    expect(saveTextThreadAgentMemoryMock).toHaveBeenCalledTimes(1);
    expect(saveTextThreadAgentMemoryMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        rollingSummary: "Previously compared Pacific Heights and the Mission.",
        threadId: "thread-1",
        userId: "user-1",
      },
    );
  });

  it("never fails the run when the deferred thread memory write errors", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: "happy to rerun the mission search whenever.",
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockRejectedValueOnce(new Error("summary model down"));
    loadTextThreadAgentMemoryMock.mockRejectedValue(new Error("load broke"));
    saveTextThreadAgentMemoryMock.mockRejectedValue(new Error("save broke"));
    const reply = vi.fn(async () => {});

    await runLiveHousingAgentReply({} as never, {
      body: "anything new?",
      message: {} as never,
      reply,
      runId: "run-err",
      thread: { id: "thread-1" } as never,
      userId: "user-1",
    });

    expect(reply).toHaveBeenCalledTimes(1);
    expect(completeAgentRunMock).toHaveBeenCalledWith(
      expect.anything(),
      "run-err",
      "Housing agent reply sent.",
      "allowed_low_risk",
      expect.anything(),
    );
    expect(afterTasks).toHaveLength(1);
    await expect(afterTasks[0]()).resolves.toBeUndefined();
  });
});

describe("onboarding intake gate", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  });

  // The gate asks nextTextAgentIntakeStepFromDraftWithCoverage twice: once for
  // the next unanswered step of any kind, once restricted to the foundation
  // list. Keying the mock off the prioritized-steps argument is what separates
  // "listings are gated too" (a foundation step is still open) from "only
  // matches are gated" (foundation done, detail steps remain).
  function armActiveIntake({
    foundationStep = null,
    step = "home_preferences",
  }: { foundationStep?: string | null; step?: string } = {}) {
    loadThreadSummaryMock.mockResolvedValue({ next_intake_step: step });
    readNextIntakeStepFromSummaryMock.mockReturnValue(step);
    nextIntakeStepFromDraftWithCoverageMock.mockImplementation(
      (_draft: unknown, _coverage: unknown, prioritizedSteps?: string[]) =>
        prioritizedSteps?.includes("neighborhoods") ? foundationStep : step,
    );
  }

  function toolCallResponse(name: string) {
    return {
      data: {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { arguments: "{}", name }, id: `call_${name}` },
              ],
            },
          },
        ],
        model: "test-model",
      },
    };
  }

  function proseResponse(content: string) {
    return {
      data: { choices: [{ message: { content } }], model: "test-model" },
    };
  }

  it("answers get_matches deterministically mid-interview instead of running it", async () => {
    armActiveIntake();
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "get_matches" },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "Noted on pets. What kind of home setup are you hoping for?",
              },
            },
          ],
          model: "test-model",
        },
      });

    const result = await runHousingAgentTurn({} as never, {
      body: "Pets are fine, especially cats. I don't have one.",
      recentMessages: [],
      runId: "run-intake-gate",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    // The real tool never ran; the model saw the continue-intake result.
    expect(runHousingAgentToolMock).not.toHaveBeenCalled();
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0].ok).toBe(false);
    expect(result.toolResults[0].data.reason).toBe("onboarding_intake_active");
    expect(result.mediaUrls).toEqual([]);
    // The onboarding directive rode along as a system message.
    const firstCall = completeAgentChatMock.mock.calls[0][0] as {
      messages: Array<{ content: string; role: string }>;
    };
    const systemText = firstCall.messages
      .filter((entry) => entry.role === "system")
      .map((entry) => entry.content)
      .join("\n");
    expect(systemText).toContain("Onboarding is mid-flight");
  });

  it("still runs get_matches mid-interview when the user explicitly asks", async () => {
    armActiveIntake();
    runHousingAgentToolMock.mockResolvedValue({
      data: { roommates: [] },
      ok: true,
      summary: "No roommate matches are ready yet.",
      toolName: "get_matches",
    });
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "get_matches" },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  "No matches ready yet — early days. Quick one: what home setup suits you?",
              },
            },
          ],
          model: "test-model",
        },
      });

    const result = await runHousingAgentTurn({} as never, {
      body: "can you show me my matches?",
      recentMessages: [],
      runId: "run-intake-explicit",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
  });

  it("does not gate once coverage says every intake step is answered", async () => {
    loadThreadSummaryMock.mockResolvedValue({
      next_intake_step: "home_preferences",
    });
    readNextIntakeStepFromSummaryMock.mockReturnValue("home_preferences");
    // Stale summary step, but coverage reports nothing left to ask.
    nextIntakeStepFromDraftWithCoverageMock.mockReturnValue(null);
    runHousingAgentToolMock.mockResolvedValue({
      data: { roommates: [] },
      ok: true,
      summary: "No roommate matches are ready yet.",
      toolName: "get_matches",
    });
    completeAgentChatMock
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: { arguments: "{}", name: "get_matches" },
                    id: "call_matches",
                  },
                ],
              },
            },
          ],
          model: "test-model",
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: "Nothing ready quite yet." } }],
          model: "test-model",
        },
      });

    const result = await runHousingAgentTurn({} as never, {
      body: "ok done I think",
      recentMessages: [],
      runId: "run-intake-complete",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
  });

  // The live failure: a user who answered neighborhoods and then budget got
  // three studios back, because the search ran before anyone asked whether they
  // wanted roommates — and with no group size the split defaults to one person.
  it("answers search_listings deterministically while a foundation step is open", async () => {
    armActiveIntake({ foundationStep: "roommates", step: "roommates" });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("search_listings"))
      .mockResolvedValueOnce(
        proseResponse(
          "Got it, $3,000 max. How many roommates are you open to living with?",
        ),
      );

    const result = await runHousingAgentTurn({} as never, {
      body: "$3000 max",
      recentMessages: [],
      runId: "run-listing-gate",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(runHousingAgentToolMock).not.toHaveBeenCalled();
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0].ok).toBe(false);
    expect(result.toolResults[0].toolName).toBe("search_listings");
    expect(result.toolResults[0].data.reason).toBe(
      "onboarding_foundation_incomplete",
    );
    expect(result.mediaUrls).toEqual([]);
  });

  it("still runs search_listings mid-intake when the user explicitly asks to see places", async () => {
    armActiveIntake({ foundationStep: "roommates", step: "roommates" });
    runHousingAgentToolMock.mockResolvedValue({
      data: { listings: [] },
      ok: true,
      summary: "No listings matched.",
      toolName: "search_listings",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("search_listings"))
      .mockResolvedValueOnce(
        proseResponse("Nothing under that cap in Nob Hill right now."),
      );

    const result = await runHousingAgentTurn({} as never, {
      body: "show me some apartments in nob hill",
      recentMessages: [],
      runId: "run-listing-explicit",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
  });

  it("runs search_listings once the foundation steps are answered", async () => {
    armActiveIntake({ foundationStep: null, step: "home_preferences" });
    runHousingAgentToolMock.mockResolvedValue({
      data: { listings: [] },
      ok: true,
      summary: "No listings matched.",
      toolName: "search_listings",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("search_listings"))
      .mockResolvedValueOnce(proseResponse("Nothing open there this week."));

    const result = await runHousingAgentTurn({} as never, {
      body: "we're flexible on move-in",
      recentMessages: [],
      runId: "run-listing-foundation-done",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
  });

  // soul.md tells the model to narrate whatever score motion update_prefs
  // reports. Mid-intake the tool must report none, or the gate's "don't mention
  // matches" instruction and the tool result contradict each other.
  it("tells update_prefs to withhold score motion while intake is active", async () => {
    armActiveIntake({ foundationStep: "roommates", step: "roommates" });
    runHousingAgentToolMock.mockResolvedValue({
      data: { persisted: [] },
      ok: true,
      summary: "Saved 1 preference.",
      toolName: "update_prefs",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("update_prefs"))
      .mockResolvedValueOnce(
        proseResponse("Set your max at $3,000. Open to roommates?"),
      );

    await runHousingAgentTurn({} as never, {
      body: "$3000 max",
      recentMessages: [],
      runId: "run-score-motion-gate",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
    const context = runHousingAgentToolMock.mock.calls[0][0] as {
      suppressScoreMotion?: boolean;
    };
    expect(context.suppressScoreMotion).toBe(true);
  });

  it("lets update_prefs report score motion once intake is done", async () => {
    loadThreadSummaryMock.mockResolvedValue(null);
    readNextIntakeStepFromSummaryMock.mockReturnValue(null);
    nextIntakeStepFromDraftWithCoverageMock.mockReturnValue(null);
    runHousingAgentToolMock.mockResolvedValue({
      data: { persisted: [] },
      ok: true,
      summary: "Saved 1 preference.",
      toolName: "update_prefs",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("update_prefs"))
      .mockResolvedValueOnce(proseResponse("Updated — that moved Jack up."));

    await runHousingAgentTurn({} as never, {
      body: "bump my budget to $3500",
      recentMessages: [],
      runId: "run-score-motion-open",
      threadId: "thread-1",
      userId: "user-1",
    });

    const context = runHousingAgentToolMock.mock.calls[0][0] as {
      suppressScoreMotion?: boolean;
    };
    expect(context.suppressScoreMotion).toBe(false);
  });

  function semanticIntent(
    kind:
      | "intake_answer"
      | "listing_request"
      | "listing_refinement"
      | "match_request"
      | "roommate_detail"
      | "negated_request"
      | "housing_tangent"
      | "other_tangent"
      | "skip",
    overrides: Record<string, unknown> = {},
  ) {
    interpretInboundMessageMock.mockResolvedValue({
      area: null,
      bedrooms: null,
      kind,
      maxRent: null,
      personName: null,
      source: "classifier",
      wantsMediaCards: false,
      ...overrides,
    });
  }

  // The corpus negation bug: "I'd rather not see roommate matches" contains a
  // see-verb + matches-noun, so the regex fallback reads it as an ASK. The
  // semantic classifier reads the negation, and negation never opens a lookup.
  it("keeps matches gated on a negated request even when the phrasing looks like an ask", async () => {
    armActiveIntake();
    semanticIntent("negated_request");
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("get_matches"))
      .mockResolvedValueOnce(
        proseResponse("Totally fine — no match talk until you ask."),
      );

    const result = await runHousingAgentTurn({} as never, {
      body: "I'd rather not see roommate matches",
      recentMessages: [],
      runId: "run-negated",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(runHousingAgentToolMock).not.toHaveBeenCalled();
    expect(result.toolResults[0]?.data.reason).toBe("onboarding_intake_active");
  });

  it("closes every mid-interview reply with the canonical question, replacing the model's own", async () => {
    armActiveIntake();
    completeAgentChatMock.mockResolvedValueOnce(
      proseResponse(
        "Noted — cats are welcome plenty of places. What kind of vibe are you going for at home?",
      ),
    );

    const result = await runHousingAgentTurn({} as never, {
      body: "Pets are fine, especially cats.",
      recentMessages: [],
      runId: "run-canonical-close",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const { buildTextAgentProfileQuestion } = await import("./index");
    const canonical = buildTextAgentProfileQuestion("home_preferences");
    expect(result.reply.endsWith(canonical)).toBe(true);
    expect(result.reply).not.toContain("What kind of vibe");
    expect(result.reply).toContain("cats are welcome");
  });

  it("completes the interview durably and closes without a question when the last step clears", async () => {
    readNextIntakeStepFromSummaryMock.mockReturnValue("home_preferences");
    loadThreadSummaryMock.mockResolvedValue({
      next_intake_step: "home_preferences",
    });
    // Foundation is already done; the any-step queue empties after the write.
    let anyStepCalls = 0;
    nextIntakeStepFromDraftWithCoverageMock.mockImplementation(
      (_draft: unknown, _coverage: unknown, prioritizedSteps?: string[]) => {
        if (prioritizedSteps?.includes("neighborhoods")) return null;
        anyStepCalls += 1;
        return anyStepCalls === 1 ? "home_preferences" : null;
      },
    );
    runHousingAgentToolMock.mockResolvedValue({
      data: { persisted: ["home_preferences"] },
      ok: true,
      summary: "Saved 1 preference.",
      toolName: "update_prefs",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("update_prefs"))
      .mockResolvedValueOnce(
        proseResponse(
          "That's everything I needed — you're all set. Want to tweak anything?",
        ),
      );

    const result = await runHousingAgentTurn({} as never, {
      body: "somewhere calm where people actually cook",
      recentMessages: [],
      runId: "run-complete",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(markMatchingInterviewCompletedMock).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user-1" },
    );
    expect(result.reply).toBe("That's everything I needed — you're all set.");
  });

  it("forces the search when the user explicitly asked for listings and the model only talked", async () => {
    armActiveIntake();
    semanticIntent("listing_request", { area: "the Marina", maxRent: 3000 });
    runHousingAgentToolMock.mockResolvedValue({
      data: { listings: [{ title: "1234 Fell St" }] },
      ok: true,
      summary: "Found 1 listing in the Marina under $3,000.",
      toolName: "search_listings",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(
        proseResponse("The Marina is lovely — let me have a look!"),
      )
      .mockResolvedValueOnce(
        proseResponse("Found one: 1234 Fell St, right in the Marina."),
      );

    const result = await runHousingAgentTurn({} as never, {
      body: "what about the marina?",
      recentMessages: [],
      runId: "run-forced-search",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(runHousingAgentToolMock).toHaveBeenCalledTimes(1);
    expect(runHousingAgentToolMock.mock.calls[0][1]).toBe("search_listings");
    expect(runHousingAgentToolMock.mock.calls[0][2]).toEqual({
      budgetMax: 3000,
      neighborhoods: ["the Marina"],
    });
    expect(result.reply).toContain("1234 Fell St");
  });

  it("persists a skipped step and closes with the NEXT question, not the declined one", async () => {
    readNextIntakeStepFromSummaryMock.mockReturnValue("budget");
    loadThreadSummaryMock.mockResolvedValue({ next_intake_step: "budget" });
    // Initial resolution sees "budget"; after the skip is persisted, the
    // refresh resolves the next unanswered step, "move_in".
    let anyStepCalls = 0;
    nextIntakeStepFromDraftWithCoverageMock.mockImplementation(
      (_draft: unknown, _coverage: unknown, prioritizedSteps?: string[]) => {
        if (prioritizedSteps?.includes("neighborhoods")) return "budget";
        anyStepCalls += 1;
        return anyStepCalls === 1 ? "budget" : "move_in";
      },
    );
    semanticIntent("skip");
    completeAgentChatMock.mockResolvedValueOnce(
      proseResponse("No worries, we can come back to that."),
    );

    const result = await runHousingAgentTurn({} as never, {
      body: "skip",
      recentMessages: [],
      runId: "run-skip",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(appendSkippedIntakeStepMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ step: "budget", threadId: "thread-1", userId: "user-1" }),
    );
    const { buildTextAgentProfileQuestion } = await import("./index");
    expect(result.reply.endsWith(buildTextAgentProfileQuestion("move_in"))).toBe(
      true,
    );
    expect(markMatchingInterviewCompletedMock).not.toHaveBeenCalled();
  });

  it("completes the interview when the final step is skipped", async () => {
    readNextIntakeStepFromSummaryMock.mockReturnValue("home_preferences");
    loadThreadSummaryMock.mockResolvedValue({
      next_intake_step: "home_preferences",
    });
    let anyStepCalls = 0;
    nextIntakeStepFromDraftWithCoverageMock.mockImplementation(
      (_draft: unknown, _coverage: unknown, prioritizedSteps?: string[]) => {
        if (prioritizedSteps?.includes("neighborhoods")) return null;
        anyStepCalls += 1;
        return anyStepCalls === 1 ? "home_preferences" : null;
      },
    );
    semanticIntent("skip");
    completeAgentChatMock.mockResolvedValueOnce(
      proseResponse("All good — leaving that one blank."),
    );

    const result = await runHousingAgentTurn({} as never, {
      body: "pass",
      recentMessages: [],
      runId: "run-skip-final",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(markMatchingInterviewCompletedMock).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user-1" },
    );
    expect(result.reply).not.toContain("?");
  });

  it("never completes the interview when the post-write refresh fails", async () => {
    armActiveIntake();
    // First resolution succeeds; the post-write refresh blows up mid-read.
    let summaryCalls = 0;
    loadThreadSummaryMock.mockImplementation(async () => {
      summaryCalls += 1;
      if (summaryCalls > 1) {
        throw new Error("supabase timeout");
      }
      return { next_intake_step: "home_preferences" };
    });
    runHousingAgentToolMock.mockResolvedValue({
      data: { persisted: ["budget"] },
      ok: true,
      summary: "Saved 1 preference.",
      toolName: "update_prefs",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("update_prefs"))
      .mockResolvedValueOnce(proseResponse("Noted!"));

    const result = await runHousingAgentTurn({} as never, {
      body: "$3000 max",
      recentMessages: [],
      runId: "run-refresh-fail",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(markMatchingInterviewCompletedMock).not.toHaveBeenCalled();
    // The pre-write canonical question stands — re-asking once is recoverable.
    const { buildTextAgentProfileQuestion } = await import("./index");
    expect(
      result.reply.endsWith(buildTextAgentProfileQuestion("home_preferences")),
    ).toBe(true);
  });

  it("refreshes coverage after a partial update_prefs write", async () => {
    armActiveIntake();
    runHousingAgentToolMock.mockResolvedValue({
      data: { failed: ["pets"], persisted: ["budget"] },
      ok: false,
      summary: "Saved 1 of 2 preferences.",
      toolName: "update_prefs",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("update_prefs"))
      .mockResolvedValueOnce(proseResponse("Got your budget down."));

    await runHousingAgentTurn({} as never, {
      body: "$3000 max and pets",
      recentMessages: [],
      runId: "run-partial-write",
      threadId: "thread-1",
      userId: "user-1",
    });

    // Two full resolutions: the initial gate and the post-write refresh.
    expect(loadThreadSummaryMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ships exactly one question even when the model asks mid-reply", async () => {
    armActiveIntake();
    completeAgentChatMock.mockResolvedValueOnce(
      proseResponse(
        "Nob Hill's a great pick. Are you set on it, or open to Russian Hill? Either way I'll keep it in mind.",
      ),
    );

    const result = await runHousingAgentTurn({} as never, {
      body: "nob hill i think",
      recentMessages: [],
      runId: "run-interior-question",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.reply.match(/\?/g)).toHaveLength(1);
    expect(result.reply).toContain("Nob Hill's a great pick.");
    expect(result.reply).not.toContain("Russian Hill?");
  });

  it("grounds the classifier on the whole previous assistant turn, not the last bubble", async () => {
    armActiveIntake();
    completeAgentChatMock.mockResolvedValueOnce(proseResponse("On it!"));

    await runHousingAgentTurn({} as never, {
      body: "what about the marina?",
      recentMessages: [
        {
          body: "Two in Nob Hill: 1234 Jones St at $2,950 and 900 Hyde St at $3,100.",
          direction: "outbound",
        },
        {
          body: "How many roommates are you open to living with?",
          direction: "outbound",
        },
      ],
      runId: "run-grounding-window",
      threadId: "thread-1",
      userId: "user-1",
    });

    const args = interpretInboundMessageMock.mock.calls[0][0] as {
      previousAssistantMessage?: string | null;
    };
    expect(args.previousAssistantMessage).toBe(
      "Two in Nob Hill: 1234 Jones St at $2,950 and 900 Hyde St at $3,100.\n\nHow many roommates are you open to living with?",
    );
  });

  it("does not join separate outbound sends across a long time gap", async () => {
    armActiveIntake();
    completeAgentChatMock.mockResolvedValueOnce(proseResponse("On it!"));

    await runHousingAgentTurn({} as never, {
      body: "what about nob hill?",
      recentMessages: [
        {
          body: "Two in the Mission: 500 Guerrero St at $2,800.",
          direction: "outbound",
          receivedAt: "2026-07-26T10:00:00Z",
        },
        {
          body: "Quick one while I have you — how do you feel about roommates?",
          direction: "outbound",
          receivedAt: "2026-07-26T14:00:00Z",
        },
      ],
      runId: "run-send-boundary",
      threadId: "thread-1",
      userId: "user-1",
    });

    const args = interpretInboundMessageMock.mock.calls[0][0] as {
      previousAssistantMessage?: string | null;
    };
    // The stale listing prose from the morning send must not leak into the
    // grounding window of the afternoon's proactive question.
    expect(args.previousAssistantMessage).toBe(
      "Quick one while I have you — how do you feel about roommates?",
    );
  });

  it("re-asks the canonical question when skip persistence fails, without refreshing", async () => {
    armActiveIntake();
    semanticIntent("skip");
    appendSkippedIntakeStepMock.mockRejectedValue(new Error("supabase down"));
    completeAgentChatMock.mockResolvedValueOnce(
      proseResponse("No worries at all."),
    );

    const result = await runHousingAgentTurn({} as never, {
      body: "skip",
      recentMessages: [],
      runId: "run-skip-fail",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(markMatchingInterviewCompletedMock).not.toHaveBeenCalled();
    // Only the initial gate resolution ran — an unrecorded skip cannot have
    // changed coverage, so the extra roundtrip is skipped too.
    expect(loadThreadSummaryMock).toHaveBeenCalledTimes(1);
    const { buildTextAgentProfileQuestion } = await import("./index");
    expect(
      result.reply.endsWith(buildTextAgentProfileQuestion("home_preferences")),
    ).toBe(true);
  });

  it("lets the model's clarification stand when an explicitly requested search genuinely failed", async () => {
    armActiveIntake();
    semanticIntent("listing_request", { maxRent: 900 });
    runHousingAgentToolMock.mockResolvedValue({
      data: { reason: "no_results" },
      ok: false,
      summary: "No listings matched under $900.",
      toolName: "search_listings",
    });
    completeAgentChatMock
      .mockResolvedValueOnce(toolCallResponse("search_listings"))
      .mockResolvedValueOnce(
        proseResponse(
          "Nothing under $900 right now — should I widen the budget or the area?",
        ),
      );

    const result = await runHousingAgentTurn({} as never, {
      body: "anything under 900?",
      recentMessages: [],
      runId: "run-failed-search",
      threadId: "thread-1",
      userId: "user-1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.reply).toBe(
      "Nothing under $900 right now — should I widen the budget or the area?",
    );
  });
});
