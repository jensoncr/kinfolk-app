import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import { loadCardFonts } from "@/lib/shared/card-fonts";
import { clipCardText, formatShortDate } from "@/lib/shared/card-text";
import { fetchCardPhotoDataUrl } from "@/lib/apartments/listing-card-image";
import {
  normalizeProfileCardFitScore,
  parseGroupJoinProfileCardSnapshot,
  resolveProfileCardPhotoUrl,
  verifyGroupJoinProfileCardToken,
} from "@/lib/profiles/profile-card";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const PROFILE_PHOTO_FETCH_TIMEOUT_MS = 10_000;

// Same bottom-weighted scrim as the listing card so the two read as a set.
const SCRIM =
  "linear-gradient(to bottom, rgba(13,16,15,0) 30%, rgba(13,16,15,0.42) 52%, rgba(13,16,15,0.8) 76%, rgba(13,16,15,0.95) 100%)";

const cardRootStyle: CSSProperties = {
  position: "relative",
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  display: "flex",
  fontFamily: "Inter",
  backgroundImage: "linear-gradient(150deg, #2f5440, #15241b)",
};

const fallbackInitialsStyle: CSSProperties = {
  position: "absolute",
  top: 150,
  left: 0,
  width: CARD_WIDTH,
  display: "flex",
  justifyContent: "center",
  color: "rgba(255,255,255,0.9)",
  fontSize: 300,
  fontWeight: 800,
};

const scrimStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  display: "flex",
  backgroundImage: SCRIM,
};

const overlayBadgeStyle: CSSProperties = {
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
};

const brandStyle: CSSProperties = {
  position: "absolute",
  top: 44,
  right: 40,
  display: "flex",
  color: "rgba(255,255,255,0.92)",
  fontSize: 30,
  fontWeight: 800,
};

const contentStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  padding: "0 56px 52px",
  color: "#ffffff",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
};

const nameStyle: CSSProperties = {
  display: "flex",
  fontFamily: "Fraunces",
  fontSize: 76,
  fontWeight: 600,
};

const dateStyle: CSSProperties = {
  display: "flex",
  fontSize: 34,
  color: "rgba(255,255,255,0.85)",
};

const roleStyle: CSSProperties = {
  display: "flex",
  fontFamily: "Fraunces",
  fontSize: 52,
  fontWeight: 600,
  marginTop: 14,
};

const groupLineStyle: CSSProperties = {
  display: "flex",
  fontSize: 32,
  color: "rgba(255,255,255,0.82)",
  marginTop: 6,
};

const aboutStyle: CSSProperties = {
  display: "flex",
  fontSize: 30,
  lineHeight: 1.4,
  color: "rgba(255,255,255,0.9)",
  marginTop: 20,
};

const chipsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
  marginTop: 26,
};

const chipStyle: CSSProperties = {
  display: "flex",
  padding: "12px 22px",
  borderRadius: 999,
  backgroundColor: "rgba(255,255,255,0.14)",
  border: "2px solid rgba(255,255,255,0.45)",
  color: "#ffffff",
  fontSize: 26,
  fontWeight: 600,
};

const actionHintStyle: CSSProperties = {
  display: "flex",
  marginTop: 30,
  color: "rgba(255,255,255,0.82)",
  fontSize: 28,
  fontWeight: 700,
};

function photoBackgroundStyle(photo: string): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundImage: `url(${photo})`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
}

type RouteContext = {
  params: Promise<{ notificationId: string }>;
};

/**
 * Renders one group join request as a full-bleed photo card, matching the
 * listing card: the requester's photo fills the frame and a bottom gradient
 * carries the overlaid name / role / group / bio / living-style chips. The
 * recipient decides straight from the picture (👍 accept · 👎 decline).
 */
export async function GET(request: Request, { params }: RouteContext) {
  const { notificationId } = await params;
  const url = new URL(request.url);
  if (
    !verifyGroupJoinProfileCardToken({
      expires: url.searchParams.get("expires"),
      notificationId,
      token: url.searchParams.get("token"),
    })
  ) {
    return new Response("Profile card not found.", { status: 404 });
  }

  const supabase = createSupabaseServiceClient();
  const result = await supabase
    .from("text_group_join_notifications")
    .select("card_snapshot")
    .eq("id", notificationId)
    .maybeSingle();

  if (result.error) {
    console.error("[profile-card] Failed to load card snapshot.", {
      error: result.error.message,
      notificationId,
    });
    return new Response("Profile card unavailable.", { status: 500 });
  }

  const snapshot = parseGroupJoinProfileCardSnapshot(result.data?.card_snapshot);
  if (!snapshot) {
    return new Response("Profile card not found.", { status: 404 });
  }

  const photo = await fetchCardPhotoDataUrl({
    height: CARD_HEIGHT,
    imageUrl: resolveProfileCardPhotoUrl({
      baseUrl: process.env.NEXT_PUBLIC_KINFOLK_BASE_URL,
      imageUrl: snapshot.imageUrl,
    }),
    timeoutMs: PROFILE_PHOTO_FETCH_TIMEOUT_MS,
    userAgent: "Kinfolk profile card renderer",
    width: CARD_WIDTH,
  }).catch(() => null);
  const score = normalizeProfileCardFitScore(snapshot.fitScore);
  const overlayLabel = score == null ? "New join request" : `Join request · ${score}% fit`;
  const role = clipCardText(snapshot.headline || "Roommate request", 42);
  const groupLine = clipCardText(
    snapshot.groupNeighborhood
      ? `Wants your ${snapshot.groupLabel} · ${snapshot.groupNeighborhood}`
      : `Wants your ${snapshot.groupLabel}`,
    52,
  );
  const about = clipCardText(
    snapshot.about ??
      "This profile is still coming together. Kinfolk has enough context to route the request, but not a full bio yet.",
    150,
  );
  const chips = snapshot.facts
    .flatMap((fact) => {
      const chip = clipCardText(fact.value || fact.label, 38);
      return chip ? [chip] : [];
    })
    .slice(0, 4);
  const fonts = await loadCardFonts();

  return new ImageResponse(
    (
      <div style={cardRootStyle}>
        {photo ? (
          <div style={photoBackgroundStyle(photo)} />
        ) : (
          <div style={fallbackInitialsStyle}>
            {snapshot.requesterInitials}
          </div>
        )}

        <div style={scrimStyle} />

        <div style={overlayBadgeStyle}>
          {overlayLabel}
        </div>

        <div style={brandStyle}>
          Kinfolk
        </div>

        <div style={contentStyle}>
          <div style={headerRowStyle}>
            <div style={nameStyle}>
              {clipCardText(snapshot.requesterName, 22)}
            </div>
            <div style={dateStyle}>
              {formatShortDate(snapshot.requestedAt, "New request")}
            </div>
          </div>

          <div style={roleStyle}>
            {role}
          </div>
          <div style={groupLineStyle}>
            {groupLine}
          </div>

          <div style={aboutStyle}>
            {about}
          </div>

          <div style={chipsStyle}>
            {chips.map((chip, index) => (
              <div
                key={`${index}-${chip}`}
                style={chipStyle}
              >
                {chip}
              </div>
            ))}
          </div>

          <div style={actionHintStyle}>
            👍 to accept · 👎 to decline
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
