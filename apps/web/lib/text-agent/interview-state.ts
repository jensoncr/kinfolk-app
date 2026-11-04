import "server-only";
import type { SupabaseServiceClient, TableRow } from "@/lib/text-agent/store-types";

export async function startMatchingInterviewForUser(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const now = new Date().toISOString();
  const [profileResult, activeInterviewResult] = await Promise.all([
    supabase
      .from("matching_profiles")
      .select("id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("matching_interviews")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["scheduled", "in_progress", "needs_review"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error) {
    throw profileResult.error;
  }

  if (activeInterviewResult.error) {
    throw activeInterviewResult.error;
  }

  const profileId = profileResult.data?.id ?? null;

  if (activeInterviewResult.data) {
    const result = await supabase
      .from("matching_interviews")
      .update({
        channel: "phone",
        consent_recorded_at:
          activeInterviewResult.data.consent_recorded_at ?? now,
        extraction_status:
          activeInterviewResult.data.extraction_status === "failed"
            ? "processing"
            : activeInterviewResult.data.extraction_status,
        profile_id: activeInterviewResult.data.profile_id ?? profileId,
        started_at: activeInterviewResult.data.started_at ?? now,
        status: "in_progress",
      })
      .eq("id", activeInterviewResult.data.id);

    if (result.error) {
      throw result.error;
    }

    return;
  }

  const result = await supabase.from("matching_interviews").insert({
    channel: "phone",
    consent_recorded_at: now,
    extraction_status: "processing",
    profile_id: profileId,
    started_at: now,
    status: "in_progress",
    user_id: userId,
  });

  if (result.error) {
    throw result.error;
  }
}

export async function markMatchingInterviewNeedsReview(
  supabase: SupabaseServiceClient,
  {
    summary,
    userId,
  }: {
    summary: string;
    userId: string;
  },
) {
  await startMatchingInterviewForUser(supabase, userId);

  const result = await supabase
    .from("matching_interviews")
    .update({
      completed_at: null,
      extraction_status: "ready",
      status: "needs_review",
      summary,
    })
    .eq("user_id", userId)
    .in("status", ["scheduled", "in_progress", "needs_review"]);

  if (result.error) {
    throw result.error;
  }
}

export async function markMatchingInterviewCompleted(
  supabase: SupabaseServiceClient,
  {
    summary,
    userId,
  }: {
    summary?: string;
    userId: string;
  },
) {
  await startMatchingInterviewForUser(supabase, userId);

  const update: Partial<TableRow<"matching_interviews">> = {
    completed_at: new Date().toISOString(),
    extraction_status: "ready",
    status: "completed",
  };

  if (summary !== undefined) {
    update.summary = summary;
  }

  const result = await supabase
    .from("matching_interviews")
    .update(update)
    .eq("user_id", userId)
    .in("status", ["scheduled", "in_progress", "needs_review"]);

  if (result.error) {
    throw result.error;
  }
}

export async function hasActiveMatchingInterview(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("matching_interviews")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["scheduled", "in_progress", "needs_review"])
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return Boolean(result.data);
}
