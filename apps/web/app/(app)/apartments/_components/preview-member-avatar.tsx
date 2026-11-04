"use client";

import Image from "next/image";
import type { RoommatePreviewMember } from "@/lib/apartments/roommate-group-preview";

type Props = {
  member: RoommatePreviewMember;
  ringClass?: string;
};

export function PreviewMemberAvatar({ member, ringClass = "ring-white" }: Props) {
  const baseClass = [
    "relative -ml-1.5 grid size-5 place-items-center overflow-hidden rounded-full bg-[var(--forest-700)] text-[8px] font-bold text-white ring-2 first:ml-0",
    ringClass,
  ].join(" ");
  if (member.imageUrl) {
    return (
      <span className={baseClass} title={member.name}>
        <Image
          src={member.imageUrl}
          alt=""
          fill
          sizes="20px"
          className="object-cover"
        />
      </span>
    );
  }

  return (
    <span className={baseClass} title={member.name}>
      {member.initials}
    </span>
  );
}
