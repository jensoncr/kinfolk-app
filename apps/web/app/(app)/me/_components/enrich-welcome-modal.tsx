"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { AssistantProfileProvider } from "@/lib/profiles/enrichment-prompt";
import type { ProfileEnrichmentSnapshot, ProfileImportSummary } from "@/lib/shared/types";
import {
  ENRICH_WELCOME_SEEN_KEY,
  shouldForceEnrichmentWelcome,
} from "@/lib/profiles/welcome-modal-preview";
import { getVisibleAssistantProviders } from "./assistant-provider-visibility";
import { EnrichProfileWithAI } from "./enrich-profile-with-ai";
import { ImportMemoriesModal } from "./import-memories-modal";
import type { AssistantPromptCopyResult } from "./import-memories-modal-state";
import { useWelcomeModalGate } from "./use-welcome-modal-gate";

const SEEN_KEY = ENRICH_WELCOME_SEEN_KEY;

// Blocking first-run welcome. Enrichment isn't a seventh task — an approved
// import promotes straight into the structured matching fields (budget,
// move-in, household), so one paste can clear most of the profile checklist.
// We surface it at the highest-intent moment (first land, empty profile), then
// never nag again: any interaction marks it seen, and it lives on quietly under
// "Continue on your phone" afterward.
export function EnrichWelcomeModal({
  enabled,
  hasAssistantImport,
  imports,
  pendingFactCount,
  profileHref,
}: {
  enabled: boolean;
  hasAssistantImport: boolean;
  imports: ProfileImportSummary[];
  pendingFactCount: number;
  profileHref: string;
}) {
  const router = useRouter();
  // `?enrichWelcome=1` is a QA hatch: it force-opens the fresh first-run modal
  // even once the real gate (no import / has pending) no longer fires.
  const { open, setOpen, forced, markSeen } = useWelcomeModalGate({
    seenKey: SEEN_KEY,
    enabled,
    forceFn: shouldForceEnrichmentWelcome,
  });
  const shouldShowWelcome = enabled || forced;
  const [completedProviders, setCompletedProviders] = useState<AssistantProfileProvider[]>([]);
  // Once a provider is picked we swap the welcome card out for the import modal
  // entirely (rather than stacking scrims). The welcome modal owns it so it
  // survives that swap.
  const [importProvider, setImportProvider] = useState<AssistantProfileProvider | null>(null);
  const [importPromptCopyResult, setImportPromptCopyResult] = useState<
    Promise<AssistantPromptCopyResult> | null
  >(null);
  const completedProvidersRef = useRef<AssistantProfileProvider[]>([]);
  const latestImportsRef = useRef(imports);
  const successfulImportRef = useRef(false);

  const dismiss = useCallback(() => {
    completedProvidersRef.current = [];
    successfulImportRef.current = false;
    setCompletedProviders([]);
    setImportPromptCopyResult(null);
    setImportProvider(null);
    markSeen();
    setOpen(false);
  }, [markSeen, setOpen]);
  const dismissFromEffect = useEffectEvent(dismiss);

  const rememberCompletedProvider = useCallback((provider: string) => {
    if (!isAssistantProfileProvider(provider)) {
      return completedProvidersRef.current;
    }

    if (completedProvidersRef.current.includes(provider)) {
      return completedProvidersRef.current;
    }

    const nextProviders = [...completedProvidersRef.current, provider];
    completedProvidersRef.current = nextProviders;
    setCompletedProviders(nextProviders);
    return nextProviders;
  }, []);

  const hasRemainingProvider = useCallback(
    (hiddenProviders: readonly AssistantProfileProvider[]) =>
      getVisibleAssistantProviders(latestImportsRef.current, {
        hiddenProviders,
        previewAll: forced,
      }).length > 0,
    [forced],
  );

  const handleImported = useCallback(
    (snapshot: ProfileEnrichmentSnapshot, provider: string) => {
      latestImportsRef.current = snapshot.imports;
      successfulImportRef.current = true;
      rememberCompletedProvider(provider);
      router.refresh();
    },
    [rememberCompletedProvider, router],
  );

  const closeImportModal = useCallback(() => {
    const wasSuccessfulImport = successfulImportRef.current;
    successfulImportRef.current = false;
    setImportPromptCopyResult(null);
    setImportProvider(null);

    if (wasSuccessfulImport && hasRemainingProvider(completedProvidersRef.current)) {
      return;
    }

    dismiss();
  }, [dismiss, hasRemainingProvider]);

  useEffect(() => {
    // While the import modal is up it handles its own Escape; don't double-fire.
    if (!shouldShowWelcome || !open || importProvider) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissFromEffect();
      }
    };
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    // Lock the root too: iOS Safari keeps scrolling the page behind the modal
    // when only body overflow is hidden.
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, shouldShowWelcome, importProvider]);

  useEffect(() => {
    latestImportsRef.current = imports;
  }, [imports]);

  if (!shouldShowWelcome || !open) {
    return null;
  }

  // A provider was picked: the welcome card gives way to the import modal. The
  // assistant has opened in a new tab with the prompt; here the user pastes the
  // reply back. Closing or finishing dismisses the whole first-run flow.
  if (importProvider) {
    return (
      <ImportMemoriesModal
        open
        initialProvider={importProvider}
        initialPromptCopyResult={importPromptCopyResult}
        onClose={closeImportModal}
        onImported={handleImported}
      />
    );
  }

  // A forced preview always shows the fresh first-run framing (and every source),
  // regardless of what the account has already imported.
  const showReview = hasAssistantImport && !forced && completedProviders.length === 0;
  const title = showReview ? "Review your imported memories." : "Start with your memories.";
  const body = showReview
    ? `You have ${pendingFactCount} imported ${
        pendingFactCount === 1 ? "memory" : "memories"
      } waiting. Approve the true ones so Kinfolk can prefill the next steps.`
    : "Paste what ChatGPT or Claude remembers about you. Kinfolk will turn it into draft profile facts.";

  return (
    <dialog
      aria-labelledby="enrich-welcome-title"
      aria-modal="true"
      className="kin-welcome-scrim fixed inset-0 z-[90] m-0 flex h-screen w-screen max-w-none items-center justify-center border-0 bg-transparent px-4 py-6 text-left"
      open
    >
      <style>{welcomeStyles}</style>
      <button
        aria-label="Close welcome"
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent p-0"
        onClick={dismiss}
        tabIndex={-1}
        type="button"
      />

      <div className="kin-welcome-card relative z-10 w-full max-w-[460px] overflow-hidden rounded-[22px] border border-[rgba(28,51,38,0.1)] bg-[#fdfcf8] shadow-[0_50px_120px_-40px_rgba(14,31,23,0.65)]">
        <button
          aria-label="Skip for now"
          className="kin-focus absolute right-3.5 top-3.5 z-10 inline-grid size-8 place-items-center rounded-full text-[#9aa39d] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[#3a4a40]"
          onClick={dismiss}
          type="button"
        >
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>

        {/* Dotted texture band echoing the dashboard backdrop, with the mark. */}
        <div className="kin-welcome-band relative flex items-center gap-2.5 px-7 pb-5 pt-7">
          <Image
            alt=""
            aria-hidden="true"
            className="size-7 shrink-0"
            height={28}
            src="/assets/kinfolk-logo-mark.png"
            width={28}
          />
          <span className="pp-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[#6b7a70]">
            Welcome to Kinfolk
          </span>
        </div>

        <div className="px-7 pb-7">
          <div className="kin-welcome-stagger kin-welcome-delay-1">
            <h2
              className="serif text-[30px] leading-[1.06] tracking-[-0.02em] text-[#0f1a14]"
              id="enrich-welcome-title"
            >
              {title}
            </h2>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#5c6b61]">
              {body}
            </p>
          </div>

          {/* The rich, dual-provider import treatment — Claude + ChatGPT with
              their marks. Reused verbatim from the dashboard panel so there's
              one source of truth for the buttons and their live import status. */}
          <div className="kin-welcome-stagger kin-welcome-delay-2">
            <EnrichProfileWithAI
              hiddenProviders={completedProviders}
              imports={imports}
              onImport={(provider, promptCopyResult) => {
                markSeen();
                setImportPromptCopyResult(promptCopyResult);
                setImportProvider(provider);
              }}
              previewAll={forced}
              stacked
            />
          </div>

          <div className="kin-welcome-stagger kin-welcome-delay-3 mt-4 text-center">
            <Link
              className="kin-focus group inline-flex items-center gap-1.5 text-[13px] font-medium text-[#3a4a40] transition hover:text-[#0f1a14]"
              href={profileHref}
              onClick={dismiss}
            >
              I&rsquo;ll fill it in myself
              <ArrowRight
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
                size={14}
                strokeWidth={1.8}
              />
            </Link>
          </div>
        </div>
      </div>
    </dialog>
  );
}

