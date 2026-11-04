import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isProfileQuestionSafeIntakeStep,
  loadProfileQuestionIntakeSteps,
} from "@/lib/profiles/enrichment-intake-hints";
import { buildTextAgentProfileQuestion } from "@/lib/text-agent";
import { nextTextAgentIntakeStepFromDraftWithCoverage } from "@/lib/text-agent/fact-utils";
import {
  loadProfileQuestionStateForUser,
  loadUserTextAgentCoverageFacts,
  savePendingProfileQuestion,
} from "@/lib/text-agent/thread-data";
import {
  countSentNotificationsSince,
  deliverMatchNotificationText,
  normalizeRequiredMatchNotificationId,
  runMatchNotificationGates,
  type MatchNotificationSendResult,
} from "@/lib/notifications/delivery";
import { jsonObjectOrEmpty } from "@/lib/text-agent/store-shared";
import type { TextAgentIntakeStep } from "@/lib/text-agent";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;

const PROFILE_QUESTION_CADENCE_MS = 7 * 24 * 60 * 60 * 1000;

export function buildProfileQuestionIdempotencyKey({
  nowUtc,
  userId,
}: {
  nowUtc: Date;
  userId: string;
}) {
  const cadenceBucket = Math.floor(
    nowUtc.getTime() / PROFILE_QUESTION_CADENCE_MS,
  );
  return `kinfolk:profile-question:${userId}:${cadenceBucket}`;
}

export function buildProfileQuestionNotificationBody(
  step: TextAgentIntakeStep,
) {
  if (!isProfileQuestionSafeIntakeStep(step)) {
    throw new Error(`Unsafe proactive profile question step: ${step}`);
  }

  return `${buildTextAgentProfileQuestion(step)} Reply SKIP if you would rather leave this one blank.`;
}

export async function sendProfileQuestionNotification(
  supabase: SupabaseServiceClient,
  {
    nowUtc = new Date(),
    userId,
  }: { nowUtc?: Date; userId: string },
): Promise<MatchNotificationSendResult> {
  const normalizedUserId = normalizeRequiredMatchNotificationId(userId);
  if (!normalizedUserId) {
    return { sent: false, skipped: "invalid_profile_question_target" };
  }

  const profileQuestionState = await loadProfileQuestionStateForUser(
    supabase,
    normalizedUserId,
  );
  if (profileQuestionState.pending) {
    return { sent: false, skipped: "pending_profile_question" };
  }

  const [coverageFacts, prioritizedSteps] = await Promise.all([
    loadUserTextAgentCoverageFacts(supabase, normalizedUserId),
    loadProfileQuestionIntakeSteps(supabase, normalizedUserId),
  ]);
  const step = nextTextAgentIntakeStepFromDraftWithCoverage(
    {
      facts: [],
      skippedSteps: profileQuestionState.skippedSteps,
    },
    coverageFacts,
    prioritizedSteps,
  );
  if (!step || !isProfileQuestionSafeIntakeStep(step)) {
    return { sent: false, skipped: "profile_complete" };
  }

  const idempotencyKey = buildProfileQuestionIdempotencyKey({
    nowUtc,
    userId: normalizedUserId,
  });
  const recovered = await recoverPendingProfileQuestion(supabase, {
    idempotencyKey,
    step,
    userId: normalizedUserId,
  });
  if (recovered) {
    return { sent: false, skipped: "already_sent" };
  }

  const gates = await runMatchNotificationGates(supabase, {
    idempotencyKey,
    kind: "profile_question",
    nowUtc,
    prefsEnabled: (prefs) => prefs.profile_questions_enabled,
    userId: normalizedUserId,
  });
  if ("skipped" in gates) {
    if (gates.skipped === "already_sent") {
      await recoverPendingProfileQuestion(supabase, {
        idempotencyKey,
        step,
        userId: normalizedUserId,
      });
    }
    return { sent: false, skipped: gates.skipped };
  }

  const sentInCadenceWindow = await countSentNotificationsSince(supabase, {
    kind: "profile_question",
    since: new Date(nowUtc.getTime() - PROFILE_QUESTION_CADENCE_MS),
    userId: normalizedUserId,
  });
  if (sentInCadenceWindow > 0) {
    return { sent: false, skipped: "profile_question_cadence" };
  }

  const delivery = await deliverMatchNotificationText(supabase, {
    existingNotification: gates.existingNotification,
    idempotencyKey,
    kind: "profile_question",
    messageKind: "profile_question_notification",
    messageParts: [
      { type: "text", value: buildProfileQuestionNotificationBody(step) },
    ],
    onDelivered: async ({ notificationId, threadId }) => {
      const askedAt = nowUtc.toISOString();
      const snapshot = await supabase
        .from("match_notifications")
        .update({
          card_snapshot: {
            profile_question: {
              asked_at: askedAt,
              resolution: null,
              resolved_at: null,
              step,
            },
          } as Json,
        })
        .eq("id", notificationId)
        .eq("recipient_user_id", normalizedUserId)
        .eq("kind", "profile_question");
      if (snapshot.error) throw snapshot.error;

      await savePendingProfileQuestion(supabase, {
        askedAt,
        notificationId,
        step,
        threadId,
        userId: normalizedUserId,
      });
    },
    phone: gates.phone,
    provider: gates.provider,
    rawPayloadExtra: { step },
    subjectId: normalizedUserId,
    userId: normalizedUserId,
  });
  return delivery;
}

async function recoverPendingProfileQuestion(
  supabase: SupabaseServiceClient,
  {
    idempotencyKey,
    step,
    userId,
  }: {
    idempotencyKey: string;
    step: TextAgentIntakeStep;
    userId: string;
  },
) {
  const result = await supabase
    .from("match_notifications")
    .select("id,thread_id,outbound_message_id,created_at,card_snapshot")
    .eq("recipient_user_id", userId)
    .eq("kind", "profile_question")
    .eq("outbound_idempotency_key", idempotencyKey)
    .maybeSingle();
  if (result.error) throw result.error;

  const notification = result.data;
  if (!notification?.outbound_message_id || !notification.thread_id) {
    return false;
  }
  const snapshot = jsonObjectOrEmpty(notification.card_snapshot);
  const profileQuestion = jsonObjectOrEmpty(snapshot.profile_question ?? null);
  if (typeof profileQuestion.resolved_at === "string") {
    return true;
  }

  await savePendingProfileQuestion(supabase, {
    askedAt:
      typeof profileQuestion.asked_at === "string"
        ? profileQuestion.asked_at
        : notification.created_at,
    notificationId: notification.id,
    step:
      typeof profileQuestion.step === "string" &&
      isProfileQuestionSafeIntakeStep(
        profileQuestion.step as TextAgentIntakeStep,
      )
        ? (profileQuestion.step as TextAgentIntakeStep)
        : step,
    threadId: notification.thread_id,
    userId,
  });
  return true;
}
