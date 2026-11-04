import { DashboardChrome } from "@/app/(app)/me/_components/dashboard-layout";
import type { DashboardSnapshot } from "@/lib/shared/types";
import type { ChatRoomsSnapshot } from "@/lib/chat/types";
import { ChatList } from "./chat-list";

export function ChatsShell({
  snapshot,
  rooms,
}: {
  snapshot: DashboardSnapshot;
  rooms: ChatRoomsSnapshot;
}) {
  return (
    <DashboardChrome active="chats" snapshot={snapshot}>
      <ChatList initial={rooms} />
    </DashboardChrome>
  );
}
