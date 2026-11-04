"use client";

import { ExternalLink } from "lucide-react";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import type { ReactNode } from "react";
import { normalizePhoneE164 } from "@/lib/shared/phone";
import type { DashboardSnapshot } from "@/lib/shared/types";

export function ProfileSettingsModal({
  snapshot,
  trigger,
}: {
  snapshot: DashboardSnapshot;
  trigger: ReactNode;
}) {
  const { email, phone, phoneVerified, linkedinConnected, linkedinUrl } = snapshot.user;
  const normalizedPhone = phoneVerified ? normalizePhoneE164(phone) : "";
  const phoneDisplay = normalizedPhone || "Not added";

  return (
    <Modal>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent
        title="Profile settings"
        description="Identity Kinfolk uses for matching and contact."
      >
        <div className="-mt-1 space-y-3">
          <Field label="Email" value={email || "—"} />
          <Field label="Phone Number" value={phoneDisplay} />
          <Field
            label="LinkedIn"
            value={
              linkedinUrl ? (
                <a
                  className="inline-flex items-center gap-1 text-[#264a36] hover:text-[#14271e] hover:underline"
                  href={linkedinUrl}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {linkedinUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  <ExternalLink aria-hidden="true" size={11} strokeWidth={1.8} />
                </a>
              ) : linkedinConnected ? (
                "Connected. URL pending enrichment."
              ) : (
                "Not connected"
              )
            }
          />
          <Field label="GitHub" value="Not added" />
          <Field label="X (Twitter)" value="Not added" />
        </div>
      </ModalContent>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="pp-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--pp-ink-40)]">
        {label}
      </p>
      <p className="mt-0.5 text-[14px] text-[var(--pp-ink-80)]">{value}</p>
    </div>
  );
}
