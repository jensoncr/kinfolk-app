"use client";

import { useCallback } from "react";
import { BudgetHistogram } from "./budget-histogram";
import { DualRangeSlider } from "./dual-range-slider";
import {
  BUDGET_CEILING,
  BUDGET_FLOOR,
  BUDGET_STEP,
  type BudgetHistogramBucket,
  type BudgetRange,
  formatBudgetShort,
  isBudgetRangeActive,
} from "./types";
import { rangeToSliderValues, sliderValuesToRange } from "./range-values";
import { BudgetInputPair } from "./shared-ui";

type Props = {
  range: BudgetRange;
  onChange: (next: BudgetRange) => void;
  buckets: BudgetHistogramBucket[];
  matchedCount: number;
  includeUnpriced: boolean;
  onIncludeUnpricedChange: (value: boolean) => void;
  profileDefaultRange: BudgetRange;
  showResetToProfile: boolean;
};

export function VariantClassic({
  range,
  onChange,
  buckets,
  matchedCount,
  includeUnpriced,
  onIncludeUnpricedChange,
  profileDefaultRange,
  showResetToProfile,
}: Props) {
  const [valueMin, valueMax] = rangeToSliderValues(range);
  const active = isBudgetRangeActive(range);

  const handleSliderChange = useCallback(
    (next: [number, number]) => onChange(sliderValuesToRange(next)),
    [onChange],
  );

  return (
    <div className="kin-popover w-[min(340px,calc(100vw-32px))] overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-1">
        <h3 className="text-[13px] font-semibold tracking-tight text-[var(--ink-900)]">
          Price range
        </h3>
        <span className="text-[11px] tabular-nums text-[var(--ink-500)]">
          {matchedCount.toLocaleString()} match{matchedCount === 1 ? "" : "es"}
        </span>
      </div>

      <div className="px-4 pt-2">
        <BudgetHistogram
          buckets={buckets}
          rangeMin={valueMin}
          rangeMax={valueMax}
          height={56}
        />
        <div className="-mt-2">
          <DualRangeSlider
            min={BUDGET_FLOOR}
            max={BUDGET_CEILING}
            step={BUDGET_STEP}
            value={[valueMin, valueMax]}
            onChange={handleSliderChange}
            formatValue={formatBudgetShort}
            ariaLabelMin="Minimum monthly rent"
            ariaLabelMax="Maximum monthly rent"
          />
        </div>
        <div className="flex items-center justify-between pl-0.5 pr-1 pt-0.5 text-[11px] tabular-nums text-[var(--ink-500)]">
          <span>{formatBudgetShort(BUDGET_FLOOR)}</span>
          <span>{formatBudgetShort(BUDGET_CEILING)}</span>
        </div>
      </div>

      <div className="px-5 pt-5 pb-5">
        <BudgetInputPair range={range} onChange={onChange} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="kin-focus inline-flex min-w-[190px] flex-1 cursor-pointer items-center gap-2 text-xs text-[var(--ink-700)] hover:text-[var(--ink-900)]">
            <input
              type="checkbox"
              aria-label="Show listings without pricing"
              checked={includeUnpriced}
              onChange={(event) => onIncludeUnpricedChange(event.target.checked)}
              className="size-3.5 cursor-pointer rounded border-[var(--border-strong)] accent-[var(--forest-700)]"
            />
            <span>Show listings without pricing</span>
          </label>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {active ? (
              <button
                type="button"
                onClick={() => onChange({ min: null, max: null })}
                className="kin-focus text-xs font-semibold text-[var(--ink-600)] underline-offset-4 transition hover:text-[var(--ink-900)] hover:underline"
              >
                Clear
              </button>
            ) : null}
            {showResetToProfile ? (
              <button
                type="button"
                onClick={() => onChange(profileDefaultRange)}
                className="kin-focus text-xs font-semibold text-[var(--ink-600)] underline-offset-4 transition hover:text-[var(--ink-900)] hover:underline"
              >
                Reset to profile
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
