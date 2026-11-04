import "server-only";
import { getActiveTextTransportProvider, sendTextText } from "@/lib/integrations/text-transport";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

// A solo founder hears about agent failures from a text, not from a user
// texting him personally. One short alert per reason per window, throttled in
// Supabase so serverless instances share the budget.
const founderAlertWindowMinutes = 30;

const founderAlertBucketType = "founder_alert_reason_30m";

const founderAlertBodyMaxChars = 600;

const founderAlertDetailMaxChars = 300;

export type FounderAlertContext = {
  detail?: string | null;
  error?: unknown;
  runId?: string | null;
  threadId?: string | null;
};

/**
 * Texts the founder about an agent failure. Best-effort by design: it logs a
 * structured `[founder-alert]` line, then sends at most one text per reason
 * per 30-minute window via the existing text transport. It NEVER throws into
 * its caller and never re-enters any reply or alert path — a failure inside
 * the alert itself is logged and dropped, not re-alerted.
 */
export async function notifyFounder(
  reason: string,
  context: FounderAlertContext = {},
): Promise<void> {
  const detail =
    context.detail ??
    (context.error !== undefined ? founderAlertErrorMessage(context.error) : null);

  try {
    console.error("[founder-alert]", {
      detail,
      reason,
      runId: context.runId ?? null,
      threadId: context.threadId ?? null,
    });

    const to = process.env.KINFOLK_FOUNDER_ALERT_PHONE?.trim();
    if (!to) {
      return;
    }

    const windowStart = founderAlertWindowStartIso();
    const supabase = createSupabaseServiceClient();
    const throttle = await supabase.rpc("hit_text_agent_rate_limit", {
      p_bucket_key: reason,
      p_bucket_type: founderAlertBucketType,
      p_limit: 1,
      p_window_start: windowStart,
    });

    if (throttle.error) {
      throw throttle.error;
    }

    if (!throttle.data?.[0]?.allowed) {
      return;
    }

    await sendTextText({
      body: buildFounderAlertBody(reason, { ...context, detail }),
      idempotencyKey: `founder-alert:${reason}:${windowStart}`,
      provider: getActiveTextTransportProvider(),
      to,
    });
  } catch (error) {
    console.error("[founder-alert] alert delivery failed", {
      error: founderAlertErrorMessage(error),
      reason,
    });
  }
}

function buildFounderAlertBody(reason: string, context: FounderAlertContext) {
  const refs = [
    context.runId ? `run ${context.runId}` : null,
    context.threadId ? `thread ${context.threadId}` : null,
  ].filter(Boolean);
  const lines = [
    `kinfolk agent alert: ${reason}`,
    refs.length > 0 ? refs.join(" · ") : null,
    context.detail ? context.detail.slice(0, founderAlertDetailMaxChars) : null,
  ].filter(Boolean);
  return lines.join("\n").slice(0, founderAlertBodyMaxChars);
}

function founderAlertWindowStartIso(now = new Date()) {
  const windowMs = founderAlertWindowMinutes * 60 * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();
}

function founderAlertErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
