"use client";

import { useCallback, useEffect, useState } from "react";
import {
  resetWelcomeModalSeenState,
  shouldResetWelcomeModals,
} from "@/lib/profiles/welcome-modal-preview";

// Shared first-run gate for the welcome modals. Both the conversation and the
// enrichment welcome share the same open/seen lifecycle — the QA reset hatch,
// the force-preview flag, and the localStorage "seen" check — and differ only in
// their seen key + force function. Each modal owns its own card + escape/overflow
// handling; this hook owns the gate.
export function useWelcomeModalGate({
  seenKey,
  enabled,
  forceFn,
}: {
  seenKey: string;
  enabled: boolean;
  forceFn: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const forced = forceFn();

  useEffect(() => {
    if (shouldResetWelcomeModals()) {
      resetWelcomeModalSeenState();
    }

    if (!enabled && !forced) {
      return;
    }

    let seen = false;
    try {
      seen = window.localStorage.getItem(seenKey) === "1";
    } catch {
      // Storage blocked — better to show once than to swallow the welcome.
    }
    // localStorage is client-only; decide after hydration to avoid markup drift.
    const frame = window.requestAnimationFrame(() => {
      setOpen(forced || !seen);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, forced, seenKey]);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(seenKey, "1");
    } catch {
      // Best-effort; the hub keeps the flow reachable regardless.
    }
  }, [seenKey]);

  return { open, setOpen, forced, markSeen };
}
