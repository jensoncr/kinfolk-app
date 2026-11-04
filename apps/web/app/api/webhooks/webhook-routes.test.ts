import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleLinqWebhook: vi.fn(),
  handleSendblueWebhook: vi.fn(),
  processTextAgentRuns: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/lib/text-agent/store", () => ({
  handleLinqWebhook: mocks.handleLinqWebhook,
  handleSendblueWebhook: mocks.handleSendblueWebhook,
  processTextAgentRuns: mocks.processTextAgentRuns,
}));

import { POST as linqPost } from "./linq/route";
import { POST as sendbluePost } from "./sendblue/route";

function webhookRequest(body: string, headers: HeadersInit = {}) {
  return new Request("https://kinfolk.test/api/webhooks/sendblue", {
    body,
    headers,
    method: "POST",
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("text transport webhook route wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processTextAgentRuns.mockResolvedValue({
      processed: 1,
    });
  });

  it("forwards raw Sendblue body and headers, then returns the handler response", async () => {
    mocks.handleSendblueWebhook.mockResolvedValueOnce({
      body: {
        ok: true,
        provider: "sendblue",
      },
      status: 202,
    });

    const response = await sendbluePost(
      webhookRequest("raw-sendblue-body", {
        "sb-signing-secret": "real-secret",
      }),
    );

    expect(response.status).toBe(202);
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      provider: "sendblue",
    });
    expect(mocks.handleSendblueWebhook).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      rawBody: "raw-sendblue-body",
    });
    const [{ headers }] = mocks.handleSendblueWebhook.mock.calls[0];
    expect(headers.get("sb-signing-secret")).toBe("real-secret");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.processTextAgentRuns).not.toHaveBeenCalled();
  });

  it("schedules a one-run queue drain after Sendblue queues an agent run", async () => {
    mocks.handleSendblueWebhook.mockResolvedValueOnce({
      body: {
        ok: true,
        queuedAgentRun: {
          id: "run-1",
        },
      },
      status: 200,
    });

    const response = await sendbluePost(webhookRequest("queued-sendblue-body"));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      queuedAgentRun: {
        id: "run-1",
      },
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.processTextAgentRuns).toHaveBeenCalledWith(1);
  });

  it("does not fail the Sendblue response when the scheduled queue drain rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.processTextAgentRuns.mockRejectedValueOnce(new Error("queue offline"));
    mocks.handleSendblueWebhook.mockResolvedValueOnce({
      body: {
        ok: true,
        queuedAgentRun: {
          id: "run-2",
        },
      },
      status: 200,
    });

    const response = await sendbluePost(webhookRequest("queued-sendblue-body"));

    expect(response.status).toBe(200);
    await mocks.after.mock.calls[0][0]();
    expect(consoleError).toHaveBeenCalledWith(
      "Queued Kinfolk text agent run failed",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("forwards raw Linq body and schedules queue drain only when requested", async () => {
    mocks.handleLinqWebhook.mockResolvedValueOnce({
      body: {
        duplicate: true,
        ok: true,
      },
      status: 200,
    });

    const idleResponse = await linqPost(
      webhookRequest("raw-linq-body", {
        "x-linq-signature": "sig",
      }),
    );

    expect(idleResponse.status).toBe(200);
    await expect(readJson(idleResponse)).resolves.toEqual({
      duplicate: true,
      ok: true,
    });
    expect(mocks.handleLinqWebhook).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      rawBody: "raw-linq-body",
    });
    const [{ headers }] = mocks.handleLinqWebhook.mock.calls[0];
    expect(headers.get("x-linq-signature")).toBe("sig");
    expect(mocks.after).not.toHaveBeenCalled();

    mocks.handleLinqWebhook.mockResolvedValueOnce({
      body: {
        ok: true,
        queuedAgentRun: {
          id: "linq-run-1",
        },
      },
      status: 200,
    });

    const queuedResponse = await linqPost(webhookRequest("queued-linq-body"));

    expect(queuedResponse.status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.processTextAgentRuns).toHaveBeenCalledWith(1);
  });
});
