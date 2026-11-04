"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { ArrowLeft, ChevronRight, QrCode, X } from "lucide-react";
import type { ContinueOnPhoneConfig } from "@/lib/integrations/continue-on-phone";
import {
  CONVERSATION_WELCOME_SEEN_KEY,
  shouldForceConversationWelcome,
} from "@/lib/profiles/welcome-modal-preview";
import { useWelcomeModalGate } from "./use-welcome-modal-gate";
import { usePhoneHandoff } from "./use-phone-handoff";

const SEEN_KEY = CONVERSATION_WELCOME_SEEN_KEY;

// First-run push to the text agent. The whole bet of this flow is that a short
// conversation beats a form, so the modal shows the conversation and offers one
// primary action: open Messages. Tapping it swaps the modal in place to a
// QR/handoff view with a back button instead of stacking a second modal.
export function ConversationWelcomeModal({
  config,
  enabled,
  firstName,
  profileHref,
}: {
  config: ContinueOnPhoneConfig;
  enabled: boolean;
  firstName: string;
  profileHref: string;
}) {
  const { open, setOpen, forced, markSeen } = useWelcomeModalGate({
    seenKey: SEEN_KEY,
    enabled,
    forceFn: shouldForceConversationWelcome,
  });
  const shouldShowWelcome = enabled || forced;
  const [view, setView] = useState<"intro" | "phone">("intro");
  const {
    isDesktop,
    handoff,
    challengeError,
    challengeLoading,
    ensureHandoff,
    link,
    qrTarget,
    requestQrCode,
    qrCodeUrl: qrUrl,
    qrError,
    qrLoading,
  } = usePhoneHandoff({ config });

  const dismiss = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [markSeen, setOpen]);

  const startPhone = useCallback(() => {
    markSeen();
    if (isDesktop) {
      setView("phone");
      void ensureHandoff().catch(() => undefined);
      return;
    }
    ensureHandoff()
      .then((next) => {
        window.location.href = next.link;
      })
      .catch(() => {
        setView("phone");
      });
  }, [ensureHandoff, isDesktop, markSeen]);

  const goBack = useCallback(() => setView("intro"), []);
  const handleEscape = useEffectEvent(() => {
    if (view === "phone") {
      setView("intro");
    } else {
      dismiss();
    }
  });

  useEffect(() => {
    if (view !== "phone" || !isDesktop || !qrTarget) {
      return;
    }
    const controller = new AbortController();
    requestQrCode(controller.signal);
    return () => controller.abort();
  }, [view, isDesktop, qrTarget, requestQrCode]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      handleEscape();
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
  }, [open]);

  if (!shouldShowWelcome || !open) {
    return null;
  }

  const isAgentThread = handoff?.kind === "agent_thread";

  return (
    <dialog
      aria-labelledby="conversation-welcome-title"
      aria-modal="true"
      className="cwm-scrim fixed inset-0 z-40 m-0 flex h-screen w-screen max-w-none items-center justify-center border-0 bg-transparent px-4 py-6 text-left"
      open
    >
      <style>{styles}</style>
      <button
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent p-0"
        onClick={dismiss}
        tabIndex={-1}
        type="button"
      />

      <div className="cwm-card relative z-10 w-full max-w-[400px] overflow-hidden rounded-[26px] border border-[rgba(28,51,38,0.1)] bg-[#fdfcf8] shadow-[0_60px_140px_-50px_rgba(14,31,23,0.7)]">
        {view === "phone" ? (
          <button
            aria-label="Back"
            className="kin-focus absolute left-3.5 top-3.5 z-10 inline-grid size-8 place-items-center rounded-full text-[#9aa39d] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[#3a4a40]"
            onClick={goBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        ) : null}
        <button
          aria-label="Skip for now"
          className="kin-focus absolute right-3.5 top-3.5 z-10 inline-grid size-8 place-items-center rounded-full text-[#9aa39d] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[#3a4a40]"
          onClick={dismiss}
          type="button"
        >
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>

        {view === "intro" ? (
          <div className="px-6 pb-6 pt-9 sm:px-7 sm:pt-10">
            <div className="cwm-fade cwm-fade-1">
              <h2
                className="serif text-[27px] leading-[1.1] tracking-[-0.02em] text-[#0f1a14]"
                id="conversation-welcome-title"
              >
                Chat with Kinfolk, unlock better ways to live.
              </h2>
              <p className="mt-2 text-[13.5px] leading-[1.5] text-[#6b7a70]">
                Two quick minutes by text. The more it knows, the more opens up.
              </p>
            </div>

            <div className="cwm-thread cwm-fade cwm-fade-2 mt-5 rounded-[18px] border border-[rgba(28,51,38,0.07)] bg-[#f4f1e8] px-3.5 pb-3.5 pt-3">
              <div className="flex items-center gap-2">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="size-[18px] shrink-0"
                  height={18}
                  src="/assets/kinfolk-logo-mark.png"
                  width={18}
                />
                <span className="text-[11px] font-medium leading-none text-[#6b7a70]">Kinfolk</span>
                <span className="pp-mono ml-auto text-[9px] uppercase tracking-[0.16em] text-[#abb2ab]">
                  iMessage
                </span>
              </div>

              <div className="mt-2.5 flex flex-col items-start gap-1.5">
                <p className="cwm-bubble cwm-bubble-1 max-w-[85%] rounded-[16px] rounded-bl-[5px] bg-[#e7e7ea] px-3.5 py-2 text-[14px] leading-[1.35] text-[#1c1c1e]">
                  Hey {firstName}
                </p>
                <p className="cwm-bubble cwm-bubble-2 max-w-[85%] rounded-[16px] rounded-bl-[5px] bg-[#e7e7ea] px-3.5 py-2 text-[14px] leading-[1.35] text-[#1c1c1e]">
                  What are you looking for in a place?
                </p>
                <output
                  aria-label="You are replying"
                  className="cwm-typing inline-flex items-center gap-[5px] self-end rounded-[18px] rounded-br-[6px] bg-[#e5e5ea] px-3.5 py-3"
                >
                  <span className="cwm-typing-dot size-[8px] rounded-full bg-[#8d8d93]" />
                  <span className="cwm-typing-dot size-[8px] rounded-full bg-[#8d8d93]" />
                  <span className="cwm-typing-dot size-[8px] rounded-full bg-[#8d8d93]" />
                </output>
              </div>
            </div>

            <button
              className="cwm-fade cwm-fade-3 kin-focus group mt-4 flex w-full items-center justify-between gap-4 rounded-2xl bg-[var(--forest-900)] px-5 py-3.5 text-left text-white shadow-[0_30px_60px_-40px_rgba(14,31,23,0.55)] transition hover:bg-[var(--forest-800)] active:scale-[0.99]"
              onClick={startPhone}
              type="button"
            >
              <Image
                alt=""
                aria-hidden="true"
                className="size-9 shrink-0 rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
                height={36}
                src="/assets/imessage.png"
                width={36}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-tight">
                  Continue on your phone
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-5 text-white/70">
                  {challengeError ?? (isDesktop ? "Scan to open Messages" : "Tap to open Messages")}
                </span>
              </span>
              {isDesktop ? (
                <QrCode aria-hidden="true" className="shrink-0 text-white/70" size={18} strokeWidth={1.8} />
              ) : (
                <ChevronRight aria-hidden="true" className="shrink-0 text-white/60" size={16} />
              )}
            </button>

            <div className="cwm-fade cwm-fade-4 mt-3.5 text-center">
              <Link
                className="kin-focus text-[12.5px] font-medium text-[#8a948c] underline-offset-2 transition hover:text-[#3a4a40] hover:underline"
                href={profileHref}
                onClick={dismiss}
              >
                I&rsquo;ll fill it in myself
              </Link>
            </div>
          </div>
        ) : (
          <div className="px-6 pb-7 pt-12 sm:px-7">
            <div className="text-center">
              <h2 className="serif text-[28px] leading-[1.05] tracking-[-0.02em] text-[#0f1a14]">
                Continue on mobile
              </h2>
              <p className="mx-auto mt-2 max-w-[32ch] text-[13px] leading-5 text-[#6b7a70]">
                Scan with your phone camera to open Messages.
              </p>
            </div>

            <div className="mt-5 flex flex-col items-center">
              <div className="grid size-[240px] place-items-center rounded-2xl border border-[rgba(28,51,38,0.12)] bg-white p-3 shadow-sm">
                {challengeLoading ? (
                  <span className="text-[13px] text-[#6b7a70]">Preparing handoff&hellip;</span>
                ) : challengeError ? (
                  <span className="px-4 text-center text-[13px] leading-5 text-[#8a4b20]">
                    {challengeError}
                  </span>
                ) : qrLoading ? (
                  <span className="text-[13px] text-[#6b7a70]">Generating QR&hellip;</span>
                ) : qrError ? (
                  <span className="px-4 text-center text-[13px] leading-5 text-[#8a4b20]">{qrError}</span>
                ) : qrUrl ? (
                  <Image
                    alt="Messages QR code"
                    className="size-full rounded-lg"
                    height={216}
                    src={qrUrl}
                    unoptimized
                    width={216}
                  />
                ) : null}
              </div>

              {handoff ? (
                <>
                  <a
                    className="kin-focus mt-4 inline-flex items-center gap-1.5 rounded-full border border-[rgba(28,51,38,0.12)] px-3.5 py-1.5 text-[12.5px] font-medium text-[#1f2a23] transition hover:bg-[rgba(28,51,38,0.04)]"
                    href={link}
                  >
                    Open directly
                    <ChevronRight aria-hidden="true" size={13} strokeWidth={1.8} />
                  </a>
                  <p className="mt-3 max-w-[30ch] text-center text-[12.5px] leading-5 text-[#6b7a70]">
                    {isAgentThread
                      ? "Opens your Kinfolk thread in Messages."
                      : `Text ${handoff.message} to ${handoff.phoneNumber}.`}
                  </p>
                </>
              ) : null}

              <button
                className="kin-focus mt-4 text-[12.5px] font-medium text-[#8a948c] transition hover:text-[#3a4a40]"
                onClick={goBack}
                type="button"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

const styles = `
  .cwm-scrim {
    background: radial-gradient(120% 120% at 50% 0%, rgba(28,51,38,0.32), rgba(15,26,20,0.55));
    backdrop-filter: blur(4px);
    animation: cwm-scrim-in 220ms ease-out both;
  }
  .cwm-card {
    animation: cwm-card-in 460ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .cwm-bubble {
    animation: cwm-bubble-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: bottom left;
  }
  .cwm-bubble-1 { animation-delay: 460ms; }
  .cwm-bubble-2 { animation-delay: 600ms; }
  .cwm-fade {
    animation: cwm-fade-in 460ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .cwm-fade-1 { animation-delay: 140ms; }
  .cwm-fade-2 { animation-delay: 300ms; }
  .cwm-fade-3 { animation-delay: 1020ms; }
  .cwm-fade-4 { animation-delay: 1140ms; }
  .cwm-typing {
    animation: cwm-bubble-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 780ms;
    transform-origin: bottom right;
  }
  .cwm-typing-dot {
    animation: cwm-typing-pulse 1.4s infinite ease-in-out both;
  }
  .cwm-typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .cwm-typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes cwm-typing-pulse {
    0%, 50%, 100% { opacity: 0.4; transform: scale(0.8); }
    25% { opacity: 1; transform: scale(1); }
  }
  @keyframes cwm-scrim-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes cwm-card-in {
    from { opacity: 0; transform: translateY(16px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes cwm-bubble-in {
    from { opacity: 0; transform: translateY(6px) scale(0.9); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes cwm-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cwm-scrim, .cwm-card, .cwm-bubble, .cwm-fade, .cwm-typing {
      animation-duration: 1ms;
      animation-delay: 0ms;
    }
    .cwm-typing-dot {
      animation: none;
      opacity: 0.6;
    }
  }
`;
