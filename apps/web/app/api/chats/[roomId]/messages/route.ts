import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getChatRoomForCurrentUser,
  sendChatMessageForUser,
} from "@/lib/chat/store";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ roomId: string }> };

const bodySchema = z.object(
  { body: z.string({ message: "Write a message first." }) },
  { message: "Request body must be an object." },
);

export async function GET(_request: Request, { params }: Context) {
  const { roomId } = await params;
  try {
    const room = await getChatRoomForCurrentUser(roomId);
    if (!room) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ room });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to load this chat.",
      logMessage: "[chats] room load failed",
      context: { roomId },
    });
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const { roomId } = await params;

  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before sending a message." },
      { status: 401 },
    );
  }

  // Message sends can fan out iMessage notifications, so throttle per user.
  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "chat_message",
    limit: 60,
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
    // The user is already resolved above (for the rate limit); going through
    // sendChatMessageForCurrentUser would re-run the Clerk fetch + upsert.
    const message = await sendChatMessageForUser(
      createSupabaseServiceClient(),
      user.id,
      roomId,
      parsed.data.body,
    );
    return Response.json({ message });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to send your message.",
      logMessage: "[chats] message send failed",
      context: { roomId },
    });
  }
}
