import {
  runCurrentUserLinkedInEnrichment,
  runCurrentUserLinkedInEnrichmentFromUrl,
} from "@/lib/profiles/linkedin-enrichment";
import { getCurrentClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await getCurrentClerkLinkedInIdentity();
    if (!identity) {
      return Response.json(
        {
          error: "Sign in before enriching your LinkedIn profile.",
          status: "signed_out",
        },
        { status: 401 },
      );
    }

    const linkedinUrl = await readLinkedInUrl(request);
    if (linkedinUrl.status === "invalid_json") {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    // Each accepted POST can trigger the external enrichment provider (and a
    // completed job's attempt_count resets), so throttle like other paid routes.
    const limited = await enforceApiUserRateLimit({
      userId: identity.clerkUserId,
      bucketType: "linkedin_enrichment",
      limit: 5,
      window: "hour",
    });
    if (limited) {
      return limited;
    }

    const result = linkedinUrl.value
      ? await runCurrentUserLinkedInEnrichmentFromUrl(linkedinUrl.value)
      : await runCurrentUserLinkedInEnrichment();
    const status = responseStatusForResult(result);
    return Response.json(result, { status });
  } catch (error) {
    console.error("[linkedin-enrichment] current-user enrichment failed", error);
    return Response.json(
      { error: "LinkedIn enrichment failed." },
      { status: 500 },
    );
  }
}

function responseStatusForResult(result: { status?: string }) {
  if (result.status === "signed_out") return 401;
  if (result.status === "invalid_url") return 400;
  return 200;
}

type LinkedInUrlReadResult =
  | { status: "ok"; value: string | null }
  | { status: "invalid_json" };

async function readLinkedInUrl(request: Request): Promise<LinkedInUrlReadResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { status: "ok", value: null };
  }

  const text = await request.text();
  if (!text.trim()) {
    return { status: "ok", value: null };
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { status: "invalid_json" };
  }

  const value =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).linkedinUrl
      : null;

  return {
    status: "ok",
    value: typeof value === "string" && value.trim().length > 0 ? value.trim() : null,
  };
}
