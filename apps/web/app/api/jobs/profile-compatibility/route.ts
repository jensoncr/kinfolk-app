import { NextRequest } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/shared/job-auth";
import { mapWithConcurrency } from "@/lib/shared/concurrency";
import { clampInteger } from "@/lib/shared/numbers";
import {
  dryRunMatchingDerivedStateForUserId,
  processQueuedProfileMatchingRefreshJobs,
  recomputeCompatibilityForUserIdWithStatus,
} from "@/lib/profiles/enrichment-store";
import { revalidateProfileDependentPaths } from "@/lib/profiles/route-cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const COMPATIBILITY_REFRESH_CONCURRENCY = 6;

type JobBody = {
  dryRun?: unknown;
  limit?: unknown;
  queuedOnly?: unknown;
  userId?: unknown;
};

type BatchRefreshResult =
  | {
      dryRun?: {
        edgeCandidates: number;
        rerankedCandidates: number;
        retrievedCandidates: number;
        staleEdgeCandidates: number;
      };
      status: "fulfilled";
      userId: string;
    }
  | { status: "missing_user"; userId: string }
  | { error: string; status: "rejected"; userId: string };

export async function POST(request: NextRequest) {
  if (!isAuthorizedJobRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsedBody = await readOptionalJsonBody(request);
    if (!parsedBody.ok) {
      return Response.json({ error: parsedBody.error }, { status: 400 });
    }

    const body = readJobBody(parsedBody.body);
    const dryRun = readBooleanOption(body.dryRun, false);
    const queuedOnly = readBooleanOption(body.queuedOnly, false);
    const limit = clampInteger(body.limit, 50, 1, 200);

    if (queuedOnly) {
      if (dryRun) {
        return Response.json(
          { error: "Queued refresh processing does not support dry-run." },
          { status: 400 },
        );
      }
      const result = await processQueuedProfileMatchingRefreshJobs(limit);
      return Response.json(result);
    }

    const userId = readNonEmptyString(body.userId);
    if (userId) {
      if (dryRun) {
        const result = await dryRunMatchingDerivedStateForUserId(userId);
        return Response.json({
          dryRun: true,
          edgeCandidates: result.edgeCandidates,
          processed: result.status === "missing_user" ? 0 : 1,
          rerankedCandidates: result.rerankedCandidates,
          retrievedCandidates: result.retrievedCandidates,
          staleEdgeCandidates: result.staleEdgeCandidates,
          userIds: result.status === "missing_user" ? [] : [userId],
        });
      }

      const { result } = await recomputeCompatibilityForUserIdWithStatus(userId);
      if (result.status === "missing_user") {
        return Response.json({ processed: 0, userIds: [] });
      }
      revalidateProfileDependentPaths();
      return Response.json({ processed: 1, userIds: [userId] });
    }

    const supabase = createSupabaseServiceClient();
    const usersResult = await supabase
      .from("kinfolk_users")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (usersResult.error) {
      throw usersResult.error;
    }

    const userIds = (usersResult.data ?? []).map((user) => user.id);
    const results = await mapWithConcurrency(
      userIds,
      COMPATIBILITY_REFRESH_CONCURRENCY,
      async (id): Promise<BatchRefreshResult> => {
        try {
          if (dryRun) {
            const result = await dryRunMatchingDerivedStateForUserId(id);
            if (result.status === "missing_user") {
              return { status: "missing_user", userId: id };
            }
            return {
              dryRun: {
                edgeCandidates: result.edgeCandidates,
                rerankedCandidates: result.rerankedCandidates,
                retrievedCandidates: result.retrievedCandidates,
                staleEdgeCandidates: result.staleEdgeCandidates,
              },
              status: "fulfilled",
              userId: id,
            };
          }

          const { result } = await recomputeCompatibilityForUserIdWithStatus(id);
          if (result.status === "missing_user") {
            return { status: "missing_user", userId: id };
          }
          return { status: "fulfilled", userId: id };
        } catch (error) {
          console.error("[profile-compatibility-job] user refresh failed", {
            error,
            userId: id,
          });
          return {
            error: "Profile compatibility refresh failed.",
            status: "rejected",
            userId: id,
          };
        }
      },
    );

    const refreshedUserIds = results
      .filter((result): result is Extract<BatchRefreshResult, { status: "fulfilled" }> =>
        result.status === "fulfilled",
      )
      .map((result) => result.userId);
    const failures = results.filter(
      (result): result is Extract<BatchRefreshResult, { status: "rejected" }> =>
        result.status === "rejected",
    );
    const missingUserIds = results
      .filter((result): result is Extract<BatchRefreshResult, { status: "missing_user" }> =>
        result.status === "missing_user",
      )
      .map((result) => result.userId);
    const dryRunTotals = results.reduce(
      (totals, result) => {
        if (result.status === "fulfilled" && result.dryRun) {
          totals.edgeCandidates += result.dryRun.edgeCandidates;
          totals.rerankedCandidates += result.dryRun.rerankedCandidates;
          totals.retrievedCandidates += result.dryRun.retrievedCandidates;
          totals.staleEdgeCandidates += result.dryRun.staleEdgeCandidates;
        }
        return totals;
      },
      {
        edgeCandidates: 0,
        rerankedCandidates: 0,
        retrievedCandidates: 0,
        staleEdgeCandidates: 0,
      },
    );

    if (!dryRun && refreshedUserIds.length > 0) {
      revalidateProfileDependentPaths();
    }

    return Response.json({
      ...(dryRun ? { dryRun: true, ...dryRunTotals } : {}),
      failed: failures.length,
      failures,
      ...(missingUserIds.length > 0 ? { missingUserIds } : {}),
      processed: refreshedUserIds.length,
      userIds: refreshedUserIds,
    });
  } catch (error) {
    console.error("[profile-compatibility-job] batch failed", error);
    return Response.json(
      { error: "Profile compatibility job failed." },
      { status: 500 },
    );
  }
}

function readJobBody(value: unknown): JobBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JobBody;
}

type ParsedJobBody =
  | { ok: true; body: unknown }
  | { ok: false; error: string };

async function readOptionalJsonBody(
  request: NextRequest,
): Promise<ParsedJobBody> {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "Request body must be valid JSON" };
  }
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBooleanOption(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    if (normalized === "1") return true;
    if (normalized === "0") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}
