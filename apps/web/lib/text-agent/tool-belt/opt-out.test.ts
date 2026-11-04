import { beforeEach, describe, expect, it, vi } from "vitest";
import { optOutTool, recordSmsConsentEvent } from "./opt-out";

const setPhoneConsentStateMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("../run-data", () => ({
  setPhoneConsentState: (...args: unknown[]) => setPhoneConsentStateMock(...args),
}));

type RecordedInsert = { table: string; values: Record<string, unknown> };
type RecordedUpdate = {
  eq: [string, unknown];
  table: string;
  values: Record<string, unknown>;
};

function makeSupabaseStub() {
  const inserts: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];
  const supabase = {
    from(table: string) {
      return {
        insert: async (values: Record<string, unknown>) => {
          inserts.push({ table, values });
          return { error: null };
        },
        update: (values: Record<string, unknown>) => ({
          eq: async (column: string, value: unknown) => {
            updates.push({ eq: [column, value], table, values });
            return { error: null };
          },
        }),
      };
    },
  };
  return { inserts, supabase: supabase as never, updates };
}

beforeEach(() => {
  setPhoneConsentStateMock.mockClear();
});

describe("opt_out tool", () => {
  it("marks the phone opted out through the STOP path and audits the verbatim text", async () => {
    const { inserts, supabase, updates } = makeSupabaseStub();
    const body = "ok seriously stopp texting me";

    const result = await optOutTool.run(
      {
        allowWrites: true,
        body,
        message: { from_phone_e164: "+14155550123" } as never,
        supabase,
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ optedOut: true });
    expect(result.summary).toContain("START");
    expect(setPhoneConsentStateMock).toHaveBeenCalledWith(
      supabase,
      "user-1",
      "+14155550123",
      "opted_out",
    );
    expect(updates).toEqual([
      {
        eq: ["id", "thread-1"],
        table: "text_threads",
        values: { status: "opted_out" },
      },
    ]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("agent_action_log");
    expect(inserts[0].values).toMatchObject({
      agent_identifier: "kinfolk_text_agent",
      tool_called: "sms_consent_event",
      user_id: "user-1",
    });
    expect(inserts[0].values.result_summary).toContain(body);
    expect(inserts[0].values.result_summary).toContain("agent_tool");
  });

  it("never opts out without writes or a phone, and says how to opt out instead", async () => {
    const { inserts, supabase, updates } = makeSupabaseStub();

    const previewResult = await optOutTool.run(
      {
        allowWrites: false,
        body: "stop texting me",
        message: { from_phone_e164: "+14155550123" } as never,
        supabase,
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );
    const phonelessResult = await optOutTool.run(
      {
        allowWrites: true,
        body: "stop texting me",
        supabase,
        threadId: "thread-1",
        userId: "user-1",
      },
      {},
    );

    for (const result of [previewResult, phonelessResult]) {
      expect(result.ok).toBe(false);
      expect(result.data).toMatchObject({ optedOut: false });
      expect(result.summary).toContain("STOP");
    }
    expect(setPhoneConsentStateMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("recordSmsConsentEvent", () => {
  it("writes one audit row per consent transition with the verbatim message", async () => {
    const { inserts, supabase } = makeSupabaseStub();

    await recordSmsConsentEvent(supabase, {
      event: "opted_out",
      message: "please stop texting me",
      method: "nl_revocation",
      phone: "+14155550123",
      userId: "user-1",
    });
    await recordSmsConsentEvent(supabase, {
      event: "opted_in",
      message: "START",
      method: "keyword",
      phone: "+14155550123",
      userId: "user-1",
    });

    expect(inserts).toHaveLength(2);
    expect(inserts[0].values.result_summary).toBe(
      'opted_out via nl_revocation for +14155550123: "please stop texting me"',
    );
    expect(inserts[1].values.result_summary).toBe(
      'opted_in via keyword for +14155550123: "START"',
    );
  });
});
