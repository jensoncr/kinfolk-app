import { NextResponse } from "next/server";
import {
  decodeListingShortCode,
  normalizeListingShortlinkBaseUrl,
} from "@/lib/apartments/listing-shortlink";
import { captureProductEvent } from "@/lib/integrations/posthog-server";

type RouteContext = {
  params: Promise<{ code: string }>;
};

// The public origin to bounce to. Behind a proxy (Render), request.url is the
// internal origin (e.g. http://localhost:10000), which would hand the user a
// dead redirect — so prefer the configured public base, then the forwarded
// host, and only fall back to request.url for a bare local dev server.
function resolveRedirectBase(request: Request): string {
  const configured = normalizeListingShortlinkBaseUrl(
    process.env.NEXT_PUBLIC_KINFOLK_BASE_URL,
  );
  if (configured) {
    return configured;
  }

  const forwarded = resolveForwardedOrigin(request);
  if (forwarded) {
    return forwarded;
  }

  return (
    normalizeListingShortlinkBaseUrl(new URL(request.url).origin) ??
    "https://usekinfolk.com"
  );
}

function resolveForwardedOrigin(request: Request): string | null {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (!forwardedHost || /[\s/?#\\@]/.test(forwardedHost)) {
    return null;
  }

  const forwardedProto =
    request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase()
      .replace(/:$/, "") || "https";

  if (forwardedProto !== "http" && forwardedProto !== "https") {
    return null;
  }

  return normalizeListingShortlinkBaseUrl(
    `${forwardedProto}://${forwardedHost}`,
  );
}

// Short listing links texted by the agent: /l/<code> is a base62-encoded
// listing uuid, decoded statelessly and bounced to the listing pinned on the
// apartments map. An unparseable code still lands somewhere useful.
export async function GET(request: Request, { params }: RouteContext) {
  const { code } = await params;
  const listingId = decodeListingShortCode(code);
  const destination = listingId
    ? `/apartments?listing=${encodeURIComponent(listingId)}`
    : "/apartments";
  // Anonymous by design: the tap arrives with no session, and the shortlink
  // code itself is the funnel join key back to the agent turn that sent it.
  captureProductEvent({
    distinctId: `shortlink:${code}`,
    event: "shortlink_tapped",
    properties: { code, decoded: Boolean(listingId), listing_id: listingId },
  });
  return NextResponse.redirect(new URL(destination, resolveRedirectBase(request)), {
    status: 302,
  });
}
