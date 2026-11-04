import Image from "next/image";
import Link from "next/link";
import {
  ChevronRight,
  Home,
  MapPin,
  MessageCircle,
  Settings as SettingsIcon,
  UserRound,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { LinkedInAuthGate } from "./linkedin-auth-gate";
import { Avatar } from "@/components/ui/avatar";
import type { DashboardSnapshot } from "@/lib/shared/types";

export type ActiveSection =
  | "hub"
  | "profile"
  | "matches"
  | "chats"
  | "plan"
  | "memories"
  | "settings";

export function DashboardChrome({
  active,
  children,
  containerClassName = "mx-auto w-full max-w-[1200px] px-5 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-8",
  snapshot,
}: {
  active: ActiveSection;
  children: React.ReactNode;
  containerClassName?: string;
  snapshot: DashboardSnapshot;
}) {
  if (!snapshot.user.externalAuthConnected) {
    return <LinkedInAuthGate />;
  }

  const firstName = snapshot.user.displayName.split(" ")[0] ?? "there";
  const initials = getInitials(snapshot.user.displayName);

  return (
    <main className="kin-dotted-bg min-h-screen text-[#0f1a14]">
      <div className={containerClassName}>
        <MobileTopBar snapshot={snapshot} initials={initials} active={active} />
        <div className="grid w-full gap-6 lg:grid-cols-[300px_1fr] lg:gap-10">
          <Sidebar snapshot={snapshot} firstName={firstName} initials={initials} active={active} />
          {children}
        </div>
      </div>
    </main>
  );
}

export function PaneShell({
  active,
  children,
  eyebrow,
  lede,
  snapshot,
  title,
}: {
  active: ActiveSection;
  children: React.ReactNode;
  eyebrow?: string;
  lede?: string;
  snapshot: DashboardSnapshot;
  title: string;
}) {
  return (
    <DashboardChrome
      active={active}
      containerClassName="mx-auto w-full max-w-[1200px] px-5 pb-24 pt-4 lg:px-8 lg:pt-12"
      snapshot={snapshot}
    >
      <div className="profile-pane overflow-hidden rounded-2xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] lg:rounded-3xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--pp-hairline)] px-6 pb-5 pt-7 sm:px-10 sm:pb-6 sm:pt-9">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="pp-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--pp-ink-40)]">
                {eyebrow}
              </p>
            ) : null}
            <h1
              className={`pp-serif text-[36px] leading-[1.05] tracking-[-0.02em] text-[var(--pp-ink)] sm:text-[44px] ${
                eyebrow ? "mt-2" : ""
              }`}
            >
              {title}
            </h1>
            {lede ? (
              <p className="mt-2.5 max-w-[58ch] text-[14px] leading-[1.55] text-[var(--pp-ink-60)]">
                {lede}
              </p>
            ) : null}
          </div>
          <Link
            aria-label="Back to hub"
            className="kin-focus -mr-1 -mt-1 inline-grid size-9 shrink-0 place-items-center rounded-full text-[var(--pp-ink-40)] transition hover:bg-[rgba(28,51,38,0.05)] hover:text-[var(--pp-ink-80)]"
            href="/me"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.6} />
          </Link>
        </header>

        <div className="px-6 py-7 sm:px-10 sm:py-9">{children}</div>
      </div>
    </DashboardChrome>
  );
}

function MobileTopBar({
  snapshot,
  initials,
  active,
}: {
  snapshot: DashboardSnapshot;
  initials: string;
  active: ActiveSection;
}) {
  return (
    <header className="mb-5 flex items-center justify-between gap-3 lg:hidden">
      <Link
        href="/me"
        className="kin-focus flex items-center gap-2 rounded-full p-1"
        aria-label="Kinfolk home"
      >
        <Image
          alt=""
          aria-hidden="true"
          className="size-8 shrink-0"
          height={32}
          src="/assets/kinfolk-logo-mark.png"
          width={32}
        />
        <span className="serif text-[18px] leading-none text-[#0f1a14]">Kinfolk</span>
      </Link>
      <nav className="flex items-center gap-2">
        <Link
          href="/chats"
          aria-current={active === "chats" ? "page" : undefined}
          className={`kin-focus grid size-10 place-items-center rounded-full border transition ${
            active === "chats"
              ? "border-[rgba(28,51,38,0.18)] bg-[rgba(28,51,38,0.06)] text-[#0f1a14]"
              : "border-[rgba(28,51,38,0.1)] bg-white text-[#1f2a23] hover:bg-[rgba(28,51,38,0.04)]"
          }`}
          aria-label="Chats"
        >
          <MessageCircle size={17} strokeWidth={1.7} aria-hidden="true" />
        </Link>
        <Link
          href="/apartments"
          className="kin-focus grid size-10 place-items-center rounded-full border border-[rgba(28,51,38,0.1)] bg-white text-[#1f2a23] transition hover:bg-[rgba(28,51,38,0.04)]"
          aria-label="Apartments"
        >
          <UsersRound size={17} strokeWidth={1.7} aria-hidden="true" />
        </Link>
        <Link
          href="/me/settings"
          aria-current={active === "settings" || active === "memories" ? "page" : undefined}
          className={`kin-focus grid size-10 place-items-center rounded-full border transition ${
            active === "settings" || active === "memories"
              ? "border-[rgba(28,51,38,0.18)] bg-[rgba(28,51,38,0.06)] text-[#0f1a14]"
              : "border-[rgba(28,51,38,0.1)] bg-white text-[#1f2a23] hover:bg-[rgba(28,51,38,0.04)]"
          }`}
          aria-label="Settings"
        >
          <SettingsIcon size={17} strokeWidth={1.7} aria-hidden="true" />
        </Link>
        <Link
          href="/me/profile"
          aria-current={active === "profile" ? "page" : undefined}
          className="kin-focus shrink-0 rounded-full"
          aria-label="Profile"
        >
          <Avatar
            imageUrl={snapshot.user.avatarUrl}
            initials={initials}
            seed={snapshot.user.email}
            size={40}
            className="text-sm tracking-wide"
          />
        </Link>
      </nav>
    </header>
  );
}

