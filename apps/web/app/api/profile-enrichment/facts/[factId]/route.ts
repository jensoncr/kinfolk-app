import { NextRequest } from "next/server";
import { updateProfileFactMutationForCurrentUser } from "@/lib/profiles/enrichment-store";
import type { ProfileFactReviewState } from "@/lib/profiles/enrichment";
import { rejectSignedOutProfileEnrichmentMutation } from "../../auth";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ factId: string }>;
};

export async function PATCH(request: NextRequest, { params }: Context) {
  const signedOut = await rejectSignedOutProfileEnrichmentMutation(
    "Sign in before editing profile facts.",
  );
  if (signedOut) return signedOut;

  const { factId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { error: "Request body must include a fact update." },
      { status: 400 },
    );
  }

  const source = body as Record<string, unknown>;
  const reviewState = readReviewState(source.reviewState);
  const hasFactUpdate =
    reviewState !== undefined ||
    Object.prototype.hasOwnProperty.call(source, "value") ||
    typeof source.reviewNote === "string";

  if (!hasFactUpdate) {
    return Response.json(
      { error: "Request body must include a fact update." },
      { status: 400 },
    );
  }

  if (
    reviewState === "edited" &&
    typeof source.value === "string" &&
    source.value.trim().length === 0
  ) {
    return Response.json({ error: "Fact value cannot be blank." }, { status: 400 });
  }

  try {
    const { snapshot } = await updateProfileFactMutationForCurrentUser(
      factId,
      {
        reviewState,
        value: source.value,
        reviewNote: typeof source.reviewNote === "string" ? source.reviewNote : undefined,
      },
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
    return Response.json({ snapshot });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Profile fact update failed.",
      logMessage: "[profile-enrichment] fact update failed",
    });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const signedOut = await rejectSignedOutProfileEnrichmentMutation(
    "Sign in before editing profile facts.",
  );
  if (signedOut) return signedOut;

  const { factId } = await params;

  try {
    const { snapshot } = await updateProfileFactMutationForCurrentUser(
      factId,
      { reviewState: "deleted" },
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
    return Response.json({ snapshot });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Profile fact delete failed.",
      logMessage: "[profile-enrichment] fact delete failed",
    });
  }
}

function readReviewState(value: unknown): ProfileFactReviewState | undefined {
  if (
    typeof value === "string" &&
    ["pending", "approved", "edited", "rejected", "deleted", "revoked"].includes(value)
  ) {
    return value as ProfileFactReviewState;
  }
  return undefined;
}
