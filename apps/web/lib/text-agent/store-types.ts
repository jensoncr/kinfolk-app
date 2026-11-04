import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ListingFeatureAssessment,
} from "@/lib/apartments/listing-feature-assessments";
import type {
  TextAgentIntakeStep,
  TextProfileFact,
  TextProfileImportExtractionMetadata,
} from "@/lib/text-agent";
import type { TextAgentModelExtraction } from "@/lib/text-agent/extraction";
import type { Database } from "@/lib/supabase/types";

export type SupabaseServiceClient = SupabaseClient<Database>;
export type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export type ContinueOnPhoneHandoff = {
  code?: string;
  expiresAt?: string;
  kind: "agent_thread" | "verification_challenge";
  link: string;
  message?: string;
  phoneNumber: string;
};

export type TextAgentReply = (
  body: string,
  intentOverride?: string,
  mediaUrls?: string[],
) => Promise<void>;

export type TextAgentPolicyOutcome =
  | "allowed_low_risk"
  | "needs_review_sensitive"
  | "blocked_protected"
  | "unsupported"
  | "rate_limited"
  | "clarification_needed"
  | "verified"
  | "opted_out"
  | "error";

export type TextAgentRateLimitResult =
  | { allowed: true; bucket: string }
  | { allowed: false; bucket: string; limit: number; windowLabel: string };

export type ProposalExtractionResult = {
  facts: TextProfileFact[];
  metadata: TextProfileImportExtractionMetadata;
  modelExtraction: TextAgentModelExtraction;
  validationNotice?: string;
  validationReply?: string;
};

export type TextAgentDraftState = {
  facts: TextProfileFact[];
  skippedSteps: TextAgentIntakeStep[];
};

export type ListingRecommendationCard = {
  address: string;
  bathrooms: number | null;
  bedrooms: number | null;
  description: string;
  effectivePerPersonRent: number | null;
  effectiveRent: number | null;
  evidence: string[];
  featureAssessments?: ListingFeatureAssessment[];
  fitScore: number;
  // Where the score came from: "engine" = precomputed apartment_listing_matches
  // row, "heuristic" = the fallback ranker's clamped estimate. Persisted in the
  // card snapshot so the card/UI can render heuristic scores honestly.
  fit_source: "engine" | "heuristic";
  id: string;
  imageUrl: string | null;
  monthlyRent: number | null;
  neighborhood: string;
  perPersonRent: number | null;
  recommendedHouseholdSize: number | null;
  sourceUrl: string | null;
};

export type ListingFeatureFit = {
  matched: string[];
  missing: string[];
  score: number;
  strict: boolean;
};

export type ListingRecommendationCandidate = {
  card: ListingRecommendationCard;
  proximityDistance: number | null;
  transitDistance: number | null;
};

export type ProfileActionToolPlan =
  | {
      clarifyingReply: string;
      facts: TextProfileFact[];
      revokeKeys: string[];
      summary: string;
    }
  | {
      clarifyingReply?: null;
      facts: TextProfileFact[];
      revokeKeys: string[];
      summary: string;
    };

export type IncrementalTextProfileFactsPersistenceArgs = {
  body: string;
  facts: TextProfileFact[];
  message: TableRow<"text_messages">;
  metadata: TextProfileImportExtractionMetadata;
  sourceLabel?: string;
  thread: TableRow<"text_threads">;
  userId: string;
};

export type IncrementalTextProfileFactsPersistenceResult = {
  applied: boolean;
  deferred?: boolean;
  factCount: number;
  importId?: string;
};

export type IntakeControlResult = {
  facts: TextProfileFact[];
  replyPrefix: string;
  skipped?: boolean;
};
