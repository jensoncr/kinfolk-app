import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { recordWebhookEvent } = vi.hoisted(() => ({
  recordWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/text-agent/message-store", () => ({
  findInboundMessageByProviderMessageId: vi.fn(),
  hasNonFailedTextAgentRunForMessage: vi.fn(),
  recordWebhookEvent,
  recordInboundMessage: vi.fn(),
  updateMessageDeliveryFromWebhook: vi.fn(),
  updateWebhookEventStatus: vi.fn(),
  upsertTextThread: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({}),
}));

// Keep text-transport REAL by re-exporting via relative path.
// We must mock its @/ sub-deps that have server-only or use fetch at import time.
vi.mock("@/lib/integrations/sendblue/client", () => ({
  getSendblueFromNumber: () => "",
  getSendblueWebhookSigningSecret: () => process.env.SENDBLUE_WEBHOOK_SIGNING_SECRET ?? process.env.SENDBLUE_WEBHOOK_SECRET ?? "",
  isSendblueTextAgentEnabled: () => false,
  sendSendblueMessage: vi.fn(),
  sendSendblueText: vi.fn(),
  startSendblueTyping: vi.fn(),
}));
vi.mock("@/lib/integrations/linq/client", () => ({
  getLinqFromNumber: () => "",
  getLinqWebhookSigningSecret: () => process.env.LINQ_WEBHOOK_SIGNING_SECRET ?? "",
  isLinqTextAgentEnabled: () => false,
  sendLinqMessage: vi.fn(),
  sendLinqText: vi.fn(),
  startLinqTyping: vi.fn(),
}));
vi.mock("@/lib/integrations/linq/webhooks", async () => {
  return await import("../integrations/linq/webhooks");
});
vi.mock("@/lib/integrations/sendblue/webhooks", async () => {
  return await import("../integrations/sendblue/webhooks");
});
vi.mock("@/lib/integrations/text-transport-types", async () => {
  return await import("../integrations/text-transport-types");
});
vi.mock("@/lib/integrations/text-transport", async () => {
  return await import("../integrations/text-transport");
});

// Mock all value imports from store.ts that are not text-transport
vi.mock("@/lib/contacts/group-join-notifications", () => ({
  processGroupJoinRequestReaction: vi.fn(),
}));
vi.mock("@/lib/text-agent", () => ({
  buildTextAgentHelpScopeNote: vi.fn(),
  buildTextAgentProfileQuestion: vi.fn(),
  classifyTextAgentIntent: vi.fn(),
  parseVerificationCode: vi.fn(),
}));
vi.mock("@/lib/text-agent/fact-utils", () => ({
  canAutoPersistAllTextFacts: vi.fn(),
  readNextIntakeStepFromSummary: vi.fn(),
  readTextAgentDraftState: vi.fn(),
}));
vi.mock("@/lib/text-agent/command-router", () => ({
  decideApproveEntryCommand: vi.fn(),
  decideApproveFallbackCommand: vi.fn(),
  decideProfileUpdateCommand: vi.fn(),
  decideVerifiedTextCommand: vi.fn(),
}));
vi.mock("@/lib/text-agent/interview-state", () => ({
  startMatchingInterviewForUser: vi.fn(),
}));
vi.mock("@/lib/text-agent/listing-reactions", () => ({
  processListingRecommendationReaction: vi.fn(),
}));
vi.mock("@/lib/text-agent/loop", () => ({
  runLiveHousingAgentReply: vi.fn(),
}));
vi.mock("@/lib/text-agent/phone-verification", () => ({
  findVerifiedPhone: vi.fn(),
  verifyPhoneChallenge: vi.fn(),
}));
vi.mock("@/lib/text-agent/profile-persistence", () => ({
  completeLowRiskTextProfileUpdate: vi.fn(),
  createProfileUpdateProposalFromFacts: vi.fn(),
}));
vi.mock("@/lib/text-agent/profile-intake-flow", () => ({
  shouldPrioritizeFreshProfileIntake: vi.fn(),
}));
vi.mock("@/lib/text-agent/profile-updates", () => ({
  proposeProfileUpdateFromText: vi.fn(),
}));
vi.mock("@/lib/text-agent/rate-limit", () => ({
  enforceVerifiedInboundRateLimits: vi.fn(),
  hitTextAgentRateLimit: vi.fn(),
}));
vi.mock("@/lib/text-agent/reply-send", () => ({
  buildReviewReply: vi.fn(),
  sendAndRecordReply: vi.fn(),
  sendOnboardingContactCard: vi.fn(),
  startTextTypingHeartbeat: vi.fn(() => () => {}),
}));
vi.mock("@/lib/text-agent/run-data", () => ({
  completeAgentRun: vi.fn(),
  createAgentRun: vi.fn(),
  failAgentRun: vi.fn(),
  setPhoneConsentState: vi.fn(),
  updateAgentRunMetadata: vi.fn(),
}));
vi.mock("@/lib/text-agent/thread-data", () => ({
  approveLatestProposal: vi.fn(),
  buildUserTextAgentProfileQuestions: vi.fn(),
  expireSupersededPendingTextProposals: vi.fn(),
  loadLatestPendingTextProposal: vi.fn(),
  loadThreadSummary: vi.fn(),
}));
vi.mock("@/lib/text-agent/phone-handoff", () => ({
  createContinueOnPhoneChallengeForCurrentUser: vi.fn(),
  createInterviewOnPhoneHandoffForCurrentUser: vi.fn(),
}));
vi.mock("@/lib/text-agent/run-queue", () => ({
  processTextAgentRuns: vi.fn(),
}));
vi.mock("@/lib/shared/alerts", () => ({
  notifyFounder: vi.fn(),
}));

