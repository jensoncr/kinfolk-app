"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, Ref } from "react";
import {
  ChevronRight,
  ExternalLink,
  Link2,
  ShieldCheck,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { SignOutRow } from "@/app/(app)/me/_components/sign-out-row";
import { ConnectedAccountsModal } from "@/app/(app)/me/_components/settings/connected-accounts-modal";
import { PrivacyModal } from "@/app/(app)/me/_components/settings/privacy-modal";
import { ProfileSettingsModal } from "@/app/(app)/me/_components/settings/profile-settings-modal";
import { getMemoriesMeta } from "@/app/(app)/me/_components/settings-page-state";
import type { DashboardSnapshot, ProfileEnrichmentSnapshot } from "@/lib/shared/types";

type RowProps = {
  icon: LucideIcon;
  label: string;
  meta?: string;
  trailing?: "chevron" | "external";
};
type RowButtonProps = RowProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    ref?: Ref<HTMLButtonElement>;
  };

export function SettingsPane({
  snapshot,
  enrichment,
}: {
  snapshot: DashboardSnapshot;
  enrichment: ProfileEnrichmentSnapshot;
}) {
  const memoriesMeta = getMemoriesMeta(enrichment);
  const linkedinConnected = snapshot.user.linkedinConnected;

  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-[640px] space-y-4">
        <RowGroup>
          <ProfileSettingsModal
            snapshot={snapshot}
            trigger={
              <RowButton icon={UserRound} label="Profile settings" />
            }
          />
          <RowLink
            href="/me/settings/memories"
            icon={Sparkles}
            label="Memories"
            meta={memoriesMeta}
          />
          <PrivacyModal
            trigger={
              <RowButton
                icon={ShieldCheck}
                label="Privacy"
                meta={
                  snapshot.profile.visibilityMode === "public"
                    ? "Public"
                    : "Anonymous until matched"
                }
              />
            }
            visibilityMode={snapshot.profile.visibilityMode}
          />
        </RowGroup>

        <RowGroup>
          <ConnectedAccountsModal
            trigger={
              <RowButton
                icon={Link2}
                label="Connected accounts"
                meta={linkedinConnected ? "LinkedIn" : "Not connected"}
              />
            }
          />
        </RowGroup>

        <RowGroup tone="quiet">
          <SignOutRow />
        </RowGroup>
      </div>
    </section>
  );
}

function RowGroup({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "quiet";
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-[var(--pp-hairline)] ${
        tone === "quiet" ? "bg-transparent" : "bg-white"
      } divide-y divide-[var(--pp-hairline-soft)]`}
    >
      {children}
    </div>
  );
}

function RowButton({ icon, label, meta, className = "", ref, ...rest }: RowButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={`kin-focus group flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-[rgba(28,51,38,0.025)] ${className}`}
      {...rest}
    >
      <RowInner icon={icon} label={label} meta={meta} trailing="chevron" />
    </button>
  );
}

function RowLink({
  href,
  icon,
  label,
  meta,
  external = false,
}: RowProps & { href: string; external?: boolean }) {
  return (
    <Link
      className="kin-focus group flex items-center gap-4 px-4 py-3.5 text-left transition hover:bg-[rgba(28,51,38,0.025)]"
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer noopener" : undefined}
    >
      <RowInner
        icon={icon}
        label={label}
        meta={meta}
        trailing={external ? "external" : "chevron"}
      />
    </Link>
  );
}

function RowInner({
  icon: Icon,
  label,
  meta,
  trailing = "chevron",
}: RowProps) {
  const TrailingIcon = trailing === "external" ? ExternalLink : ChevronRight;
  return (
    <>
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--pp-canvas-soft)] text-[var(--pp-ink-80)]"
      >
        <Icon size={16} strokeWidth={1.7} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
        <span className="truncate text-[14px] font-medium text-[var(--pp-ink)]">{label}</span>
        {meta ? (
          <span className="mt-0.5 truncate text-[12px] text-[var(--pp-ink-40)] sm:ml-auto sm:mt-0 sm:shrink-0">
            {meta}
          </span>
        ) : null}
      </span>
      <TrailingIcon
        aria-hidden
        className="shrink-0 text-[var(--pp-ink-30)] transition-transform group-hover:translate-x-0.5"
        size={14}
      />
    </>
  );
}
