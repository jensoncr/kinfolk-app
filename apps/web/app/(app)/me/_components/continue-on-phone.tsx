"use client";

import Image from "next/image";
import { ChevronRight, QrCode, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ContinueOnPhoneConfig } from "@/lib/integrations/continue-on-phone";
import { usePhoneHandoff, type PhoneChallenge } from "./use-phone-handoff";

type ContinueOnPhoneProps = {
  config: ContinueOnPhoneConfig;
};

export function ContinueOnPhone({ config }: ContinueOnPhoneProps) {
  const {
    isDesktop,
    handoff,
    challengeError,
    challengeLoading,
    ensureHandoff,
    link,
    qrTarget,
    requestQrCode,
    qrCodeUrl,
    qrError,
    qrLoading,
  } = usePhoneHandoff({ config });
  const [modalOpen, setModalOpen] = useState(false);

  const label = "Messages";
  const disabled = !config.agentEnabled || challengeLoading;

  // Prefetch the QR on desktop (mirrors the previous `prefetch={isDesktop}`),
  // otherwise wait until the modal opens.
  useEffect(() => {
    if (!qrTarget || (!modalOpen && !isDesktop)) {
      return;
    }
    const controller = new AbortController();
    requestQrCode(controller.signal);
    return () => controller.abort();
  }, [modalOpen, isDesktop, qrTarget, requestQrCode]);

  async function startPhoneHandoff() {
    if (isDesktop) {
      setModalOpen(true);
      void ensureHandoff().catch(() => undefined);
      return;
    }

    try {
      const nextHandoff = await ensureHandoff();
      window.location.href = nextHandoff.link;
    } catch {
      // Inline error state is set in ensureHandoff.
    }
  }

  return (
    <>
      <div className="mt-4">
        <button
          aria-label="Continue on your phone"
          className="kin-focus group flex w-full items-center justify-between gap-4 rounded-2xl bg-[var(--forest-900)] px-5 py-3.5 text-left text-white shadow-[0_30px_60px_-40px_rgba(14,31,23,0.55)] transition hover:bg-[var(--forest-800)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:bg-[var(--forest-900)] disabled:active:scale-100"
          disabled={disabled}
          type="button"
          onClick={startPhoneHandoff}
        >
          <PlatformMark />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight">
              Continue on your phone
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-5 text-white/70">
              {challengeError ?? (isDesktop ? `Scan to open ${label}` : `Tap to open ${label}`)}
            </span>
          </span>
          {isDesktop ? (
            <QrCode
              aria-hidden="true"
              className="shrink-0 text-white/70"
              size={18}
              strokeWidth={1.8}
            />
          ) : (
            <ChevronRight aria-hidden="true" className="shrink-0 text-white/60" size={16} />
          )}
        </button>
      </div>

      <ContinueOnPhoneModal
        error={challengeError}
        handoff={handoff}
        link={link}
        loadingChallenge={challengeLoading}
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        qrCodeUrl={qrCodeUrl}
        qrError={qrError}
        qrLoading={qrLoading}
      />
    </>
  );
}

export function ContinueOnPhoneModal({
  error: challengeError,
  handoff,
  link,
  loadingChallenge,
  onClose,
  open,
  qrCodeUrl,
  qrError,
  qrLoading,
}: {
  error: string | null;
  handoff: PhoneChallenge | null;
  link: string;
  loadingChallenge: boolean;
  onClose: () => void;
  open: boolean;
  qrCodeUrl: string | null;
  qrError: string | null;
  qrLoading: boolean;
}) {
  const label = "Messages";
  const isAgentThread = handoff?.kind === "agent_thread";

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1a14]/35 px-4 backdrop-blur-sm">
      <dialog
        open
        aria-labelledby="continue-on-phone-modal-title"
        aria-modal="true"
        className="relative m-0 w-full max-w-[420px] rounded-2xl border border-[rgba(28,51,38,0.12)] bg-[#fdfcf8] p-5 text-[#0f1a14] shadow-[0_30px_80px_-30px_rgba(14,31,23,0.35)]"
      >
        <button
          aria-label="Close"
          className="kin-focus absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[#6b7a70] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[#0f1a14]"
          type="button"
          onClick={onClose}
        >
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>

        <div className="pr-8 text-center">
          <h2
            className="serif text-[30px] leading-none tracking-[-0.02em]"
            id="continue-on-phone-modal-title"
          >
            Continue on mobile
          </h2>
          <p className="mx-auto mt-2 max-w-[34ch] text-[13px] leading-5 text-[#6b7a70]">
            Scan with your phone camera to open {label}.
          </p>
        </div>

        <div className="mt-5 flex flex-col items-center">
          <div className="grid size-[250px] place-items-center rounded-xl border border-[rgba(28,51,38,0.12)] bg-white p-3 shadow-sm">
            {loadingChallenge ? (
              <span className="text-[13px] text-[#6b7a70]">Preparing handoff&hellip;</span>
            ) : challengeError ? (
              <span className="px-4 text-center text-[13px] leading-5 text-[#8a4b20]">
                {challengeError}
              </span>
            ) : qrLoading ? (
              <span className="text-[13px] text-[#6b7a70]">Generating QR&hellip;</span>
            ) : qrError ? (
              <span className="px-4 text-center text-[13px] leading-5 text-[#8a4b20]">{qrError}</span>
            ) : qrCodeUrl ? (
              <Image
                alt={`${label} QR code`}
                className="size-full rounded-md"
                height={226}
                src={qrCodeUrl}
                unoptimized
                width={226}
              />
            ) : null}
          </div>

          {handoff ? (
            <>
              <a
                className="kin-focus mt-4 inline-flex items-center gap-1.5 rounded-full border border-[rgba(28,51,38,0.12)] px-3 py-1.5 text-[12.5px] font-medium text-[#1f2a23] transition hover:bg-[rgba(28,51,38,0.04)]"
                href={link}
              >
                Open directly
                <ChevronRight aria-hidden="true" size={13} strokeWidth={1.8} />
              </a>
              <div className="mt-3 max-w-[30ch] text-center text-[12.5px] leading-5 text-[#6b7a70]">
                {isAgentThread
                  ? "Open your Kinfolk agent thread in Messages."
                  : `Text ${handoff.message} to ${handoff.phoneNumber}.`}
              </div>
            </>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}

function PlatformMark() {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className="size-9 shrink-0 rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
      height={36}
      src="/assets/imessage.png"
      width={36}
    />
  );
}
