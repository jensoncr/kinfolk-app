import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;

export type UserSavedPlaces = {
  savedAreaLabels: string[];
  savedListingIds: string[];
};

/**
 * Batch-load saved places for a set of users in a single query.
 *
 * Returns a Map keyed by userId. Users with no saves are omitted (callers
 * treat a missing key as empty arrays — consistent with sparsity-neutral scoring).
 *
 * This is the ONE batched read that prevents N+1 in the compatibility scorer:
 * call it ONCE above any per-candidate loop and pass the map in.
 *
 * Query mirrors `loadSavedPlaces` in lib/plan/plan.ts but without the
 * secondary listing-detail lookup (we only need ids + labels for scoring).
 * The `saved_places_user_idx` index on `(user_id, created_at desc)` covers
 * the IN-clause scan.
 */
export async function loadSavedPlacesForUsers(
  supabase: SupabaseServiceClient,
  userIds: string[],
): Promise<Map<string, UserSavedPlaces>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const result = await supabase
    .from("saved_places")
    .select("user_id,kind,listing_id,area_label")
    .in("user_id", userIds);

  if (result.error) {
    throw result.error;
  }

  const rows = result.data ?? [];
  const byUser = new Map<string, UserSavedPlaces>();

  for (const row of rows) {
    if (!byUser.has(row.user_id)) {
      byUser.set(row.user_id, { savedAreaLabels: [], savedListingIds: [] });
    }
    const entry = byUser.get(row.user_id)!;

    if (row.kind === "area" && row.area_label) {
      entry.savedAreaLabels.push(row.area_label);
    } else if (row.kind === "listing" && row.listing_id) {
      entry.savedListingIds.push(row.listing_id);
    }
  }

  return byUser;
}
