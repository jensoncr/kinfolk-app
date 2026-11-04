import "server-only";
import { normalizeSmsRecipient } from "@/lib/integrations/continue-on-phone";
import { buildTextAgentInterviewStartMessage, buildVerificationMessage, generateScopedVerificationCode, hashVerificationCode } from "@/lib/text-agent";
import { startMatchingInterviewForUser } from "@/lib/text-agent/interview-state";
import { findVerifiedPhoneForUser } from "@/lib/text-agent/phone-verification";
import { getPhoneVerificationProvider, getTextTransportDisplayName, getTextTransportFromNumber, isTextAgentEnabled } from "@/lib/integrations/text-transport";
import { ApiError } from "@/lib/shared/api-error";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireBoundarySecret } from "../shared/secrets";
import { randomUUID } from "node:crypto";
import type { ContinueOnPhoneHandoff, SupabaseServiceClient } from "@/lib/text-agent/store-types";
import type { TextTransportProvider } from "@/lib/integrations/text-transport";

const challengeTtlMinutes = 30;

export async function createContinueOnPhoneChallengeForCurrentUser(): Promise<ContinueOnPhoneHandoff> {
  const provider = getPhoneVerificationProvider();
  if (!isTextAgentEnabled(provider)) {
    throw new ApiError(
      `${getTextTransportDisplayName(provider)} text agent is not configured.`,
    );
  }

  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!identity || !user) {
    throw new ApiError("Sign in before continuing on your phone.", 401);
  }

  return createContinueOnPhoneHandoffForUser(supabase, {
    provider,
    userId: user.id,
  });
}

export async function createInterviewOnPhoneHandoffForCurrentUser(): Promise<ContinueOnPhoneHandoff> {
  const provider = getPhoneVerificationProvider();
  if (!isTextAgentEnabled(provider)) {
    throw new ApiError(
      `${getTextTransportDisplayName(provider)} text agent is not configured.`,
    );
  }

  const supabase = createSupabaseServiceClient();
  const { identity, user } = await ensureCurrentKinfolkUser(supabase);

  if (!identity || !user) {
    throw new ApiError("Sign in before starting your Kinfolk interview.", 401);
  }

  await startMatchingInterviewForUser(supabase, user.id);

  return createContinueOnPhoneHandoffForUser(supabase, {
    provider,
    userId: user.id,
    verifiedMessage: buildTextAgentInterviewStartMessage(),
  });
}

async function createContinueOnPhoneHandoffForUser(
  supabase: SupabaseServiceClient,
  {
    provider,
    userId,
    verifiedMessage,
  }: {
    provider: TextTransportProvider;
    userId: string;
    verifiedMessage?: string;
  },
) {
  const phoneNumber = getTextTransportFromNumber(provider);
  const now = new Date();
  const nowIso = now.toISOString();
  const verifiedPhone = await findVerifiedPhoneForUser(supabase, userId);

  if (verifiedPhone) {
    return buildAgentThreadHandoff({ message: verifiedMessage, phoneNumber });
  }

  const activeChallenge = await supabase
    .from("phone_verification_challenges")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeChallenge.error) {
    throw activeChallenge.error;
  }

  if (activeChallenge.data) {
    const code = generatePhoneChallengeCode(
      userId,
      activeChallenge.data.id,
    );

    if (hashVerificationCode(code) === activeChallenge.data.code_hash) {
      return buildVerificationChallengeHandoff({
        code,
        expiresAt: activeChallenge.data.expires_at,
        phoneNumber,
      });
    }
  }

  const expiredPrevious = await supabase
    .from("phone_verification_challenges")
    .update({ expires_at: nowIso })
    .eq("user_id", userId)
    .eq("provider", provider)
    .is("used_at", null)
    .gt("expires_at", nowIso);

  if (expiredPrevious.error) {
    throw expiredPrevious.error;
  }

  const challengeId = randomUUID();
  const code = generatePhoneChallengeCode(userId, challengeId);
  const codeHash = hashVerificationCode(code);
  const expiresAt = new Date(
    now.getTime() + challengeTtlMinutes * 60 * 1000,
  ).toISOString();
  const result = await supabase.from("phone_verification_challenges").insert({
    id: challengeId,
    code_hash: codeHash,
    code_hint: code.slice(-2),
    expires_at: expiresAt,
    provider,
    user_id: userId,
  });

  if (result.error) {
    throw result.error;
  }

  return buildVerificationChallengeHandoff({
    code,
    expiresAt,
    phoneNumber,
  });
}

function buildVerificationChallengeHandoff({
  code,
  expiresAt,
  phoneNumber,
}: {
  code: string;
  expiresAt: string;
  phoneNumber: string;
}): ContinueOnPhoneHandoff {
  const message = buildVerificationMessage(code);

  return {
    code,
    expiresAt,
    kind: "verification_challenge",
    link: `sms:${normalizeSmsRecipient(phoneNumber)}?body=${encodeURIComponent(message)}`,
    message,
    phoneNumber,
  };
}

function buildAgentThreadHandoff({
  message,
  phoneNumber,
}: {
  message?: string;
  phoneNumber: string;
}): ContinueOnPhoneHandoff {
  const normalizedPhoneNumber = normalizeSmsRecipient(phoneNumber);
  const body = message?.trim();

  return {
    kind: "agent_thread",
    link: body
      ? `sms:${normalizedPhoneNumber}?body=${encodeURIComponent(body)}`
      : `sms:${normalizedPhoneNumber}`,
    message: body || undefined,
    phoneNumber,
  };
}

function generatePhoneChallengeCode(userId: string, challengeId: string) {
  return generateScopedVerificationCode(
    `${userId}:${challengeId}`,
    getPhoneVerificationCodeSecret(),
  );
}

function getPhoneVerificationCodeSecret() {
  return requireBoundarySecret(
    "KINFOLK_PHONE_VERIFICATION_SECRET",
    "phone-verification",
  );
}
