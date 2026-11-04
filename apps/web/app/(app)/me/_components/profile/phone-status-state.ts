import { normalizePhoneE164 } from "@/lib/shared/phone";

type PhoneStatusInput = {
  phone?: unknown;
  phoneVerified?: unknown;
};

type PhoneHandoffInput = {
  expiresAt?: string | null;
  kind?: "agent_thread" | "verification_challenge" | null;
  link?: string | null;
};

export type PhoneStatusCheckResult =
  | {
      kind: "verified";
      phone: string;
    }
  | {
      kind: "pending";
      message: string;
    };

export function getPhoneStatusPendingMessage(agentEnabled: boolean): string {
  return agentEnabled
    ? "No Kinfolk-verified phone yet. Send the text, then check again."
    : "No Kinfolk-verified phone yet. Kinfolk texting is not configured.";
}

export function getVerifiedPhone(status: PhoneStatusInput): string | null {
  if (status.phoneVerified !== true || typeof status.phone !== "string") {
    return null;
  }

  const phone = normalizePhoneE164(status.phone);
  return phone || null;
}

export function resolvePhoneStatusCheck(
  status: PhoneStatusInput,
  agentEnabled: boolean,
): PhoneStatusCheckResult {
  const phone = getVerifiedPhone(status);

  if (phone) {
    return {
      kind: "verified",
      phone,
    };
  }

  return {
    kind: "pending",
    message: getPhoneStatusPendingMessage(agentEnabled),
  };
}

export function canReusePhoneHandoff(
  handoff: PhoneHandoffInput | null,
  nowMs = Date.now(),
): boolean {
  if (!handoff?.link?.trim()) {
    return false;
  }

  if (handoff.kind !== "verification_challenge") {
    return false;
  }

  const expiresAt = typeof handoff.expiresAt === "string" ? Date.parse(handoff.expiresAt) : NaN;
  return Number.isFinite(expiresAt) && expiresAt > nowMs + 30_000;
}
