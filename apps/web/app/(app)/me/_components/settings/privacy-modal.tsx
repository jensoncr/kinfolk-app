"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { saveField } from "@/app/(app)/me/_components/profile/shared";

type VisibilityChoice = "anonymous" | "public";

const CHOICES: {
  value: VisibilityChoice;
  label: string;
  description: string;
}[] = [
  {
    value: "anonymous",
    label: "Anonymous until matched",
    description:
      "Others see your first name and fit only. Your full profile is shared when you ask to join a group, with a group that accepts you, a match you both approve, or a contact you accept.",
  },
  {
    value: "public",
    label: "Public",
    description:
      "Anyone signed in can see your full profile — photo, work, school, and lifestyle — wherever your groups and matches appear.",
  },
];

export function PrivacyModal({
  trigger,
  visibilityMode,
}: {
  trigger: ReactNode;
  visibilityMode: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<VisibilityChoice>(
    visibilityMode === "public" ? "public" : "anonymous",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const select = async (next: VisibilityChoice) => {
    if (saving || next === choice) return;
    const previous = choice;
    setChoice(next);
    setSaving(true);
    setError(null);
    try {
      await saveField({ profileVisibility: next });
      // The settings row meta renders from the server snapshot — refresh so
      // it agrees with the saved choice without a manual reload.
      router.refresh();
    } catch {
      setChoice(previous);
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent
        title="Privacy"
        description="Who can see your profile."
      >
        <div
          aria-label="Profile visibility"
          className="-mt-1 overflow-hidden rounded-xl border border-[var(--pp-hairline)] bg-white divide-y divide-[var(--pp-hairline-soft)]"
          role="radiogroup"
        >
          {CHOICES.map((option) => {
            const selected = choice === option.value;
            return (
              <button
                key={option.value}
                aria-checked={selected}
                className="kin-focus flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-[rgba(28,51,38,0.025)] disabled:cursor-wait"
                disabled={saving}
                onClick={() => select(option.value)}
                role="radio"
                type="button"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                    selected
                      ? "border-[var(--forest-600)] bg-[var(--forest-600)] text-white"
                      : "border-[var(--pp-hairline-strong)] bg-white text-transparent"
                  }`}
                >
                  <Check size={10} strokeWidth={3} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13.5px] font-medium text-[var(--pp-ink)]">
                    {option.label}
                  </span>
                  <span className="text-[12.5px] leading-[1.5] text-[var(--pp-ink-60)]">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="text-[12.5px] text-[var(--rust)]" role="alert">
            {error}
          </p>
        ) : null}

        <Link
          className="kin-focus group flex items-center justify-between rounded-xl border border-[var(--pp-hairline)] bg-white px-3.5 py-2.5 text-[13.5px] font-medium text-[var(--pp-ink)] transition hover:border-[var(--pp-hairline-strong)] hover:bg-[var(--pp-canvas-soft)]"
          href="/privacy"
          target="_blank"
          rel="noreferrer noopener"
        >
          Read full policy
          <ArrowUpRight
            aria-hidden="true"
            className="text-[var(--pp-ink-40)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            size={14}
            strokeWidth={1.8}
          />
        </Link>
      </ModalContent>
    </Modal>
  );
}
