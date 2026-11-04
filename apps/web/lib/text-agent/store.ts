import "server-only";
import { processGroupJoinRequestReaction } from "@/lib/contacts/group-join-notifications";
import { textAgentOptInConfirmationCopy, textAgentOptOutConfirmationCopy } from "./copy";
import { recordSmsConsentEvent } from "./tool-belt/opt-out";
import { buildTextAgentHelpScopeNote, buildTextAgentProfileQuestion, classifyTextAgentIntent, isTextAgentOptOutKeyword, parseVerificationCode } from "@/lib/text-agent";
import { canAutoPersistAllTextFacts, readNextIntakeStepFromSummary, readTextAgentDraftState } from "@/lib/text-agent/fact-utils";
import { decideApproveEntryCommand, decideApproveFallbackCommand, decideProfileUpdateCommand, decideVerifiedTextCommand } from "@/lib/text-agent/command-router";
import { startMatchingInterviewForUser } from "@/lib/text-agent/interview-state";
import { processListingRecommendationReaction } from "@/lib/text-agent/listing-reactions";
import { runLiveHousingAgentReply } from "@/lib/text-agent/loop";
import { findInboundMessageByProviderMessageId, hasNonFailedTextAgentRunForMessage, recordInboundMessage, recordWebhookEvent, updateMessageDeliveryFromWebhook, updateWebhookEventStatus, upsertTextThread } from "@/lib/text-agent/message-store";
import { findVerifiedPhone, verifyPhoneChallenge } from "@/lib/text-agent/phone-verification";
import { completeLowRiskTextProfileUpdate, createProfileUpdateProposalFromFacts } from "@/lib/text-agent/profile-persistence";
import { shouldPrioritizeFreshProfileIntake } from "@/lib/text-agent/profile-intake-flow";
import { proposeProfileUpdateFromText } from "@/lib/text-agent/profile-updates";
import { enforceVerifiedInboundRateLimits, hitTextAgentRateLimit } from "@/lib/text-agent/rate-limit";
import { buildReviewReply, sendAndRecordReply, sendOnboardingContactCard, startTextTypingHeartbeat } from "@/lib/text-agent/reply-send";
import { completeAgentRun, createAgentRun, failAgentRun, setPhoneConsentState, updateAgentRunMetadata } from "@/lib/text-agent/run-data";
import { notifyFounder } from "@/lib/shared/alerts";
import { approveLatestProposal, buildUserTextAgentProfileQuestions, expireSupersededPendingTextProposals, loadLatestPendingTextProposal, loadThreadSummary } from "@/lib/text-agent/thread-data";
import { getTextTransportDisplayName, parseTextWebhookPayload, verifyTextWebhook } from "@/lib/integrations/text-transport";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SupabaseServiceClient, TableRow, TextAgentReply } from "@/lib/text-agent/store-types";
import type { ParsedTextWebhook, TextInboundMessage, TextTransportProvider } from "@/lib/integrations/text-transport";

const maxUnverifiedInboundPerHour = 3;

const maxVerificationCodeAttemptsPerHour = 8;

async function sendVerifiedOnboardingSequence(
  reply: TextAgentReply,
  profileQuestions: string,
) {
  await sendOnboardingContactCard(reply);
  await reply(profileQuestions, "profile_prompt");
}

export async function handleLinqWebhook({
  headers,
  rawBody,
}: {
  headers: Headers;
  rawBody: string;
}) {
  return handleTextTransportWebhook({ headers, provider: "linq", rawBody });
}

export async function handleSendblueWebhook({
  headers,
  rawBody,
}: {
  headers: Headers;
  rawBody: string;
}) {
  return handleTextTransportWebhook({ headers, provider: "sendblue", rawBody });
}

