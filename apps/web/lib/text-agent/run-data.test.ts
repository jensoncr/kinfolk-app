import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { failAgentRun } from "./run-data";

function makeSupabase({ updateError = null }: { updateError?: unknown } = {}) {
  const calls: Array<{ args: unknown[]; method: string; table: string }> = [];
  const builder = {
    _terminal: null as unknown,
    eq: (column: string, value: unknown) => {
      calls.push({ args: [column, value], method: "eq", table: "text_agent_runs" });
      return builder;
    },
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) =>
      (builder._terminal as Promise<unknown>).then(onFulfilled, onRejected),
    update: (row: unknown) => {
      calls.push({ args: [row], method: "update", table: "text_agent_runs" });
      builder._terminal = Promise.resolve({ error: updateError });
      return builder;
    },
  };
  const client = {
    calls,
    from: (table: string) => {
      calls.push({ args: [table], method: "from", table });
      return builder;
    },
  };
  return client;
}

describe("failAgentRun", () => {
  it("marks a text-agent run failed with the original error", async () => {
    const client = makeSupabase();

    await failAgentRun(
      client as unknown as Parameters<typeof failAgentRun>[0],
      "run-1",
      "metadata write failed",
    );

    expect(client.calls).toEqual([
      { args: ["text_agent_runs"], method: "from", table: "text_agent_runs" },
      {
        args: [
          expect.objectContaining({
            error_message: "metadata write failed",
            policy_outcome: "error",
            run_status: "failed",
          }),
        ],
        method: "update",
        table: "text_agent_runs",
      },
      { args: ["id", "run-1"], method: "eq", table: "text_agent_runs" },
    ]);
    expect(
      (client.calls[1].args[0] as { completed_at?: string }).completed_at,
    ).toEqual(expect.any(String));
  });

  it("throws when the failed-run marker cannot be persisted", async () => {
    const updateError = new Error("text_agent_runs update failed");
    const client = makeSupabase({ updateError });

    await expect(
      failAgentRun(
        client as unknown as Parameters<typeof failAgentRun>[0],
        "run-1",
        "metadata write failed",
      ),
    ).rejects.toThrow("text_agent_runs update failed");
  });
});