import { handleLinqWebhook, handleSendblueWebhook } from "./store";
import { computeLinqWebhookSignature } from "@/lib/integrations/linq/webhooks";
import { classifyTextAgentIntent, parseVerificationCode } from "@/lib/text-agent";
import { notifyFounder } from "@/lib/shared/alerts";
import { findVerifiedPhone, verifyPhoneChallenge } from "@/lib/text-agent/phone-verification";
import {
  enforceVerifiedInboundRateLimits,
  hitTextAgentRateLimit,
} from "@/lib/text-agent/rate-limit";
import { startTextTypingHeartbeat } from "@/lib/text-agent/reply-send";
import { createAgentRun, failAgentRun, updateAgentRunMetadata } from "@/lib/text-agent/run-data";
import {
  findInboundMessageByProviderMessageId,
  hasNonFailedTextAgentRunForMessage,
  recordInboundMessage,
  updateMessageDeliveryFromWebhook,
  updateWebhookEventStatus,
  upsertTextThread,
} from "@/lib/text-agent/message-store";

// Minimal valid Sendblue inbound payload that parseSendblueTextWebhook accepts
// (mirrors webhooks.test.ts:24-39 fixture — produces eventId "receive:msg_inbound_123")
const validSendblueBody = JSON.stringify({
  accountEmail: "hello@example.com",
  content: "Hello Kinfolk",
  date_sent: "2026-05-23T20:00:00.000Z",
  date_updated: "2026-05-23T20:00:01.000Z",
  from_number: "+14155550142",
  is_outbound: false,
  message_handle: "msg_inbound_123",
  message_type: "message",
  number: "+14155550142",
  sendblue_number: "+14155550147",
  service: "iMessage",
  status: "RECEIVED",
  to_number: "+14155550147",
});

const validSendblueDeliveryBody = JSON.stringify({
  content: "Hello back",
  date_updated: "2026-05-23T20:01:00.000Z",
  from_number: "+14155550147",
  is_outbound: true,
  message_handle: "msg_outbound_123",
  number: "+14155550142",
  service: "iMessage",
  status: "DELIVERED",
  to_number: "+14155550142",
});

