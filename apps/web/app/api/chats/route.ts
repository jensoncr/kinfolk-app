import { getChatRoomsForCurrentUser } from "@/lib/chat/store";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

export async function GET() {
  try {
    const snapshot = await getChatRoomsForCurrentUser();
    return Response.json(snapshot);
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to load your chats.",
      logMessage: "[chats] list failed",
    });
  }
}
