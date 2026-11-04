"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildContinueOnPhoneQrTarget,
  normalizeSmsHandoffLink,
  type ContinueOnPhoneConfig,
} from "@/lib/integrations/continue-on-phone";

/**
 * A phone-handoff payload returned by a challenge/handoff endpoint. Shared by
 * every "continue on phone" surface (the dashboard CTA, the welcome modal, and
 * the profile interview action).
 */
export type PhoneChallenge = {
  code?: string;
  expiresAt?: string;
  kind?: "agent_thread" | "verification_challenge";
  link: string;
  message?: string;
  phoneNumber: string;
};

type PhoneChallengePayload = Partial<Omit<PhoneChallenge, "kind">> & {
  kind?: PhoneChallenge["kind"];
};

type ChallengeResponse = {
  challenge?: PhoneChallengePayload;
  error?: string;
  ok?: boolean;
};

type QrCodeResponse = {
  error?: string;
  ok?: boolean;
  qrcode?: {
    url?: string;
  };
};

type QrResult = {
  error: string | null;
  target: string;
  url: string | null;
};

type QrRequestState = {
  inFlightTarget: string | null;
  result: QrResult | null;
  target: string;
};

export type UsePhoneHandoffOptions = {
  config: ContinueOnPhoneConfig;
  /**
   * Endpoint that mints the handoff challenge. Defaults to
   * `config.challengeEndpoint`; the interview action overrides it.
   */
  challengeEndpoint?: string;
  /** Called once with the challenge the first time a handoff is created. */
  onHandoffCreated?: (challenge: PhoneChallenge) => void;
  /** Error copy when the agent integration is disabled. */
  disabledMessage?: string;
  /** Error copy when the challenge request fails without a message. */
  challengeErrorMessage?: string;
};

/**
 * Owns the duplicated phone-handoff machinery: environment detection, the
 * de-duplicated `ensureHandoff` call, and a single-flight QR fetch guarded so
 * the rendered QR always matches the link it was generated for.
 */
