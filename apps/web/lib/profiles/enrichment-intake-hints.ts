import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractProfileImportMetadata,
  type ProfileImportMetadata,
  type ProfileImportProvider,
} from "./enrichment";
import {
  intakeStepMatchingImpact,
  textAgentFoundationIntakeSteps,
  textAgentIntakeSteps,
  type TextAgentIntakeStep,
} from "../text-agent";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;

const assistantImportProviders = new Set<ProfileImportProvider>([
  "claude",
  "chatgpt",
]);

const excludedProfileQuestionSteps = new Set<TextAgentIntakeStep>([
  "age_comfort",
]);

export const profileQuestionSafeIntakeSteps = textAgentIntakeSteps.filter(
  (step) => !excludedProfileQuestionSteps.has(step),
);

export function isProfileQuestionSafeIntakeStep(
  step: TextAgentIntakeStep,
): boolean {
  return (
    (textAgentIntakeSteps as readonly string[]).includes(step) &&
    !excludedProfileQuestionSteps.has(step)
  );
}

export function mapFollowUpQuestionToIntakeStep(
  question: string,
): TextAgentIntakeStep | null {
  const haystack = question.toLowerCase();

  if (/\b(sleep|chronotype|bedtime|night owl|early bird|wake)\b/.test(haystack)) {
    return "sleep_schedule";
  }
  if (/\b(work from home|wfh|remote|hybrid|home office|calls from home|take calls|in[- ]?office|onsite)\b/.test(haystack)) {
    return "work_from_home";
  }
  if (/\b(clean|chores?|dishes|trash|tidy|clutter)\b/.test(haystack)) {
    return "cleanliness";
  }
  if (/\b(noise|bass|quiet|loud|soundproof)\b/.test(haystack)) {
    return "noise_tolerance";
  }
  if (/\b(guest|host|overnight|visitor|party)\b/.test(haystack)) {
    return "guests";
  }
  if (/\b(conflict|disagree|friction|repair|argument)\b/.test(haystack)) {
    return "conflict_repair";
  }
  if (/\b(interests?|hobb(?:y|ies)|music|media|weekend|common ground|taste|aesthetic)\b/.test(haystack)) {
    return "interests";
  }
  if (/\b(social|introvert|extrovert|hang out|hosting cadence)\b/.test(haystack)) {
    return "social_energy";
  }
  if (/\b(tradeoff|flexible on rent|flexible on location|flexible on commute|location vs rent|rent vs location|price vs location|room size|room quality|lease certainty)\b/.test(haystack)) {
    return "rent_tradeoff";
  }
  if (/\b(budget|rent|afford|deposit)\b/.test(haystack)) {
    return "budget";
  }
  if (/\b(neighborhoods?|market|commute|location|area)\b/.test(haystack)) {
    return "neighborhoods";
  }
  if (/\b(school|company|employer|work context|communities?|mutuals?|references?|prior roommate|trusted|trust)\b/.test(haystack)) {
    return "trust_context";
  }
  if (/\b(move[ -]?in|lease start|timing)\b/.test(haystack)) {
    return "move_in";
  }
  if (/\b(pets?|dog|cat|animal)\b/.test(haystack)) {
    return "pets";
  }
  if (/\b(roommates?|household|group size)\b/.test(haystack)) {
    return "roommates";
  }
  if (/\b(communicat|text style|direct|responsive|house meetings?)\b/.test(haystack)) {
    return "communication_style";
  }
  if (/\b(dealbreaker|non[- ]?negotiable|must not)\b/.test(haystack)) {
    return "home_preferences";
  }
  if (/\b(must[- ]?have|need in an apartment|amenity)\b/.test(haystack)) {
    return "home_preferences";
  }
  return null;
}

export function prioritizeIntakeStepsFromHints(
  questions: string[],
  existingSteps: TextAgentIntakeStep[],
): TextAgentIntakeStep[] {
  const hintedSteps: TextAgentIntakeStep[] = [];
  const seen = new Set<TextAgentIntakeStep>();

  for (const question of questions) {
    const step = mapFollowUpQuestionToIntakeStep(question);
    if (step && !seen.has(step)) {
      seen.add(step);
      hintedSteps.push(step);
    }
  }

  const pool = existingSteps.length > 0 ? existingSteps : textAgentIntakeSteps;
  const foundationStepSet = new Set<TextAgentIntakeStep>(
    textAgentFoundationIntakeSteps,
  );
  const foundationSteps = pool.filter((step) => foundationStepSet.has(step));
  const foundationSet = new Set<TextAgentIntakeStep>(foundationSteps);
  const hintedDetails = hintedSteps.filter((step) => !foundationSet.has(step));
  const remainingDetails = pool
    .filter((step) => !seen.has(step) && !foundationSet.has(step))
    .sort(
      (left, right) =>
        intakeStepMatchingImpact[right] - intakeStepMatchingImpact[left],
    );

  return [...foundationSteps, ...hintedDetails, ...remainingDetails];
}

export async function loadEnrichmentIntakeHints(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<TextAgentIntakeStep[]> {
  const importsResult = await supabase
    .from("profile_imports")
    .select("raw_payload, import_metadata, provider, created_at")
    .eq("user_id", userId)
    .in("provider", [...assistantImportProviders])
    .neq("status", "deleted")
    .neq("status", "failed")
    .order("created_at", { ascending: false });

  if (importsResult.error) {
    throw importsResult.error;
  }

  const questions: string[] = [];
  const seenSteps = new Set<TextAgentIntakeStep>();

  for (const row of importsResult.data ?? []) {
    const metadata = readProfileImportMetadata(row.import_metadata, row.raw_payload);
    if (metadata.recommendedFollowUpQuestions?.length) {
      for (const question of metadata.recommendedFollowUpQuestions) {
        const step = mapFollowUpQuestionToIntakeStep(question);
        if (step && !seenSteps.has(step)) {
          seenSteps.add(step);
          questions.push(question);
        }
      }
    }
  }

  const prioritized = prioritizeIntakeStepsFromHints(questions, textAgentIntakeSteps);
  // Pending imported facts are not yet approved or projected onto the matching
  // profile, so the text agent should ask the user directly instead of treating
  // them as covered.
  return prioritized;
}

export async function loadProfileQuestionIntakeSteps(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<TextAgentIntakeStep[]> {
  const prioritized = await loadEnrichmentIntakeHints(supabase, userId);
  return prioritized.filter(isProfileQuestionSafeIntakeStep);
}

function readProfileImportMetadata(
  importMetadata: Database["public"]["Tables"]["profile_imports"]["Row"]["import_metadata"],
  rawPayload: Database["public"]["Tables"]["profile_imports"]["Row"]["raw_payload"],
): ProfileImportMetadata {
  if (
    importMetadata &&
    typeof importMetadata === "object" &&
    !Array.isArray(importMetadata)
  ) {
    const record = importMetadata as Record<string, unknown>;
    const recommendedFollowUpQuestions = readStringArray(
      record.recommendedFollowUpQuestions ?? record.recommended_follow_up_questions,
    );

    if (recommendedFollowUpQuestions.length > 0) {
      return { recommendedFollowUpQuestions };
    }
  }

  return extractProfileImportMetadata(rawPayload);
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}
