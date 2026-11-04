"use client";

import { FilterPopover } from "../filter-popover";
import { FilterTrigger, type FilterTriggerVariant } from "../filter-trigger";
import { useFilterPopover } from "../use-filter-popover";
import {
  type BudgetHistogramBucket,
  type BudgetRange,
  formatBudgetRangeLabel,
  isBudgetRangeActive,
} from "./types";
import { VariantClassic } from "./variant-classic";
import { budgetRangesEqual } from "../filter-defaults";

type Props = {
  range: BudgetRange;
  onChange: (next: BudgetRange) => void;
  buckets: BudgetHistogramBucket[];
  matchedCount: number;
  profileDefaultRange: BudgetRange;
  includeUnpriced: boolean;
  onIncludeUnpricedChange: (value: boolean) => void;
  variant?: FilterTriggerVariant;
};

export function BudgetRangeControl({
  range,
  onChange,
  buckets,
  matchedCount,
  profileDefaultRange,
  includeUnpriced,
  onIncludeUnpricedChange,
  variant,
}: Props) {
  const { open, setOpen, containerRef, panelRef, triggerRef } = useFilterPopover();

  const active = isBudgetRangeActive(range);
  const profileDefaultActive = isBudgetRangeActive(profileDefaultRange);
  const activeLabel = formatBudgetRangeLabel(range).replace(/^Up to/, "up to");
  const label = active
    ? variant === "segment"
      ? formatBudgetRangeLabel(range)
      : `Budget ${activeLabel}`
    : null;

  return (
    <div
      ref={containerRef}
      className={
        variant === "segment"
          ? "kin-seg-wrap hidden flex-1 sm:flex"
          : "relative"
      }
    >
      <FilterTrigger
        variant={variant}
        name="Budget"
        value={label}
        placeholder="Any budget"
        active={active}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        triggerRef={triggerRef}
      />

      <FilterPopover open={open} triggerRef={triggerRef} panelRef={panelRef} align={variant === "segment" ? "left" : "right"} offset={variant === "segment" ? 13 : 8}>
        <dialog open aria-label="Budget range" className="kin-focus relative m-0 rounded-2xl border-0 bg-transparent p-0">
          <VariantClassic
            range={range}
            onChange={onChange}
            buckets={buckets}
            matchedCount={matchedCount}
            includeUnpriced={includeUnpriced}
            onIncludeUnpricedChange={onIncludeUnpricedChange}
            profileDefaultRange={profileDefaultRange}
            showResetToProfile={
              profileDefaultActive && !budgetRangesEqual(range, profileDefaultRange)
            }
          />
        </dialog>
      </FilterPopover>
    </div>
  );
}
