import "server-only";
import {
  isProfileQuestionSafeIntakeStep,
  loadEnrichmentIntakeHints,
  profileQuestionSafeIntakeSteps,
} from "@/lib/profiles/enrichment-intake-hints";
import { reviewProfileImportForUserId } from "@/lib/profiles/enrichment-store";
import { buildTextAgentProfileEnrichmentHandoffReply, buildTextAgentProfileQuestion, textAgentFoundationIntakeComplete } from "@/lib/text-agent";
import { buildTextAgentConversationState } from "@/lib/text-agent/state";
import type { TextAgentIntakeStep, TextProfileFact } from "@/lib/text-agent";
import type { TextAgentModelExtraction } from "@/lib/text-agent/extraction";
import type { TextAgentActiveMode, TextAgentLastSentCard } from "@/lib/text-agent/state";
import type { SupabaseServiceClient, TableRow, TextAgentReply } from "@/lib/text-agent/store-types";
import type { Json } from "@/lib/supabase/types";
import { isInformativeTextProfileFact, mergeTextAgentDraftFacts, nextTextAgentIntakeStepFromDraftWithCoverage, readTextProfileFactValue, serializeTextProfileFact } from "@/lib/text-agent/fact-utils";
import { markMatchingInterviewCompleted } from "@/lib/text-agent/interview-state";
import { buildReviewReply } from "@/lib/text-agent/reply-send";
import { completeAgentRun } from "@/lib/text-agent/run-data";
import { getProfileEnrichmentFormUrl, jsonObjectOrEmpty } from "@/lib/text-agent/store-shared";

const maxPendingProposalsPerThread = 2;
const maxSentListingCardEntries = 10;
const maxRollingSummaryWords = 120;
const maxRollingSummaryChars = 1200;

// The agent's durable thread memory, stored under summary_json.agent_memory in
// text_thread_summaries. This is the shared contract between the loop (which
// writes it after each sent reply) and the get_listing_details tool (which
// resolves "the second one" against last_sent_cards). Persisted keys are
// snake_case: { last_sent_cards: [{ address, listing_id, ordinal,
// recommendation_id }], rolling_summary, updated_at }.
export type TextThreadSentListingCard = {
  address: string;
  listingId: string | null;
  ordinal: number;
  recommendationId: string;
};

export type TextThreadAgentMemory = {
  rollingSummary: string;
  sentListingCards: TextThreadSentListingCard[];
};

export type PendingProfileQuestion = {
  askedAt: string;
  notificationId: string;
  step: TextAgentIntakeStep;
};

export type ProfileQuestionResolution = "answered" | "dismissed" | "skipped";

export async function loadThreadSummary(
  supabase: SupabaseServiceClient,
  threadId: string,
  userId: string,
) {
  const result = await supabase
    .from("text_thread_summaries")
    .select("*")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

export function readPendingProfileQuestionFromSummary(
  summary: TableRow<"text_thread_summaries"> | null,
): PendingProfileQuestion | null {
  const raw = jsonObjectOrEmpty(
    jsonObjectOrEmpty(summary?.summary_json ?? null).pending_profile_question ??
      null,
  );
  const step =
    typeof raw.step === "string" &&
    (profileQuestionSafeIntakeSteps as string[]).includes(raw.step)
      ? (raw.step as TextAgentIntakeStep)
      : null;
  const askedAt = typeof raw.asked_at === "string" ? raw.asked_at.trim() : "";
  const notificationId =
    typeof raw.notification_id === "string" ? raw.notification_id.trim() : "";

  if (
    !step ||
    !askedAt ||
    !Number.isFinite(Date.parse(askedAt)) ||
    !notificationId
  ) {
    return null;
  }

  return { askedAt, notificationId, step };
}

export function readSkippedProfileQuestionStepsFromSummary(
  summary: TableRow<"text_thread_summaries"> | null,
): TextAgentIntakeStep[] {
  const value = jsonObjectOrEmpty(
    summary?.summary_json ?? null,
  ).profile_question_skipped_steps;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (step): step is TextAgentIntakeStep =>
      typeof step === "string" &&
      (profileQuestionSafeIntakeSteps as string[]).includes(step),
  );
}

