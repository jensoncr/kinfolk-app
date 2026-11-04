import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import { shouldReplaceIdentityAvatarUrl } from "@/lib/profiles/identity-avatar";
import { supabaseUrl } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type LinkedInEnrichmentJobInsert =
  Database["public"]["Tables"]["linkedin_enrichment_jobs"]["Insert"];
type LinkedInIdentitySnapshotInsert = LinkedInEnrichmentJobInsert & {
  idempotency_key: string;
  image_url: string;
};

export type LinkedInIdentitySnapshotSyncResult =
  | "inserted"
  | "not_applicable"
  | "unchanged"
  | "updated";

export function buildLinkedInIdentityJobKey(identity: ClerkLinkedInIdentity) {
  const linkedin = identity.linkedin;
  if (!linkedin) {
    return null;
  }

  return [
    "linkedin",
    identity.clerkUserId,
    linkedin.providerUserId ?? identity.email ?? linkedin.externalAccountId ?? "unknown",
  ].join(":");
}

export function buildLinkedInIdentitySnapshot({
  identity,
  now = new Date(),
  userId,
}: {
  identity: ClerkLinkedInIdentity;
  now?: Date;
  userId: string;
}): LinkedInIdentitySnapshotInsert | null {
  const linkedin = identity.linkedin;
  const idempotencyKey = buildLinkedInIdentityJobKey(identity);
  const imageUrl = cleanText(identity.avatarUrl) ?? cleanText(linkedin?.imageUrl);

  if (!linkedin || !idempotencyKey || !imageUrl) {
    return null;
  }

  const timestamp = now.toISOString();
  return {
    user_id: userId,
    clerk_user_id: identity.clerkUserId,
    provider_user_id: linkedin.providerUserId,
    linkedin_url: linkedin.profileUrl,
    email: identity.email ?? linkedin.emailAddress,
    display_name: identity.displayName,
    image_url: imageUrl,
    idempotency_key: idempotencyKey,
    status: "skipped",
    attempt_count: 0,
    last_error: null,
    locked_at: null,
    next_attempt_at: timestamp,
    completed_at: timestamp,
  };
}

export async function syncLinkedInIdentitySnapshot(
  supabase: SupabaseServiceClient,
  userId: string,
  identity: ClerkLinkedInIdentity,
): Promise<LinkedInIdentitySnapshotSyncResult> {
  const snapshot = buildLinkedInIdentitySnapshot({ identity, userId });
  if (!snapshot) {
    return "not_applicable";
  }

  const existing = await supabase
    .from("linkedin_enrichment_jobs")
    .select("id,image_url")
    .eq("idempotency_key", snapshot.idempotency_key)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data) {
    if (
      !shouldReplaceIdentityAvatarUrl(
        existing.data.image_url,
        snapshot.image_url,
        supabaseUrl,
      )
    ) {
      return "unchanged";
    }

    const updated = await updateSnapshotImageIfMissing(
      supabase,
      existing.data.id,
      existing.data.image_url,
      snapshot.image_url,
    );
    return updated ? "updated" : "unchanged";
  }

  const inserted = await supabase.from("linkedin_enrichment_jobs").insert(snapshot);
  if (!inserted.error) {
    return "inserted";
  }

  if (inserted.error.code !== "23505") {
    throw inserted.error;
  }

  // A concurrent request may create the same identity row between our read and
  // insert. Re-read it so the same fill-only rule protects enrichment-owned
  // image URLs while still filling a null avatar.
  const raced = await supabase
    .from("linkedin_enrichment_jobs")
    .select("id,image_url")
    .eq("idempotency_key", snapshot.idempotency_key)
    .maybeSingle();

  if (raced.error) {
    throw raced.error;
  }
  if (!raced.data) {
    throw inserted.error;
  }
  if (
    !shouldReplaceIdentityAvatarUrl(
      raced.data.image_url,
      snapshot.image_url,
      supabaseUrl,
    )
  ) {
    return "unchanged";
  }

  const updated = await updateSnapshotImageIfMissing(
    supabase,
    raced.data.id,
    raced.data.image_url,
    snapshot.image_url,
  );
  return updated ? "updated" : "unchanged";
}

async function updateSnapshotImageIfMissing(
  supabase: SupabaseServiceClient,
  jobId: string,
  observedImageUrl: string | null,
  imageUrl: string,
) {
  const update = supabase
    .from("linkedin_enrichment_jobs")
    .update({ image_url: imageUrl })
    .eq("id", jobId);
  const guardedUpdate =
    observedImageUrl === null
      ? update.is("image_url", null)
      : update.eq("image_url", observedImageUrl);
  const updated = await guardedUpdate.select("id").maybeSingle();

  if (updated.error) {
    throw updated.error;
  }

  // If another writer populated the image after our read, preserve its value.
  return Boolean(updated.data);
}

function cleanText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}