const validLinqBody = JSON.stringify({
  created_at: "2026-05-23T21:00:00.000Z",
  event_id: "linq_evt_1",
  event_type: "message.received",
  trace_id: "trace_linq_1",
  data: {
    id: "linq_msg_1",
    chat: {
      id: "linq_chat_1",
      is_group: false,
      owner_handle: { handle: "+14155550147" },
      participants: [
        { handle: "+14155550147", is_me: true, service: "iMessage" },
        { handle: "+14155550142", is_me: false, service: "iMessage" },
      ],
    },
    direction: "inbound",
    parts: [{ type: "text", value: "I want a quieter roommate match" }],
    sender_handle: { handle: "+14155550142" },
    service: "iMessage",
  },
});

function signedLinqHeaders(rawBody: string, secret = "linq-secret") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeLinqWebhookSignature({
    payload: rawBody,
    secret,
    timestamp,
  });
  return new Headers({
    "x-webhook-signature": signature,
    "x-webhook-timestamp": timestamp,
  });
}

describe("handleSendblueWebhook / handleTextTransportWebhook boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseVerificationCode).mockReturnValue(null);
    vi.mocked(verifyPhoneChallenge).mockResolvedValue({
      success: false,
    });
    vi.mocked(hitTextAgentRateLimit).mockResolvedValue({
      allowed: true,
      bucket: "verification_code_phone_hour:+14155550142",
    });
    vi.mocked(enforceVerifiedInboundRateLimits).mockResolvedValue({
      allowed: true,
      bucket: "verified_inbound:user-1",
    });
    vi.mocked(findInboundMessageByProviderMessageId).mockResolvedValue(null);
    vi.mocked(hasNonFailedTextAgentRunForMessage).mockResolvedValue(false);
    vi.mocked(startTextTypingHeartbeat).mockReturnValue(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forged signature → 401 signature_mismatch; recordWebhookEvent not called", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "WRONG" }),
      rawBody: "{}",
    });
    expect(result.status).toBe(401);
    expect(result.body.ok).toBe(false);
    expect((result.body as { error?: string }).error).toBe("signature_mismatch");
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("missing secret → 500 missing_secret; recordWebhookEvent not called", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    const result = await handleSendblueWebhook({
      headers: new Headers({}),
      rawBody: "{}",
    });
    expect(result.status).toBe(500);
    expect(result.body.ok).toBe(false);
    expect((result.body as { error?: string }).error).toBe("missing_secret");
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("valid signature + duplicate event → 200 {duplicate:true}; recordWebhookEvent called once", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    recordWebhookEvent.mockResolvedValue({ duplicate: true });
    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "real-secret" }),
      rawBody: validSendblueBody,
    });
    expect(result.status).toBe(200);
    expect((result.body as { duplicate?: boolean }).duplicate).toBe(true);
    expect(recordWebhookEvent).toHaveBeenCalledOnce();
  });

  it("marks webhook failures even when founder notification fails", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(updateMessageDeliveryFromWebhook).mockRejectedValueOnce(
      new Error("delivery update failed"),
    );
    vi.mocked(notifyFounder).mockRejectedValueOnce(new Error("alert offline"));
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "real-secret" }),
      rawBody: validSendblueDeliveryBody,
    });

    expect(result).toEqual({
      body: { error: "delivery update failed", ok: false },
      status: 500,
    });
    expect(notifyFounder).toHaveBeenCalledWith("text_webhook_processing_failed", {
      detail: "sendblue outbound: delivery update failed",
    });
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId:
          "outbound:msg_outbound_123:delivered:2026-05-23T20:01:00.000Z",
        eventType: "outbound",
        provider: "sendblue",
      }),
      "failed",
      "delivery update failed",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[text-agent] webhook failure notification failed",
      expect.objectContaining({
        error: "alert offline",
      }),
    );
    consoleError.mockRestore();
  });

  it("preserves the original webhook error when marking the webhook failed also fails", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(updateMessageDeliveryFromWebhook).mockRejectedValueOnce(
      new Error("delivery update failed"),
    );
    vi.mocked(updateWebhookEventStatus).mockRejectedValueOnce(
      new Error("failed marker unavailable"),
    );

    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "real-secret" }),
      rawBody: validSendblueDeliveryBody,
    });

    expect(result).toEqual({
      body: { error: "delivery update failed", ok: false },
      status: 500,
    });
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId:
          "outbound:msg_outbound_123:delivered:2026-05-23T20:01:00.000Z",
        eventType: "outbound",
        provider: "sendblue",
      }),
      "failed",
      "delivery update failed",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[text-agent] webhook failed-status update failed",
      expect.objectContaining({
        error: "failed marker unavailable",
        originalError: "delivery update failed",
      }),
    );
    consoleError.mockRestore();
  });

  it("valid verified inbound Sendblue message records the thread/message and queues the agent", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(classifyTextAgentIntent).mockReturnValue("profile_update");
    vi.mocked(findVerifiedPhone).mockResolvedValue({
      id: "phone-1",
      sms_consent_state: "opted_in",
      user_id: "user-1",
    } as Awaited<ReturnType<typeof findVerifiedPhone>>);
    vi.mocked(upsertTextThread).mockResolvedValue({
      id: "thread-1",
    } as Awaited<ReturnType<typeof upsertTextThread>>);
    vi.mocked(recordInboundMessage).mockResolvedValue({
      id: "message-1",
    } as Awaited<ReturnType<typeof recordInboundMessage>>);
    vi.mocked(createAgentRun).mockResolvedValue({
      id: "run-1",
    } as Awaited<ReturnType<typeof createAgentRun>>);
    vi.mocked(updateAgentRunMetadata).mockResolvedValue(undefined);
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "real-secret" }),
      rawBody: validSendblueBody,
    });

    expect(result).toEqual({
      body: { ok: true, queuedAgentRun: true },
      status: 200,
    });
    expect(upsertTextThread).toHaveBeenCalledWith(expect.anything(), {
      chatId: "sendblue:+14155550147:+14155550142",
      from: "+14155550147",
      phoneNumberId: "phone-1",
      provider: "sendblue",
      status: "active",
      to: "+14155550142",
      userId: "user-1",
    });
    expect(recordInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: "Hello Kinfolk",
        chatId: "sendblue:+14155550147:+14155550142",
        eventId: "receive:msg_inbound_123",
        from: "+14155550142",
        messageId: "msg_inbound_123",
        provider: "sendblue",
        to: "+14155550147",
      }),
      "thread-1",
      "user-1",
      "phone-1",
    );
    expect(createAgentRun).toHaveBeenCalledWith(expect.anything(), {
      initialStatus: "queued",
      intent: "profile_update",
      messageId: "message-1",
      threadId: "thread-1",
      traceId: null,
      userId: "user-1",
    });
    expect(updateAgentRunMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      {
        limitBucket: "verified_inbound:user-1",
        policyOutcome: null,
      },
    );
    expect(startTextTypingHeartbeat).toHaveBeenCalledWith({
      chatId: "sendblue:+14155550147:+14155550142",
      provider: "sendblue",
      singlePingOnly: true,
      to: "+14155550142",
    });
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "receive:msg_inbound_123",
        eventType: "receive",
        provider: "sendblue",
      }),
      "processed",
    );
  });

  it("persists media-only Sendblue inbound messages from plural media fields", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(classifyTextAgentIntent).mockReturnValue("profile_update");
    vi.mocked(findVerifiedPhone).mockResolvedValue({
      id: "phone-1",
      sms_consent_state: "opted_in",
      user_id: "user-1",
    } as Awaited<ReturnType<typeof findVerifiedPhone>>);
    vi.mocked(upsertTextThread).mockResolvedValue({
      id: "thread-1",
    } as Awaited<ReturnType<typeof upsertTextThread>>);
    vi.mocked(recordInboundMessage).mockResolvedValue({
      id: "message-1",
    } as Awaited<ReturnType<typeof recordInboundMessage>>);
    vi.mocked(createAgentRun).mockResolvedValue({
      id: "run-1",
    } as Awaited<ReturnType<typeof createAgentRun>>);
    vi.mocked(updateAgentRunMetadata).mockResolvedValue(undefined);
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const rawBody = JSON.stringify({
      content: "   ",
      date_sent: "2026-05-23T20:00:00.000Z",
      from_number: "+14155550142",
      is_outbound: false,
      media_urls: [
        "https://cdn.sendblue.co/media/first.jpg",
        " https://cdn.sendblue.co/media/second.jpg ",
      ],
      message_handle: "msg_media_array_only",
      sendblue_number: "+14155550147",
      service: "iMessage",
      status: "RECEIVED",
    });

    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "real-secret" }),
      rawBody,
    });

    expect(result).toEqual({
      body: { ok: true, queuedAgentRun: true },
      status: 200,
    });
    expect(recordInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: "",
        chatId: "sendblue:+14155550147:+14155550142",
        eventId: "receive:msg_media_array_only",
        media: [
          {
            type: "media",
            url: "https://cdn.sendblue.co/media/first.jpg",
          },
          {
            type: "media",
            url: "https://cdn.sendblue.co/media/second.jpg",
          },
        ],
        messageId: "msg_media_array_only",
        provider: "sendblue",
      }),
      "thread-1",
      "user-1",
      "phone-1",
    );
    expect(createAgentRun).toHaveBeenCalledWith(expect.anything(), {
      initialStatus: "queued",
      intent: "profile_update",
      messageId: "message-1",
      threadId: "thread-1",
      traceId: null,
      userId: "user-1",
    });
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "receive:msg_media_array_only",
        eventType: "receive",
        provider: "sendblue",
      }),
      "processed",
    );
  });

  it("preserves the original inbound error when marking the run failed also fails", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(classifyTextAgentIntent).mockReturnValue("profile_update");
    vi.mocked(findVerifiedPhone).mockResolvedValue({
      id: "phone-1",
      sms_consent_state: "opted_in",
      user_id: "user-1",
    } as Awaited<ReturnType<typeof findVerifiedPhone>>);
    vi.mocked(upsertTextThread).mockResolvedValue({
      id: "thread-1",
    } as Awaited<ReturnType<typeof upsertTextThread>>);
    vi.mocked(recordInboundMessage).mockResolvedValue({
      id: "message-1",
    } as Awaited<ReturnType<typeof recordInboundMessage>>);
    vi.mocked(createAgentRun).mockResolvedValue({
      id: "run-1",
    } as Awaited<ReturnType<typeof createAgentRun>>);
    vi.mocked(updateAgentRunMetadata).mockRejectedValueOnce(
      new Error("metadata write failed"),
    );
    vi.mocked(failAgentRun).mockRejectedValueOnce(new Error("run failure write failed"));
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "real-secret" }),
      rawBody: validSendblueBody,
    });

    expect(result).toEqual({
      body: { error: "metadata write failed", ok: false },
      status: 500,
    });
    expect(failAgentRun).toHaveBeenCalledWith(expect.anything(), "run-1", "metadata write failed");
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "receive:msg_inbound_123",
        eventType: "receive",
        provider: "sendblue",
      }),
      "failed",
      "metadata write failed",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[text-agent] failed to mark inbound run failed",
      expect.objectContaining({
        error: "run failure write failed",
        originalError: "metadata write failed",
        runId: "run-1",
        threadId: "thread-1",
      }),
    );
    consoleError.mockRestore();
  });

  it("valid verified inbound Linq message records the thread/message and queues the agent", async () => {
    vi.stubEnv("LINQ_WEBHOOK_SIGNING_SECRET", "linq-secret");
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(classifyTextAgentIntent).mockReturnValue("profile_update");
    vi.mocked(findVerifiedPhone).mockResolvedValue({
      id: "phone-1",
      sms_consent_state: "opted_in",
      user_id: "user-1",
    } as Awaited<ReturnType<typeof findVerifiedPhone>>);
    vi.mocked(upsertTextThread).mockResolvedValue({
      id: "thread-1",
    } as Awaited<ReturnType<typeof upsertTextThread>>);
    vi.mocked(recordInboundMessage).mockResolvedValue({
      id: "message-1",
    } as Awaited<ReturnType<typeof recordInboundMessage>>);
    vi.mocked(createAgentRun).mockResolvedValue({
      id: "run-1",
    } as Awaited<ReturnType<typeof createAgentRun>>);
    vi.mocked(updateAgentRunMetadata).mockResolvedValue(undefined);
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const result = await handleLinqWebhook({
      headers: signedLinqHeaders(validLinqBody),
      rawBody: validLinqBody,
    });

    expect(result).toEqual({
      body: { ok: true, queuedAgentRun: true },
      status: 200,
    });
    expect(upsertTextThread).toHaveBeenCalledWith(expect.anything(), {
      chatId: "linq_chat_1",
      from: "+14155550147",
      phoneNumberId: "phone-1",
      provider: "linq",
      status: "active",
      to: "+14155550142",
      userId: "user-1",
    });
    expect(recordInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: "I want a quieter roommate match",
        chatId: "linq_chat_1",
        eventId: "linq_evt_1",
        from: "+14155550142",
        messageId: "linq_msg_1",
        provider: "linq",
        to: "+14155550147",
        traceId: "trace_linq_1",
      }),
      "thread-1",
      "user-1",
      "phone-1",
    );
    expect(createAgentRun).toHaveBeenCalledWith(expect.anything(), {
      initialStatus: "queued",
      intent: "profile_update",
      messageId: "message-1",
      threadId: "thread-1",
      traceId: "trace_linq_1",
      userId: "user-1",
    });
    expect(updateAgentRunMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      {
        limitBucket: "verified_inbound:user-1",
        policyOutcome: null,
      },
    );
    expect(startTextTypingHeartbeat).toHaveBeenCalledWith({
      chatId: "linq_chat_1",
      provider: "linq",
      singlePingOnly: true,
      to: "+14155550142",
    });
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "linq_evt_1",
        eventType: "message.received",
        provider: "linq",
      }),
      "processed",
    );
  });

  it("acknowledges a replayed inbound provider message without creating another agent run", async () => {
    vi.stubEnv("LINQ_WEBHOOK_SIGNING_SECRET", "linq-secret");
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(classifyTextAgentIntent).mockReturnValue("profile_update");
    vi.mocked(findVerifiedPhone).mockResolvedValue({
      id: "phone-1",
      sms_consent_state: "opted_in",
      user_id: "user-1",
    } as Awaited<ReturnType<typeof findVerifiedPhone>>);
    vi.mocked(findInboundMessageByProviderMessageId).mockResolvedValue({
      id: "message-1",
    } as Awaited<ReturnType<typeof findInboundMessageByProviderMessageId>>);
    vi.mocked(hasNonFailedTextAgentRunForMessage).mockResolvedValue(true);
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const result = await handleLinqWebhook({
      headers: signedLinqHeaders(validLinqBody),
      rawBody: validLinqBody,
    });

    expect(result).toEqual({
      body: { ok: true, queuedAgentRun: false },
      status: 200,
    });
    expect(findInboundMessageByProviderMessageId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chatId: "linq_chat_1",
        eventId: "linq_evt_1",
        messageId: "linq_msg_1",
        provider: "linq",
      }),
    );
    expect(hasNonFailedTextAgentRunForMessage).toHaveBeenCalledWith(
      expect.anything(),
      "message-1",
    );
    expect(upsertTextThread).not.toHaveBeenCalled();
    expect(recordInboundMessage).not.toHaveBeenCalled();
    expect(createAgentRun).not.toHaveBeenCalled();
    expect(updateAgentRunMetadata).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeat).not.toHaveBeenCalled();
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "linq_evt_1",
        eventType: "message.received",
        provider: "linq",
      }),
      "processed",
    );
  });

  it("acknowledges a replayed Sendblue inbound provider message with a fresh webhook event id", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SIGNING_SECRET", "real-secret");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(classifyTextAgentIntent).mockReturnValue("profile_update");
    vi.mocked(findVerifiedPhone).mockResolvedValue({
      id: "phone-1",
      sms_consent_state: "opted_in",
      user_id: "user-1",
    } as Awaited<ReturnType<typeof findVerifiedPhone>>);
    vi.mocked(findInboundMessageByProviderMessageId).mockResolvedValue({
      id: "message-1",
    } as Awaited<ReturnType<typeof findInboundMessageByProviderMessageId>>);
    vi.mocked(hasNonFailedTextAgentRunForMessage).mockResolvedValue(true);
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const rawBody = JSON.stringify({
      accountEmail: "hello@example.com",
      content: "Hello Kinfolk again",
      date_sent: "2026-05-23T20:00:10.000Z",
      event_id: "sendblue_retry_evt_2",
      from_number: "+14155550142",
      is_outbound: false,
      message_handle: "msg_inbound_123",
      message_type: "message",
      sendblue_number: "+14155550147",
      service: "iMessage",
      status: "RECEIVED",
    });

    const result = await handleSendblueWebhook({
      headers: new Headers({ "sb-signing-secret": "real-secret" }),
      rawBody,
    });

    expect(result).toEqual({
      body: { ok: true, queuedAgentRun: false },
      status: 200,
    });
    expect(findInboundMessageByProviderMessageId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chatId: "sendblue:+14155550147:+14155550142",
        eventId: "sendblue_retry_evt_2",
        messageId: "msg_inbound_123",
        provider: "sendblue",
      }),
    );
    expect(hasNonFailedTextAgentRunForMessage).toHaveBeenCalledWith(
      expect.anything(),
      "message-1",
    );
    expect(upsertTextThread).not.toHaveBeenCalled();
    expect(recordInboundMessage).not.toHaveBeenCalled();
    expect(createAgentRun).not.toHaveBeenCalled();
    expect(updateAgentRunMetadata).not.toHaveBeenCalled();
    expect(startTextTypingHeartbeat).not.toHaveBeenCalled();
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "sendblue_retry_evt_2",
        eventType: "receive",
        provider: "sendblue",
      }),
      "processed",
    );
  });

  it("retries an existing inbound message when the prior agent run failed", async () => {
    vi.stubEnv("LINQ_WEBHOOK_SIGNING_SECRET", "linq-secret");
    recordWebhookEvent.mockResolvedValue({ duplicate: false });
    vi.mocked(classifyTextAgentIntent).mockReturnValue("profile_update");
    vi.mocked(findVerifiedPhone).mockResolvedValue({
      id: "phone-1",
      sms_consent_state: "opted_in",
      user_id: "user-1",
    } as Awaited<ReturnType<typeof findVerifiedPhone>>);
    vi.mocked(findInboundMessageByProviderMessageId).mockResolvedValue({
      id: "message-1",
    } as Awaited<ReturnType<typeof findInboundMessageByProviderMessageId>>);
    vi.mocked(hasNonFailedTextAgentRunForMessage).mockResolvedValue(false);
    vi.mocked(upsertTextThread).mockResolvedValue({
      id: "thread-1",
    } as Awaited<ReturnType<typeof upsertTextThread>>);
    vi.mocked(createAgentRun).mockResolvedValue({
      id: "run-2",
    } as Awaited<ReturnType<typeof createAgentRun>>);
    vi.mocked(updateAgentRunMetadata).mockResolvedValue(undefined);
    vi.mocked(updateWebhookEventStatus).mockResolvedValue(undefined);

    const result = await handleLinqWebhook({
      headers: signedLinqHeaders(validLinqBody),
      rawBody: validLinqBody,
    });

    expect(result).toEqual({
      body: { ok: true, queuedAgentRun: true },
      status: 200,
    });
    expect(recordInboundMessage).not.toHaveBeenCalled();
    expect(createAgentRun).toHaveBeenCalledWith(expect.anything(), {
      initialStatus: "queued",
      intent: "profile_update",
      messageId: "message-1",
      threadId: "thread-1",
      traceId: "trace_linq_1",
      userId: "user-1",
    });
    expect(updateAgentRunMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "run-2",
      {
        limitBucket: "verified_inbound:user-1",
        policyOutcome: null,
      },
    );
    expect(updateWebhookEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "linq_evt_1",
        eventType: "message.received",
        provider: "linq",
      }),
      "processed",
    );
  });

  it("linq delegation smoke: no secret → 500 or 401", async () => {
    vi.stubEnv("LINQ_WEBHOOK_SIGNING_SECRET", "");
    const result = await handleLinqWebhook({
      headers: new Headers({}),
      rawBody: "{}",
    });
    expect([401, 500]).toContain(result.status);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });
});