async function handleTextTransportWebhook({
  headers,
  provider,
  rawBody,
}: {
  headers: Headers;
  provider: TextTransportProvider;
  rawBody: string;
}) {
  const verification = verifyTextWebhook({
    headers,
    provider,
    rawBody,
  });

  if (!verification.ok) {
    return {
      body: { error: verification.reason, ok: false },
      status: verification.reason === "missing_secret" ? 500 : 401,
    };
  }

  let parsed: ParsedTextWebhook;
  try {
    parsed = parseTextWebhookPayload({ provider, rawBody });
  } catch (error) {
    return {
      body: {
        error:
          error instanceof Error ? error.message : "Invalid webhook payload.",
        ok: false,
      },
      status: 400,
    };
  }

  if (!parsed.event.eventId || !parsed.event.eventType) {
    return {
      body: {
        error: `Missing ${getTextTransportDisplayName(provider)} event id or event type.`,
        ok: false,
      },
      status: 400,
    };
  }

  const supabase = createSupabaseServiceClient();
  const event = await recordWebhookEvent(supabase, parsed.event);

  if (event.duplicate) {
    return { body: { duplicate: true, ok: true }, status: 200 };
  }

  try {
    const inbound = parsed.inbound;
    if (inbound) {
      const processing = await processInboundTextMessage(supabase, inbound);
      await updateWebhookEventStatus(supabase, parsed.event, "processed");
      return {
        body: { ok: true, queuedAgentRun: processing.queuedAgentRun },
        status: 200,
      };
    }

    const reaction = parsed.reaction;
    if (reaction) {
      const groupJoinProcessing = await processGroupJoinRequestReaction(
        supabase,
        reaction,
      );
      const processing = groupJoinProcessing.handled
        ? groupJoinProcessing
        : await processListingRecommendationReaction(supabase, reaction);
      await updateWebhookEventStatus(
        supabase,
        parsed.event,
        processing.handled ? "processed" : "ignored",
      );
      return {
        body: { handled: processing.handled, ok: true },
        status: 200,
      };
    }

    await updateMessageDeliveryFromWebhook(supabase, parsed.delivery ?? null);
    await updateWebhookEventStatus(supabase, parsed.event, "ignored");
    return { body: { ignored: true, ok: true }, status: 200 };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Text webhook processing failed.";
    console.error("[text-agent] webhook processing failed", {
      error: message,
      eventId: parsed.event.eventId,
      eventType: parsed.event.eventType,
      provider,
    });
    try {
      await notifyFounder("text_webhook_processing_failed", {
        detail: `${provider} ${parsed.event.eventType}: ${message}`,
      });
    } catch (notifyError) {
      console.error("[text-agent] webhook failure notification failed", {
        error:
          notifyError instanceof Error
            ? notifyError.message
            : "Founder notification failed.",
        eventId: parsed.event.eventId,
        eventType: parsed.event.eventType,
        provider,
      });
    }
    try {
      await updateWebhookEventStatus(
        supabase,
        parsed.event,
        "failed",
        message,
      );
    } catch (statusError) {
      console.error("[text-agent] webhook failed-status update failed", {
        error:
          statusError instanceof Error
            ? statusError.message
            : "Webhook failed-status update failed.",
        eventId: parsed.event.eventId,
        eventType: parsed.event.eventType,
        originalError: message,
        provider,
      });
    }
    return { body: { error: message, ok: false }, status: 500 };
  }
}

