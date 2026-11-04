import Link from "next/link";
import { Building2, Check, ChevronRight, Home, MessageCircle, UserRound } from "lucide-react";
import { ContinueOnPhone } from "./continue-on-phone";
import { ConversationWelcomeModal } from "./conversation-welcome-modal";
import { DashboardChrome } from "./dashboard-layout";
import { EnrichProfileWithAI } from "./enrich-profile-with-ai";
import { EnrichWelcomeModal } from "./enrich-welcome-modal";
import { getContinueOnPhoneConfig } from "@/lib/integrations/continue-on-phone-server";
import {
  getProfileSetupProgress,
  readProfileSetupState,
  type ProfileSetupTask,
} from "@/lib/profiles/completion";
import type {
  DashboardSnapshot,
  ProfileEnrichmentSnapshot,
} from "@/lib/shared/types";

type AssistantMemoryState = {
  hasAssistantImport: boolean;
  pendingFactCount: number;
};

const assistantMemoryProviders = new Set(["chatgpt", "claude"]);

export async function DashboardShell({
  enrichment,
  snapshot,
}: {
  enrichment: ProfileEnrichmentSnapshot;
  snapshot: DashboardSnapshot;
}) {
  const firstName = snapshot.user.displayName.trim().split(/\s+/)[0] || "there";
  const queueCount = snapshot.queue.length;
  const setupProgress = getProfileSetupProgress(readProfileSetupState(snapshot));
  const continueOnPhoneConfig = getContinueOnPhoneConfig();

  return (
    <DashboardChrome
      active="hub"
      containerClassName="mx-auto w-full max-w-[1200px] px-5 pb-8 pt-4 lg:px-8 lg:pb-10 lg:pt-8"
      snapshot={snapshot}
    >
      <HubMain
        assistantMemoryState={getAssistantMemoryState(enrichment)}
        firstName={firstName}
        profileImports={enrichment.imports}
        queueCount={queueCount}
        profileCompleted={setupProgress.completed}
        profileHref={setupProgress.nextTask?.href ?? "/me/profile"}
        profilePct={setupProgress.percent}
        profileTasks={setupProgress.tasks}
        profileTotal={setupProgress.total}
        continueOnPhoneConfig={continueOnPhoneConfig}
      />
    </DashboardChrome>
  );
}

