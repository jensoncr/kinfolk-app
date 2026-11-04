"use client";

import { Check, ChevronDown } from "lucide-react";
import { FilterPopover } from "./filter-popover";
import { useFilterPopover } from "./use-filter-popover";
import {
  APARTMENT_SORT_LABELS,
  APARTMENT_SORT_ORDERS,
  type ApartmentSortOrder,
} from "./listing-sort";

type Props = {
  value: ApartmentSortOrder;
  onChange: (next: ApartmentSortOrder) => void;
};

export function SortControl({ value, onChange }: Props) {
  const { open, setOpen, containerRef, panelRef, triggerRef } =
    useFilterPopover();

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="kin-focus -m-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full p-2 text-[13px] font-semibold text-[var(--ink-600)] transition hover:text-[var(--ink-900)]"
      >
        {APARTMENT_SORT_LABELS[value]}
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <FilterPopover
        open={open}
        triggerRef={triggerRef}
        panelRef={panelRef}
        align="right"
      >
        <dialog
          open
          aria-label="Sort listings"
          className="kin-popover kin-focus relative m-0 w-[min(240px,calc(100vw-32px))] overflow-hidden p-2"
        >
          {APARTMENT_SORT_ORDERS.map((order) => {
            const active = order === value;
            return (
              <button
                key={order}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onChange(order);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={[
                  "kin-focus flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-[var(--bg-soft)]",
                  active
                    ? "font-semibold text-[var(--ink-900)]"
                    : "text-[var(--ink-600)]",
                ].join(" ")}
              >
                {APARTMENT_SORT_LABELS[order]}
                {active ? (
                  <Check
                    size={14}
                    aria-hidden="true"
                    className="text-[var(--forest-700)]"
                  />
                ) : null}
              </button>
            );
          })}
        </dialog>
      </FilterPopover>
    </div>
  );
}
