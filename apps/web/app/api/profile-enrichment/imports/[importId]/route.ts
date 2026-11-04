import { deleteProfileImportForCurrentUser } from "@/lib/profiles/enrichment-store";
import { rejectSignedOutProfileEnrichmentMutation } from "../../auth";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ importId: string }>;
};

export async function DELETE(_request: Request, { params }: Context) {
  const signedOut = await rejectSignedOutProfileEnrichmentMutation(
    "Sign in before deleting profile imports.",
  );
  if (signedOut) return signedOut;

  const { importId } = await params;

  try {
    const snapshot = await deleteProfileImportForCurrentUser(importId);
    return Response.json({ snapshot });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Profile import delete failed.",
      logMessage: "[profile-enrichment] import delete failed",
    });
  }
}