export function usePhoneHandoff({
  config,
  challengeEndpoint,
  onHandoffCreated,
  disabledMessage = "Linq text agent is not configured.",
  challengeErrorMessage = "Could not create phone handoff.",
}: UsePhoneHandoffOptions) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  const [handoff, setHandoff] = useState<PhoneChallenge | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [qrResult, setQrResult] = useState<QrResult | null>(null);
  const requestRef = useRef<Promise<PhoneChallenge> | null>(null);
  const qrRequestRef = useRef<string | null>(null);
  const qrResultRef = useRef<QrResult | null>(null);

  const onHandoffCreatedRef = useRef(onHandoffCreated);
  useEffect(() => {
    onHandoffCreatedRef.current = onHandoffCreated;
  }, [onHandoffCreated]);
  useEffect(() => {
    qrResultRef.current = qrResult;
  }, [qrResult]);

  const resolvedChallengeEndpoint = challengeEndpoint ?? config.challengeEndpoint;

  useEffect(() => {
    const update = () => {
      setIsDesktop(window.matchMedia("(min-width: 640px)").matches);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const visibleChallengeError = config.agentEnabled ? challengeError : disabledMessage;
  const link = normalizePhoneHandoffLink(handoff?.link);
  const qrTarget = buildContinueOnPhoneQrTarget({
    link,
    origin,
    publicHandoffBaseUrl: config.publicHandoffBaseUrl,
  });

  const ensureHandoff = useCallback(async () => {
    if (!config.agentEnabled) {
      setChallengeError(null);
      throw new Error(disabledMessage);
    }

    if (
      handoff &&
      (handoff.kind === "agent_thread" ||
        (handoff.expiresAt && Date.parse(handoff.expiresAt) > Date.now() + 30_000))
    ) {
      return handoff;
    }

    if (requestRef.current) {
      return requestRef.current;
    }

    setChallengeLoading(true);
    setChallengeError(null);

    const request = fetch(resolvedChallengeEndpoint, { method: "POST" })
      .then(async (response) => {
        const data = await readJsonResponse<ChallengeResponse>(response);
        const challenge = normalizePhoneChallengeResponse(data);
        if (!response.ok || !challenge) {
          throw new Error(readResponseErrorMessage(data, challengeErrorMessage));
        }
        setHandoff(challenge);
        onHandoffCreatedRef.current?.(challenge);
        return challenge;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : challengeErrorMessage;
        setChallengeError(message);
        throw error;
      })
      .finally(() => {
        requestRef.current = null;
        setChallengeLoading(false);
      });

    requestRef.current = request;
    return request;
  }, [
    config.agentEnabled,
    resolvedChallengeEndpoint,
    handoff,
    disabledMessage,
    challengeErrorMessage,
  ]);

  // Single-flight QR fetch for the current `qrTarget`. The guard compares the
  // stored result against the SAME identifier the fetch was issued for
  // (`qrTarget`), not against `handoff.link`, so a stale result is never shown.
  const requestQrCode = useCallback(
    (signal?: AbortSignal) => {
      if (
        !shouldRequestQrCode({
          inFlightTarget: qrRequestRef.current,
          result: qrResultRef.current,
          target: qrTarget,
        })
      ) {
        return;
      }
      const requestTarget = qrTarget;
      qrRequestRef.current = requestTarget;
      setQrResult({ error: null, target: requestTarget, url: null });

      fetch("/api/kinfolk/continue-on-phone/qrcode", {
        body: JSON.stringify({ url: requestTarget }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal,
      })
        .then(async (response) => {
          const data = await readJsonResponse<QrCodeResponse>(response);
          if (!response.ok || !data.ok || !data.qrcode?.url) {
            throw new Error(readResponseErrorMessage(data, "Could not generate QR code."));
          }
          setQrResult({ error: null, target: requestTarget, url: data.qrcode.url });
        })
        .catch((error: unknown) => {
          if (signal?.aborted) {
            return;
          }
          setQrResult({
            error: error instanceof Error ? error.message : "Could not generate QR code.",
            target: requestTarget,
            url: null,
          });
        })
        .finally(() => {
          if (qrRequestRef.current === requestTarget) {
            qrRequestRef.current = null;
          }
        });
    },
    [qrTarget],
  );

  const isCurrentQrResult = qrResult !== null && qrResult.target === qrTarget;
  const qrCodeUrl = isCurrentQrResult ? qrResult.url : null;
  const qrError = isCurrentQrResult ? qrResult.error : null;
  const qrLoading = Boolean(qrTarget && !qrCodeUrl && !qrError);

  return {
    isDesktop,
    origin,
    handoff,
    challengeError: visibleChallengeError,
    challengeLoading,
    ensureHandoff,
    link,
    qrTarget,
    requestQrCode,
    qrCodeUrl,
    qrError,
    qrLoading,
  };
}

export function normalizePhoneChallengeResponse(
  data: ChallengeResponse,
): PhoneChallenge | null {
  const challenge = data.challenge;
  const link = normalizePhoneHandoffLink(challenge?.link);
  if (!data.ok || !challenge || !link) {
    return null;
  }

  const { kind } = challenge;
  if (kind !== "agent_thread" && kind !== "verification_challenge") {
    return null;
  }

  const phoneNumber = readTrimmedString(challenge.phoneNumber);
  if (!phoneNumber) {
    return null;
  }

  const message = readTrimmedString(challenge.message);
  const expiresAt = readTrimmedString(challenge.expiresAt);
  if (kind === "verification_challenge") {
    const expiresAtMs = Date.parse(expiresAt);
    if (!message || !expiresAt || !Number.isFinite(expiresAtMs)) {
      return null;
    }
  }

  return {
    code: readTrimmedString(challenge.code) || undefined,
    expiresAt: expiresAt || undefined,
    kind,
    link,
    message: message || undefined,
    phoneNumber,
  };
}

export function normalizePhoneHandoffLink(value: unknown) {
  return normalizeSmsHandoffLink(value);
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function shouldRequestQrCode({
  inFlightTarget,
  result,
  target,
}: QrRequestState): boolean {
  if (!target || inFlightTarget === target) {
    return false;
  }

  return !(result?.target === target && result.url && !result.error);
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => ({}));
  return isPlainRecord(value) ? (value as T) : ({} as T);
}

export function readResponseErrorMessage(
  data: { error?: unknown },
  fallback: string,
) {
  if (typeof data.error !== "string") {
    return fallback;
  }

  const message = data.error.trim();
  return message || fallback;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
