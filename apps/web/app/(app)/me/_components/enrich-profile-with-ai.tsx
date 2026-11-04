"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import {
  type AssistantProfileProvider,
} from "@/lib/profiles/enrichment-prompt";
import type { ProfileImportSummary } from "@/lib/shared/types";
import {
  ENRICH_PROVIDER_STYLE,
  getEnrichProviderRows,
} from "./enrich-profile-with-ai-state";
import { ImportMemoriesModal } from "./import-memories-modal";
import {
  type AssistantPromptCopyResult,
  copyAssistantProfilePrompt,
} from "./import-memories-modal-state";

const emptyImports: ProfileImportSummary[] = [];
const emptyHiddenProviders: AssistantProfileProvider[] = [];

export function EnrichProfileWithAI({
  imports = emptyImports,
  hiddenProviders = emptyHiddenProviders,
  onImport,
  previewAll = false,
  stacked = false,
}: {
  imports?: ProfileImportSummary[];
  hiddenProviders?: readonly AssistantProfileProvider[];
  // When set (e.g. the first-run welcome modal), the host owns the import modal
  // so it can outlive this component — we just hand back the clicked provider.
  // When unset, we open our own import modal in place.
  onImport?: (
    provider: AssistantProfileProvider,
    promptCopyResult: Promise<AssistantPromptCopyResult>,
  ) => void;
  // QA preview: always show every source in its fresh enrich state, ignoring
  // whatever has already been imported/reviewed.
  previewAll?: boolean;
  // Default is the joined side-by-side panel used on the hub. The welcome modal
  // asks for `stacked`: each provider on its own full-width line.
  stacked?: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<AssistantProfileProvider | null>(null);
  const [importProvider, setImportProvider] = useState<AssistantProfileProvider | null>(null);
  const [importPromptCopyResult, setImportPromptCopyResult] = useState<
    Promise<AssistantPromptCopyResult> | null
  >(null);

  // The anchor opens the assistant in a new tab; we copy the prompt for the
  // paste-in, then surface the import modal (here, or via the host) rather than
  // navigating this tab away.
  const launch = (provider: AssistantProfileProvider) => {
    const promptCopyResult = copyAssistantProfilePrompt(provider, navigator.clipboard);
    if (onImport) {
      onImport(provider, promptCopyResult);
      return;
    }
    void promptCopyResult.then((result) => {
      if (result.ok) {
        setCopied(provider);
      }
    });
    setImportPromptCopyResult(promptCopyResult);
    setImportProvider(provider);
  };

  const rowStates = getEnrichProviderRows({
    copiedProvider: copied,
    hiddenProviders,
    imports,
    previewAll,
  });

  // Everything imported and reviewed — no enrichment prompt to show.
  if (rowStates.length === 0) {
    return null;
  }

  // A lone remaining source spans the full line instead of half a split grid.
  const soloLayout = stacked || rowStates.length === 1;
  const containerClass = soloLayout
    ? "mt-3 flex flex-col gap-2.5"
    : "mt-3 grid grid-cols-1 overflow-hidden rounded-2xl shadow-[0_30px_60px_-40px_rgba(14,31,23,0.55)] sm:grid-cols-2";

  const rows = rowStates.map((row) => {
    const buttonClass = buttonClassFor(row.provider, soloLayout);
    const style = ENRICH_PROVIDER_STYLE[row.provider];
    return (
      <ProviderRow
        key={row.provider}
        buttonClass={buttonClass}
        checkColor={style.checkColor}
        chevronColor={style.chevronColor}
        copied={row.copied}
        href={row.href}
        label={row.label}
        logoClassName={style.logoClassName}
        logoSrc={style.logoSrc}
        mode={row.mode}
        onEnrich={row.mode === "enrich" ? () => launch(row.provider) : undefined}
        subtitle={row.subtitle}
        subtitleColor={style.subtitleColor}
      />
    );
  });

  return (
    <>
      <div className={containerClass}>{rows}</div>
      {/* The inline panel owns its own import modal. The welcome modal passes
          `onImport` instead and renders the modal itself, so it can swap the
          welcome card out cleanly without unmounting this in the process. */}
      {onImport ? null : (
        <ImportMemoriesModal
          key={importProvider ?? "closed"}
          open={importProvider !== null}
          initialProvider={importProvider ?? undefined}
          initialPromptCopyResult={importPromptCopyResult}
          onClose={() => {
            setImportPromptCopyResult(null);
            setImportProvider(null);
          }}
          onImported={() => router.refresh()}
        />
      )}
    </>
  );
}

function ProviderRow({
  buttonClass,
  checkColor,
  chevronColor,
  copied,
  href,
  label,
  logoClassName,
  logoSrc,
  mode,
  onEnrich,
  subtitle,
  subtitleColor,
}: {
  buttonClass: string;
  checkColor: string;
  chevronColor: string;
  copied: boolean;
  href: string;
  label: string;
  logoClassName: string;
  logoSrc: string;
  mode: "review" | "enrich";
  onEnrich?: () => void;
  subtitle: string;
  subtitleColor: string;
}) {
  const inner = (
    <>
      <Image alt="" aria-hidden="true" className={logoClassName} height={36} src={logoSrc} width={36} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight">{label}</span>
        <span className={`mt-0.5 block text-[12.5px] leading-5 ${subtitleColor}`}>{subtitle}</span>
      </span>
      {copied ? (
        <Check aria-hidden="true" className={`shrink-0 ${checkColor}`} size={16} />
      ) : (
        <ChevronRight
          aria-hidden="true"
          className={`shrink-0 ${chevronColor} transition-transform group-hover:translate-x-0.5`}
          size={16}
        />
      )}
    </>
  );

  // Review state navigates within the app; enrich opens the assistant in a new
  // tab (default anchor behavior) while onEnrich opens the import modal.
  if (mode === "review") {
    return (
      <Link className={buttonClass} href={href}>
        {inner}
      </Link>
    );
  }

  return (
    <a className={buttonClass} href={href} onClick={onEnrich} rel="noopener noreferrer" target="_blank">
      {inner}
    </a>
  );
}

function buttonClassFor(provider: AssistantProfileProvider, stacked: boolean) {
  if (provider === "claude") {
    return stacked
      ? "kin-focus group flex items-center gap-3 rounded-2xl bg-[#D97757] px-4 py-3.5 text-white shadow-[0_14px_32px_-20px_rgba(217,119,87,0.95)] transition hover:brightness-[0.96]"
      : "kin-focus group flex items-center gap-3 bg-[#D97757] px-4 py-3 text-white transition hover:brightness-[0.96]";
  }
  return stacked
    ? "kin-focus group flex items-center gap-3 rounded-2xl border border-[rgba(28,51,38,0.12)] bg-white px-4 py-3.5 text-[#0f1a14] shadow-[0_10px_28px_-20px_rgba(14,31,23,0.55)] transition hover:bg-[#f7f5ef]"
    : "kin-focus group flex items-center gap-3 border-t border-[rgba(28,51,38,0.08)] bg-white px-4 py-3 text-[#0f1a14] transition hover:bg-[#f7f5ef] sm:border-l sm:border-t-0";
}