function Sidebar({
  snapshot,
  firstName,
  initials,
  active,
}: {
  snapshot: DashboardSnapshot;
  firstName: string;
  initials: string;
  active: ActiveSection;
}) {
  return (
    <aside className="hidden flex-col gap-3 lg:sticky lg:top-8 lg:flex lg:self-start">
      <Link
        className="kin-focus flex items-center gap-3 rounded-2xl px-1 py-1.5 transition hover:bg-[rgba(28,51,38,0.04)]"
        href="/me"
      >
        <Avatar
          imageUrl={snapshot.user.avatarUrl}
          initials={initials}
          seed={snapshot.user.email}
          size={48}
          className="text-sm tracking-wide"
        />
        <span className="min-w-0">
          <span className="serif block text-[20px] leading-tight tracking-[-0.01em] text-[#0f1a14]">
            Hey {firstName}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-5 text-[#6b7a70]">your rent hub</span>
        </span>
      </Link>

      <nav className="mt-3 flex flex-col gap-0.5">
        <SidebarLink href="/me/profile" icon={UserRound} label="Profile" active={active === "profile"} />
        <SidebarLink href="/me/matches" icon={Home} label="Matches" active={active === "matches"} />
        <SidebarLink href="/chats" icon={MessageCircle} label="Chats" active={active === "chats"} />
        <SidebarLink href="/apartments" icon={UsersRound} label="Apartments" />
        <SidebarLink href="/me/plan" icon={MapPin} label="Plan" active={active === "plan"} badge="Beta" />
        <SidebarLink
          href="/me/settings"
          icon={SettingsIcon}
          label="Settings"
          active={active === "settings" || active === "memories"}
        />
      </nav>

      <Link
        href="/me/plan"
        className="kin-focus group mt-4 flex items-center gap-3 rounded-2xl border border-[rgba(28,51,38,0.08)] bg-[#fdfcf8] px-4 py-3.5 text-left transition hover:border-[rgba(28,51,38,0.18)]"
      >
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[#eef2eb] text-[#264a36]"
        >
          <Users size={16} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold leading-tight text-[#15251b]">
            Invite roommates
          </span>
          <span className="mt-0.5 block text-[12px] leading-5 text-[#6b7a70]">
            They&rsquo;ll see what you see.
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="shrink-0 text-[#b6bdb7] transition-transform group-hover:translate-x-0.5"
          size={14}
        />
      </Link>

      <Link
        href="/"
        className="kin-focus mt-1.5 flex items-center gap-3 rounded-2xl border border-[rgba(28,51,38,0.08)] bg-[#fdfcf8] px-3.5 py-3 transition hover:border-[rgba(28,51,38,0.18)]"
        aria-label="Kinfolk - your rent agent"
      >
        <Image
          alt=""
          className="size-9 shrink-0"
          height={36}
          src="/assets/kinfolk-logo-mark.png"
          width={36}
        />
        <span className="min-w-0">
          <span className="serif block text-[15px] leading-tight text-[#0f1a14]">Kinfolk</span>
          <span className="mt-0.5 block text-[12px] leading-5 text-[#6b7a70]">
            your rent agent
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="ml-auto text-[#b6bdb7]" size={14} />
      </Link>
    </aside>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  label,
  active = false,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: string;
}) {
  return (
    <Link
      className={`kin-focus group flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[14px] transition hover:bg-[rgba(28,51,38,0.04)] ${
        active ? "bg-[rgba(28,51,38,0.06)] font-semibold text-[#0f1a14]" : "text-[#1f2a23]"
      }`}
      href={href}
    >
      <span className="flex items-center gap-3">
        <Icon aria-hidden="true" size={16} strokeWidth={1.7} className="text-[#3a4a40]" />
        <span>{label}</span>
        {badge ? (
          <span className="inline-flex items-center rounded-full border border-transparent bg-[rgba(176,120,38,0.12)] px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-[#946012]">
            {badge}
          </span>
        ) : null}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="text-[#c7cdc7] transition-transform group-hover:translate-x-0.5"
        size={14}
      />
    </Link>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "K";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
