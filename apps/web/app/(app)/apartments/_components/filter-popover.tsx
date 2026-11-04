"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  /** Which edge of the panel lines up with the trigger. */
  align?: "left" | "right";
  /** Gap between the trigger's bottom edge and the panel. */
  offset?: number;
  /**
   * Whether opening should move focus into the panel.
   *
   * True for chips and segments, whose trigger is a button and whose controls
   * all live inside the panel. False when the trigger owns a text input: this
   * policy was written for the old neighborhood control, whose search box was
   * *inside* the panel, and stealing focus from a trigger-owned input means the
   * user cannot type at all.
   */
  autoFocusPanel?: boolean;
  /**
   * Where focus returns on close. Defaults to the trigger, which must be
   * focusable — a plain <div> silently swallows .focus().
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function panelFocusables(panel: HTMLDivElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("disabled"));
}

// Container focus lands on the consumer's labelled <dialog> so screen readers
// announce its name ("Sort listings", "Budget range", …); the unnamed portal
// wrapper is only the fallback. The dialog isn't natively focusable, so stamp
// tabindex=-1 before focusing it.
function focusPanelContainer(panel: HTMLDivElement) {
  const dialog = panel.querySelector<HTMLElement>("dialog[aria-label]");
  if (dialog && !dialog.hasAttribute("tabindex")) {
    dialog.setAttribute("tabindex", "-1");
  }
  (dialog ?? panel).focus({ preventScroll: true });
}

/**
 * Renders a filter dropdown in a portal anchored to its trigger chip.
 *
 * The mobile filter bar scrolls horizontally (`overflow-x-auto`), and the CSS
 * spec forces a scroll container's other axis away from `visible` too — so an
 * absolutely-positioned dropdown nested inside it gets clipped to the bar's
 * height. Portaling to <body> with fixed positioning escapes that clip while
 * keeping the panel visually pinned under its chip. Desktop behaves the same.
 */
// How long `.kin-pop-out` runs in globals.css. The panel stays mounted for
// exactly this long after `open` goes false so the exit can play; keep the two
// numbers in step.
const EXIT_MS = 140;

export function FilterPopover({
  open,
  triggerRef,
  panelRef,
  align = "left",
  offset = 8,
  autoFocusPanel = true,
  returnFocusRef,
  children,
}: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const repositionRef = useRef<() => void>(() => {});

  // Mount lags `open` on the way out so the panel can animate away. Every open
  // bumps `openCount`, which keys the wrapper and restarts the entrance —
  // without it, reopening from a different trigger would reuse the finished
  // animation and the panel would just appear.
  //
  // The transition is derived during render rather than in an effect: an
  // effect would paint one frame of the closed panel still fully present
  // before the exit could start.
  const [exiting, setExiting] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (open) {
      setExiting(false);
      setOpenCount((count) => count + 1);
    } else {
      setExiting(true);
    }
  }

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setExiting(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  // Restore focus when the exit actually finishes. Doing it as the open-effect
  // cleanup fired too early: the just-clicked option was still focused and
  // still mounted, so an `activeElement === body` check read false, and the
  // real drop to <body> happened later when the portal unmounted with nothing
  // watching. Checking containment covers both — the element may be gone by now.
  const restoreRef = returnFocusRef ?? triggerRef;
  useEffect(() => {
    if (open || !exiting) return;
    const panel = panelRef.current;
    const restore = restoreRef.current;
    return () => {
      const active = document.activeElement;
      const stranded =
        active === null ||
        active === document.body ||
        (panel?.contains(active) ?? false);
      if (stranded) restore?.focus({ preventScroll: true });
    };
  }, [exiting, open, panelRef, restoreRef]);

  useLayoutEffect(() => {
    repositionRef.current = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 16;
      const panelWidth = panelRef.current?.offsetWidth ?? 0;
      const rawLeft = align === "right" ? rect.right - panelWidth : rect.left;
      const maxLeft = window.innerWidth - panelWidth - margin;
      const left = Math.max(margin, Math.min(rawLeft, maxLeft));
      setPos({ top: rect.bottom + offset, left });
    };
  }, [align, offset, panelRef, triggerRef]);

  useLayoutEffect(() => {
    if (!open) return;
    repositionRef.current();
  }, [align, open, panelRef, triggerRef]);

  // The panel is portaled to the end of <body>, so it sits after the whole
  // page in DOM order — without moving focus in, a keyboard user has to Tab
  // through every listing card before reaching the options. Focus the
  // container, not its first focusable: the budget panel's first focusable is
  // an invisible range thumb (arrow keys would silently change the filter) and
  // the neighborhood panel's is a text input (raises the mobile keyboard).
  // Latched once per open — the panel repositions on every scroll, and that
  // must not re-steal focus the user has since moved elsewhere.
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (!open || !autoFocusPanel) {
      autoFocusedRef.current = false;
      return;
    }
    if (!pos || autoFocusedRef.current) return;
    const panel = panelRef.current;
    if (!panel) return;
    focusPanelContainer(panel);
    autoFocusedRef.current = true;
  }, [autoFocusPanel, open, pos, panelRef]);

  // A focused control can unmount while the panel stays open ("Clear" removes
  // itself): no blur fires, focus silently drops to <body> and the Tab trap
  // disengages. Watch the subtree and pull focus back onto the panel.
  useEffect(() => {
    if (!open || !autoFocusPanel) return;
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new MutationObserver(() => {
      const active = document.activeElement;
      if (active === document.body || active === null) {
        focusPanelContainer(panel);
      }
    });
    observer.observe(panel, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [autoFocusPanel, open, panelRef]);

  // Closing with focus inside the panel (selecting a roommates option
  // unmounts the portal) drops focus to <body>; return it to the trigger.
  // Escape already restores it synchronously (the check no-ops), and outside
  // clicks that land on something focusable keep focus where the user put it.


  useEffect(() => {
    if (!open) return;

    // Position on the next frame (once the panel has measured its own width for
    // right-alignment + viewport clamping), then keep it pinned on scroll/resize.
    const reposition = () => repositionRef.current();
    reposition();
    const raf = requestAnimationFrame(reposition);
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, scrollOptions);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, scrollOptions);
    };
  }, [open]);

  if ((!open && !exiting) || typeof document === "undefined") return null;

  // Trap Tab within the panel; Escape (handled by useFilterPopover) is the
  // keyboard exit and returns focus to the trigger.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panelFocusables(panel);
    if (focusables.length === 0) {
      // Nothing to cycle through (e.g. an empty neighborhood list): keep
      // focus parked on the panel instead of letting Tab escape the dialog.
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    // Forward Tab from a container (wrapper or dialog) naturally enters the
    // first control (containers precede their children in DOM order);
    // backward Tab from a container or the first control wraps to the last.
    const onContainer = !focusables.includes(active as HTMLElement);
    if (event.shiftKey && (active === first || onContainer)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      key={openCount}
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // The panel grows out of the corner nearest its trigger.
        transformOrigin: align === "right" ? "top right" : "top left",
        // Hidden for the first frame until we've measured + placed it.
        visibility: pos ? "visible" : "hidden",
      }}
      className={`z-50 outline-none ${open ? "kin-pop-in" : "kin-pop-out"}`}
    >
      {children}
    </div>,
    document.body,
  );
}