export async function loadPendingProfileQuestion(
  supabase: SupabaseServiceClient,
  threadId: string,
  userId: string,
) {
  return readPendingProfileQuestionFromSummary(
    await loadThreadSummary(supabase, threadId, userId),
  );
}

export async function loadProfileQuestionStateForUser(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<{
  pending: (PendingProfileQuestion & { threadId: string }) | null;
  skippedSteps: TextAgentIntakeStep[];
}> {
  const result = await supabase
    .from("text_thread_summaries")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (result.error) {
    throw result.error;
  }

  const skippedSteps = new Set<TextAgentIntakeStep>();
  let pending: (PendingProfileQuestion & { threadId: string }) | null = null;
  for (const summary of result.data ?? []) {
    for (const step of readSkippedProfileQuestionStepsFromSummary(summary)) {
      skippedSteps.add(step);
    }
    const candidate = readPendingProfileQuestionFromSummary(summary);
    if (!pending && candidate) {
      pending = { ...candidate, threadId: summary.thread_id };
    }
  }

  return { pending, skippedSteps: [...skippedSteps] };
}

export async function savePendingProfileQuestion(
  supabase: SupabaseServiceClient,
  {
    askedAt,
    notificationId,
    step,
    threadId,
    userId,
  }: PendingProfileQuestion & { threadId: string; userId: string },
) {
  if (!isProfileQuestionSafeIntakeStep(step)) {
    throw new Error(`Unsafe proactive profile question step: ${step}`);
  }

  const existing = await loadThreadSummary(supabase, threadId, userId);
  const summaryJson = jsonObjectOrEmpty(existing?.summary_json ?? null);
  const result = await supabase.from("text_thread_summaries").upsert(
    {
      summary_json: {
        ...summaryJson,
        pending_profile_question: {
          asked_at: askedAt,
          notification_id: notificationId,
          step,
        },
      } as Json,
      thread_id: threadId,
      user_id: userId,
    },
    { onConflict: "thread_id" },
  );
  if (result.error) {
    throw result.error;
  }
}

export async function resolvePendingProfileQuestion(
  supabase: SupabaseServiceClient,
  {
    notificationId,
    resolution,
    threadId,
    userId,
  }: {
    notificationId: string;
    resolution: ProfileQuestionResolution;
    threadId: string;
    userId: string;
  },
) {
  const existing = await loadThreadSummary(supabase, threadId, userId);
  const pending = readPendingProfileQuestionFromSummary(existing);
  if (!pending || pending.notificationId !== notificationId) {
    return false;
  }

  const summaryJson = jsonObjectOrEmpty(existing?.summary_json ?? null);
  const withoutPending = { ...summaryJson };
  delete withoutPending.pending_profile_question;
  const skippedSteps = new Set(
    readSkippedProfileQuestionStepsFromSummary(existing),
  );
  if (resolution === "skipped") {
    skippedSteps.add(pending.step);
  }
  const resolvedAt = new Date().toISOString();
  const notificationResult = await supabase
    .from("match_notifications")
    .update({
      card_snapshot: {
        profile_question: {
          asked_at: pending.askedAt,
          resolution,
          resolved_at: resolvedAt,
          step: pending.step,
        },
      } as Json,
    })
    .eq("id", notificationId)
    .eq("recipient_user_id", userId)
    .eq("kind", "profile_question");
  if (notificationResult.error) throw notificationResult.error;

  const summaryResult = await supabase.from("text_thread_summaries").upsert(
    {
      summary_json: {
        ...withoutPending,
        profile_question_skipped_steps: [...skippedSteps],
      } as Json,
      thread_id: threadId,
      user_id: userId,
    },
    { onConflict: "thread_id" },
  );
  if (summaryResult.error) throw summaryResult.error;
  return true;
}

export function readTextThreadAgentMemoryFromSummary(
  summary: TableRow<"text_thread_summaries"> | null,
): TextThreadAgentMemory {
  const agentMemory = jsonObjectOrEmpty(
    jsonObjectOrEmpty(summary?.summary_json ?? null).agent_memory ?? null,
  );
  const rawCards = Array.isArray(agentMemory.last_sent_cards)
    ? agentMemory.last_sent_cards
    : [];
  const sentListingCards = rawCards.flatMap((value, index) => {
    const raw = jsonObjectOrEmpty(value);
    const recommendationId =
      typeof raw.recommendation_id === "string"
        ? raw.recommendation_id.trim()
        : "";
    if (!recommendationId) {
      return [];
    }
    return [
      {
        address: typeof raw.address === "string" ? raw.address : "",
        listingId:
          typeof raw.listing_id === "string" && raw.listing_id
            ? raw.listing_id
            : null,
        ordinal:
          typeof raw.ordinal === "number" && Number.isFinite(raw.ordinal)
            ? raw.ordinal
            : index + 1,
        recommendationId,
      },
    ];
  });

  return {
    rollingSummary:
      typeof agentMemory.rolling_summary === "string"
        ? agentMemory.rolling_summary.trim()
        : "",
    sentListingCards: sentListingCards.slice(0, maxSentListingCardEntries),
  };
}

export async function loadTextThreadAgentMemory(
  supabase: SupabaseServiceClient,
  threadId: string,
  userId: string,
): Promise<TextThreadAgentMemory> {
  return readTextThreadAgentMemoryFromSummary(
    await loadThreadSummary(supabase, threadId, userId),
  );
}

export async function saveTextThreadAgentMemory(
  supabase: SupabaseServiceClient,
  {
    rollingSummary,
    sentListingCards,
    threadId,
    userId,
  }: {
    rollingSummary?: string;
    sentListingCards?: TextThreadSentListingCard[];
    threadId: string;
    userId: string;
  },
) {
  const existing = await loadThreadSummary(supabase, threadId, userId);
  const summaryJson = jsonObjectOrEmpty(existing?.summary_json ?? null);
  const agentMemory = { ...jsonObjectOrEmpty(summaryJson.agent_memory ?? null) };

  if (rollingSummary !== undefined) {
    agentMemory.rolling_summary = clampRollingSummary(rollingSummary);
  }
  if (sentListingCards !== undefined) {
    agentMemory.last_sent_cards = sentListingCards
      .slice(0, maxSentListingCardEntries)
      .map((card, index) => ({
        address: card.address,
        listing_id: card.listingId,
        ordinal: card.ordinal || index + 1,
        recommendation_id: card.recommendationId,
      }));
  }
  agentMemory.updated_at = new Date().toISOString();

  const result = await supabase.from("text_thread_summaries").upsert(
    {
      summary_json: { ...summaryJson, agent_memory: agentMemory } as Json,
      thread_id: threadId,
      user_id: userId,
    },
    { onConflict: "thread_id" },
  );

  if (result.error) {
    throw result.error;
  }
}

function clampRollingSummary(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, maxRollingSummaryWords)
    .join(" ")
    .slice(0, maxRollingSummaryChars);
}

