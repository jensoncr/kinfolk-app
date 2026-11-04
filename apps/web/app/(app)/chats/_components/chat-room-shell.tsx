import { DashboardChrome } from "@/app/(app)/me/_components/dashboard-layout";
import type { DashboardSnapshot } from "@/lib/shared/types";
import type { ChatRoomDetail } from "@/lib/chat/types";
import { ChatRoom } from "./chat-room";

export function ChatRoomShell({
  snapshot,
  room,
}: {
  snapshot: DashboardSnapshot;
  room: ChatRoomDetail;
}) {
  return (
    <DashboardChrome
      active="chats"
      containerClassName="mx-auto w-full max-w-[1200px] px-5 pb-6 pt-4 lg:px-8 lg:pb-10 lg:pt-8"
      snapshot={snapshot}
    >
      <ChatRoom initial={room} />
    </DashboardChrome>
  );
}
