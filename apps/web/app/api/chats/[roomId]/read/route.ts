import { markChatRoomReadForCurrentUser } from "@/lib/chat/store";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

type Context = { params: Promise<{ roomId: string }> };

export async function POST(_request: Request, { params }: Context) {
  const { roomId } = await params;
  try {
    const result = await markChatRoomReadForCurrentUser(roomId);
    return Response.json(result);
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to update this chat.",
      logMessage: "[chats] read-state update failed",
      context: { roomId },
    });
  }
}
