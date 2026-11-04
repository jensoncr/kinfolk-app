import type { RoommateGroupMember } from "@/lib/apartments/types";

type MemberKeyInput = Pick<
  RoommateGroupMember,
  "headline" | "imageUrl" | "initials" | "name" | "userId"
>;

export function roommateGroupMemberKey(member: MemberKeyInput) {
  const userId = member.userId?.trim();
  if (userId) return `user:${userId}`;

  return [
    "profile",
    member.name.trim().toLowerCase(),
    member.initials.trim().toLowerCase(),
    member.imageUrl?.trim() ?? "",
    member.headline?.trim().toLowerCase() ?? "",
  ].join(":");
}
