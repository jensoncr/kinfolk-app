"use client";

import { createContext, use } from "react";
import { Check, Pencil } from "lucide-react";

/**
 * Lets a row editor close its host row after a SUCCESSFUL save. The ledger
 * rows used to close only via key-remount on saved values, so a no-op save
 * (unchanged value) left the editor open with no feedback.
 */
const LedgerRowCloseContext = createContext<() => void>(() => {});

export const LedgerRowCloseProvider = LedgerRowCloseContext.Provider;

export function useLedgerRowClose() {
  return use(LedgerRowCloseContext);
}

export function EditorLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="pp-mono mb-1 block text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        {label}
      </span>
      {children}
    </label>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="m-0 rounded-lg border border-[rgba(155,77,32,0.2)] bg-[rgba(155,77,32,0.06)] px-3 py-2 text-[12.5px] leading-[1.5] text-[#8a4b20]">
      {message}
    </p>
  );
}

export function PrimaryButton({
  children,
  disabled = false,
  loading = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="kin-focus inline-flex items-center gap-1 rounded-full bg-[#264a36] px-4 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-[#1c3526] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {loading ? "Saving…" : (
        <>
          <Check size={12} strokeWidth={2} aria-hidden />
          {children}
        </>
      )}
    </button>
  );
}

export async function saveField(patch: Record<string, unknown>) {
  const response = await fetch("/api/kinfolk/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(typeof data.error === "string" ? data.error : "Profile update failed.");
  }
  return data as SaveFieldResult;
}

/** What the profile PATCH echoes back so the page can render it immediately. */
export type SaveFieldResult = {
  org?: {
    occupationCompany?: { domain: string | null; logoUrl: string | null };
    educationSchool?: { domain: string | null; logoUrl: string | null };
  };
};

/**
 * A field-level reducer patch: either a partial next-state object, or a
 * function from the current state to one. Used with `useReducer(patchReducer, …)`
 * by the profile section editors so each editor keeps a single local state bag
 * without a bespoke reducer per field.
 */
export type StatePatch<T> = Partial<T> | ((state: T) => Partial<T>);

export function patchReducer<T>(state: T, patch: StatePatch<T>): T {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function QuietButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="kin-focus inline-flex items-center rounded-full px-3 py-1 text-[12.5px] font-medium text-[var(--pp-ink-60)] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[var(--pp-ink)] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/** A titled profile section with an optional trailing action (Edit/Add). */
export function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7 border-t border-[var(--pp-hairline)] pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="pp-mono m-0 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.16em] text-[var(--pp-ink-40)]">
          {label}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function EditTrigger({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      className="kin-focus inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-[var(--pp-ink-60)] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[var(--pp-ink)]"
      onClick={onClick}
      type="button"
    >
      <Pencil size={11} strokeWidth={1.8} aria-hidden />
      {label}
    </button>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[13.5px] leading-[1.55] text-[var(--pp-ink-40)]">{children}</p>;
}

export function SuggestedTag() {
  return (
    <span className="pp-mono ml-2 inline-flex items-center rounded-full bg-[rgba(28,51,38,0.05)] px-1.5 py-[1px] text-[9.5px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
      Suggested
    </span>
  );
}
