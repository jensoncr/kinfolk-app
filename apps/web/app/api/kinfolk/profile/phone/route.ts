import { getKinfolkPhoneVerificationStatusForCurrentUser } from "@/lib/profiles/store";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { user } = await ensureCurrentKinfolkUser();
    if (!user) {
      return Response.json(
        { error: "Sign in before checking phone verification." },
        { status: 401 },
      );
    }

    const phone = await getKinfolkPhoneVerificationStatusForCurrentUser();
    return Response.json(phone);
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Phone verification check failed.",
      logMessage: "[profile] phone verification check failed",
    });
  }
}

export const POST = GET;
