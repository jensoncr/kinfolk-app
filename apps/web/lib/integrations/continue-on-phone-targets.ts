import {
  normalizeHttpBaseUrl,
  normalizeSmsHandoffLink,
} from "@/lib/integrations/continue-on-phone";

const maxTargetLength = 2048;

export function normalizeContinueOnPhoneTarget(value: unknown, origin: string | string[]) {
  return normalizeContinueOnPhoneTargetInner(value, origin, 0);
}

function normalizeContinueOnPhoneTargetInner(
  value: unknown,
  origin: string | string[],
  depth: number,
) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxTargetLength) {
    return null;
  }

  const smsLink = normalizeSmsHandoffLink(trimmed);
  if (smsLink) {
    return smsLink;
  }

  const originCandidates = Array.isArray(origin) ? origin : [origin];
  const allowedOrigins = new Set(
    originCandidates
      .map((candidate) => normalizeOrigin(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
  const baseOrigin = originCandidates.find((candidate) => normalizeOrigin(candidate)) ?? undefined;

  try {
    const url = new URL(trimmed, baseOrigin);
    if (allowedOrigins.has(url.origin)) {
      if (isAllowedDashboardPath(url.pathname)) {
        return url.toString();
      }

      if (
        url.pathname === "/qr" &&
        depth < 2 &&
        normalizeContinueOnPhoneTargetInner(url.searchParams.get("link"), originCandidates, depth + 1)
      ) {
        return url.toString();
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isAllowedDashboardPath(pathname: string) {
  return pathname === "/me" || pathname.startsWith("/me/");
}

function normalizeOrigin(value: string) {
  return normalizeHttpBaseUrl(value);
}
