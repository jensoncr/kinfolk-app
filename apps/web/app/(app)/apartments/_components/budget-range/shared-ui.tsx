"use client";

import { type ChangeEvent } from "react";
import { BUDGET_CEILING, BUDGET_FLOOR, type BudgetRange } from "./types";

function parseMoneyInput(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return Number.parseInt(digits, 10);
}

type InputPairProps = {
  range: BudgetRange;
  onChange: (next: BudgetRange) => void;
};

export function BudgetInputPair({ range, onChange }: InputPairProps) {
  // Read directly from the prop — no local state needed since the only meaningful
  // characters are digits (commas are decorative and we render the slider/labels for
  // formatted readouts).
  const minText = range.min == null ? "" : String(range.min);
  const maxText = range.max == null ? "" : String(range.max);

  const handleMinChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = parseMoneyInput(event.target.value);
    if (parsed == null) {
      onChange({ ...range, min: null });
      return;
    }
    const max = range.max ?? BUDGET_CEILING;
    onChange({ ...range, min: Math.min(parsed, Math.max(BUDGET_FLOOR, max - 1)) });
  };

  const handleMaxChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = parseMoneyInput(event.target.value);
    if (parsed == null) {
      onChange({ ...range, max: null });
      return;
    }
    const min = range.min ?? BUDGET_FLOOR;
    onChange({ ...range, max: Math.max(parsed, min + 1) });
  };

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
      <label className="block">
        <span className="block text-xs font-semibold text-[var(--ink-800)]">Min</span>
        <div className="mt-1 flex h-10 items-center rounded-lg border border-[var(--border-strong)] bg-white px-3 focus-within:border-[var(--forest-700)]">
          <span className="text-sm text-[var(--ink-400)]">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={minText}
            onChange={handleMinChange}
            placeholder="No min"
            className="ml-1 w-full bg-transparent text-sm tabular-nums text-[var(--ink-900)] placeholder:font-normal placeholder:text-[var(--ink-400)] focus:outline-none"
            aria-label="Minimum monthly rent"
          />
        </div>
      </label>
      <span className="pb-3 text-[var(--ink-400)]">–</span>
      <label className="block">
        <span className="block text-xs font-semibold text-[var(--ink-800)]">Max</span>
        <div className="mt-1 flex h-10 items-center rounded-lg border border-[var(--border-strong)] bg-white px-3 focus-within:border-[var(--forest-700)]">
          <span className="text-sm text-[var(--ink-400)]">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={maxText}
            onChange={handleMaxChange}
            placeholder="No max"
            className="ml-1 w-full bg-transparent text-sm tabular-nums text-[var(--ink-900)] placeholder:font-normal placeholder:text-[var(--ink-400)] focus:outline-none"
            aria-label="Maximum monthly rent"
          />
        </div>
      </label>
    </div>
  );
}
