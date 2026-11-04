"use client";

import dynamic from "next/dynamic";
import type {
  ApartmentListing,
  ApartmentSearchSnapshot,
} from "@/lib/apartments/types";

function MapViewSkeleton() {
  return (
    <main
      aria-busy="true"
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--background)]"
    >
      <div className="h-14 w-full shrink-0 animate-pulse border-b border-[var(--border)] bg-[var(--bg-soft)]" />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[380px] shrink-0 animate-pulse border-r border-[var(--border)] bg-[var(--bg-soft)] lg:block" />
        <div className="flex-1 animate-pulse bg-[var(--bg-soft)]" />
      </div>
      <span className="sr-only">Loading the apartments map…</span>
    </main>
  );
}

const ApartmentsMapView = dynamic(
  () =>
    import("./apartments-map-view").then((m) => ({
      default: m.ApartmentsMapView,
    })),
  { ssr: false, loading: () => <MapViewSkeleton /> },
);

export function ApartmentsMapViewDynamic({
  initialListing = null,
  initialListingId = null,
  snapshot,
}: {
  initialListing?: ApartmentListing | null;
  initialListingId?: string | null;
  snapshot: ApartmentSearchSnapshot;
}) {
  return (
    <ApartmentsMapView
      initialListing={initialListing}
      initialListingId={initialListingId}
      snapshot={snapshot}
    />
  );
}