async function processInboundTextMessage(
  supabase: SupabaseServiceClient,
  inbound: TextInboundMessage,
) {
  const intent = classifyTextAgentIntent(inbound.body);
  const verificationCode = parseVerificationCode(inbound.body);
  const verificationAttemptLimit = verificationCode
    ? await hitTextAgentRateLimit(supabase, {
        bucketKey: inbound.from,
        bucketType: "verification_code_phone_hour",
        limit: maxVerificationCodeAttemptsPerHour,
        window: "hour",
      })
    : null;
  const verification = verificationCode
    && (!verificationAttemptLimit || verificationAttemptLimit.allowed)
    ? await verifyPhoneChallenge(
        supabase,
        verificationCode,
        inbound.from,
        inbound.provider,
      )
    : null;
  const verifiedPhone =
    verification?.phoneNumber ??
    (await findVerifiedPhone(supabase, inbound.from));
  const userId = verification?.userId ?? verifiedPhone?.user_id ?? null;
  const phoneNumberId =
    verification?.phoneNumber?.id ?? verifiedPhone?.id ?? null;
  const isOptedOut =
    verifiedPhone?.sms_consent_state === "opted_out" && !verification?.success;
  const status =
    isOptedOut && intent !== "opt_in"
      ? "opted_out"
      : userId
        ? "active"
        : "pending_verification";
  const existingMessage = await findInboundMessageByProviderMessageId(
    supabase,
    inbound,
  );

  if (
    existingMessage &&
    await hasNonFailedTextAgentRunForMessage(supabase, existingMessage.id)
  ) {
    return { queuedAgentRun: false };
  }

  const thread = await upsertTextThread(supabase, {
    chatId: inbound.chatId,
    from: inbound.to,
    phoneNumberId,
    provider: inbound.provider,
    status,
    to: inbound.from,
    userId,
  });
  const message =
    existingMessage ??
    await recordInboundMessage(
      supabase,
      inbound,
      thread.id,
      userId,
      phoneNumberId,
    );
  // Verification codes are handled inline. Everything else owned by the live
  // agent is queued for the cron drain.
  const shouldQueueRun = Boolean(
    userId &&
    intent === "profile_update" &&
    !isOptedOut &&
    !verification?.success,
  );
  const runIntent = verification?.success ? "verification_code" : intent;
  const run = await createAgentRun(supabase, {
    initialStatus: shouldQueueRun ? "queued" : "running",
    intent: runIntent,
    messageId: message.id,
    threadId: thread.id,
    traceId: inbound.traceId,
    userId,
  });
  const reply: TextAgentReply = (body, intentOverride, mediaUrls) =>
    sendAndRecordReply(supabase, {
      body,
      chatId: inbound.chatId,
      intent: intentOverride ?? intent,
      mediaUrls,
      phoneNumberId,
      sourceMessageId: inbound.messageId,
      thread,
      to: inbound.from,
      userId,
    });

  try {
    if (verification?.success) {
      const [profileQuestions] = await Promise.all([
        buildUserTextAgentProfileQuestions(supabase, verification.userId),
        completeAgentRun(
          supabase,
          run.id,
          "Phone number verified.",
          "verified",
        ),
      ]);
      await sendVerifiedOnboardingSequence(reply, profileQuestions);
      return { queuedAgentRun: false };
    }

    if (verificationAttemptLimit && !verificationAttemptLimit.allowed) {
      await completeAgentRun(
        supabase,
        run.id,
        "Verification code sender rate limited.",
        "rate_limited",
        {
          limitBucket: verificationAttemptLimit.bucket,
        },
      );
      await reply(
        "Too many Kinfolk verification attempts. Open Kinfolk and try Continue on your phone again later.",
        "rate_limited",
      );
      return { queuedAgentRun: false };
    }

    if (isOptedOut && intent !== "opt_in") {
      await completeAgentRun(
        supabase,
        run.id,
        "Opted-out sender ignored.",
        "opted_out",
      );
      return { queuedAgentRun: false };
    }

    if (intent === "verification_code" && !verification?.success) {
      const phoneAlreadyLinked =
        verification &&
        !verification.success &&
        "reason" in verification &&
        verification.reason === "phone_already_linked";
      if (!phoneAlreadyLinked && verifiedPhone && userId) {
        const threadSummary = await loadThreadSummary(
          supabase,
          thread.id,
          userId,
        );
        const activeStep = readNextIntakeStepFromSummary(threadSummary);
        await completeAgentRun(
          supabase,
          run.id,
          "Already-verified phone sent a stale verification code; profile prompt sent.",
          "clarification_needed",
        );
        await reply(
          activeStep
            ? buildTextAgentProfileQuestion(activeStep)
            : await buildUserTextAgentProfileQuestions(supabase, userId),
          "profile_prompt",
        );
        return { queuedAgentRun: false };
      }

      const replyText =
        phoneAlreadyLinked
          ? "That phone is already connected to a different Kinfolk profile. Sign in to that profile or contact Kinfolk before switching it."
          : "That Kinfolk code expired or was not recognized. Open Kinfolk and tap Continue on your phone again.";
      await completeAgentRun(
        supabase,
        run.id,
        "Invalid or expired verification code.",
        "unsupported",
      );
      await reply(replyText);
      return { queuedAgentRun: false };
    }

    if (!userId) {
      if (intent === "opt_out") {
        await completeAgentRun(
          supabase,
          run.id,
          "Unverified sender opted out; no reply sent.",
          "opted_out",
        );
        return { queuedAgentRun: false };
      }

      const limit = await hitTextAgentRateLimit(supabase, {
        bucketKey: inbound.from,
        bucketType: "unverified_phone_hour",
        limit: maxUnverifiedInboundPerHour,
        window: "hour",
      });

      if (!limit.allowed) {
        await completeAgentRun(
          supabase,
          run.id,
          "Unverified sender rate limited.",
          "rate_limited",
          {
            limitBucket: limit.bucket,
          },
        );
        await reply(
          "Too many Kinfolk verification attempts. Open Kinfolk and try Continue on your phone again later.",
        );
        return { queuedAgentRun: false };
      }

      await completeAgentRun(
        supabase,
        run.id,
        "Unverified sender.",
        "unsupported",
        {
          limitBucket: limit.bucket,
        },
      );
      await reply(
        "Open Kinfolk and tap Continue on your phone first so I can connect this number to your profile.",
      );
      return { queuedAgentRun: false };
    }

    if (intent !== "profile_update") {
      const stopTyping = startTextTypingHeartbeat({
        chatId: inbound.chatId,
        provider: inbound.provider,
        to: inbound.from,
      });

      try {
        await routeVerifiedTextMessage(supabase, {
          inbound,
          intent,
          message,
          reply: (body, intentOverride, mediaUrls) =>
            reply(body, intentOverride, mediaUrls),
          runId: run.id,
          thread,
          userId,
        });
      } finally {
        stopTyping();
      }
      return { queuedAgentRun: false };
    }

    const inboundLimit = await enforceVerifiedInboundRateLimits(supabase, {
      phone: inbound.from,
      threadId: thread.id,
      userId,
    });

    if (!inboundLimit.allowed) {
      await completeAgentRun(
        supabase,
        run.id,
        "Verified sender rate limited.",
        "rate_limited",
        {
          limitBucket: inboundLimit.bucket,
        },
      );
      await reply(
        "Kinfolk hit today's text safety limit for this profile. Reply REVIEW to open Kinfolk instead.",
        "rate_limited",
      );
      return { queuedAgentRun: false };
    }

    if (shouldQueueRun) {
      await updateAgentRunMetadata(supabase, run.id, {
        limitBucket: inboundLimit.bucket,
        policyOutcome: null,
      });
      startTextTypingHeartbeat({
        chatId: inbound.chatId,
        provider: inbound.provider,
        to: inbound.from,
        singlePingOnly: true,
      });
      return { queuedAgentRun: true };
    }

    const stopTyping = startTextTypingHeartbeat({
      chatId: inbound.chatId,
      provider: inbound.provider,
      to: inbound.from,
    });

    try {
      await routeVerifiedTextMessage(supabase, {
        inbound,
        intent,
        message,
        reply: (body, intentOverride, mediaUrls) =>
          reply(body, intentOverride, mediaUrls),
        runId: run.id,
        thread,
        userId,
      });
    } finally {
      stopTyping();
    }
    return { queuedAgentRun: false };
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Text agent failed.";
    console.error("[text-agent] inbound processing failed", {
      error: messageText,
      runId: run.id,
      threadId: thread.id,
    });
    try {
      await failAgentRun(supabase, run.id, messageText);
    } catch (failError) {
      console.error("[text-agent] failed to mark inbound run failed", {
        error:
          failError instanceof Error
            ? failError.message
            : "Failed to mark inbound run failed.",
        originalError: messageText,
        runId: run.id,
        threadId: thread.id,
      });
    }
    throw error;
  }
}

