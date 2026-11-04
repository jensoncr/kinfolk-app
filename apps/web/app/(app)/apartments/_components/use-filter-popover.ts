"use client";

import { useEffect, useRef, useState } from "react";

// Generic over the trigger element: chips and segments trigger from a
// <button>, but the "Where" field triggers from the div wrapping its input.
export function useFilterPopover<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    // The panel is portaled out of containerRef, so dismissal must also spare
    // taps inside panelRef. `pointerdown` fires on any element on touch devices
    // (legacy `mousedown` does not reliably fire on non-interactive elements in
    // iOS Safari), so tapping the map to dismiss works on mobile.
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return { open, setOpen, containerRef, panelRef, triggerRef };
}
