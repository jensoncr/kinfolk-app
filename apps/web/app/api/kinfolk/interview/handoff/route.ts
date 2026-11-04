import { createInterviewOnPhoneHandoffForCurrentUser } from "@/lib/text-agent/store";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { user } = await ensureCurrentKinfolkUser();
    if (!user) {
      return Response.json(
        { error: "Sign in before creating interview handoff." },
        { status: 401 },
      );
    }

    const challenge = await createInterviewOnPhoneHandoffForCurrentUser();
    return Response.json({ challenge, ok: true });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Could not create interview handoff.",
      logMessage: "[phone-handoff] interview handoff failed",
    });
  }
}
