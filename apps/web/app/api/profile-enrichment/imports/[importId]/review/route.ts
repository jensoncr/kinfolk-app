import { NextRequest } from "next/server";
import { reviewProfileImportMutationForCurrentUser } from "@/lib/profiles/enrichment-store";
import { rejectSignedOutProfileEnrichmentMutation } from "../../../auth";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ importId: string }>;
};

export async function POST(request: NextRequest, { params }: Context) {
  const signedOut = await rejectSignedOutProfileEnrichmentMutation(
    "Sign in before reviewing profile imports.",
  );
  if (signedOut) return signedOut;

  const { importId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must include a review action." }, { status: 400 });
  }

  const source = body as Record<string, unknown>;
  const action = typeof source.action === "string" ? source.action : null;

  if (action !== "approve_all" && action !== "reject_all") {
    return Response.json({ error: "Unsupported review action." }, { status: 400 });
  }

  try {
    const { snapshot } = await reviewProfileImportMutationForCurrentUser(
      importId,
      action,
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
    return Response.json({ snapshot });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Profile import review failed.",
      logMessage: "[profile-enrichment] import review failed",
    });
  }
}
