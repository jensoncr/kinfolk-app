"use client";

import { useState } from "react";
import type { ProfileSetupState } from "@/lib/profiles/completion";
import { resolveBudgetSave } from "./matching-basics-state";
import { EditorLabel, InlineError, PrimaryButton, saveField, useLedgerRowClose } from "./shared";

export function BudgetSetupEditor({
  setup,
  onSetupChange,
  setError,
}: {
  setup: ProfileSetupState;
  onSetupChange: (next: ProfileSetupState) => void;
  setError: (message: string | null) => void;
}) {
  const [min, setMin] = useState(setup.budgetMin > 0 ? String(setup.budgetMin) : "");
  const [max, setMax] = useState(setup.budgetMax > 0 ? String(setup.budgetMax) : "");
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const closeRow = useLedgerRowClose();

  async function commit() {
    setInlineError(null);
    setError(null);

    const saved = resolveBudgetSave(min, max);
    if (!saved.ok) {
      setInlineError(saved.error);
      return;
    }

    setBusy(true);
    try {
      await saveField(saved.patch);
      onSetupChange({
        ...setup,
        ...saved.display,
      });
      closeRow();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Budget update failed.";
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-2 sm:grid-cols-2">
        <EditorLabel label="Min">
          <input
            aria-label="Minimum budget"
            className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
            inputMode="numeric"
            min={1}
            onChange={(event) => setMin(event.target.value)}
            placeholder="1400"
            step={1}
            type="number"
            value={min}
          />
        </EditorLabel>
        <EditorLabel label="Max">
          <input
            aria-label="Maximum budget"
            className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
            inputMode="numeric"
            min={1}
            onChange={(event) => setMax(event.target.value)}
            placeholder="1800"
            step={1}
            type="number"
            value={max}
          />
        </EditorLabel>
      </div>
      <InlineError message={inlineError} />
      <div className="flex justify-end">
        <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}