const welcomeStyles = `
  .kin-welcome-scrim {
    background: radial-gradient(120% 120% at 50% 0%, rgba(28,51,38,0.30), rgba(15,26,20,0.52));
    backdrop-filter: blur(3px);
    animation: kin-welcome-fade 240ms ease-out both;
  }
  .kin-welcome-card {
    animation: kin-welcome-rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .kin-welcome-band {
    background:
      radial-gradient(rgba(28,51,38,0.10) 1px, transparent 1.4px) 0 0 / 14px 14px,
      linear-gradient(180deg, #f4f1e8, #fdfcf8);
  }
  .kin-welcome-stagger {
    animation: kin-welcome-rise 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .kin-welcome-delay-1 {
    animation-delay: 120ms;
  }
  .kin-welcome-delay-2 {
    animation-delay: 220ms;
  }
  .kin-welcome-delay-3 {
    animation-delay: 320ms;
  }
  @keyframes kin-welcome-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes kin-welcome-rise {
    from { opacity: 0; transform: translateY(14px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .kin-welcome-scrim,
    .kin-welcome-card,
    .kin-welcome-stagger {
      animation-duration: 1ms;
    }
  }
`;

function isAssistantProfileProvider(provider: string): provider is AssistantProfileProvider {
  return provider === "claude" || provider === "chatgpt";
}
