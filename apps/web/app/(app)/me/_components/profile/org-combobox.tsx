"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { OrgKind, OrgSuggestion } from "@/lib/orgs/types";
import { applyTextEdit, isSearchableQuery, moveHighlight, type OrgPick } from "./org-combobox-state";

const DEBOUNCE_MS = 220;

/**
 * Typeahead over real organizations. The user picks an entity (which carries a
 * domain, the stable key behind logos and same-employer matching) or keeps
 * typing free text — free text always saves, so a missing record never blocks
 * someone from recording where they work.
 */
export function OrgCombobox({
  ariaLabel,
  kind,
  inputId,
  logoUrl,
  maxLength,
  onChange,
  placeholder,
  savedDomain,
  value,
}: {
  ariaLabel: string;
  /** Lets a caller label this input without wrapping the popup listbox. */
  inputId?: string;
  kind: OrgKind;
  /** Logo re-hosted for `savedDomain`, if there is one. */
  logoUrl?: string | null;
  maxLength: number;
  onChange: (pick: OrgPick) => void;
  placeholder: string;
  /** Domain the saved `logoUrl` belongs to. */
  savedDomain?: string | null;
  value: OrgPick;
}) {
  // What the user typed, which is not the same as the current value: choosing
  // a suggestion also changes the value, and searching for the text we just
  // filled in reopened the menu over a completed pick.
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<OrgSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const statusId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Monotonic counter. A response is applied only if no newer query has
  // started, so a slow reply can never repopulate the menu for text the user
  // has already moved past.
  const queryTokenRef = useRef(0);

  useEffect(() => {
    const token = (queryTokenRef.current += 1);
    const controller = new AbortController();

    // Everything below runs on the debounce timer rather than in the effect
    // body: clearing state synchronously here would cascade a render per
    // keystroke.
    const timer = window.setTimeout(async () => {
      if (!isSearchableQuery(query)) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(
          `/api/kinfolk/orgs/search?kind=${kind}&q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("search failed");
        const body: { suggestions?: OrgSuggestion[] } = await response.json();
        if (token !== queryTokenRef.current) return;

        setSuggestions(body.suggestions ?? []);
        setHighlight(-1);
        setOpen((body.suggestions ?? []).length > 0);
      } catch {
        // A dead typeahead is a silent downgrade to free text, not an error
        // worth interrupting someone mid-edit.
        if (token === queryTokenRef.current) setSuggestions([]);
      } finally {
        if (token === queryTokenRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [kind, query]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Keep the active option visible: six suggestions overflow the menu box.
  useEffect(() => {
    if (highlight < 0) return;
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function closeMenu() {
    // Retire the in-flight token here rather than in the effect: an older
    // response could otherwise land between the event and the re-render and
    // reopen a menu the user has already moved past.
    queryTokenRef.current += 1;
    setSuggestions([]);
    setOpen(false);
    setHighlight(-1);
  }

  function choose(suggestion: OrgSuggestion) {
    closeMenu();
    setQuery("");
    onChange({ label: suggestion.name, domain: suggestion.domain });
  }

  function editText(nextLabel: string) {
    // Retire the open menu immediately. Leaving it live through the debounce
    // meant Enter could commit the previous query's organization over freshly
    // typed text.
    closeMenu();
    setQuery(nextLabel);
    onChange(applyTextEdit(value, nextLabel));
  }

  const showMenu = open && suggestions.length > 0;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (showMenu) {
        event.stopPropagation();
        setOpen(false);
        setHighlight(-1);
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Reopen a menu dismissed with Escape rather than stranding the keyboard
      // user, per the APG combobox pattern.
      if (!showMenu && suggestions.length > 0) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!showMenu) return;
      event.preventDefault();
      setHighlight((current) =>
        moveHighlight(current, event.key === "ArrowDown" ? 1 : -1, suggestions.length),
      );
      return;
    }

    if (event.key === "Enter" && showMenu) {
      // Always swallow Enter while the menu is open: in the enrichment form
      // this input sits inside a <form>, so falling through submitted the whole
      // page with a half-typed label. But only an option the user actually
      // moved to is committed — auto-selecting the first row replaced
      // deliberate free text with an organization they never looked at.
      event.preventDefault();
      if (highlight >= 0) {
        choose(suggestions[highlight]);
      } else {
        closeMenu();
      }
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5">
        <OrgMark
          domain={value.domain}
          logoUrl={savedDomain && savedDomain === value.domain ? (logoUrl ?? null) : null}
          name={value.label}
        />
        <input
          aria-activedescendant={highlight >= 0 ? `${listId}-option-${highlight}` : undefined}
          aria-autocomplete="list"
          aria-controls={showMenu ? listId : undefined}
          aria-expanded={showMenu}
          aria-label={ariaLabel}
          autoComplete="off"
          className="kin-focus w-full rounded-lg bg-transparent text-[15px] text-[var(--pp-ink)] outline-none"
          id={inputId}
          maxLength={maxLength}
          onChange={(event) => editText(event.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={value.label}
        />
        {loading ? (
          <span aria-hidden className="pp-mono text-[10px] text-[var(--pp-ink-40)]">
            …
          </span>
        ) : null}
      </div>

      <span aria-live="polite" className="sr-only" id={statusId}>
        {showMenu ? `${suggestions.length} organizations found. Use arrow keys to review.` : ""}
      </span>

      {showMenu ? (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] py-1 shadow-lg"
          id={listId}
          ref={listRef}
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <li
              aria-selected={index === highlight}
              className={`flex cursor-pointer items-center gap-2.5 px-2.5 py-2 ${
                index === highlight ? "bg-[rgba(28,51,38,0.05)]" : ""
              }`}
              id={`${listId}-option-${index}`}
              key={`${suggestion.domain}:${suggestion.name}`}
              onMouseDown={(event) => {
                // Commit before the input's blur closes the menu.
                event.preventDefault();
                choose(suggestion);
              }}
              onMouseEnter={() => setHighlight(index)}
              role="option"
            >
              <SuggestionIcon iconUrl={suggestion.iconUrl} name={suggestion.name} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] text-[var(--pp-ink)]">
                  {suggestion.name}
                </span>
                <span className="pp-mono block truncate text-[11px] text-[var(--pp-ink-40)]">
                  {suggestion.domain}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Confirmation that a real organization is attached, not just typed text.
 *
 * The caller passes a logo only when it belongs to the domain currently
 * picked; otherwise this falls to the favicon or a monogram. Showing the
 * previously saved mark beside a newly chosen organization is the same
 * wrong-pairing this round exists to remove.
 */
function OrgMark({
  domain,
  logoUrl,
  name,
}: {
  domain: string | null;
  logoUrl: string | null;
  name: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = domain
    ? (logoUrl ??
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`)
    : null;

  if (!src || failedSrc === src) {
    return (
      <span
        aria-hidden
        className="pp-mono grid size-7 shrink-0 place-items-center rounded-md border border-[var(--pp-hairline)] text-[10px] font-semibold text-[var(--pp-ink-40)]"
      >
        {initials(name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party favicon host; Next's optimizer would proxy it server-side.
    <img
      alt=""
      className="size-7 shrink-0 rounded-md border border-[var(--pp-hairline)] object-contain p-0.5"
      height={28}
      onError={() => setFailedSrc(src)}
      src={src}
      width={28}
    />
  );
}

function SuggestionIcon({ iconUrl, name }: { iconUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false);

  if (!iconUrl || failed) {
    return (
      <span
        aria-hidden
        className="pp-mono grid size-6 shrink-0 place-items-center rounded-md border border-[var(--pp-hairline)] text-[9px] font-semibold text-[var(--pp-ink-40)]"
      >
        {initials(name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party icon host; Next's optimizer would proxy it server-side.
    <img
      alt=""
      className="size-6 shrink-0 rounded-md border border-[var(--pp-hairline)] object-contain p-0.5"
      height={24}
      onError={() => setFailed(true)}
      src={iconUrl}
      width={24}
    />
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}
