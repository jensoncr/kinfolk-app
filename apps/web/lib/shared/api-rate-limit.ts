import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ApiRateLimitWindow = "minute" | "hour" | "day";

/**
 * Per-user rate limit for authenticated API routes that do expensive work
 * (paid third-party calls, embedding/compatibility recomputes). Reuses the
 * deployed `hit_text_agent_rate_limit` RPC — an atomic increment-and-check — so
 * the count is correct under concurrency and shared across instances.
 *
 * Returns a ready-to-return 429 Response when the caller is over budget, or
 * null when the request may proceed. Fails OPEN: a counter outage must not lock
 * legitimate users out of the product — this is abuse mitigation, not a hard
 * security boundary.
 */
export async function enforceApiUserRateLimit({
  userId,
  bucketType,
  limit,
  window,
}: {
  userId: string;
  bucketType: string;
  limit: number;
  window: ApiRateLimitWindow;
}): Promise<Response | null> {
  try {
    const now = new Date();
    const supabase = createSupabaseServiceClient();
    const result = await supabase.rpc("hit_text_agent_rate_limit", {
      p_bucket_key: hashRateLimitKey(`${bucketType}:${userId}`),
      p_bucket_type: `api:${bucketType}`,
      p_limit: limit,
      p_window_start: windowStartIso(window, now),
    });
    if (result.error) {
      console.error("[api-rate-limit] counter unavailable; allowing request", {
        bucketType,
        error: result.error,
      });
      return null;
    }
    if (result.data?.[0]?.allowed === true) {
      return null;
    }
    return Response.json(
      {
        error: "Too many requests. Please slow down and try again shortly.",
        status: "rate_limited",
      },
      {
        status: 429,
        headers: { "Retry-After": String(windowRetrySeconds(window, now)) },
      },
    );
  } catch (error) {
    console.error("[api-rate-limit] unexpected error; allowing request", {
      bucketType,
      error,
    });
    return null;
  }
}

function hashRateLimitKey(value: string) {
  return createHash("sha256").update(`kinfolk-api-rate:${value}`).digest("hex");
}

function windowStartIso(window: ApiRateLimitWindow, now: Date) {
  now = new Date(now);
  if (window === "day") {
    now.setUTCHours(0, 0, 0, 0);
  } else if (window === "hour") {
    now.setUTCMinutes(0, 0, 0);
  } else {
    now.setUTCSeconds(0, 0);
  }
  return now.toISOString();
}

function windowRetrySeconds(window: ApiRateLimitWindow, now: Date) {
  const nextWindow = new Date(windowStartIso(window, now));
  if (window === "day") {
    nextWindow.setUTCDate(nextWindow.getUTCDate() + 1);
  } else if (window === "hour") {
    nextWindow.setUTCHours(nextWindow.getUTCHours() + 1);
  } else {
    nextWindow.setUTCMinutes(nextWindow.getUTCMinutes() + 1);
  }
  return Math.max(1, Math.ceil((nextWindow.getTime() - now.getTime()) / 1000));
}
