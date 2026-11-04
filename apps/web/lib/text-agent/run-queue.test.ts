import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextAgentReply } from "./store-types";
import { processTextAgentRuns } from "./run-queue";

vi.mock("server-only", () => ({}));

const runLiveHousingAgentReplyMock = vi.fn();
vi.mock("@/lib/text-agent/loop", () => ({
  runLiveHousingAgentReply: (...args: unknown[]) =>
    runLiveHousingAgentReplyMock(...args),
}));

const handlePendingProfileQuestionReplyMock = vi.fn();
vi.mock("@/lib/text-agent/pending-profile-question", () => ({
  handlePendingProfileQuestionReply: (...args: unknown[]) =>
    handlePendingProfileQuestionReplyMock(...args),
}));

vi.mock("@/lib/text-agent/interview-state", () => ({
  startMatchingInterviewForUser: async () => {},
}));

vi.mock("@/lib/text-agent/profile-persistence", () => ({
  readableErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

vi.mock("@/lib/text-agent/profile-intake-flow", () => ({
  shouldPrioritizeFreshProfileIntake: async () => false,
}));

vi.mock("@/lib/text-agent/profile-updates", () => ({
  proposeProfileUpdateFromMessage: async () => {},
}));

const sendAndRecordReplyMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
const startTextTypingHeartbeatMock = vi.fn<(...args: unknown[]) => () => void>(
  () => () => {},
);
vi.mock("@/lib/text-agent/reply-send", () => ({
  sendAndRecordReply: (...args: unknown[]) => sendAndRecordReplyMock(...args),
  startTextTypingHeartbeat: (...args: unknown[]) =>
    startTextTypingHeartbeatMock(...args),
}));

const completeAgentRunMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
const failAgentRunMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("@/lib/text-agent/run-data", () => ({
  completeAgentRun: (...args: unknown[]) => completeAgentRunMock(...args),
  failAgentRun: (...args: unknown[]) => failAgentRunMock(...args),
}));

const notifyFounderMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("@/lib/shared/alerts", () => ({
  notifyFounder: (...args: unknown[]) => notifyFounderMock(...args),
}));

vi.mock("@/lib/integrations/text-transport", () => ({
  readTextProviderForRow: () => "sendblue",
}));

let currentClient: unknown;
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => currentClient,
}));

type StubResult = {
  count?: number | null;
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

type StubCall = { args: unknown[]; method: string; table: string };

function createSupabaseStub(plan: Record<string, StubResult[]>) {
  const calls: StubCall[] = [];
  const client = {
    from(table: string) {
      const queue = plan[table] ?? [];
      const result =
        queue.length > 0 ? queue.shift()! : { data: null, error: null };
      const query: Record<string, unknown> = {};
      for (const method of [
        "delete",
        "eq",
        "in",
        "insert",
        "limit",
        "lt",
        "maybeSingle",
        "neq",
        "or",
        "order",
        "select",
        "single",
        "update",
        "upsert",
      ]) {
        query[method] = (...args: unknown[]) => {
          calls.push({ args, method, table });
          return query;
        };
      }
      query.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          count: result.count ?? null,
          data: result.data ?? null,
          error: result.error ?? null,
        }).then(resolve, reject);
      return query;
    },
  };
  return { calls, client: client as never };
}

const queuedRun = {
  attempt_count: 0,
  created_at: "2026-06-10T12:00:00.000Z",
  id: "run-1",
  intent: "profile_update",
  message_id: "msg-1",
  thread_id: "thread-1",
  user_id: "user-1",
};

const messageRow = {
  body: "show me mission 2 beds",
  from_phone_e164: "+14155550111",
  id: "msg-1",
  phone_number_id: null,
  provider_chat_id: "chat-1",
  provider_message_id: "pm-1",
  user_id: "user-1",
};

const threadRow = {
  id: "thread-1",
  provider: "sendblue",
  provider_chat_id: "chat-1",
};

