import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import { loadCardFonts } from "@/lib/shared/card-fonts";
import {
  clipListingCardText,
  formatListingBeds,
  formatListingFitBadge,
  formatListingRent,
  type ListingCardSnapshot,
  parseEmbeddedListingCardData,
  parseListingCardSnapshot,
  verifyEmbeddedListingCardToken,
  verifyListingCardToken,
} from "@/lib/apartments/listing-card";
import { fetchListingCardPhotoDataUrl } from "@/lib/apartments/listing-card-image";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

// Scrim that keeps the top of the photo clear and darkens the bottom so the
// overlaid white text stays legible over any image.
const SCRIM =
  "linear-gradient(to bottom, rgba(13,16,15,0) 34%, rgba(13,16,15,0.45) 56%, rgba(13,16,15,0.82) 78%, rgba(13,16,15,0.94) 100%)";

const containerStyle = {
  position: "relative",
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  display: "flex",
  fontFamily: "Inter",
  backgroundImage: "linear-gradient(150deg, #3a4a52, #181d22)",
} satisfies CSSProperties;

const photoStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  backgroundPosition: "center",
  backgroundSize: "cover",
} satisfies CSSProperties;

function listingPhotoStyle(imageSource: string): CSSProperties {
  return {
    ...photoStyle,
    backgroundImage: `url(${imageSource})`,
  };
}

const scrimStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  display: "flex",
  backgroundImage: SCRIM,
} satisfies CSSProperties;

const fitBadgeStyle = {
  position: "absolute",
  top: 36,
  left: 36,
  display: "flex",
  padding: "14px 26px",
  borderRadius: 999,
  backgroundColor: "rgba(13, 16, 15, 0.6)",
  border: "2px solid rgba(255,255,255,0.28)",
  color: "#ffffff",
  fontSize: 32,
  fontWeight: 700,
} satisfies CSSProperties;

const wordmarkStyle = {
  position: "absolute",
  top: 44,
  right: 40,
  display: "flex",
  color: "rgba(255,255,255,0.92)",
  fontSize: 30,
  fontWeight: 800,
} satisfies CSSProperties;

const contentStyle = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  padding: "0 56px 56px",
  color: "#ffffff",
} satisfies CSSProperties;

const rowStyle = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
} satisfies CSSProperties;

const rentStyle = {
  display: "flex",
  fontFamily: "Fraunces",
  fontSize: 80,
  fontWeight: 600,
} satisfies CSSProperties;

// The rent is set in 80px Fraunces, the beds label in 34px Inter: bottom
// alignment alone leaves the small label sunk below the rent's baseline by
// the descender difference, so this pad lifts it back onto the shared line.
const bedsStyle = {
  display: "flex",
  fontSize: 34,
  color: "rgba(255,255,255,0.85)",
  paddingBottom: 12,
} satisfies CSSProperties;

const addressStyle = {
  display: "flex",
  fontFamily: "Fraunces",
  fontSize: 54,
  fontWeight: 600,
  marginTop: 14,
} satisfies CSSProperties;

const neighborhoodStyle = {
  display: "flex",
  fontSize: 32,
  color: "rgba(255,255,255,0.82)",
  marginTop: 6,
} satisfies CSSProperties;

type RouteContext = {
  params: Promise<{ recommendationId: string }>;
};

type ListingCardSource = { rank: number; snapshot: ListingCardSnapshot };

function sourceEmbeddedListingCard(url: URL): ListingCardSource | Response {
  const data = url.searchParams.get("data");
  if (
    !verifyEmbeddedListingCardToken({
      data,
      expires: url.searchParams.get("expires"),
      token: url.searchParams.get("token"),
    })
  ) {
    return new Response("Listing card not found.", { status: 404 });
  }

  const snapshot = parseEmbeddedListingCardData(data);
  if (!snapshot) {
    return new Response("Listing card not found.", { status: 404 });
  }

  return {
    rank: normalizeListingCardRank(url.searchParams.get("rank")),
    snapshot,
  };
}

async function sourceListingCardFromRecommendation(
  recommendationId: string,
  url: URL,
): Promise<ListingCardSource | Response> {
  if (
    !verifyListingCardToken({
      expires: url.searchParams.get("expires"),
      recommendationId,
      token: url.searchParams.get("token"),
    })
  ) {
    return new Response("Listing card not found.", { status: 404 });
  }

  const supabase = createSupabaseServiceClient();
  const result = await supabase
    .from("text_listing_recommendations")
    .select("card_snapshot, rank")
    .eq("id", recommendationId)
    .maybeSingle();

  if (result.error) {
    console.error("[listing-card] Failed to load card snapshot.", {
      error: result.error.message,
      recommendationId,
    });
    return new Response("Listing card unavailable.", { status: 500 });
  }

  const snapshot = parseListingCardSnapshot(result.data?.card_snapshot);
  if (!snapshot) {
    return new Response("Listing card not found.", { status: 404 });
  }

  return { rank: result.data?.rank ?? 1, snapshot };
}

function normalizeListingCardRank(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

/**
 * Renders one listing recommendation as a self-describing card image. The
 * carousel sends these as media parts, so the listing essentials live in the
 * picture rather than in a separate wall of text messages. The photo fills the
 * whole card; a bottom gradient carries the overlaid rent, beds, and address.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const { recommendationId } = await params;
  const url = new URL(request.url);

  // The `embedded` segment is a sentinel (never a real UUID id): the snapshot
  // rides in a signed query blob instead of a persisted recommendation row, so
  // match notifications can render a card before any thread/DB row exists.
  const sourced =
    recommendationId === "embedded"
      ? sourceEmbeddedListingCard(url)
      : await sourceListingCardFromRecommendation(recommendationId, url);

  if (sourced instanceof Response) {
    return sourced;
  }

  const { rank, snapshot } = sourced;
  const rent = formatListingRent(snapshot);
  const beds = formatListingBeds(snapshot);
  const badge = formatListingFitBadge(snapshot, rank);
  const [imageSource, fonts] = await Promise.all([
    fetchListingCardPhotoDataUrl({
      height: CARD_HEIGHT,
      imageUrl: snapshot.imageUrl,
      width: CARD_WIDTH,
    }).catch(() => null),
    loadCardFonts(),
  ]);

  return new ImageResponse(
    (
      <div style={containerStyle}>
        {imageSource ? (
          <div aria-hidden="true" style={listingPhotoStyle(imageSource)} />
        ) : null}

        {/* Bottom-weighted scrim for text legibility */}
        <div style={scrimStyle} />

        {/* Fit overlay, top-left */}
        <div style={fitBadgeStyle}>
          {badge}
        </div>

        {/* Kinfolk wordmark, top-right */}
        <div style={wordmarkStyle}>
          Kinfolk
        </div>

        {/* Overlaid content, anchored to the bottom */}
        <div style={contentStyle}>
          <div style={rowStyle}>
            <div style={rentStyle}>
              {rent ?? "Rent in Kinfolk"}
            </div>
            <div style={bedsStyle}>
              {beds}
            </div>
          </div>

          <div style={addressStyle}>
            {clipListingCardText(snapshot.address, 42)}
          </div>
          <div style={neighborhoodStyle}>
            {clipListingCardText(snapshot.neighborhood, 52)}
          </div>
        </div>
      </div>
    ),
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts,
      headers: {
        "cache-control": "public, max-age=86400, s-maxage=86400",
      },
    },
  );
}