/**
 * Durably record that the user skipped an intake step, without rebuilding the
 * whole summary: the gate's coverage recompute reads
 * known_preferences_json.skipped_steps, so this one merged write is what
 * advances onboarding past a declined question.
 *
 * The read is deliberately allowed to THROW — a failed read must never read
 * as "no row exists". The upsert payload carries only the merged preferences
 * column (plus keys), so every other column survives the conflict update; on
 * a genuine first insert the table defaults cover summary_json and
 * open_questions_json. The caller treats a thrown error as a skipped-skip:
 * the canonical question is re-asked, which is recoverable — clobbering the
 * thread's memory is not.
 */
export async function appendSkippedIntakeStep(
  supabase: SupabaseServiceClient,
  {
    messageId,
    step,
    threadId,
    userId,
  }: {
    messageId: string | null;
    step: TextAgentIntakeStep;
    threadId: string;
    userId: string;
  },
) {
  const existing = await loadThreadSummary(supabase, threadId, userId);
  const preferences = jsonObjectOrEmpty(
    existing?.known_preferences_json ?? null,
  );
  const skipped = Array.isArray(preferences.skipped_steps)
    ? preferences.skipped_steps.filter((value) => typeof value === "string")
    : [];
  const result = await supabase.from("text_thread_summaries").upsert(
    {
      known_preferences_json: {
        ...preferences,
        skipped_steps: [...new Set([...skipped, step])],
      } as Json,
      ...(messageId ? { updated_from_message_id: messageId } : {}),
      thread_id: threadId,
      user_id: userId,
    },
    { onConflict: "thread_id" },
  );

  if (result.error) {
    throw result.error;
  }
}

