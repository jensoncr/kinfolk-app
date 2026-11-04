"use client";

import { useState } from "react";
import type { ProfileSetupState } from "@/lib/profiles/completion";
import {
  HOUSEHOLD_SIZE_MAX,
  HOUSEHOLD_SIZE_MIN,
  resolveHouseholdSave,
} from "./matching-basics-state";
import { EditorLabel, InlineError, PrimaryButton, saveField, useLedgerRowClose } from "./shared";

const householdSizeOptions = Array.from(
  { length: HOUSEHOLD_SIZE_MAX - HOUSEHOLD_SIZE_MIN + 1 },
  (_, index) => HOUSEHOLD_SIZE_MIN + index,
);

export function HouseholdSetupEditor({
  setup,
  onSetupChange,
  setError,
}: {
  setup: ProfileSetupState;
  onSetupChange: (next: ProfileSetupState) => void;
  setError: (message: string | null) => void;
}) {
  const [max, setMax] = useState(String(setup.householdSizeMax > 0 ? setup.householdSizeMax : 4));
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const closeRow = useLedgerRowClose();

  async function commit() {
    setInlineError(null);
    setError(null);

    const saved = resolveHouseholdSave(max);
    if (!saved.ok) {
      setInlineError(saved.error);
      return;
    }

    setBusy(true);
    try {
      await saveField(saved.patch);
      onSetupChange({ ...setup, ...saved.display });
      closeRow();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Household update failed.";
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      <EditorLabel label="Max people">
        <select
          className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
          onChange={(event) => setMax(event.target.value)}
          value={max}
        >
          {householdSizeOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </EditorLabel>
      <InlineError message={inlineError} />
      <div className="flex justify-end">
        <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}
