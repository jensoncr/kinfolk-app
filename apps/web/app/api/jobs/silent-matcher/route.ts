import { NextRequest } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/shared/job-auth";
import { runSilentMatcherSweep } from "@/lib/matching/silent-matcher";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Runs the silent-matcher sweep over opted-in living plans. Candidates-only:
 * edges are computed and stored, nothing is revealed or sent to any user —
 * reveal stays blocked on the open consent questions in
 * lib/matching/silent-matcher.ts.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedJobRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const result = await runSilentMatcherSweep(supabase);
    return Response.json(result);
  } catch (error) {
    console.error("[jobs/silent-matcher] sweep failed", { error });
    return Response.json({ error: "Silent matcher sweep failed." }, { status: 500 });
  }
}
