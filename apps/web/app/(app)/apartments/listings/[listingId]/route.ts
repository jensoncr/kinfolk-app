import { getApartmentListingDetail } from "@/lib/apartments/search";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ listingId: string }>;
};

export async function GET(_request: Request, { params }: Context) {
  const listing = await Promise.all([
    params,
    ensureCurrentKinfolkUser(),
  ]).then(([{ listingId }, { user }]) => {
    const normalizedListingId = listingId.trim();
    return normalizedListingId
      ? getApartmentListingDetail(normalizedListingId, user?.id ?? null)
      : null;
  });

  if (!listing) {
    return Response.json({ error: "Listing not found" }, { status: 404 });
  }

  return Response.json({ listing });
}
