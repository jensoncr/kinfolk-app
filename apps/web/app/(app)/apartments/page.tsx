import type { Metadata } from "next";
import { ApartmentsMapViewDynamic } from "@/app/(app)/apartments/_components/apartments-map-view-dynamic";
import {
  getApartmentListingDetail,
  getApartmentSearchSnapshot,
  preloadApartmentSearchCatalog,
} from "@/lib/apartments/search";
import { normalizePublicHttpsOrigin } from "@/lib/shared/public-url";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const dynamic = "force-dynamic";

const APARTMENTS_META_DESCRIPTION =
  "Kinfolk matches renters with compatible roommate groups and apartments they can actually afford together.";

// Per-listing link preview: the agent texts usekinfolk.com/l/<code>, which 302s
// here with ?listing=<uuid>. Emitting per-listing OpenGraph/Twitter tags lets
// iMessage hydrate the link into a rich card (photo + price + beds) instead of a
// bare URL. Falls back to the generic Apartments metadata without a listing.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string | string[] }>;
}): Promise<Metadata> {
  const listingId = normalizeListingQueryValue((await searchParams).listing);
  if (!listingId) {
    return { title: "Apartments", description: APARTMENTS_META_DESCRIPTION };
  }

  const detail = await getApartmentListingDetail(listingId, null).catch(
    () => null,
  );
  if (!detail) {
    return { title: "Apartments", description: APARTMENTS_META_DESCRIPTION };
  }

  const title = buildListingMetaTitle(detail);
  const description = buildListingMetaDescription(detail);
  const image = detail.photoUrl ?? null;
  const url = buildListingMetadataUrl(detail.id);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(url ? { url } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

function buildListingMetadataUrl(listingId: string) {
  const origin = normalizePublicHttpsOrigin(
    process.env.NEXT_PUBLIC_KINFOLK_BASE_URL,
  );
  if (!origin) {
    return undefined;
  }

  return new URL(
    `/apartments?listing=${encodeURIComponent(listingId)}`,
    origin,
  ).toString();
}

export default async function ApartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string | string[] }>;
}) {
  const catalogWarmupPromise = preloadApartmentSearchCatalog();
  void catalogWarmupPromise;
  const currentUserPromise = ensureCurrentKinfolkUser();
  const initialListingIdPromise = searchParams.then(({ listing }) =>
    normalizeListingQueryValue(listing),
  );
  const activeUserIdPromise = currentUserPromise.then(
    ({ user }) => user?.id ?? null,
  );
  const snapshotPromise = activeUserIdPromise.then(getApartmentSearchSnapshot);
  const initialListingPromise = Promise.all([
    initialListingIdPromise,
    activeUserIdPromise,
  ]).then(([initialListingId, activeUserId]) =>
    initialListingId
      ? getApartmentListingDetail(initialListingId, activeUserId)
      : null,
  );
  const [snapshot, initialListingId, initialListing] = await Promise.all([
    snapshotPromise,
    initialListingIdPromise,
    initialListingPromise,
  ]);

  return (
    <ApartmentsMapViewDynamic
      initialListing={initialListing}
      initialListingId={initialListingId}
      snapshot={snapshot}
    />
  );
}

function normalizeListingQueryValue(listing: string | string[] | undefined) {
  if (typeof listing !== "string") {
    return null;
  }

  return listing.trim() || null;
}

function buildListingMetaTitle(detail: {
  address: string | null;
  perPersonRent: number | null;
  effectivePerPersonRent: number | null;
  monthlyRent: number | null;
  effectiveMonthlyRent: number | null;
}) {
  const address = detail.address ?? "This listing";
  const perPerson = detail.effectivePerPersonRent ?? detail.perPersonRent;
  const monthly = detail.effectiveMonthlyRent ?? detail.monthlyRent;
  // Only lead with the per-person figure when the unit actually splits — a solo
  // studio shouldn't read as "$X/person".
  if (perPerson != null && monthly != null && perPerson < monthly) {
    return `$${Math.round(perPerson).toLocaleString()}/person · ${address}`;
  }
  if (monthly != null) {
    return `$${Math.round(monthly).toLocaleString()}/mo · ${address}`;
  }
  if (perPerson != null) {
    return `$${Math.round(perPerson).toLocaleString()}/person · ${address}`;
  }
  return `${address} · Kinfolk`;
}

function buildListingMetaDescription(detail: {
  bedrooms: number | null;
  bathrooms: number | null;
  monthlyRent: number | null;
  effectiveMonthlyRent: number | null;
  neighborhood: string | null;
}) {
  const parts: string[] = [];
  if (detail.bedrooms != null) {
    parts.push(detail.bedrooms === 0 ? "Studio" : `${detail.bedrooms} bed`);
  }
  if (detail.bathrooms != null) {
    parts.push(`${detail.bathrooms} bath`);
  }
  const monthly = detail.effectiveMonthlyRent ?? detail.monthlyRent;
  if (monthly != null) {
    parts.push(`$${Math.round(monthly).toLocaleString()}/mo`);
  }
  if (detail.neighborhood) {
    parts.push(detail.neighborhood);
  }
  return parts.length > 0
    ? `${parts.join(" · ")}. See it on the Kinfolk map and start a group.`
    : APARTMENTS_META_DESCRIPTION;
}
