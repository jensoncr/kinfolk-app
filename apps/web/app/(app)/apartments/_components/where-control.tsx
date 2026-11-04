"use client";

import { Building2, Check, MapPin, Navigation, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { moveHighlight } from "@/app/(app)/me/_components/profile/org-combobox-state";
import type { NeighborhoodFilterOption } from "./apartment-listing-filters";
import { FilterPopover } from "./filter-popover";
import {
  newSearchSessionToken,
  suggestPlaces,
  type PlaceSuggestion,
} from "./place-suggest";
import { useFilterPopover } from "./use-filter-popover";

type Props = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  options: NeighborhoodFilterOption[];
  /**
   * Neighborhoods with listings inside the current map viewport, or null
   * before the map has reported bounds. Everything else is reachable under
   * "Elsewhere" so panning is never a prerequisite for finding a place.
   */
  inViewValues: ReadonlySet<string> | null;
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Commit the typed query as a place: geocode it and take the map there. */
  onSubmit: () => void;
  /** Take the map to a suggestion the user picked, by its Mapbox id. */
  onPickSuggestion: (suggestion: PlaceSuggestion, sessionToken: string) => void;
  marketLabel: string | null;
  suggestBbox: {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null;
  suggestProximity: [number, number] | null;
};

// Long enough that a settled word is what gets sent, short enough that the list
// feels like it is keeping up with typing.
const SUGGEST_DEBOUNCE_MS = 220;

const EMPTY_SUGGESTIONS: PlaceSuggestion[] = [];

const SUGGESTION_ICON: Record<string, typeof MapPin> = {
  address: MapPin,
  street: Navigation,
  poi: Building2,
};

function summarizeSelection(
  selected: ReadonlySet<string>,
  options: NeighborhoodFilterOption[],
) {
  if (selected.size === 0) return null;
  if (selected.size === 1) {
    const value = [...selected][0]!;
    return options.find((option) => option.value === value)?.label ?? "1 neighborhood";
  }
  return `${selected.size} neighborhoods`;
}

/**
 * The "Where" field.
 *
 * Neighborhoods used to be a separate pill sitting outside the bar, which read
 * as an afterthought — where you are searching is the same question as which
 * neighborhoods you will accept. Opening the field answers it in the user's
 * current context: the neighborhoods on screen right now come first, checkable,
 * with counts. Typing filters that list and still searches addresses and
 * transit, so free text never stops working.
 */
export function WhereControl({
  searchValue,
  onSearchChange,
  options,
  inViewValues,
  selected,
  onToggle,
  onClear,
  onSubmit,
  onPickSuggestion,
  marketLabel,
  suggestBbox,
  suggestProximity,
}: Props) {
  const { open, setOpen, containerRef, panelRef, triggerRef } =
    useFilterPopover<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const query = searchValue.trim().toLowerCase();
  const { inView, elsewhere } = useMemo(() => {
    const matching = query
      ? options.filter((option) => option.label.toLowerCase().includes(query))
      : options;
    if (!inViewValues) {
      return { inView: matching, elsewhere: [] as NeighborhoodFilterOption[] };
    }
    // A selected neighborhood must appear in exactly one group, always. Ranking
    // in-view first and letting "elsewhere" take everything the first group did
    // not means a pick can never fall through the gap between them — selecting
    // an off-screen neighborhood used to remove it from both lists, leaving no
    // way to un-check it short of clearing every selection. The data layer
    // keeps selected values at count 0 for exactly this reason
    // (neighborhoodFilterOptionsWithCounts); this must not undo that.
    const inView = matching.filter((option) => inViewValues.has(option.value));
    const inViewIds = new Set(inView.map((option) => option.value));
    return {
      inView,
      elsewhere: matching.filter((option) => !inViewIds.has(option.value)),
    };
  }, [inViewValues, options, query]);

  const typed = searchValue.trim();
  const selectionLabel = summarizeSelection(selected, options);

  // One session token per mounted field: Mapbox bills a suggest/retrieve pair
  // sharing a token as a single search rather than one per keystroke.
  // A retrieve closes the Mapbox search session, so the next search needs a
  // new token — reusing one would misgroup later requests and bill oddly.
  const [sessionToken, setSessionToken] = useState(newSearchSessionToken);

  // Results are stored with the query that produced them and only shown while
  // the two still agree. Keeping them keyed that way means a stale response
  // cannot flash under newer typing, and the list clears itself without the
  // effect having to reach back and reset state.
  const [resolved, setResolved] = useState<{
    query: string;
    items: PlaceSuggestion[];
  }>({ query: "", items: [] });
  const suggestions = useMemo(
    () =>
      open && typed.length >= 2 && resolved.query === typed
        ? resolved.items
        : EMPTY_SUGGESTIONS,
    [open, resolved, typed],
  );

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!open || !token || typed.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void suggestPlaces({
        query: typed,
        token,
        sessionToken,
        bbox: suggestBbox,
        proximity: suggestProximity,
        signal: controller.signal,
      }).then((items) => setResolved({ query: typed, items }));
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, sessionToken, suggestBbox, suggestProximity, typed]);
  // ---------------------------------------------------------------------
  // One flat list of rows, in render order, so a single highlight index can
  // walk the whole panel. Neighborhoods and places behave differently on
  // commit — one toggles and stays open, the other flies the map and closes —
  // but both are options in one listbox, which is what lets arrow keys work
  // across them and what `aria-activedescendant` points at.
  // ---------------------------------------------------------------------
  type Row =
    | { kind: "neighborhood"; key: string; option: NeighborhoodFilterOption }
    | { kind: "place"; key: string; suggestion: PlaceSuggestion };

  const rows = useMemo<Row[]>(
    () => [
      ...inView.map((option) => ({
        kind: "neighborhood" as const,
        key: `n:${option.value}`,
        option,
      })),
      ...elsewhere.map((option) => ({
        kind: "neighborhood" as const,
        key: `e:${option.value}`,
        option,
      })),
      ...suggestions.map((suggestion) => ({
        kind: "place" as const,
        key: `p:${suggestion.id}`,
        suggestion,
      })),
    ],
    [elsewhere, inView, suggestions],
  );

  // Typing rebuilds the list, so a held index would point at a different row
  // than the one the user was looking at. Reset during render rather than in an
  // effect, which would paint one frame highlighting the wrong row.
  const [highlight, setHighlight] = useState(-1);
  const listKey = `${open}:${typed}`;
  const [lastListKey, setLastListKey] = useState(listKey);
  if (lastListKey !== listKey) {
    setLastListKey(listKey);
    setHighlight(-1);
  }

  const listId = "apartments-where-listbox";
  const commitRow = (row: Row) => {
    if (row.kind === "place") {
      onPickSuggestion(row.suggestion, sessionToken);
      setSessionToken(newSearchSessionToken());
      setOpen(false);
      return;
    }
    // Toggling stays open: picking neighborhoods is usually plural.
    onToggle(row.option.value);
  };

  const hasAnything = inView.length > 0 || elsewhere.length > 0;

  return (
    <div ref={containerRef} className="kin-seg-wrap flex flex-[1.7]">
      <div
        ref={triggerRef}
        data-open={open ? "true" : undefined}
        className="kin-seg-field flex flex-col justify-center gap-[1px] px-4"
      >
        <label className="kin-field-label" htmlFor="apartments-search">
          Where
        </label>
        <div className="flex items-center gap-2">
          <input
            id="apartments-search"
            ref={inputRef}
            type="text"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              // Handled here rather than left to the document listener in
              // useFilterPopover: that one restores focus through triggerRef,
              // which for this field is a non-focusable <div>, so the close
              // path was unreliable and the panel could stay open.
              if (event.key === "Escape") {
                if (!open) return;
                event.preventDefault();
                event.stopPropagation();
                setHighlight(-1);
                setOpen(false);
                inputRef.current?.focus();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (rows.length === 0) return;
                // Reopen a list dismissed with Escape rather than stranding the
                // keyboard user, per the APG combobox pattern.
                if (!open) {
                  event.preventDefault();
                  setOpen(true);
                  return;
                }
                event.preventDefault();
                setHighlight((current) =>
                  moveHighlight(
                    current,
                    event.key === "ArrowDown" ? 1 : -1,
                    rows.length,
                  ),
                );
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              // Only a row the user deliberately moved to is committed —
              // auto-taking the first would fly the map somewhere they never
              // looked at instead of searching what they typed.
              const row = highlight >= 0 ? rows[highlight] : undefined;
              if (row) {
                commitRow(row);
                return;
              }
              onSubmit();
              setOpen(false);
            }}
            autoComplete="off"
            // A real combobox: the roles alone were half a pattern, promising
            // arrow navigation the field did not implement.
            role="combobox"
            aria-expanded={open && rows.length > 0}
            aria-controls={open && rows.length > 0 ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              highlight >= 0 ? `${listId}-option-${highlight}` : undefined
            }
            aria-describedby="apartments-where-selection"
            placeholder={selectionLabel ?? "Neighborhood, address, or train"}
            className={[
              // kin-focus, not focus:outline-none — the segments lost their
              // drawn borders, so without a ring this control has no keyboard
              // affordance at all (the white-on-cream state swap is ~1.06:1).
              "kin-focus min-w-0 flex-1 bg-transparent text-[13.5px] font-medium leading-[20px] text-[var(--ink-900)]",
              selectionLabel
                ? "placeholder:font-medium placeholder:text-[var(--ink-900)]"
                : "placeholder:font-normal placeholder:text-[var(--ink-600)]",
            ].join(" ")}
          />
          {/* The selection is drawn in the placeholder so the field can still be
              typed into, but a placeholder is not a value — screen readers get
              it from here instead. */}
          <span id="apartments-where-selection" className="sr-only">
            {selected.size > 0
              ? `${selectionLabel} selected`
              : "No neighborhood selected"}
          </span>
          {searchValue || selectionLabel ? (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                onClear();
                inputRef.current?.focus();
              }}
              aria-label="Clear where"
              className="kin-focus -m-1 shrink-0 rounded-full p-1 text-[var(--ink-600)] transition hover:text-[var(--ink-900)]"
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <FilterPopover
        open={open}
        triggerRef={triggerRef}
        panelRef={panelRef}
        align="left"
        offset={13}
        autoFocusPanel={false}
        returnFocusRef={inputRef}
      >
        {/* A listbox, not a dialog: focus stays in the input and the rows are
            never individually tabbable, so there is nothing to trap. The rows
            are divs rather than buttons — a <button role="option"> loses its
            button semantics in the a11y tree while gaining none of the listbox
            interaction. */}
        <div className="kin-popover relative m-0 w-[min(360px,calc(100vw-32px))] overflow-hidden p-0">
          <span aria-live="polite" className="sr-only">
            {open && rows.length > 0
              ? `${rows.length} results. Use arrow keys to review.`
              : ""}
          </span>
          <div
            id={listId}
            role="listbox"
            aria-label="Neighborhoods and places"
            aria-multiselectable="true"
            className="max-h-[min(420px,60vh)] overflow-y-auto"
          >
            {inView.length > 0 ? (
              <NeighborhoodGroup
                heading={
                  inViewValues ? "In the area you're viewing" : "Neighborhoods"
                }
                options={inView}
                selected={selected}
                rows={rows}
                highlight={highlight}
                listId={listId}
                onHighlight={setHighlight}
                onToggle={onToggle}
                groupPrefix="n"
              />
            ) : null}
            {elsewhere.length > 0 ? (
              <NeighborhoodGroup
                heading={marketLabel ? `Elsewhere in ${marketLabel}` : "Elsewhere"}
                options={elsewhere}
                selected={selected}
                rows={rows}
                highlight={highlight}
                listId={listId}
                onHighlight={setHighlight}
                onToggle={onToggle}
                groupPrefix="e"
              />
            ) : null}
            {/* Places come after neighborhoods: checking a neighborhood narrows
                the listings, which is what this search is for, while a place
                only moves the map. Both are always offered — hiding the
                neighborhoods once suggestions arrived meant typing "pac" buried
                Pacific Heights under a list of shops. */}
            {suggestions.length > 0 ? (
              <section className="px-3 pb-1 pt-4">
                <h3 className="px-2 pb-1.5 text-[12px] font-semibold text-[var(--ink-600)]">
                  Places
                </h3>
                <div className="space-y-0.5">
                  {suggestions.map((suggestion) => {
                    const Icon =
                      SUGGESTION_ICON[suggestion.featureType] ?? MapPin;
                    const index = rows.findIndex(
                      (row) => row.key === `p:${suggestion.id}`,
                    );
                    const active = index === highlight;
                    return (
                      <div
                        key={suggestion.id}
                        id={`${listId}-option-${index}`}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setHighlight(index)}
                        // Commit before the input's blur can close the panel.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onPickSuggestion(suggestion, sessionToken);
                          setSessionToken(newSearchSessionToken());
                          setOpen(false);
                        }}
                        className={[
                          "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors",
                          active ? "bg-[var(--bg-soft)]" : "",
                        ].join(" ")}
                      >
                        <span className="grid size-[18px] shrink-0 place-items-center text-[var(--ink-600)]">
                          <Icon size={14} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-[var(--ink-900)]">
                            {suggestion.name}
                          </span>
                          {suggestion.context ? (
                            <span className="block truncate text-[12px] text-[var(--ink-600)]">
                              {suggestion.context}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {!hasAnything && suggestions.length === 0 ? (
              <p className="flex items-start gap-2.5 px-5 pb-4 pt-3 text-[13px] leading-relaxed text-[var(--ink-600)]">
                <MapPin size={14} aria-hidden="true" className="mt-[3px] shrink-0" />
                {typed
                  ? "No neighborhood by that name — searching addresses and places instead."
                  : "No neighborhoods available here yet."}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
            <span className="min-w-0 flex-1 text-[12px] text-[var(--ink-600)]">
              {selected.size > 0
                ? `${selected.size} selected`
                : "Any neighborhood"}
            </span>
            {selected.size > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="kin-focus shrink-0 text-[13px] font-semibold text-[var(--ink-700)] underline-offset-4 transition hover:text-[var(--ink-900)] hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </FilterPopover>
    </div>
  );
}

function NeighborhoodGroup({
  heading,
  options,
  selected,
  rows,
  highlight,
  listId,
  groupPrefix,
  onHighlight,
  onToggle,
}: {
  heading: string;
  options: NeighborhoodFilterOption[];
  selected: ReadonlySet<string>;
  rows: ReadonlyArray<{ key: string }>;
  highlight: number;
  listId: string;
  groupPrefix: string;
  onHighlight: (index: number) => void;
  onToggle: (value: string) => void;
}) {
  return (
    <section className="px-3 pb-2 pt-3 first:pt-4">
      <h3 className="px-2 pb-1.5 text-[12px] font-semibold text-[var(--ink-600)]">
        {heading}
      </h3>
      <div className="space-y-0.5">
        {options.map((option) => {
          const isSelected = selected.has(option.value);
          const index = rows.findIndex(
            (row) => row.key === `${groupPrefix}:${option.value}`,
          );
          const active = index === highlight;
          return (
            <div
              key={option.value}
              id={`${listId}-option-${index}`}
              role="option"
              // In a multi-selectable listbox aria-selected carries the checked
              // state; the visual highlight is the separate "active" row.
              aria-selected={isSelected}
              onMouseEnter={() => onHighlight(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onToggle(option.value);
              }}
              className={[
                "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 text-left transition-colors",
                "h-10",
                active
                  ? "bg-[var(--bg-soft)]"
                  : isSelected
                    ? "bg-[rgba(28,51,38,0.035)]"
                    : "",
                isSelected ? "text-[var(--ink-900)]" : "text-[var(--ink-800)]",
              ].join(" ")}
            >
              <span
                className={[
                  "grid size-[18px] shrink-0 place-items-center rounded-md transition-colors",
                  isSelected
                    ? "bg-[var(--forest-700)] text-white"
                    // --ink-300 measured 1.92:1 on white; this ring is the only
                    // thing that says "unchecked", so it has to clear 3:1.
                    : "bg-white text-transparent shadow-[0_0_0_1.5px_var(--ink-500)]",
                ].join(" ")}
                aria-hidden="true"
              >
                <Check size={12} strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                {option.label}
              </span>
              <span className="mono shrink-0 text-[12px] text-[var(--ink-600)]">
                {option.count}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
