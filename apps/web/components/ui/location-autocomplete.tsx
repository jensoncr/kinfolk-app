"use client";

import { useCallback, useEffect, useId, useReducer, useRef } from "react";
import type { ChangeEvent } from "react";
import {
  LOCATION_SEARCH_MAX_QUERY_LENGTH,
  LOCATION_SEARCH_MIN_QUERY_LENGTH,
  type LocationSuggestion,
} from "@/lib/shared/location-suggestions";
import { findMatchingLocationSuggestion } from "./location-autocomplete-state";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSelect?: (suggestion: LocationSuggestion) => void;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  maxLength?: number;
};

const DEBOUNCE_MS = 220;

type AutocompleteState = {
  loading: boolean;
  suggestions: LocationSuggestion[];
};

type AutocompleteAction =
  | { type: "clear" }
  | { type: "loading" }
  | { type: "results"; suggestions: LocationSuggestion[] };

const INITIAL_AUTOCOMPLETE_STATE: AutocompleteState = {
  loading: false,
  suggestions: [],
};

function autocompleteReducer(
  state: AutocompleteState,
  action: AutocompleteAction,
): AutocompleteState {
  switch (action.type) {
    case "clear":
      return INITIAL_AUTOCOMPLETE_STATE;
    case "loading":
      return { ...state, loading: true };
    case "results":
      return {
        loading: false,
        suggestions: action.suggestions,
      };
  }
}

export function LocationAutocomplete({
  value,
  onChange,
  onSelect,
  ariaLabel = "Location",
  ariaDescribedBy,
  ariaInvalid = false,
  className,
  inputClassName,
  placeholder = "e.g. Chicago, IL",
  maxLength = LOCATION_SEARCH_MAX_QUERY_LENGTH,
}: Props) {
  const listboxId = useId();
  const [{ loading, suggestions }, dispatch] = useReducer(
    autocompleteReducer,
    INITIAL_AUTOCOMPLETE_STATE,
  );
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestSeq = useRef(0);

  const clearPendingSearch = useCallback(() => {
    requestSeq.current += 1;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => clearPendingSearch, [clearPendingSearch]);

  async function runSearch(query: string, seq: number) {
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "loading" });

    try {
      const res = await fetch(`/api/locations/search?q=${encodeURIComponent(query)}`, {
        method: "GET",
        signal: controller.signal,
      });
      if (seq === requestSeq.current) {
        if (res.ok) {
          const data = (await res.json()) as { results?: LocationSuggestion[] };
          if (seq === requestSeq.current) {
            dispatch({ suggestions: data.results ?? [], type: "results" });
          }
        } else {
          dispatch({ type: "clear" });
        }
      }
    } catch {
      if (seq !== requestSeq.current || controller.signal.aborted) return;
      dispatch({ type: "clear" });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  function scheduleSearch(nextValue: string) {
    clearPendingSearch();
    const trimmed = nextValue.trim();
    if (trimmed.length < LOCATION_SEARCH_MIN_QUERY_LENGTH) {
      dispatch({ type: "clear" });
      return;
    }

    const seq = ++requestSeq.current;
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void runSearch(trimmed, seq);
    }, DEBOUNCE_MS);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const nextValue = e.target.value;
    onChange(nextValue);
    const matchingSuggestion = findMatchingLocationSuggestion(
      suggestions,
      nextValue,
    );
    if (matchingSuggestion) {
      clearPendingSearch();
      onSelect?.(matchingSuggestion);
      dispatch({ type: "clear" });
      return;
    }
    scheduleSearch(nextValue);
  }

  return (
    <div className={cn("relative", className)}>
      <input
        type="text"
        list={listboxId}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] text-[var(--pp-ink)]",
          inputClassName,
        )}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={handleInputChange}
      />
      <datalist id={listboxId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion.id} label={suggestion.label} value={suggestion.label}>
            {suggestion.label}
          </option>
        ))}
      </datalist>
      {loading ? (
        <span className="pp-mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
          …
        </span>
      ) : null}
    </div>
  );
}
