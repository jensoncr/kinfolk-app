"use client";

import { FilterPopover } from "./filter-popover";
import { FilterTrigger, type FilterTriggerVariant } from "./filter-trigger";
import { useFilterPopover } from "./use-filter-popover";

export type BedBathFilter = {
  minBeds: number | null;
  minBaths: number | null;
};

type Props = {
  minBeds: number | null;
  minBaths: number | null;
  onChange: (next: BedBathFilter) => void;
  variant?: FilterTriggerVariant;
};

// Minimum-count options ("X+"). Baths include the common half step.
const BED_OPTIONS = [1, 2, 3, 4];
const BATH_OPTIONS = [1, 1.5, 2, 3];

function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function optionClass(isActive: boolean) {
  return [
    "kin-focus inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-xs font-semibold tabular-nums transition",
    isActive
      ? "bg-[var(--forest-700)] text-white"
      : "border border-[var(--border-strong)] bg-white text-[var(--ink-800)] hover:bg-[var(--bg-soft)]",
  ].join(" ");
}

export function BedBathControl({
  minBeds,
  minBaths,
  onChange,
  variant,
}: Props) {
  const { open, setOpen, containerRef, panelRef, triggerRef } = useFilterPopover();

  const active = minBeds != null || minBaths != null;
  const bedPart = minBeds != null ? `${minBeds}+ bd` : null;
  const bathPart = minBaths != null ? `${formatCount(minBaths)}+ ba` : null;
  const label = active ? [bedPart, bathPart].filter(Boolean).join(" · ") : null;

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
        name="Beds & baths"
        value={label}
        placeholder="Any size"
        active={active}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        triggerRef={triggerRef}
      />

      <FilterPopover open={open} triggerRef={triggerRef} panelRef={panelRef} align="left" offset={variant === "segment" ? 13 : 8}>
        <dialog
          open
          aria-label="Beds and baths"
          className="kin-popover kin-focus relative m-0 w-[min(300px,calc(100vw-32px))] overflow-hidden p-0"
        >
          <div className="px-5 pt-4 pb-2">
            <h3 className="text-[13px] font-semibold tracking-tight text-[var(--ink-900)]">
              Bedrooms
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--ink-500)]">
              Listings with at least this many bedrooms available.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ minBeds: null, minBaths })}
                aria-pressed={minBeds == null}
                className={optionClass(minBeds == null)}
              >
                Any
              </button>
              {BED_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange({ minBeds: n, minBaths })}
                  aria-pressed={minBeds === n}
                  className={optionClass(minBeds === n)}
                >
                  {n}+
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 pt-1 pb-2">
            <h3 className="text-[13px] font-semibold tracking-tight text-[var(--ink-900)]">
              Bathrooms
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ minBeds, minBaths: null })}
                aria-pressed={minBaths == null}
                className={optionClass(minBaths == null)}
              >
                Any
              </button>
              {BATH_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange({ minBeds, minBaths: n })}
                  aria-pressed={minBaths === n}
                  className={optionClass(minBaths === n)}
                >
                  {formatCount(n)}+
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
            <span className="min-w-0 flex-1 text-[11px] text-[var(--ink-500)]">
              {active ? "Minimum bed and bath counts" : "Any beds or baths"}
            </span>
            {active ? (
              <button
                type="button"
                onClick={() => onChange({ minBeds: null, minBaths: null })}
                className="kin-focus shrink-0 text-xs font-semibold text-[var(--ink-600)] underline-offset-4 transition hover:text-[var(--ink-900)] hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
        </dialog>
      </FilterPopover>
    </div>
  );
}
