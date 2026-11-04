"use client";

import { ChevronDown } from "lucide-react";
import type { Ref } from "react";

export type FilterTriggerVariant = "chip" | "segment";

type Props = {
  /**
   * `chip` is the standalone rounded pill used in the secondary filter row.
   * `segment` is a field inside the search bar: a quiet label stacked over the
   * current value, with the divider drawn by `.kin-searchbar`.
   */
  variant?: FilterTriggerVariant;
  /** Field name. In `segment` it is always shown; in `chip` it is the fallback label. */
  name: string;
  /** Current selection, or null when the filter is untouched. */
  value: string | null;
  /**
   * What a segment shows while unset. Each field names its own — three
   * fields all reading "Any" is a wall of sameness that says nothing about
   * what any of them does.
   */
  placeholder?: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  triggerRef: Ref<HTMLButtonElement>;
};

/**
 * The one trigger both filter shapes are built from.
 *
 * Keeping them in a single component is what makes the search bar and the chip
 * row stay in step: a filter renders as a labelled segment when it is part of
 * the primary query and as a pill when it is a refinement, and neither form can
 * drift from the other.
 */
export function FilterTrigger({
  variant = "chip",
  name,
  value,
  placeholder = "Any",
  active,
  open,
  onToggle,
  triggerRef,
}: Props) {
  if (variant === "segment") {
    // Resting/engaged/live appearance is driven from `.kin-seg` in globals.css
    // off this button's own aria-expanded — see the search-bar block there.
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="kin-seg kin-focus flex h-full min-w-0 flex-col justify-center gap-[1px] px-4 py-2 text-left"
      >
        <span className="kin-field-label">{name}</span>
        <span
          className={[
            // truncate is overflow:hidden — at 17px the line box clipped the
            // descenders and "Any budget" rendered as "Anu budget".
            "truncate text-[13.5px] leading-[20px]",
            active
              ? "font-medium text-[var(--ink-900)]"
              : "text-[var(--ink-600)]",
          ].join(" ")}
        >
          {value ?? placeholder}
        </span>
      </button>
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={[
        "kin-focus inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-150",
        active
          ? "bg-[var(--forest-700)] text-white"
          : "bg-white text-[var(--ink-800)] shadow-[var(--lift-2)] hover:bg-[var(--bg-soft)]",
      ].join(" ")}
    >
      {value ?? name}
      <ChevronDown
        size={12}
        aria-hidden="true"
        className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}
