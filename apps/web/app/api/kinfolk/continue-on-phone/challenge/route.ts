import { createContinueOnPhoneChallengeForCurrentUser } from "@/lib/text-agent/store";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { user } = await ensureCurrentKinfolkUser();
    if (!user) {
      return Response.json(
        { error: "Sign in before creating phone handoff." },
        { status: 401 },
      );
    }

    const challenge = await createContinueOnPhoneChallengeForCurrentUser();
    return Response.json({ challenge, ok: true });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Could not create phone handoff.",
      logMessage: "[phone-handoff] challenge creation failed",
    });
  }
}