function HubMain({
  assistantMemoryState,
  firstName,
  profileImports,
  queueCount,
  profileCompleted,
  profileHref,
  profileTotal,
  profilePct,
  profileTasks,
  continueOnPhoneConfig,
}: {
  assistantMemoryState: AssistantMemoryState;
  firstName: string;
  profileImports: ProfileEnrichmentSnapshot["imports"];
  queueCount: number;
  profileCompleted: number;
  profileHref: string;
  profileTotal: number;
  profilePct: number;
  profileTasks: ProfileSetupTask[];
  continueOnPhoneConfig: Awaited<ReturnType<typeof getContinueOnPhoneConfig>>;
}) {
  const profileComplete = profileTotal > 0 && profileCompleted >= profileTotal;
  const requiredTasks = profileTasks.filter((task) => !task.optional);
  const shouldPromptForAssistantMemories =
    !profileComplete &&
    (!assistantMemoryState.hasAssistantImport || assistantMemoryState.pendingFactCount > 0);

  // The setup receipt owns the "finish setup" message, so the matches card
  // stays neutral while the profile is incomplete instead of nagging twice.
  const profileCard = (
    <HubCard
      href="/me/profile"
      icon={UserRound}
      headline={profileComplete ? "Profile ready" : "Your profile"}
      subtitle={profileComplete ? "View and edit your details" : "Add photos, work, and more"}
    />
  );
  const matchesCard = (
    <HubCard
      href="/me/matches"
      icon={Home}
      eyebrow={queueCount > 0 ? `${queueCount} ready` : undefined}
      headline={queueCount > 0 ? "Matches" : "Finding matches"}
      subtitle={
        queueCount > 0
          ? "Groups + apartments your agent is reviewing"
          : "Your agent is reviewing listings now"
      }
    />
  );
  const apartmentsCard = (
    <HubCard
      href="/apartments"
      icon={Building2}
      headline="Apartments"
      subtitle="Places your group could take"
    />
  );
  const chatsCard = (
    <HubCard
      href="/chats"
      icon={MessageCircle}
      headline="Chats"
      subtitle="Your matches and group rooms"
    />
  );

  return (
    <section className="flex w-full flex-col">
      <h1 className="serif text-4xl leading-[1] tracking-[-0.02em] text-[#0f1a14] sm:text-[52px]">
        Hey {firstName}
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-[#6b7a70] sm:text-[16px]">
        {profileComplete
          ? "your hub at a glance."
          : queueCount > 0
            ? "keep texting your agent to sharpen your matches."
            : "your agent is setting up your search."}
      </p>

      <ConversationWelcomeModal
        config={continueOnPhoneConfig}
        enabled={!profileComplete && !shouldPromptForAssistantMemories}
        firstName={firstName}
        profileHref={profileHref}
      />
      <EnrichWelcomeModal
        enabled={shouldPromptForAssistantMemories}
        hasAssistantImport={assistantMemoryState.hasAssistantImport}
        imports={profileImports}
        pendingFactCount={assistantMemoryState.pendingFactCount}
        profileHref={profileHref}
      />

      {!profileComplete ? (
        <>
          <SetupReceipt
            completed={profileCompleted}
            percent={profilePct}
            tasks={requiredTasks}
            total={profileTotal}
          />
          <div className="mt-4">
            <ContinueOnPhone config={continueOnPhoneConfig} />
            <EnrichProfileWithAI imports={profileImports} />
          </div>
        </>
      ) : (
        <div className="mt-6">
          <ContinueOnPhone config={continueOnPhoneConfig} />
          <EnrichProfileWithAI imports={profileImports} />
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 sm:gap-4">
        {profileCard}
        {matchesCard}
        {chatsCard}
        {apartmentsCard}
      </div>
    </section>
  );
}

function SetupReceipt({
  completed,
  percent,
  tasks,
  total,
}: {
  completed: number;
  percent: number;
  tasks: ProfileSetupTask[];
  total: number;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-[rgba(28,51,38,0.07)] bg-[#fdfcf8] px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13.5px] font-semibold text-[#15251b]">
          What your agent has so far
        </p>
        <p className="pp-mono text-[12px] tabular-nums text-[#6b7a70]">
          {completed} of {total}
        </p>
      </div>
      <progress
        aria-label="Profile setup progress"
        aria-valuetext={`${completed} of ${total} setup tasks complete`}
        className="sr-only"
        max={total}
        value={completed}
      >
        {completed} of {total} setup tasks complete
      </progress>
      <div
        aria-hidden="true"
        className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-[rgba(28,51,38,0.08)]"
      >
        <div
          aria-hidden="true"
          className="h-full rounded-full bg-[#264a36] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2.5">
        {tasks.map((task) => (
          <li key={task.key} className="flex items-center gap-2 text-[13px]">
            <span
              aria-hidden="true"
              className={`grid size-[18px] shrink-0 place-items-center rounded-full border transition ${
                task.isComplete
                  ? "border-transparent bg-[#264a36] text-white"
                  : "border-[rgba(28,51,38,0.22)] bg-transparent text-transparent"
              }`}
            >
              <Check size={11} strokeWidth={2.4} />
            </span>
            <span className={task.isComplete ? "text-[#15251b]" : "text-[#8a948c]"}>
              {task.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3.5 text-[12px] leading-5 text-[#9aa39d]">
        These fill in as you talk, no form to fill out.
      </p>
    </div>
  );
}

function HubCard({
  href,
  icon: Icon,
  eyebrow,
  headline,
  subtitle,
}: {
  href: string;
  icon: typeof Home;
  eyebrow?: string;
  headline: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="kin-focus group relative flex items-center gap-4 rounded-2xl border border-[rgba(28,51,38,0.07)] bg-[#fdfcf8] p-4 shadow-[0_1px_2px_rgba(28,51,38,0.03)] transition hover:border-[rgba(28,51,38,0.16)] hover:shadow-[0_10px_30px_-18px_rgba(14,31,23,0.25)] sm:h-[168px] sm:flex-col sm:items-stretch sm:justify-between sm:gap-0 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eef2eb] text-[#264a36]"
      >
        <Icon size={18} strokeWidth={1.8} />
      </span>

      <div className="min-w-0 flex-1 sm:flex-none">
        {eyebrow ? (
          <p className="mono text-[10.5px] uppercase tracking-[0.16em] text-[#264a36]">
            {eyebrow}
          </p>
        ) : null}
        <p className="serif text-[20px] leading-[1.1] tracking-[-0.01em] text-[#0f1a14] sm:mt-1 sm:text-[24px]">
          {headline}
        </p>
        <p className="mt-1 text-[12.5px] leading-5 text-[#6b7a70]">{subtitle}</p>
      </div>

      <ChevronRight
        aria-hidden="true"
        className="shrink-0 text-[#9aa39d] transition-transform group-hover:translate-x-0.5 sm:absolute sm:right-4 sm:top-5"
        size={16}
      />
    </Link>
  );
}

function getAssistantMemoryState(enrichment: ProfileEnrichmentSnapshot): AssistantMemoryState {
  const providerByImportId = new Map(
    enrichment.imports.map((item) => [item.id, item.provider.toLowerCase()]),
  );
  const assistantImportIds = new Set<string>();

  for (const item of enrichment.imports) {
    if (item.status !== "deleted" && assistantMemoryProviders.has(item.provider.toLowerCase())) {
      assistantImportIds.add(item.id);
    }
  }

  let pendingFactCount = 0;

  for (const fact of enrichment.facts) {
    const provider = providerByImportId.get(fact.importId);
    if (!provider || !assistantMemoryProviders.has(provider)) {
      continue;
    }

    if (fact.reviewState === "pending" && fact.sensitivityLevel === "standard") {
      pendingFactCount += 1;
    }
  }

  return {
    hasAssistantImport: assistantImportIds.size > 0,
    pendingFactCount,
  };
}
