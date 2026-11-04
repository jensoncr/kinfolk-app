import type { ApartmentListing } from "./types";

export type RoommatePreviewMember =
  ApartmentListing["formingGroups"][number]["members"][number];

export function uniqueRoommatePreviewMembers(
  formingGroups: ApartmentListing["formingGroups"],
  limit: number,
): RoommatePreviewMember[] {
  const members: RoommatePreviewMember[] = [];
  const seen = new Set<string>();

  for (const group of formingGroups) {
    for (const member of group.members) {
      if (seen.has(member.name)) continue;
      seen.add(member.name);
      members.push(member);
      if (members.length >= limit) {
        return members;
      }
    }
  }

  return members;
}
