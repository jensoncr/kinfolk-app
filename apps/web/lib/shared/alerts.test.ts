import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyFounder } from "./alerts";

vi.mock("server-only", () => ({}));

const sendTextTextMock = vi.fn();
vi.mock("@/lib/integrations/text-transport", () => ({
  getActiveTextTransportProvider: () => "sendblue",
  sendTextText: (...args: unknown[]) => sendTextTextMock(...args),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

beforeEach(() => {
  rpcMock.mockReset();
  sendTextTextMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("notifyFounder", () => {
  it("texts the founder once per reason per window and suppresses the repeat", async () => {
    vi.stubEnv("KINFOLK_FOUNDER_ALERT_PHONE", "+14155550199");
    rpcMock
      .mockResolvedValueOnce({ data: [{ allowed: true, bucket_count: 1 }], error: null })
      .mockResolvedValueOnce({ data: [{ allowed: false, bucket_count: 1 }], error: null });
    sendTextTextMock.mockResolvedValue({ messageId: "alert-1" });

    await notifyFounder("text_agent_run_failed", {
      detail: "Queued run blew up.",
      runId: "run-9",
      threadId: "thread-4",
    });
    await notifyFounder("text_agent_run_failed", {
      detail: "Queued run blew up again.",
      runId: "run-10",
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0][0]).toBe("hit_text_agent_rate_limit");
    expect(rpcMock.mock.calls[0][1]).toMatchObject({
      p_bucket_key: "text_agent_run_failed",
      p_bucket_type: "founder_alert_reason_30m",
      p_limit: 1,
    });
    expect(sendTextTextMock).toHaveBeenCalledTimes(1);
    const sent = sendTextTextMock.mock.calls[0][0] as {
      body: string;
      idempotencyKey: string;
      provider: string;
      to: string;
    };
    expect(sent.to).toBe("+14155550199");
    expect(sent.provider).toBe("sendblue");
    expect(sent.body).toContain("kinfolk agent alert: text_agent_run_failed");
    expect(sent.body).toContain("run run-9");
    expect(sent.body).toContain("thread thread-4");
    expect(sent.body).toContain("Queued run blew up.");
    expect(sent.idempotencyKey).toMatch(/^founder-alert:text_agent_run_failed:/);
  });

  it("only logs when KINFOLK_FOUNDER_ALERT_PHONE is unset", async () => {
    await notifyFounder("text_webhook_processing_failed", {
      detail: "sendblue message.received: boom",
    });

    expect(rpcMock).not.toHaveBeenCalled();
    expect(sendTextTextMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[founder-alert]",
      expect.objectContaining({
        detail: "sendblue message.received: boom",
        reason: "text_webhook_processing_failed",
      }),
    );
  });

  it("never throws into its caller when the throttle or transport fails", async () => {
    vi.stubEnv("KINFOLK_FOUNDER_ALERT_PHONE", "+14155550199");
    rpcMock.mockResolvedValue({ data: null, error: { message: "db down" } });

    await expect(
      notifyFounder("text_agent_job_failed", { error: new Error("drain failed") }),
    ).resolves.toBeUndefined();
    expect(sendTextTextMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValue({
      data: [{ allowed: true, bucket_count: 1 }],
      error: null,
    });
    sendTextTextMock.mockRejectedValue(new Error("transport down"));

    await expect(
      notifyFounder("text_agent_job_failed", { detail: "still failing" }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "[founder-alert] alert delivery failed",
      expect.objectContaining({ reason: "text_agent_job_failed" }),
    );
  });
});