export async function updateTextThreadSummary(
  supabase: SupabaseServiceClient,
  {
    activeMode,
    extraction,
    facts = [],
    lastIntent: lastIntentOverride,
    lastSentCards = [],
    messageId,
    nextIntakeStep = null,
    pausedUntil = null,
    pendingAction = null,
    skippedSteps = [],
    threadId,
    userId,
  }: {
    activeMode?: TextAgentActiveMode;
    extraction?: TextAgentModelExtraction;
    facts?: TextProfileFact[];
    lastIntent?: string | null;
    lastSentCards?: TextAgentLastSentCard[];
    messageId: string;
    nextIntakeStep?: TextAgentIntakeStep | null;
    pausedUntil?: string | null;
    pendingAction?: string | null;
    skippedSteps?: TextAgentIntakeStep[];
    threadId: string;
    userId: string;
  },
) {
  const lastIntent =
    lastIntentOverride ?? extraction?.extraction.intent ?? "profile_update";
  const lastReplyKind =
    extraction?.extraction.reply_kind ??
    (facts.length > 0 ? "confirmation" : "unsupported");
  const [durableFacts, existingSummary] = await Promise.all([
    loadUserTextAgentCoverageFacts(supabase, userId),
    loadThreadSummary(supabase, threadId, userId).catch(() => null),
  ]);
  const stateFacts = mergeTextAgentDraftFacts(
    { facts: durableFacts, skippedSteps: [] },
    facts,
  ).facts;
  const conversationState = buildTextAgentConversationState({
    activeMode,
    facts: stateFacts,
    lastIntent,
    lastReplyKind,
    lastSentCards,
    nextIntakeStep,
    pausedUntil,
    pendingAction,
  });
  // The live loop's thread memory (rolling summary + sent-card registry) lives
  // in summary_json too; this wholesale rebuild must carry it forward.
  const existingSummaryJson = jsonObjectOrEmpty(
    existingSummary?.summary_json ?? null,
  );
  const preservedAgentMemory = existingSummaryJson.agent_memory;
  const pendingProfileQuestion = existingSummaryJson.pending_profile_question;
  const skippedProfileQuestionSteps =
    existingSummaryJson.profile_question_skipped_steps;
  const summary = {
    ...conversationState,
    ...(preservedAgentMemory === undefined
      ? {}
      : { agent_memory: preservedAgentMemory }),
    ...(pendingProfileQuestion === undefined
      ? {}
      : { pending_profile_question: pendingProfileQuestion }),
    ...(skippedProfileQuestionSteps === undefined
      ? {}
      : { profile_question_skipped_steps: skippedProfileQuestionSteps }),
    conversation_state: conversationState,
    intake_complete:
      nextIntakeStep === null &&
      (stateFacts.length > 0 || skippedSteps.length > 0),
    last_intent: lastIntent,
    last_reply_kind: lastReplyKind,
    last_updated_at: new Date().toISOString(),
    next_intake_step: nextIntakeStep,
    warning_count: extraction?.extraction.warnings.length ?? 0,
  };
  const knownPreferences = {
    facts: facts.slice(0, 20).map(serializeTextProfileFact),
    skipped_steps: skippedSteps,
  };
  const openQuestions = nextIntakeStep
    ? [buildTextAgentProfileQuestion(nextIntakeStep)]
    : extraction?.extraction.intent === "clarification_needed" &&
        extraction.extraction.clarifying_question
      ? [extraction.extraction.clarifying_question]
      : [];

  const result = await supabase.from("text_thread_summaries").upsert(
    {
      known_preferences_json: knownPreferences as Json,
      open_questions_json: openQuestions as Json,
      summary_json: summary as Json,
      thread_id: threadId,
      updated_from_message_id: messageId,
      user_id: userId,
    },
    { onConflict: "thread_id" },
  );

  if (result.error) {
    throw result.error;
  }
}

