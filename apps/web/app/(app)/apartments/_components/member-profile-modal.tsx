"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  RoommateGroupMember,
  RoommateGroupMemberColor,
} from "@/lib/apartments/types";
import {
  formatRoommateEducation,
  formatRoommateWork,
  profileInitials,
} from "@/lib/apartments/roommate-profile";

const COLOR_CLASS: Record<RoommateGroupMemberColor, string> = {
  forest: "bg-[var(--forest-700)] text-white",
  mint: "bg-[var(--mint-400)] text-[var(--forest-900)]",
  warm: "bg-[var(--ochre)] text-white",
  rust: "bg-[var(--rust)] text-white",
  sage: "bg-[var(--sage)] text-white",
};

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

type Props = {
  // The other members of the group, in display order — paged through here.
  members: RoommateGroupMember[];
  index: number;
  tagFor: (member: RoommateGroupMember) => string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

function LifeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium text-[var(--ink-400)]">{label}</span>
      <span className="mt-0.5 text-[12.5px] text-[var(--ink-800)]">{value}</span>
    </div>
  );
}

function ProfileSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-4 border-t border-[var(--border)] pt-3.5">
      <p className="mb-2 text-[11.5px] font-semibold text-[var(--ink-600)]">{label}</p>
      {children}
    </section>
  );
}

// Company/school logo from enrichment, falling back to a monogram when there's
// no logo URL or the image fails to load.
function CredentialBadge({
  badgeLabel,
  logoUrl,
}: {
  badgeLabel: string;
  logoUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(logoUrl) && !failed;

  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-1 mono text-[10px] font-bold text-[var(--ink-500)]">
      {showLogo && logoUrl ? (
        <Image
          src={logoUrl}
          alt=""
          width={28}
          height={28}
          unoptimized
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        profileInitials(badgeLabel)
      )}
    </span>
  );
}

function CredentialRow({
  badgeLabel,
  logoUrl,
  primary,
  secondary,
}: {
  badgeLabel: string;
  logoUrl?: string | null;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <CredentialBadge badgeLabel={badgeLabel} logoUrl={logoUrl} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13px] font-medium leading-[1.35] text-[var(--ink-900)]">
          {primary}
        </p>
        {secondary ? (
          <p className="m-0 mt-0.5 truncate text-[12px] text-[var(--ink-500)]">
            {secondary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function MemberProfileModal({
  members,
  index,
  tagFor,
  onIndexChange,
  onClose,
}: Props) {
  const member = members[index];
  const hasPrev = index > 0;
  const hasNext = index < members.length - 1;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowLeft" && index > 0) {
        onIndexChange(index - 1);
      } else if (event.key === "ArrowRight" && index < members.length - 1) {
        onIndexChange(index + 1);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, members.length, onClose, onIndexChange]);

  if (typeof document === "undefined" || !member) return null;

  const tag = tagFor(member);
  const workLine = formatRoommateWork(member);
  const education = formatRoommateEducation(member);

  return createPortal(
    <dialog
      open
      aria-modal="true"
      aria-label={`${member.name}'s profile`}
      className="fixed inset-0 z-[80] m-0 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-transparent p-0 px-4 py-6"
    >
      <button
        type="button"
        aria-label="Close profile"
        onClick={onClose}
        className="absolute inset-0 -z-10 bg-[rgba(14,31,23,0.5)] backdrop-blur-[5px]"
      />
      <div className="relative flex max-h-[86vh] w-full max-w-[380px] flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-white text-[var(--ink-900)] shadow-[0_40px_120px_-30px_rgba(8,18,12,0.65)]">
        <div className="relative aspect-square w-full shrink-0 bg-[var(--bg-soft)]">
          {member.imageUrl ? (
            <Image
              src={member.imageUrl}
              alt={member.name}
              fill
              sizes="380px"
              className="object-cover object-top"
            />
          ) : (
            <span
              className={[
                "grid h-full w-full place-items-center serif text-4xl font-semibold",
                COLOR_CLASS[member.color],
              ].join(" ")}
            >
              {member.initials}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="kin-focus absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-white/92 text-[var(--ink-700)] shadow-sm transition hover:bg-white"
          >
            <X size={13} aria-hidden="true" />
          </button>
          {members.length > 1 ? (
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {members.map((m, i) => (
                <span
                  key={m.name}
                  aria-hidden="true"
                  className={[
                    "h-1.5 rounded-full transition-all",
                    i === index ? "w-4 bg-white" : "w-1.5 bg-white/55",
                  ].join(" ")}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="serif text-xl font-semibold leading-tight">{member.name}</p>
          {workLine ? (
            <p className="mt-0.5 text-[12.5px] text-[var(--ink-500)]">{workLine}</p>
          ) : null}

          <p className="mt-1.5 text-[12px] text-[var(--ink-600)]">
            {typeof member.matchScore === "number" ? (
              <>
                <span className="font-semibold text-[var(--ink-900)]">
                  Fit {member.matchScore}
                </span>
                {" · "}
              </>
            ) : null}
            {tag}
          </p>

          {member.about ? (
            <p className="mt-3.5 text-[13px] leading-relaxed text-[var(--ink-700)]">
              “{member.about}”
            </p>
          ) : null}

          {workLine ? (
            <ProfileSection label="Work">
              <CredentialRow
                badgeLabel={member.occupationCompany || member.occupationTitle || workLine}
                logoUrl={member.occupationCompanyLogoUrl}
                primary={workLine}
              />
            </ProfileSection>
          ) : null}

          {education ? (
            <ProfileSection label="Education">
              <CredentialRow
                badgeLabel={education.school || education.detail}
                logoUrl={member.educationSchoolLogoUrl}
                primary={education.school || education.detail}
                secondary={education.detail || undefined}
              />
            </ProfileSection>
          ) : null}

          {member.lifestyle ? (
            <ProfileSection label="Living rhythm">
              <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5">
                <LifeItem label="Sleep" value={member.lifestyle.sleep} />
                <LifeItem label="Kitchen" value={member.lifestyle.kitchen} />
                <LifeItem label="Hosting" value={member.lifestyle.hosting} />
                <LifeItem label="Tidiness" value={member.lifestyle.tidiness} />
              </div>
            </ProfileSection>
          ) : null}

          {member.interests && member.interests.length > 0 ? (
            <ProfileSection label="Interests">
              <div className="flex flex-wrap gap-1.5">
                {member.interests.map((interest) => (
                  <span
                    key={interest}
                    className="rounded-md bg-[var(--bg-soft)] px-2 py-0.5 text-[10.5px] font-medium capitalize text-[var(--ink-600)]"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            </ProfileSection>
          ) : null}
        </div>

        {members.length > 1 ? (
          <footer className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
            <button
              type="button"
              onClick={() => hasPrev && onIndexChange(index - 1)}
              disabled={!hasPrev}
              className="kin-focus inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--ink-600)] transition hover:bg-[var(--bg-soft)] disabled:invisible"
            >
              <ChevronLeft size={13} aria-hidden="true" />
              {hasPrev ? firstName(members[index - 1]!.name) : ""}
            </button>
            <span className="text-[11px] text-[var(--ink-400)]">
              {index + 1} of {members.length}
            </span>
            <button
              type="button"
              onClick={() => hasNext && onIndexChange(index + 1)}
              disabled={!hasNext}
              className="kin-focus inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--ink-600)] transition hover:bg-[var(--bg-soft)] disabled:invisible"
            >
              {hasNext ? firstName(members[index + 1]!.name) : ""}
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          </footer>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
