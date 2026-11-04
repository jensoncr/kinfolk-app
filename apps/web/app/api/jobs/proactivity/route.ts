import { NextRequest } from "next/server";
import {
  scanApartmentMatches,
  scanGroupReady,
  scanProfileQuestions,
  scanRoommateMatches,
} from "@/lib/notifications/proactivity-scans";
import { isAuthorizedJobRequest } from "@/lib/shared/job-auth";
import {
  readBooleanOption,
  readJobRequestBody,
  readSinceDate,
} from "@/lib/shared/job-body";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// The window must reach past skip-that-means-defer outcomes, not just the
// cron interval: a match created inside the recipient's quiet window (default
// 12h) or past their daily cap is skipped WITHOUT a reservation row, and only
// a later scan whose window still covers the match can deliver it. 48h spans
// the longest quiet-window + next-day-cap deferral; the idempotency gate
// makes re-scanning already-sent candidates cheap.
const DEFAULT_SCAN_WINDOW_MS = 48 * 60 * 60 * 1000;

async function handle(request: NextRequest) {
  if (!isAuthorizedJobRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsedBody = await readJobRequestBody(request);
    if (!parsedBody.ok) {
      return Response.json({ error: parsedBody.error }, { status: 400 });
    }

    const dryRun = readBooleanOption(parsedBody.body.dryRun, false);
    // Prefer a cursor from the request body (e.g. set by the scheduler).
    const since = readSinceDate(
      parsedBody.body.since,
      new Date(Date.now() - DEFAULT_SCAN_WINDOW_MS),
    );

    const supabase = createSupabaseServiceClient();
    // Sequential on purpose (send-rate friendliness); the expensive shared
    // piece — the verified-phone cohort page-through — is memoized per client
    // inside the scans, so it runs once per invocation.
    const apartmentMatches = await scanApartmentMatches(supabase, { dryRun, since });
    const roommateMatches = await scanRoommateMatches(supabase, { dryRun, since });
    const groupReady = await scanGroupReady(supabase, { dryRun, since });
    const profileQuestions = await scanProfileQuestions(supabase, { dryRun, since });

    return Response.json({
      ok: true,
      apartmentMatches,
      roommateMatches,
      groupReady,
      profileQuestions,
    });
  } catch (error) {
    console.error("[proactivity] job scan failed", error);
    return Response.json(
      { error: "Proactivity job failed.", ok: false },
      { status: 500 },
    );
  }
}

// Vercel Cron triggers a GET on the configured path (with an
// `Authorization: Bearer <CRON_SECRET>` header when CRON_SECRET is set).
export async function GET(request: NextRequest) {
  return handle(request);
}

// POST supports manual pokes and non-Vercel schedulers (e.g. Render /
// pg_cron) sending `x-kinfolk-job-secret`.
export async function POST(request: NextRequest) {
  return handle(request);
}
