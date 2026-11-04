import type { RoommateGroupMember } from "./types";

export function formatRoommateWork(member: RoommateGroupMember): string {
  const title = clean(member.occupationTitle);
  const company = clean(member.occupationCompany);

  if (title && company) return `${title} · ${company}`;
  if (title || company) return title || company;
  return clean(member.role);
}

export function formatRoommateEducation(
  member: RoommateGroupMember,
): { school: string; detail: string } | null {
  const school = clean(member.educationSchool);
  const degree = clean(member.educationDegree);
  const major = clean(member.educationMajor);
  const year = clean(member.educationYear);
  const degreeLine =
    degree && major ? `${degree} in ${major}` : degree || major;
  const detail = [degreeLine, year].filter(Boolean).join(" · ");

  if (!school && !detail) return null;
  return { school, detail };
}

export function profileInitials(value: string): string {
  const words = clean(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "-";
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (
    words[0]!.charAt(0) + words[words.length - 1]!.charAt(0)
  ).toUpperCase();
}

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
