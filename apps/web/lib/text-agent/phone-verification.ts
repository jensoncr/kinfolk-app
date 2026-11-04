import "server-only";
import { hashVerificationCode } from "@/lib/text-agent";
import type { SupabaseServiceClient } from "@/lib/text-agent/store-types";
import type { TextTransportProvider } from "@/lib/integrations/text-transport";

const maxVerificationChallengeAttempts = 5;

export async function verifyPhoneChallenge(
  supabase: SupabaseServiceClient,
  code: string,
  senderPhone: string,
  provider: TextTransportProvider,
) {
  const now = new Date().toISOString();
  const challenge = await supabase
    .from("phone_verification_challenges")
    .select("*")
    .eq("code_hash", hashVerificationCode(code))
    .eq("provider", provider)
    .is("used_at", null)
    .gt("expires_at", now)
    .lt("attempt_count", maxVerificationChallengeAttempts)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challenge.error) {
    throw challenge.error;
  }

  if (!challenge.data) {
    return { success: false as const };
  }

  const verifiedAt = new Date().toISOString();
  const existingPhone = await supabase
    .from("user_phone_numbers")
    .select("*")
    .eq("phone_e164", senderPhone)
    .maybeSingle();

  if (existingPhone.error) {
    throw existingPhone.error;
  }

  if (
    existingPhone.data &&
    existingPhone.data.user_id !== challenge.data.user_id
  ) {
    const attemptCount = challenge.data.attempt_count + 1;
    await supabase
      .from("phone_verification_challenges")
      .update({
        attempt_count: attemptCount,
        ...(attemptCount >= maxVerificationChallengeAttempts
          ? { expires_at: now }
          : {}),
      })
      .eq("id", challenge.data.id);

    return { reason: "phone_already_linked" as const, success: false as const };
  }

  const phoneWrite = existingPhone.data
    ? supabase
        .from("user_phone_numbers")
        .update({
          consent_source: "continue_on_phone",
          sms_consent_state: "opted_in",
          verified_at: verifiedAt,
        })
        .eq("id", existingPhone.data.id)
        .select("*")
        .single()
    : supabase
        .from("user_phone_numbers")
        .insert({
          consent_source: "continue_on_phone",
          phone_e164: senderPhone,
          sms_consent_state: "opted_in",
          user_id: challenge.data.user_id,
          verified_at: verifiedAt,
        })
        .select("*")
        .single();
  const phoneResult = await phoneWrite;

  if (phoneResult.error) {
    throw phoneResult.error;
  }

  const [challengeResult, userResult] = await Promise.all([
    supabase
      .from("phone_verification_challenges")
      .update({
        attempt_count: challenge.data.attempt_count + 1,
        phone_number_id: phoneResult.data.id,
        used_at: verifiedAt,
      })
      .eq("id", challenge.data.id),
    supabase
      .from("kinfolk_users")
      .update({
        phone_e164: senderPhone,
        phone_verified_at: verifiedAt,
      })
      .eq("id", challenge.data.user_id),
  ]);

  if (challengeResult.error) {
    throw challengeResult.error;
  }

  if (userResult.error) {
    throw userResult.error;
  }

  return {
    phoneNumber: phoneResult.data,
    success: true as const,
    userId: challenge.data.user_id,
  };
}

export async function findVerifiedPhone(
  supabase: SupabaseServiceClient,
  phone: string,
) {
  const result = await supabase
    .from("user_phone_numbers")
    .select("*")
    .eq("phone_e164", phone)
    .not("verified_at", "is", null)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

/**
 * Returns true when the phone has explicitly opted out of SMS (texted STOP).
 * Shared consent gate so every outbound path — agent replies, the proactivity
 * job, and tapback follow-ups — can fail closed on opt-out rather than each
 * caller re-deriving the check. A phone with no verified record is treated as
 * not-opted-out (callers gate sending on their own consent requirements).
 */
export async function isPhoneOptedOut(
  supabase: SupabaseServiceClient,
  phone: string | null | undefined,
) {
  const trimmed = phone?.trim();
  if (!trimmed) {
    return false;
  }

  const verifiedPhone = await findVerifiedPhone(supabase, trimmed);
  return verifiedPhone?.sms_consent_state === "opted_out";
}

export async function findVerifiedPhoneForUser(
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