beforeEach(() => {
  runLiveHousingAgentReplyMock.mockReset();
  handlePendingProfileQuestionReplyMock.mockReset();
  handlePendingProfileQuestionReplyMock.mockResolvedValue(false);
  sendAndRecordReplyMock.mockClear();
  startTextTypingHeartbeatMock.mockClear();
  completeAgentRunMock.mockClear();
  failAgentRunMock.mockClear();
  notifyFounderMock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("processTextAgentRuns", () => {
  it("dry-runs the due queue without requeueing, claiming, or replying", async () => {
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { count: 4 },
        { data: [queuedRun, { ...queuedRun, id: "run-2" }] },
      ],
    });
    currentClient = client;

    const result = await processTextAgentRuns(2, { dryRun: true });

    expect(result).toEqual({
      claimed: 0,
      completed: 0,
      dryRun: true,
      failed: 0,
      queued: 2,
      skipped: 0,
      staleQueued: 4,
      superseded: 0,
      wouldAlertBacklog: true,
    });
    expect(
      calls.some(
        (call) => call.table === "text_agent_runs" && call.method === "update",
      ),
    ).toBe(false);
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
    expect(completeAgentRunMock).not.toHaveBeenCalled();
    expect(failAgentRunMock).not.toHaveBeenCalled();
    expect(notifyFounderMock).not.toHaveBeenCalled();
    expect(sendAndRecordReplyMock).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeatMock).not.toHaveBeenCalled();
  });

  it("defaults malformed direct limits before reading the due queue", async () => {
    const cases: unknown[] = [
      Number.NaN,
      "",
      "   ",
      "12.5",
      null,
      false,
    ];

    for (const value of cases) {
      const { calls, client } = createSupabaseStub({
        text_agent_runs: [{ count: 0 }, { data: [] }],
      });
      currentClient = client;

      const result = await processTextAgentRuns(value, { dryRun: true });

      expect(result).toMatchObject({ dryRun: true, queued: 0 });
      expect(
        calls
          .filter(
            (call) =>
              call.table === "text_agent_runs" && call.method === "limit",
          )
          .map((call) => call.args[0]),
      ).toEqual([5]);
    }
  });

  it("floors numeric direct limits before clamping the due queue read", async () => {
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [{ count: 0 }, { data: [] }],
    });
    currentClient = client;

    const result = await processTextAgentRuns(12.8, { dryRun: true });

    expect(result).toMatchObject({ dryRun: true, queued: 0 });
    expect(
      calls
        .filter(
          (call) =>
            call.table === "text_agent_runs" && call.method === "limit",
        )
        .map((call) => call.args[0]),
    ).toEqual([12]);
  });

  it("claims and processes a stale queued run that the webhook drain never picked up", async () => {
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 1 },
        { data: [queuedRun] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: messageRow }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockResolvedValue(undefined);

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      staleQueued: 1,
      superseded: 0,
    });
    const claimUpdate = calls.filter(
      (call) => call.table === "text_agent_runs" && call.method === "update",
    )[1];
    expect(claimUpdate.args[0]).toMatchObject({
      attempt_count: 1,
      run_status: "running",
    });
    expect(runLiveHousingAgentReplyMock).toHaveBeenCalledTimes(1);
    expect(runLiveHousingAgentReplyMock.mock.calls[0][1]).toMatchObject({
      body: messageRow.body,
      runId: "run-1",
      userId: "user-1",
    });
    expect(notifyFounderMock).not.toHaveBeenCalled();
  });

  it("consumes a pending profile-question reply before normal agent routing", async () => {
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: messageRow }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    handlePendingProfileQuestionReplyMock.mockResolvedValue(true);

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(handlePendingProfileQuestionReplyMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        body: messageRow.body,
        message: messageRow,
        thread: threadRow,
        userId: "user-1",
      }),
    );
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
  });

  it("alerts the founder when the stale queue depth crosses the backlog threshold", async () => {
    const { client } = createSupabaseStub({
      text_agent_runs: [{ data: null }, { count: 5 }, { data: [] }],
    });
    currentClient = client;

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({ claimed: 0, staleQueued: 5 });
    expect(notifyFounderMock).toHaveBeenCalledTimes(1);
    expect(notifyFounderMock).toHaveBeenCalledWith("text_agent_queue_backlog", {
      detail: expect.stringContaining("5 runs queued"),
    });
  });

  it("keeps draining when the stale backlog alert cannot be delivered", async () => {
    const { client } = createSupabaseStub({
      text_agent_runs: [{ data: null }, { count: 5 }, { data: [] }],
    });
    currentClient = client;
    notifyFounderMock.mockRejectedValueOnce(new Error("sms provider down"));

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 0,
      completed: 0,
      failed: 0,
      staleQueued: 5,
    });
    expect(notifyFounderMock).toHaveBeenCalledWith("text_agent_queue_backlog", {
      detail: expect.stringContaining("5 runs queued"),
    });
    expect(console.error).toHaveBeenCalledWith(
      "[text-agent-queue] founder notification failed",
      {
        error: "sms provider down",
        reason: "text_agent_queue_backlog",
        runId: null,
        threadId: null,
      },
    );
  });

  it("requeues a failed run before retry attempts are exhausted", async () => {
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
        { data: null },
      ],
      text_messages: [{ data: messageRow }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockRejectedValue(new Error("model timeout"));

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      failed: 0,
      skipped: 1,
    });
    const retryUpdate = calls.find(
      (call) =>
        call.table === "text_agent_runs" &&
        call.method === "update" &&
        (call.args[0] as Record<string, unknown>).error_message ===
          "model timeout",
    );
    expect(retryUpdate?.args[0]).toMatchObject({
      error_message: "model timeout",
      run_status: "queued",
    });
    expect(
      calls.some(
        (call) =>
          call.table === "text_agent_runs" &&
          call.method === "eq" &&
          call.args[0] === "run_status" &&
          call.args[1] === "running",
      ),
    ).toBe(true);
    expect(failAgentRunMock).not.toHaveBeenCalled();
    expect(notifyFounderMock).not.toHaveBeenCalledWith(
      "text_agent_run_failed",
      expect.anything(),
    );
  });

  it("fails the run and alerts the founder once retries are exhausted", async () => {
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [{ ...queuedRun, attempt_count: 2 }] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 3, run_status: "running" } },
      ],
      text_messages: [{ data: messageRow }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockRejectedValue(new Error("model exploded"));

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1 });
    expect(failAgentRunMock).toHaveBeenCalledWith(
      client,
      "run-1",
      "model exploded",
    );
    expect(notifyFounderMock).toHaveBeenCalledTimes(1);
    expect(notifyFounderMock).toHaveBeenCalledWith("text_agent_run_failed", {
      detail: "model exploded",
      runId: "run-1",
      threadId: "thread-1",
    });
  });

  it("completes unsupported queued intents without entering the reply path", async () => {
    const unsupportedRun = {
      ...queuedRun,
      intent: "delivery_update",
      message_id: null,
      thread_id: null,
    };
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [unsupportedRun] },
        { data: { ...unsupportedRun, attempt_count: 1, run_status: "running" } },
      ],
    });
    currentClient = client;

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(completeAgentRunMock).toHaveBeenCalledWith(
      client,
      "run-1",
      "Queued run had no model-eligible intent.",
      "unsupported",
    );
    expect(
      calls.some((call) => call.table === "text_messages"),
    ).toBe(false);
    expect(calls.some((call) => call.table === "text_threads")).toBe(false);
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
    expect(sendAndRecordReplyMock).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeatMock).not.toHaveBeenCalled();
  });

  it("completes userless queued messages without sending a provider reply", async () => {
    const userlessRun = { ...queuedRun, user_id: null };
    const userlessMessage = { ...messageRow, user_id: null };
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [userlessRun] },
        { data: [] },
        { data: { ...userlessRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: userlessMessage }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(completeAgentRunMock).toHaveBeenCalledWith(
      client,
      "run-1",
      "Queued run missing user.",
      "unsupported",
    );
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
    expect(sendAndRecordReplyMock).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeatMock).not.toHaveBeenCalled();
  });

  it("completes queued messages with blank sender phones before typing or replying", async () => {
    const blankSenderMessage = { ...messageRow, from_phone_e164: "   " };
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: blankSenderMessage }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(completeAgentRunMock).toHaveBeenCalledWith(
      client,
      "run-1",
      "Queued run missing sender phone.",
      "error",
    );
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
    expect(sendAndRecordReplyMock).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeatMock).not.toHaveBeenCalled();
  });

  it("completes queued messages with malformed sender phones before typing or replying", async () => {
    const malformedSenderMessage = { ...messageRow, from_phone_e164: "123456" };
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: malformedSenderMessage }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(completeAgentRunMock).toHaveBeenCalledWith(
      client,
      "run-1",
      "Queued run missing sender phone.",
      "error",
    );
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
    expect(sendAndRecordReplyMock).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeatMock).not.toHaveBeenCalled();
  });

  it("trims queued sender phone values before typing and sending replies", async () => {
    const paddedSenderMessage = {
      ...messageRow,
      from_phone_e164: "  +14155550111  ",
    };
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: paddedSenderMessage }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockImplementation(
      async (_supabase: unknown, args: { reply: TextAgentReply }) => {
        await args.reply("Got it.");
      },
    );

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(startTextTypingHeartbeatMock).toHaveBeenCalledWith({
      chatId: "chat-1",
      provider: "sendblue",
      to: "+14155550111",
    });
    expect(sendAndRecordReplyMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ to: "+14155550111" }),
    );
  });

  it("keeps the exhausted run failed when the failure alert cannot be delivered", async () => {
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [{ ...queuedRun, attempt_count: 2 }] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 3, run_status: "running" } },
      ],
      text_messages: [{ data: messageRow }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockRejectedValue(new Error("model exploded"));
    notifyFounderMock.mockRejectedValueOnce(new Error("sms provider down"));

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1 });
    expect(failAgentRunMock).toHaveBeenCalledWith(
      client,
      "run-1",
      "model exploded",
    );
    expect(notifyFounderMock).toHaveBeenCalledWith("text_agent_run_failed", {
      detail: "model exploded",
      runId: "run-1",
      threadId: "thread-1",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[text-agent-queue] founder notification failed",
      {
        error: "sms provider down",
        reason: "text_agent_run_failed",
        runId: "run-1",
        threadId: "thread-1",
      },
    );
  });

  it("skips a queued run that is claimed by another worker before typing or replying", async () => {
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [] },
        { data: null },
      ],
    });
    currentClient = client;

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 0,
      completed: 0,
      failed: 0,
      skipped: 1,
      superseded: 0,
    });
    expect(
      calls.some(
        (call) =>
          call.table === "text_agent_runs" &&
          call.method === "eq" &&
          call.args[0] === "run_status" &&
          call.args[1] === "queued",
      ),
    ).toBe(true);
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
    expect(sendAndRecordReplyMock).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeatMock).not.toHaveBeenCalled();
    expect(completeAgentRunMock).not.toHaveBeenCalled();
    expect(failAgentRunMock).not.toHaveBeenCalled();
    expect(notifyFounderMock).not.toHaveBeenCalled();
  });

  it("refuses to claim while another run in the same thread is actively running", async () => {
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        {
          data: [
            {
              created_at: "2026-06-10T11:59:55.000Z",
              id: "run-0",
              run_status: "running",
              updated_at: new Date().toISOString(),
            },
          ],
        },
      ],
    });
    currentClient = client;

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 0,
      completed: 0,
      failed: 0,
      skipped: 1,
      superseded: 0,
    });
    expect(runLiveHousingAgentReplyMock).not.toHaveBeenCalled();
    const updates = calls.filter(
      (call) => call.table === "text_agent_runs" && call.method === "update",
    );
    expect(updates).toHaveLength(1);
  });

  it("claims past a running sibling whose heartbeat has gone stale", async () => {
    const staleBeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        {
          data: [
            {
              created_at: staleBeat,
              id: "run-0",
              run_status: "running",
              updated_at: staleBeat,
            },
          ],
        },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: messageRow }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockResolvedValue(undefined);

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({ claimed: 1, completed: 1, skipped: 0 });
    expect(runLiveHousingAgentReplyMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces a multi-bubble burst into the newest run and never replies to superseded ones", async () => {
    const newerRun = {
      ...queuedRun,
      created_at: "2026-06-10T12:00:05.000Z",
      id: "run-2",
      message_id: "msg-2",
      run_status: "queued",
      updated_at: "2026-06-10T12:00:05.000Z",
    };
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun, newerRun] },
        {
          data: [
            {
              created_at: newerRun.created_at,
              id: "run-2",
              run_status: "queued",
              updated_at: newerRun.created_at,
            },
          ],
        },
        { data: [{ id: "run-1" }] },
        { data: [] },
        { data: { ...newerRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: { ...messageRow, id: "msg-2" } }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockResolvedValue(undefined);

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      superseded: 1,
    });
    expect(runLiveHousingAgentReplyMock).toHaveBeenCalledTimes(1);
    expect(runLiveHousingAgentReplyMock.mock.calls[0][1]).toMatchObject({
      runId: "run-2",
    });
    const supersedeUpdate = calls.filter(
      (call) => call.table === "text_agent_runs" && call.method === "update",
    )[1];
    expect(supersedeUpdate.args[0]).toMatchObject({
      result_summary: expect.stringContaining("Superseded"),
      run_status: "ignored",
    });
    expect(
      calls.find(
        (call) =>
          call.table === "text_agent_runs" &&
          call.method === "in" &&
          call.args[0] === "id",
      )?.args[1],
    ).toEqual(["run-1"]);
    expect(failAgentRunMock).not.toHaveBeenCalled();
    expect(notifyFounderMock).not.toHaveBeenCalled();
  });

  it("processes the newest burst owner when a one-run drain first sees an older sibling", async () => {
    const newerRun = {
      ...queuedRun,
      created_at: "2026-06-10T12:00:05.000Z",
      id: "run-2",
      message_id: "msg-2",
      run_status: "queued",
      updated_at: "2026-06-10T12:00:05.000Z",
    };
    const { client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [newerRun] },
        { data: [{ id: "run-1" }] },
        { data: [] },
        { data: { ...newerRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: { ...messageRow, id: "msg-2" } }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockResolvedValue(undefined);

    const result = await processTextAgentRuns(1);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      superseded: 1,
    });
    expect(runLiveHousingAgentReplyMock).toHaveBeenCalledTimes(1);
    expect(runLiveHousingAgentReplyMock.mock.calls[0][1]).toMatchObject({
      body: messageRow.body,
      runId: "run-2",
      userId: "user-1",
    });
    expect(failAgentRunMock).not.toHaveBeenCalled();
    expect(notifyFounderMock).not.toHaveBeenCalled();
  });

  it("uses the computed burst order when superseding queued siblings", async () => {
    const olderByQueueRun = {
      ...queuedRun,
      created_at: "2026-06-10T12:05:00.000Z",
      id: "run-a",
      message_id: "msg-a",
      queued_at: "2026-06-10T12:00:00.000Z",
      run_status: "queued",
      updated_at: "2026-06-10T12:05:00.000Z",
    };
    const ownerRun = {
      ...queuedRun,
      created_at: "2026-06-10T12:00:00.000Z",
      id: "run-b",
      message_id: "msg-b",
      queued_at: "2026-06-10T12:10:00.000Z",
      run_status: "queued",
      updated_at: "2026-06-10T12:10:00.000Z",
    };
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [olderByQueueRun, ownerRun] },
        { data: [ownerRun] },
        { data: [{ id: "run-a" }] },
        { data: [] },
        { data: { ...ownerRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: { ...messageRow, id: "msg-b" } }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockResolvedValue(undefined);

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      superseded: 1,
    });
    expect(runLiveHousingAgentReplyMock).toHaveBeenCalledTimes(1);
    expect(runLiveHousingAgentReplyMock.mock.calls[0][1]).toMatchObject({
      runId: "run-b",
    });
    expect(
      calls.find(
        (call) =>
          call.table === "text_agent_runs" &&
          call.method === "in" &&
          call.args[0] === "id",
      )?.args[1],
    ).toEqual(["run-a"]);
    expect(failAgentRunMock).not.toHaveBeenCalled();
    expect(notifyFounderMock).not.toHaveBeenCalled();
  });

  it("coalesces same-timestamp queued burst runs into one deterministic owner", async () => {
    const sharedTimestamp = "2026-06-10T12:00:05.000Z";
    const olderRun = {
      ...queuedRun,
      created_at: sharedTimestamp,
      id: "run-a",
      message_id: "msg-a",
      queued_at: sharedTimestamp,
      run_status: "queued",
      updated_at: sharedTimestamp,
    };
    const ownerRun = {
      ...queuedRun,
      created_at: sharedTimestamp,
      id: "run-b",
      message_id: "msg-b",
      queued_at: sharedTimestamp,
      run_status: "queued",
      updated_at: sharedTimestamp,
    };
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [olderRun, ownerRun] },
        { data: [ownerRun] },
        { data: [{ id: "run-a" }] },
        { data: [] },
        { data: { ...ownerRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: { ...messageRow, id: "msg-b" } }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    runLiveHousingAgentReplyMock.mockResolvedValue(undefined);

    const result = await processTextAgentRuns(5);

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      superseded: 1,
    });
    expect(runLiveHousingAgentReplyMock).toHaveBeenCalledTimes(1);
    expect(runLiveHousingAgentReplyMock.mock.calls[0][1]).toMatchObject({
      runId: "run-b",
    });
    expect(
      calls.find(
        (call) =>
          call.table === "text_agent_runs" &&
          call.method === "in" &&
          call.args[0] === "id"
      )?.args[1],
    ).toEqual(["run-a"]);
    expect(failAgentRunMock).not.toHaveBeenCalled();
    expect(notifyFounderMock).not.toHaveBeenCalled();
  });

  it("only sweeps running runs that are both old and heartbeat-silent back to queued", async () => {
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [{ data: null }, { count: 0 }, { data: [] }],
    });
    currentClient = client;

    await processTextAgentRuns(5);

    const sweepUpdate = calls.find(
      (call) => call.table === "text_agent_runs" && call.method === "update",
    );
    expect(sweepUpdate?.args[0]).toMatchObject({
      run_status: "queued",
      started_at: null,
    });
    const ltColumns = calls
      .filter((call) => call.method === "lt")
      .map((call) => call.args[0]);
    expect(ltColumns).toContain("started_at");
    expect(ltColumns).toContain("updated_at");
  });

  it("beats the claimed run's liveness heartbeat while the loop is slow", async () => {
    vi.useFakeTimers();
    const { calls, client } = createSupabaseStub({
      text_agent_runs: [
        { data: null },
        { count: 0 },
        { data: [queuedRun] },
        { data: [] },
        { data: { ...queuedRun, attempt_count: 1, run_status: "running" } },
      ],
      text_messages: [{ data: messageRow }],
      text_threads: [{ data: threadRow }],
    });
    currentClient = client;
    let finishRun: (() => void) | undefined;
    runLiveHousingAgentReplyMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRun = resolve;
        }),
    );

    const drain = processTextAgentRuns(5);
    await vi.advanceTimersByTimeAsync(2 * 45 * 1000);

    const heartbeats = calls.filter(
      (call) =>
        call.table === "text_agent_runs" &&
        call.method === "update" &&
        Object.keys(call.args[0] as Record<string, unknown>).length === 1 &&
        (call.args[0] as Record<string, unknown>).updated_at !== undefined,
    );
    expect(heartbeats).toHaveLength(2);

    finishRun?.();
    const result = await drain;

    expect(result).toMatchObject({ claimed: 1, completed: 1 });
    const beatsAfterCompletion = calls.filter(
      (call) =>
        call.table === "text_agent_runs" &&
        call.method === "update" &&
        Object.keys(call.args[0] as Record<string, unknown>).length === 1,
    );
    await vi.advanceTimersByTimeAsync(4 * 45 * 1000);
    expect(
      calls.filter(
        (call) =>
          call.table === "text_agent_runs" &&
          call.method === "update" &&
          Object.keys(call.args[0] as Record<string, unknown>).length === 1,
      ),
    ).toHaveLength(beatsAfterCompletion.length);
  });
});
