import { NextRequest } from "next/server";
import { backfillListingFeatureEvidence } from "@/lib/apartments/listing-feature-assessments";
import { isAuthorizedJobRequest } from "@/lib/shared/job-auth";
import { clampInteger } from "@/lib/shared/numbers";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
    const result = await backfillListingFeatureEvidence(
      createSupabaseServiceClient(),
      {
        ...(dryRun ? { dryRun } : {}),
        force: readBooleanOption(body.force, false),
        includeVision: readBooleanOption(body.includeVision, false),
        limit: clampInteger(body.limit, 50, 1, 500),
        listingId: readNonEmptyString(body.listingId),
        maxPhotosPerListing: clampInteger(body.maxPhotosPerListing, 3, 1, 8),
      },
    );

    return Response.json(result);
  } catch (error) {
    console.error("[listing-feature-evidence-job] worker failed", error);
    return Response.json(
      { error: "Listing feature evidence job failed." },
      { status: 500 },
    );
  }
}

type JobBody = {
  dryRun?: unknown;
  force?: unknown;
  includeVision?: unknown;
  limit?: unknown;
  listingId?: unknown;
  maxPhotosPerListing?: unknown;
};

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

function readJobBody(value: unknown): JobBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JobBody;
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
