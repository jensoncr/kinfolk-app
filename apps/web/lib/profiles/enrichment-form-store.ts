import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/shared/api-error";
import {
  buildProfileEnrichmentFormMutation,
  profileEnrichmentSuccessText,
  type ProfileEnrichmentFormValues,
} from "@/lib/profiles/enrichment-form";
import { applyProfileSlotEditForUserId } from "@/lib/profiles/enrichment-store";
import { revalidateProfileDependentPaths } from "@/lib/profiles/route-cache";
import {
  updateProfileFieldsForCurrentUser,
  type ProfileFieldsPatch,
} from "@/lib/profiles/store";
import {
  getActiveTextTransportProvider,
  getTextTransportFromNumber,
  isTextAgentEnabled,
  sendTextText,
  type TextTransportProvider,
} from "@/lib/integrations/text-transport";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export async function saveProfileEnrichmentFormForCurrentUser(
  values: ProfileEnrichmentFormValues,
) {
  const mutation = buildProfileEnrichmentFormMutation(values);
  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!identity || !user) {
    throw new ApiError("Sign in before finishing your profile.", 401);
  }

  if (Object.keys(mutation.profilePatch).length > 0) {
    await updateProfileFieldsForCurrentUser(
      mutation.profilePatch as ProfileFieldsPatch,
      { refreshMatchingState: false },
    );
  }

  if (mutation.revokeKeys.length > 0) {
    await applyProfileSlotEditForUserId(
      user.id,
      {
        facts: mutation.facts,
        method: "system",
        payload: mutation.payload,
        provider: "web",
        revokeKeys: mutation.revokeKeys,
        sourceLabel: "Profile enrichment form",
      },
      { refreshMatchingState: true, snapshotMode: "none" },
    );
  }

  await markMatchingInterviewCompletedFromForm(supabase, user.id, mutation.summary);
  scheduleProfileEnrichmentSuccessText(supabase, user.id);
  revalidateProfileDependentPaths();

  return {
    summary: mutation.summary,
  };
}

function scheduleProfileEnrichmentSuccessText(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  try {
    after(() => safelySendProfileEnrichmentSuccessText(supabase, userId));
  } catch (error) {
    console.error("Unable to schedule profile enrichment success text", {
      error,
      userId,
    });
    void safelySendProfileEnrichmentSuccessText(supabase, userId);
  }
}

async function markMatchingInterviewCompletedFromForm(
  supabase: SupabaseServiceClient,
  userId: string,
  summary: string,
) {
  const result = await supabase
    .from("matching_interviews")
    .update({
      completed_at: new Date().toISOString(),
      extraction_status: "ready",
      status: "completed",
      summary,
    })
    .eq("user_id", userId)
    .in("status", ["scheduled", "in_progress", "needs_review"]);

  if (result.error) {
    throw result.error;
  }
}

async function safelySendProfileEnrichmentSuccessText(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  try {
    await sendProfileEnrichmentSuccessText(supabase, userId);
  } catch (error) {
    console.error("Unable to send profile enrichment success text", {
      error,
      userId,
    });
  }
}

async function sendProfileEnrichmentSuccessText(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const provider = getActiveTextTransportProvider();
  if (!isTextAgentEnabled(provider)) {
    return;
  }

  const phone = await findVerifiedOptedInPhoneForUser(supabase, userId);
  if (!phone) {
    return;
  }

  const idempotencyKey = `kinfolk:profile-enrichment-form:${userId}:success-apartments-v1`;
  const existing = await supabase
    .from("text_messages")
    .select("id")
    .eq("provider", provider)
    .eq("outbound_idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }
  if (existing.data) {
    return;
  }

  const existingThread = await findLatestTextThreadForPhone(supabase, {
    phoneE164: phone.phone_e164,
    provider,
    userId,
  });
  const response = await sendTextText({
    body: profileEnrichmentSuccessText,
    chatId: existingThread?.provider_chat_id,
    idempotencyKey,
    provider,
    to: phone.phone_e164,
  });
  const thread = await upsertProfileEnrichmentTextThread(supabase, {
    chatId: response.chatId,
    existingThread,
    phone,
    provider,
    userId,
  });
  const insert = await supabase.from("text_messages").insert({
    body: profileEnrichmentSuccessText,
    delivery_status: response.deliveryStatus,
    direction: "outbound",
    from_phone_e164: getTextTransportFromNumber(provider),
    media: [] as Json,
    outbound_idempotency_key: idempotencyKey,
    phone_number_id: phone.id,
    provider,
    provider_chat_id: response.chatId ?? thread.provider_chat_id,
    provider_message_id: response.messageId,
    raw_payload: {
      idempotency_key: idempotencyKey,
      message_kind: "profile_enrichment_success_apartment_nudge",
      trigger: "profile_enrichment_form_saved",
    } as Json,
    received_at: new Date().toISOString(),
    service: response.service,
    thread_id: thread.id,
    to_phone_e164: phone.phone_e164,
    user_id: userId,
  });

  if (insert.error && insert.error.code !== "23505") {
    throw insert.error;
  }
}

// Post-profile nudges are promotional, so require an explicit opted_in verified
// number before texting.
async function findVerifiedOptedInPhoneForUser(
  supabase: SupabaseServiceClient,
  userId: string,
) {
  const result = await supabase
    .from("user_phone_numbers")
    .select("*")
    .eq("user_id", userId)
    .eq("sms_consent_state", "opted_in")
    .not("verified_at", "is", null)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function findLatestTextThreadForPhone(
  supabase: SupabaseServiceClient,
  {
    phoneE164,
    provider,
    userId,
  }: {
    phoneE164: string;
    provider: TextTransportProvider;
    userId: string;
  },
) {
  // Scope to this user so we never reuse a thread that belongs to another
  // Kinfolk account that happens to share the phone number.
  const result = await supabase
    .from("text_threads")
    .select("*")
    .eq("provider", provider)
    .eq("user_id", userId)
    .eq("to_phone_e164", phoneE164)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function upsertProfileEnrichmentTextThread(
  supabase: SupabaseServiceClient,
  {
    chatId,
    existingThread,
    phone,
    provider,
    userId,
  }: {
    chatId?: string | null;
    existingThread: TableRow<"text_threads"> | null;
    phone: TableRow<"user_phone_numbers">;
    provider: TextTransportProvider;
    userId: string;
  },
) {
  const from = getTextTransportFromNumber(provider);
  const resolvedChatId = chatId ?? existingThread?.provider_chat_id ?? null;
  const now = new Date().toISOString();

  if (existingThread) {
    if (existingThread.user_id && existingThread.user_id !== userId) {
      throw new Error("Text thread is already linked to a different Kinfolk user.");
    }

    const updated = await supabase
      .from("text_threads")
      .update({
        from_phone_e164: from,
        last_message_at: now,
        phone_number_id: phone.id,
        provider_chat_id: resolvedChatId,
        status: "active",
        to_phone_e164: phone.phone_e164,
        user_id: userId,
      })
      .eq("id", existingThread.id)
      .select("*")
      .single();

    if (updated.error) {
      throw updated.error;
    }

    return updated.data;
  }

  const inserted = await supabase
    .from("text_threads")
    .insert({
      from_phone_e164: from,
      last_message_at: now,
      phone_number_id: phone.id,
      provider,
      provider_chat_id: resolvedChatId,
      status: "active",
      to_phone_e164: phone.phone_e164,
      user_id: userId,
    })
    .select("*")
    .single();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data;
}
