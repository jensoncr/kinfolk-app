import { notFound } from "next/navigation";
import { ChatRoomShell } from "@/app/(app)/chats/_components/chat-room-shell";
import { getChatRoomForCurrentUser } from "@/lib/chat/store";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";

export const metadata = {
  title: "Chat",
};

type Props = { params: Promise<{ roomId: string }> };

export default async function ChatRoomPage({ params }: Props) {
  const { roomId } = await params;
  const [snapshot, room] = await Promise.all([
    getDashboardSnapshot(),
    getChatRoomForCurrentUser(roomId),
  ]);

  // Generic not-found for rooms the viewer isn't an active member of — never
  // confirm a private room's existence.
  if (!room) notFound();

  return <ChatRoomShell snapshot={snapshot} room={room} />;
}
