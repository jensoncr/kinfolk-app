import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * The two effective profile visibility states. The matching_profiles column
 * also carries legacy 'limited' / 'approved' values; anything that is not
 * 'public' behaves as anonymous — identity stays hidden until the viewer is
 * unlocked (accepted into the same group, or a mutual intro).
 */
export type ProfileVisibility = "public" | "anonymous";

export function isPublicVisibilityMode(mode: string | null | undefined): boolean {
  return mode === "public";
}

/**
 * Latest visibility_mode per user, collapsed to "is this profile public?".
 * Users with no matching_profiles row are anonymous (the column's default).
 */
export async function loadPublicVisibilityByUserId(
  supabase: SupabaseServiceClient,
  userIds: string[],
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (userIds.length === 0) return map;

  const result = await supabase
    .from("matching_profiles")
    .select("user_id,visibility_mode,updated_at")
    .in("user_id", userIds)
    .order("updated_at", { ascending: false });

  if (result.error) throw result.error;
  for (const row of result.data ?? []) {
    // Query is updated_at desc, so the first row per user is the latest.
    if (map.has(row.user_id)) continue;
    map.set(row.user_id, isPublicVisibilityMode(row.visibility_mode));
  }
  return map;
}
