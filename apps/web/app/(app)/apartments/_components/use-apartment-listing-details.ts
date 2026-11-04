"use client";

import { useCallback, useRef } from "react";
import type { ApartmentListing } from "@/lib/apartments/types";

type UseApartmentListingDetailsArgs = {
  initialListings?: readonly ApartmentListing[];
  onClearLoading: () => void;
  onOpenListing: (listing: ApartmentListing) => void;
  onStartLoading: (listingId: string) => void;
};

function mergeListingDetailScore(
  summary: ApartmentListing,
  detail: ApartmentListing,
): ApartmentListing {
  // Keep the summary's fit score when the detail fetch came back without one.
  if (detail.fitScore <= 0 && summary.fitScore > 0) {
    return { ...detail, fitScore: summary.fitScore };
  }
  return detail;
}

export function useApartmentListingDetails({
  initialListings = [],
  onClearLoading,
  onOpenListing,
  onStartLoading,
}: UseApartmentListingDetailsArgs) {
  const detailCacheRef = useRef<Map<string, ApartmentListing> | null>(null);
  if (detailCacheRef.current === null) {
    detailCacheRef.current = new Map(
      initialListings.map((listing) => [listing.id, listing]),
    );
  }
  const detailFetchCacheRef = useRef<Map<string, Promise<ApartmentListing>> | null>(null);
  if (detailFetchCacheRef.current === null) {
    detailFetchCacheRef.current = new Map();
  }
  const pendingDetailIdRef = useRef<string | null>(null);

  const getDetailCache = useCallback(() => {
    let cache = detailCacheRef.current;
    if (cache === null) {
      cache = new Map();
      detailCacheRef.current = cache;
    }
    return cache;
  }, []);

  const getDetailFetchCache = useCallback(() => {
    let cache = detailFetchCacheRef.current;
    if (cache === null) {
      cache = new Map();
      detailFetchCacheRef.current = cache;
    }
    return cache;
  }, []);

  const fetchListingDetails = useCallback((listing: ApartmentListing) => {
    const detailCache = getDetailCache();
    const detailFetchCache = getDetailFetchCache();
    const cached = detailCache.get(listing.id);
    if (cached) {
      return Promise.resolve(cached);
    }

    const pending = detailFetchCache.get(listing.id);
    if (pending) {
      return pending;
    }

    const request = fetch(`/apartments/listings/${encodeURIComponent(listing.id)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load listing detail.");
        const payload = (await response.json()) as { listing?: ApartmentListing };
        const fullListing = payload.listing
          ? mergeListingDetailScore(listing, payload.listing)
          : listing;
        detailCache.set(listing.id, fullListing);
        return fullListing;
      })
      .finally(() => {
        detailFetchCache.delete(listing.id);
      });

    detailFetchCache.set(listing.id, request);
    return request;
  }, [getDetailCache, getDetailFetchCache]);

  const prefetchListingDetails = useCallback(
    (listing: ApartmentListing) => {
      void fetchListingDetails(listing).catch(() => {
        // The modal still opens with summary data if intent prefetch fails.
      });
    },
    [fetchListingDetails],
  );

  const openListingDetails = useCallback(
    async (listing: ApartmentListing) => {
      const cached = getDetailCache().get(listing.id);
      if (cached) {
        pendingDetailIdRef.current = null;
        onOpenListing(cached);
        return;
      }

      onOpenListing(listing);
      onStartLoading(listing.id);
      pendingDetailIdRef.current = listing.id;

      try {
        const fullListing = await fetchListingDetails(listing);
        if (pendingDetailIdRef.current === listing.id) {
          onOpenListing(fullListing);
        }
      } catch {
        // Modal already open with summary data.
      } finally {
        if (pendingDetailIdRef.current === listing.id) {
          onClearLoading();
          pendingDetailIdRef.current = null;
        }
      }
    },
    [fetchListingDetails, getDetailCache, onClearLoading, onOpenListing, onStartLoading],
  );

  const cacheListingDetails = useCallback(
    (listing: ApartmentListing) => {
      getDetailCache().set(listing.id, listing);
      onOpenListing(listing);
    },
    [getDetailCache, onOpenListing],
  );

  return {
    cacheListingDetails,
    openListingDetails,
    prefetchListingDetails,
  };
}
