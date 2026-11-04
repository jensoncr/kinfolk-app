"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The viewer's saved listings (hearts), backed by /api/plan/saved.
 *
 * State lives in a module-level store shared by every consumer (list cards,
 * map popup, detail modal), so a heart toggled in one surface fills in all of
 * them. Loads once per page and toggles optimistically: the heart flips
 * instantly, and flips back if the server rejects the change. Saves land in
 * saved_places, the shared taste spine that apartment fit and roommate
 * compatibility read.
 */
export function createSavedListingsStore() {
  let savedListingIds: ReadonlySet<string> = new Set();
  let loadStarted = false;
  const listeners = new Set<() => void>();
  // Toggles made before the initial GET resolves must win over the (stale)
  // fetched snapshot, or a slow first load un-fills a just-clicked heart.
  const pendingToggles = new Map<string, boolean>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setSavedListingIds = (next: ReadonlySet<string>) => {
    savedListingIds = next;
    emit();
  };

  const ensureLoaded = () => {
    if (loadStarted) return;
    loadStarted = true;
    void (async () => {
      try {
        const response = await fetch("/api/plan/saved");
        if (!response.ok) return;
        const body = (await response.json()) as { listingIds?: unknown };
        if (Array.isArray(body.listingIds)) {
          const fetched = new Set(
            body.listingIds.filter((id): id is string => typeof id === "string"),
          );
          for (const [listingId, saved] of pendingToggles) {
            if (saved) {
              fetched.add(listingId);
            } else {
              fetched.delete(listingId);
            }
          }
          setSavedListingIds(fetched);
        }
      } catch {
        // Signed-out or transient failure — hearts just start unfilled.
      }
    })();
  };

  const subscribe = (listener: () => void) => {
    ensureLoaded();
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getSnapshot = () => savedListingIds;

  const toggleSavedListing = (listingId: string) => {
    const wasSaved = savedListingIds.has(listingId);
    const next = new Set(savedListingIds);
    if (wasSaved) {
      next.delete(listingId);
    } else {
      next.add(listingId);
    }
    pendingToggles.set(listingId, !wasSaved);
    setSavedListingIds(next);

    // Server rejected or unreachable — revert the optimistic flip.
    const revert = () => {
      pendingToggles.set(listingId, wasSaved);
      const reverted = new Set(savedListingIds);
      if (wasSaved) {
        reverted.add(listingId);
      } else {
        reverted.delete(listingId);
      }
      setSavedListingIds(reverted);
    };
    // Send the desired end state so a retried or raced request can't undo
    // the save the user just made.
    void fetch("/api/plan/saved", {
      body: JSON.stringify({ kind: "listing", listingId, saved: !wasSaved }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).then((response) => {
      if (!response.ok) {
        revert();
      }
    }, revert);
  };

  return { subscribe, getSnapshot, toggleSavedListing };
}

const EMPTY_SAVED_LISTINGS: ReadonlySet<string> = new Set();
const getServerSnapshot = () => EMPTY_SAVED_LISTINGS;

const store = createSavedListingsStore();

export function useSavedListings() {
  const savedListingIds = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot,
  );
  const toggleSavedListing = useCallback(
    (listingId: string) => store.toggleSavedListing(listingId),
    [],
  );
  return { savedListingIds, toggleSavedListing };
}
