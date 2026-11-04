import { NextRequest } from "next/server";
import { z } from "zod";
import { recordMatchIntentAndOpen } from "@/lib/chat/store";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

const bodySchema = z.object(
  {
    compatibilityEdgeId: z
      .string({ message: "Pick a match to message." })
      .trim()
      .min(1, "Pick a match to message."),
  },
  { message: "Request body must be an object." },
);

export async function POST(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before messaging matches." },
      { status: 401 },
    );
  }

  // Same bucket family as message sends: this path creates rooms and can
  // deliver stored intros, so it must not be free to hammer.
  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "chat_match_intent",
    limit: 20,
    window: "minute",
  });
  if (limited) {
    return limited;
  }

  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await recordMatchIntentAndOpen(parsed.data.compatibilityEdgeId);
    return Response.json(result);
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to open this chat.",
      logMessage: "[chats] match intent failed",
    });
  }
}
