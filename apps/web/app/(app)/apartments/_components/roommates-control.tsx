"use client";

import { FilterPopover } from "./filter-popover";
import { FilterTrigger, type FilterTriggerVariant } from "./filter-trigger";
import { useFilterPopover } from "./use-filter-popover";

type Props = {
  value: number | null;
  onChange: (next: number | null) => void;
  maxRoommates: number;
  profileDefault: number | null;
  variant?: FilterTriggerVariant;
};

export function RoommatesControl({
  value,
  onChange,
  maxRoommates,
  profileDefault,
  variant,
}: Props) {
  const { open, setOpen, containerRef, panelRef, triggerRef } = useFilterPopover();

  const active = value != null;
  const activeHouseholdSize = active ? value + 1 : null;
  const profileDefaultHouseholdSize = profileDefault != null ? profileDefault + 1 : null;
  const differsFromProfile = value !== profileDefault;
  const label = activeHouseholdSize
    ? variant === "segment"
      ? `Up to ${activeHouseholdSize} people`
      : `Up to ${activeHouseholdSize}-person split`
    : null;
  const householdSizes = Array.from(
    { length: Math.max(0, maxRoommates) },
    (_, i) => i + 2,
  );

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
        name="Roommates"
        value={label}
        placeholder="Any household"
        active={active}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        triggerRef={triggerRef}
      />

      <FilterPopover open={open} triggerRef={triggerRef} panelRef={panelRef} align="left" offset={variant === "segment" ? 13 : 8}>
        <dialog
          open
          aria-label="Household size"
          className="kin-popover kin-focus relative m-0 w-[min(280px,calc(100vw-32px))] overflow-hidden p-0"
        >
          <div className="px-5 pt-4 pb-2">
            <h3 className="text-[13px] font-semibold tracking-tight text-[var(--ink-900)]">
              Household size
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--ink-500)]">
              Listings show rent split across the full household.
            </p>
          </div>

          <div className="px-4 pb-3">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                aria-pressed={value == null}
                className={[
                  "kin-focus inline-flex h-9 items-center justify-center rounded-lg px-2.5 text-xs font-semibold transition",
                  value == null
                    ? "bg-[var(--forest-700)] text-white"
                    : "border border-[var(--border-strong)] bg-white text-[var(--ink-800)] hover:bg-[var(--bg-soft)]",
                ].join(" ")}
              >
                No split
              </button>
              {householdSizes.length > 0 ? householdSizes.map((n) => {
                const roommateCount = n - 1;
                const isActive = value === roommateCount;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      onChange(roommateCount);
                      setOpen(false);
                    }}
                    aria-pressed={isActive}
                    className={[
                      "kin-focus inline-flex size-9 items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition",
                      isActive
                        ? "bg-[var(--forest-700)] text-white"
                        : "border border-[var(--border-strong)] bg-white text-[var(--ink-800)] hover:bg-[var(--bg-soft)]",
                    ].join(" ")}
                  >
                    {n}
                  </button>
                );
              }) : (
                <p className="text-[11px] text-[var(--ink-500)]">
                  No household splits fit your current profile.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
            <span className="min-w-0 flex-1 text-[11px] text-[var(--ink-500)]">
              {activeHouseholdSize
                ? `Rent split across up to ${activeHouseholdSize} people`
                : profileDefaultHouseholdSize
                  ? `Profile default is up to ${profileDefaultHouseholdSize} people`
                  : "No split"}
            </span>
            {differsFromProfile ? (
              <button
                type="button"
                onClick={() => {
                  onChange(profileDefault);
                  setOpen(false);
                }}
                className="kin-focus shrink-0 text-xs font-semibold text-[var(--ink-600)] underline-offset-4 transition hover:text-[var(--ink-900)] hover:underline"
              >
                Reset to profile
              </button>
            ) : null}
          </div>
        </dialog>
      </FilterPopover>
    </div>
  );
}
