import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseServiceClient, TextAgentRateLimitResult } from "@/lib/text-agent/store-types";

const maxVerifiedInboundPerDay = 200;

export async function enforceVerifiedInboundRateLimits(
  supabase: SupabaseServiceClient,
  {
    phone,
    threadId,
    userId,
  }: {
    phone: string;
    threadId: string;
    userId: string;
  },
): Promise<TextAgentRateLimitResult> {
  const checks = [
    {
      bucketKey: phone,
      bucketType: "verified_phone_day",
      limit: maxVerifiedInboundPerDay,
      window: "day" as const,
    },
    {
      bucketKey: userId,
      bucketType: "verified_user_day",
      limit: maxVerifiedInboundPerDay,
      window: "day" as const,
    },
    {
      bucketKey: threadId,
      bucketType: "thread_day",
      limit: maxVerifiedInboundPerDay,
      window: "day" as const,
    },
  ];

  const runCheck = async (
    index: number,
    lastAllowed: TextAgentRateLimitResult | null,
  ): Promise<TextAgentRateLimitResult> => {
    const check = checks[index];
    if (!check) {
      return lastAllowed ?? { allowed: true, bucket: "verified_user_day:none" };
    }

    const hit = await hitTextAgentRateLimit(supabase, check);
    if (!hit.allowed) {
      return hit;
    }
    return runCheck(index + 1, hit);
  };

  return runCheck(0, null);
}

export async function hitTextAgentRateLimit(
  supabase: SupabaseServiceClient,
  {
    bucketKey,
    bucketType,
    limit,
    window,
  }: {
    bucketKey: string;
    bucketType: string;
    limit: number;
    window: "hour" | "day";
  },
): Promise<TextAgentRateLimitResult> {
  const windowStart = windowStartIso(window);
  const hashedBucketKey = hashRateLimitBucketKey(bucketKey);
  const bucket = `${bucketType}:${hashedBucketKey}:${windowStart}`;
  const result = await supabase.rpc("hit_text_agent_rate_limit", {
    p_bucket_key: hashedBucketKey,
    p_bucket_type: bucketType,
    p_limit: limit,
    p_window_start: windowStart,
  });

  if (result.error) {
    throw result.error;
  }

  const hit = result.data?.[0];
  return hit?.allowed
    ? { allowed: true, bucket }
    : { allowed: false, bucket, limit, windowLabel: window };
}

function hashRateLimitBucketKey(value: string) {
  return createHash("sha256")
    .update(`kinfolk-text-agent-rate:${value}`)
    .digest("hex");
}

function windowStartIso(window: "hour" | "day") {
  const now = new Date();
  if (window === "hour") {
    now.setUTCMinutes(0, 0, 0);
  } else {
    now.setUTCHours(0, 0, 0, 0);
  }
  return now.toISOString();
}
