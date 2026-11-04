import { NextRequest } from "next/server";
import { z } from "zod";
import { setChatRoomNotificationsForCurrentUser } from "@/lib/chat/store";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

type Context = { params: Promise<{ roomId: string }> };

const bodySchema = z.object(
  { enabled: z.boolean({ message: "Expected an on/off value." }) },
  { message: "Request body must be an object." },
);

export async function POST(request: NextRequest, { params }: Context) {
  const { roomId } = await params;

  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await setChatRoomNotificationsForCurrentUser(roomId, parsed.data.enabled);
    return Response.json(result);
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to update notifications.",
      logMessage: "[chats] notification update failed",
      context: { roomId },
    });
  }
}
