"use client";

import { useState } from "react";
import type { ProfileSetupState } from "@/lib/profiles/completion";
import { resolveMoveInSave } from "./matching-basics-state";
import { EditorLabel, InlineError, PrimaryButton, saveField, useLedgerRowClose } from "./shared";

export function MoveInSetupEditor({
  setup,
  onSetupChange,
  setError,
}: {
  setup: ProfileSetupState;
  onSetupChange: (next: ProfileSetupState) => void;
  setError: (message: string | null) => void;
}) {
  const [moveByDate, setMoveByDate] = useState(setup.moveInEnd || setup.moveInStart);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const closeRow = useLedgerRowClose();

  async function commit() {
    setInlineError(null);
    setError(null);

    const saved = resolveMoveInSave(moveByDate);
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
      const message = error instanceof Error ? error.message : "Move-in update failed.";
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      <EditorLabel label="Date">
        <input
          aria-label="Move-in date"
          className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
          onChange={(event) => setMoveByDate(event.target.value)}
          type="date"
          value={moveByDate}
        />
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
