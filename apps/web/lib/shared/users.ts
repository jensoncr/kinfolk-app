import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { getCurrentClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import type { ClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import { DEFAULT_LAUNCH_MARKET, normalizeLaunchMarket } from "@/lib/shared/launch-market";
import { hasServerSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type KinfolkUserRow = Database["public"]["Tables"]["kinfolk_users"]["Row"];
type KinfolkUserInsert = Database["public"]["Tables"]["kinfolk_users"]["Insert"];
type KinfolkUserUpdate = Database["public"]["Tables"]["kinfolk_users"]["Update"];
type CurrentKinfolkUserResult = {
  identity: ClerkLinkedInIdentity | null;
  user: KinfolkUserRow | null;
};

const inFlightDefaultUserEnsures = new Map<
  string,
  Promise<CurrentKinfolkUserResult>
>();

export async function ensureCurrentKinfolkUser(
  supabase?: SupabaseServiceClient,
): Promise<CurrentKinfolkUserResult> {
  if (!supabase) {
    return ensureCurrentKinfolkUserWithDefaultClient();
  }

  return ensureCurrentKinfolkUserWithClient(supabase);
}

const ensureCurrentKinfolkUserWithDefaultClient = cache(
  async (): Promise<CurrentKinfolkUserResult> => {
    const identity = await getCurrentClerkLinkedInIdentity();

    if (!identity) {
      return { identity: null, user: null };
    }

    if (!hasServerSupabaseConfig()) {
      return { identity, user: null };
    }

    const inFlight = inFlightDefaultUserEnsures.get(identity.clerkUserId);
    if (inFlight) {
      return inFlight;
    }

    const promise = upsertKinfolkUserFromClerk(
      createSupabaseServiceClient(),
      identity,
    ).then((user) => ({ identity, user }));

    inFlightDefaultUserEnsures.set(identity.clerkUserId, promise);
    try {
      return await promise;
    } finally {
      if (inFlightDefaultUserEnsures.get(identity.clerkUserId) === promise) {
        inFlightDefaultUserEnsures.delete(identity.clerkUserId);
      }
    }
  },
);

async function ensureCurrentKinfolkUserWithClient(
  supabase: SupabaseServiceClient,
): Promise<CurrentKinfolkUserResult> {
  const identity = await getCurrentClerkLinkedInIdentity();

  if (!identity) {
    return { identity: null, user: null };
  }

  if (!hasServerSupabaseConfig()) {
    return { identity, user: null };
  }

  const user = await upsertKinfolkUserFromClerk(supabase, identity);
  return { identity, user };
}

export async function upsertKinfolkUserFromClerk(
  supabase: SupabaseServiceClient,
  identity: ClerkLinkedInIdentity,
) {
  const existing = await supabase
    .from("kinfolk_users")
    .select("*")
    .eq("clerk_user_id", identity.clerkUserId)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const nextValues = kinfolkUserValuesFromClerk(identity, existing.data ?? null);

  if (existing.data) {
    const update = changedKinfolkUserValues(existing.data, nextValues);

    if (Object.keys(update).length === 0) {
      return existing.data;
    }

    const result = await supabase
      .from("kinfolk_users")
      .update(update)
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (result.error) {
      throw result.error;
    }

    return result.data;
  }

  const result = await supabase
    .from("kinfolk_users")
    .upsert(
      nextValues,
      { onConflict: "clerk_user_id" },
    )
    .select("*")
    .single();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

function kinfolkUserValuesFromClerk(
  identity: ClerkLinkedInIdentity,
  existing: KinfolkUserRow | null,
): KinfolkUserInsert {
  const nextLinkedInUrl =
    identity.linkedin?.profileUrl ?? existing?.linkedin_url ?? null;
  const nextLaunchMarket = normalizeLaunchMarket(existing?.launch_market);
  // Preserve user-edited values: keep the stored display name on conflict, and
  // never null out an existing email when Clerk omits it on a given request.
  const existingDisplayName = existing?.display_name;
  const nextDisplayName = hasDisplayText(existingDisplayName)
    ? existingDisplayName
    : identity.displayName;
  const nextEmail = identity.email ?? existing?.email ?? null;

  return {
    clerk_user_id: identity.clerkUserId,
    display_name: nextDisplayName,
    email: nextEmail,
    linkedin_url: nextLinkedInUrl,
    launch_market: nextLaunchMarket || DEFAULT_LAUNCH_MARKET,
  };
}

function changedKinfolkUserValues(
  existing: KinfolkUserRow,
  nextValues: KinfolkUserInsert,
): KinfolkUserUpdate {
  const update: KinfolkUserUpdate = {};
  if (!hasDisplayText(existing.display_name) && nextValues.display_name) {
    update.display_name = nextValues.display_name;
  }
  if (existing.email !== nextValues.email) {
    update.email = nextValues.email;
  }
  if (existing.linkedin_url !== nextValues.linkedin_url) {
    update.linkedin_url = nextValues.linkedin_url;
  }
  if (existing.launch_market !== nextValues.launch_market) {
    update.launch_market = nextValues.launch_market;
  }

  return update;
}

function hasDisplayText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