export async function enforcePendingProposalLimit(
  supabase: SupabaseServiceClient,
  { threadId, userId }: { threadId: string; userId: string },
) {
  const result = await supabase
    .from("profile_update_proposals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());

  if (result.error) {
    throw result.error;
  }

  return { allowed: (result.count ?? 0) < maxPendingProposalsPerThread };
}

export async function expireSupersededPendingTextProposals(
  supabase: SupabaseServiceClient,
  {
    exceptProposalId,
    threadId,
    userId,
  }: { exceptProposalId?: string; threadId: string; userId: string },
) {
  const now = new Date().toISOString();
  let query = supabase
    .from("profile_update_proposals")
    .update({ expires_at: now, status: "expired" })
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .eq("status", "pending")
    .gt("expires_at", now);

  if (exceptProposalId) {
    query = query.neq("id", exceptProposalId);
  }

  const result = await query;

  if (result.error) {
    throw result.error;
  }
}

export async function loadLatestPendingTextProposal(
  supabase: SupabaseServiceClient,
  { threadId, userId }: { threadId: string; userId: string },
) {
  const proposal = await supabase
    .from("profile_update_proposals")
    .select("*")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (proposal.error) {
    throw proposal.error;
  }

  return proposal.data;
}

export async function buildUserTextAgentProfileQuestions(
  supabase: SupabaseServiceClient,
  userId: string,
  options: { handoffWhenFoundationComplete?: boolean } = {},
) {
  const [profileCoverageFacts, enrichmentHintSteps] = await Promise.all([
    loadUserTextAgentCoverageFacts(supabase, userId),
    loadEnrichmentIntakeHints(supabase, userId),
  ]);

  if (
    options.handoffWhenFoundationComplete &&
    textAgentFoundationIntakeComplete({ facts: profileCoverageFacts })
  ) {
    return buildTextAgentProfileEnrichmentHandoffReply({
      enrichmentUrl: getProfileEnrichmentFormUrl(),
    });
  }

  const nextStep = nextTextAgentIntakeStepFromDraftWithCoverage(
    { facts: [], skippedSteps: [] },
    profileCoverageFacts,
    enrichmentHintSteps,
  );

  if (!nextStep) {
    return [
      "You're connected. I have enough profile signal for matching.",
      "",
      "Text me any roommate preference you want to add, or reply REVIEW to open Kinfolk.",
    ].join("\n");
  }

  return buildTextAgentProfileQuestion(nextStep, { includeIntro: true });
}

export async function loadUserTextAgentCoverageFacts(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const [factsResult, profileResult, housingResult, roommateResult] =
    await Promise.all([
      supabase
        .from("profile_facts")
        .select("*")
        .eq("user_id", userId)
        .eq("matching_eligible", true)
        .eq("sensitivity_level", "standard")
        .in("user_review_state", ["approved", "edited"]),
      supabase
        .from("matching_profiles")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("housing_preferences")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("roommate_preferences")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const firstError = [
    factsResult.error,
    profileResult.error,
    housingResult.error,
    roommateResult.error,
  ].find(Boolean);

  if (firstError) {
    throw firstError;
  }

  const facts: TextProfileFact[] = (factsResult.data ?? []).flatMap((row) => {
    const value = readTextProfileFactValue(row.value_json);

    if (value === null) {
      return [];
    }

    const fact = {
      assertion_type:
        row.assertion_type === "inferred" ? "inferred" : "explicit",
      confidence: row.confidence,
      dimension: row.dimension,
      evidence: row.evidence_excerpt ?? "",
      fact_key: row.fact_key,
      importance: row.importance,
      matching_eligible: true,
      sensitivity_level: "standard",
      value,
    } satisfies TextProfileFact;

    return isInformativeTextProfileFact(fact) ? [fact] : [];
  });

  const profile = profileResult.data;
  if (profile) {
    const budgetMin = profile.budget_min ?? 0;
    const budgetMax = profile.budget_max ?? 0;

    if (budgetMin > 0 || budgetMax > 0) {
      facts.push(
        makeCoverageFact({
          factKey:
            budgetMin > 0 && budgetMax > 0
              ? "budget"
              : budgetMin > 0
                ? "budget_min"
                : "budget_max",
          value:
            budgetMin > 0 && budgetMax > 0
              ? { max: budgetMax, min: budgetMin }
              : budgetMin > 0
                ? budgetMin
                : budgetMax,
        }),
      );
    }

    if (profile.move_in_start || profile.move_in_end) {
      facts.push(
        makeCoverageFact({
          factKey: "move_in_window",
          value: {
            end: profile.move_in_end ?? null,
            start: profile.move_in_start ?? null,
          },
        }),
      );
    }

    if (
      profile.household_size_min > 0 &&
      profile.household_size_max >= profile.household_size_min
    ) {
      facts.push(
        makeCoverageFact({
          factKey: "household_size",
          value: {
            max: profile.household_size_max,
            min: profile.household_size_min,
          },
        }),
      );
    }
  }

  const housing = housingResult.data;
  if (housing) {
    if (housing.neighborhoods.length > 0) {
      facts.push(
        makeCoverageFact({
          factKey: "neighborhoods",
          value: housing.neighborhoods,
        }),
      );
    }
    if (housing.pets) {
      facts.push(makeCoverageFact({ factKey: "pets", value: housing.pets }));
    }
    if (housing.must_haves.length > 0) {
      facts.push(
        makeCoverageFact({
          factKey: "must_haves",
          value: housing.must_haves,
        }),
      );
    }
    if (housing.dealbreakers.length > 0) {
      facts.push(
        makeCoverageFact({
          factKey: "dealbreakers",
          value: housing.dealbreakers,
        }),
      );
    }
  }

  const roommate = roommateResult.data;
  if (roommate) {
    if (roommate.cleanliness) {
      facts.push(
        makeCoverageFact({
          dimension: "home_labor",
          factKey: "cleanliness",
          value: roommate.cleanliness,
        }),
      );
    }
    if (roommate.sleep_schedule) {
      facts.push(
        makeCoverageFact({
          dimension: "daily_rhythm",
          factKey: "sleep_schedule",
          value: roommate.sleep_schedule,
        }),
      );
    }
    if (roommate.hosting_expectations) {
      facts.push(
        makeCoverageFact({
          dimension: "social_boundary",
          factKey: "guests",
          value: roommate.hosting_expectations,
        }),
      );
    }
    if (roommate.conflict_style) {
      facts.push(
        makeCoverageFact({
          dimension: "communication",
          factKey: "conflict_repair",
          value: roommate.conflict_style,
        }),
      );
    }
    if (roommate.social_energy) {
      facts.push(
        makeCoverageFact({
          dimension: "social_boundary",
          factKey: "social_energy",
          value: roommate.social_energy,
        }),
      );
    }
  }

  return facts;
}

function makeCoverageFact({
  dimension = "feasibility",
  factKey,
  value,
}: {
  dimension?: string;
  factKey: string;
  value: TextProfileFact["value"];
}): TextProfileFact {
  return {
    assertion_type: "explicit",
    confidence: 1,
    dimension,
    evidence: "Saved Kinfolk profile",
    fact_key: factKey,
    importance: 1,
    matching_eligible: true,
    sensitivity_level: "standard",
    value,
  };
}

export async function approveLatestProposal(
  supabase: SupabaseServiceClient,
  {
    reply,
    runId,
    thread,
    userId,
  }: {
    reply: TextAgentReply;
    runId: string;
    thread: TableRow<"text_threads">;
    userId: string;
  },
) {
  const proposal = await loadLatestPendingTextProposal(supabase, {
    threadId: thread.id,
    userId,
  });

  if (!proposal?.source_import_id) {
    await completeAgentRun(supabase, runId, "No pending proposal.");
    await reply(
      `I do not have a pending profile update to save yet.\n\n${await buildUserTextAgentProfileQuestions(supabase, userId)}`,
      "approve",
    );
    return;
  }

  if (proposal.risk_level !== "low") {
    await completeAgentRun(supabase, runId, "Proposal requires review.");
    await reply(buildReviewReply("review"), "approve");
    return;
  }

  await reviewProfileImportForUserId(
    userId,
    proposal.source_import_id,
    "approve_all",
    { refreshMatchingState: "deferred", snapshotMode: "none" },
  );
  const [update] = await Promise.all([
    supabase
      .from("profile_update_proposals")
      .update({ approved_at: new Date().toISOString(), status: "approved" })
      .eq("id", proposal.id),
    markMatchingInterviewCompleted(supabase, {
      summary: proposal.summary,
      userId,
    }),
  ]);

  if (update.error) {
    throw update.error;
  }

  await completeAgentRun(supabase, runId, "Profile proposal approved.");
  await reply(
    "Saved. I updated your Kinfolk profile with the standard facts and kept anything sensitive out of matching.",
    "approve",
  );
}
