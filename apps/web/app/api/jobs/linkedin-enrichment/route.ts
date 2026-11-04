import { NextRequest } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/shared/job-auth";
import { clampInteger } from "@/lib/shared/numbers";
import { processLinkedInEnrichmentJobs } from "@/lib/profiles/linkedin-enrichment";

export const runtime = "nodejs";

type JobBody = {
  dryRun?: unknown;
  limit?: unknown;
};

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
    const limit = clampInteger(body.limit, 5, 1, 25);
    const result = dryRun
      ? await processLinkedInEnrichmentJobs(limit, { dryRun })
      : await processLinkedInEnrichmentJobs(limit);

    return Response.json(result);
  } catch (error) {
    console.error("[linkedin-enrichment-job] scheduler failed", error);
    return Response.json(
      { error: "LinkedIn enrichment job failed.", ok: false },
      { status: 500 },
    );
  }
}

function readJobBody(value: unknown): JobBody {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JobBody) : {};
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
