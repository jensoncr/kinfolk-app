import { ChatsShell } from "@/app/(app)/chats/_components/chats-shell";
import { getChatRoomsForCurrentUser } from "@/lib/chat/store";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";

export const metadata = {
  title: "Chats",
};

export default async function ChatsPage() {
  const [snapshot, rooms] = await Promise.all([
    getDashboardSnapshot(),
    getChatRoomsForCurrentUser(),
  ]);

  return <ChatsShell snapshot={snapshot} rooms={rooms} />;
}