async function routeVerifiedTextMessage(
  supabase: SupabaseServiceClient,
  {
    inbound,
    intent,
    message,
    reply,
    runId,
    thread,
    userId,
  }: {
    inbound: TextInboundMessage;
    intent: string;
    message: TableRow<"text_messages">;
    reply: TextAgentReply;
    runId: string;
    thread: TableRow<"text_threads">;
    userId: string;
  },
) {
  const command = decideVerifiedTextCommand(intent);

  if (command.kind === "opt_out") {
    await Promise.all([
      setPhoneConsentState(supabase, userId, inbound.from, "opted_out"),
      supabase
        .from("text_threads")
        .update({ status: "opted_out" })
        .eq("id", thread.id),
      recordSmsConsentEvent(supabase, {
        event: "opted_out",
        message: inbound.body,
        method: isTextAgentOptOutKeyword(inbound.body)
          ? "keyword"
          : "nl_revocation",
        phone: inbound.from,
        userId,
      }),
      completeAgentRun(supabase, runId, "Opt-out honored.", "opted_out"),
    ]);
    await reply(textAgentOptOutConfirmationCopy(), "opt_out");
    return;
  }

  if (command.kind === "opt_in") {
    await Promise.all([
      setPhoneConsentState(supabase, userId, inbound.from, "opted_in"),
      recordSmsConsentEvent(supabase, {
        event: "opted_in",
        message: inbound.body,
        method: "keyword",
        phone: inbound.from,
        userId,
      }),
      completeAgentRun(supabase, runId, "Opt-in mirrored."),
    ]);
    await reply(textAgentOptInConfirmationCopy());
    return;
  }

  if (command.kind === "help") {
    const [profileQuestions] = await Promise.all([
      buildUserTextAgentProfileQuestions(supabase, userId),
      completeAgentRun(supabase, runId, "Help sent."),
    ]);
    await reply(
      `${profileQuestions}\n\n${buildTextAgentHelpScopeNote()}\n\nReply STOP any time to opt out, or REVIEW to open Kinfolk.`,
      "help",
    );
    return;
  }

  if (command.kind === "start_interview") {
    const [profileQuestions] = await Promise.all([
      buildUserTextAgentProfileQuestions(supabase, userId, {
        handoffWhenFoundationComplete: true,
      }),
      startMatchingInterviewForUser(supabase, userId),
      completeAgentRun(
        supabase,
        runId,
        "Matching interview mode started.",
        "clarification_needed",
      ),
    ]);
    await reply(profileQuestions, "profile_prompt");
    return;
  }

  if (command.kind === "approve") {
    const pendingProposal = await loadLatestPendingTextProposal(supabase, {
      threadId: thread.id,
      userId,
    });
    const approveEntryCommand = decideApproveEntryCommand({
      hasPendingProposal: Boolean(pendingProposal),
    });

    if (approveEntryCommand.kind === "approve_pending_proposal") {
      await approveLatestProposal(supabase, {
        reply,
        runId,
        thread,
        userId,
      });
      return;
    }

    const threadSummary = await loadThreadSummary(supabase, thread.id, userId);
    const draft = readTextAgentDraftState(threadSummary);
    const hasNextIntakeStep = Boolean(readNextIntakeStepFromSummary(threadSummary));
    const approveFallbackCommand = decideApproveFallbackCommand({
      canAutoPersistDraftFacts: canAutoPersistAllTextFacts(draft.facts),
      draftFactCount: draft.facts.length,
      hasNextIntakeStep,
    });

    if (approveFallbackCommand.kind === "extract_profile_update" && hasNextIntakeStep) {
      await proposeProfileUpdateFromText(supabase, {
        inbound,
        message,
        reply,
        runId,
        thread,
        userId,
      });
      return;
    }

    if (approveFallbackCommand.kind === "extract_profile_update") {
      // A bare "YES" with no pending proposal or draft runs the FULL model
      // loop — hold it to the same daily budget as profile_update inbounds,
      // which are limited before queueing.
      const inboundLimit = await enforceVerifiedInboundRateLimits(supabase, {
        phone: inbound.from,
        threadId: thread.id,
        userId,
      });
      if (!inboundLimit.allowed) {
        await completeAgentRun(
          supabase,
          runId,
          "Verified sender rate limited.",
          "rate_limited",
          { limitBucket: inboundLimit.bucket },
        );
        await reply(
          "Kinfolk hit today's text safety limit for this profile. Reply REVIEW to open Kinfolk instead.",
          "rate_limited",
        );
        return;
      }
      await runLiveHousingAgentReply(supabase, {
        body: inbound.body,
        message,
        reply,
        runId,
        thread,
        userId,
      });
      return;
    }

    if (approveFallbackCommand.kind === "persist_draft_low_risk") {
      await expireSupersededPendingTextProposals(supabase, {
        threadId: thread.id,
        userId,
      });
      await completeLowRiskTextProfileUpdate(supabase, {
        body: inbound.body,
        facts: draft.facts,
        message,
        metadata: { extractor: "kinfolk_tool", model: null },
        reply,
        run: { id: runId },
        skippedSteps: draft.skippedSteps,
        sourceLabel: `Text confirmation from ${inbound.from}`,
        thread,
        userId,
      });
      return;
    }

    await expireSupersededPendingTextProposals(supabase, {
      threadId: thread.id,
      userId,
    });
    await createProfileUpdateProposalFromFacts(supabase, {
      autoApprove: true,
      body: inbound.body,
      facts: draft.facts,
      message,
      metadata: { extractor: "kinfolk_tool", model: null },
      reply,
      run: { id: runId },
      skippedSteps: draft.skippedSteps,
      sourceLabel: `Text confirmation from ${inbound.from}`,
      thread,
      userId,
    });
    return;
  }

  if (command.kind === "review_link") {
    await completeAgentRun(supabase, runId, `${command.intent} link sent.`);
    await reply(buildReviewReply(command.intent));
    return;
  }

  if (command.kind === "profile_update") {
    const profileUpdateCommand = decideProfileUpdateCommand({
      prioritizeFreshProfileIntake: await shouldPrioritizeFreshProfileIntake(supabase, {
        body: inbound.body,
        threadId: thread.id,
        userId,
      }),
    });

    if (profileUpdateCommand.kind === "start_interview_then_extract") {
      await startMatchingInterviewForUser(supabase, userId);
      await proposeProfileUpdateFromText(supabase, {
        inbound,
        message,
        reply,
        runId,
        thread,
        userId,
      });
      return;
    }

    // One charming agent in a bounded tool loop owns the live reply for
    // returning users. It writes its own prose, honors free-form modifiers, and
    // grounds claims in tools.
    await runLiveHousingAgentReply(supabase, {
      body: inbound.body,
      message,
      reply,
      runId,
      thread,
      userId,
    });
    return;
  }

  await completeAgentRun(supabase, runId, "Unsupported text.");
  await reply(await buildUserTextAgentProfileQuestions(supabase, userId), "profile_prompt");
}

export { createContinueOnPhoneChallengeForCurrentUser, createInterviewOnPhoneHandoffForCurrentUser } from "@/lib/text-agent/phone-handoff";
export { processTextAgentRuns } from "@/lib/text-agent/run-queue";
