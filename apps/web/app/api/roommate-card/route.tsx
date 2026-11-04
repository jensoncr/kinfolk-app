import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import { loadCardFonts } from "@/lib/shared/card-fonts";
import { clipCardText, formatShortDate } from "@/lib/shared/card-text";
import { fetchCardPhotoDataUrl } from "@/lib/apartments/listing-card-image";
import {
  normalizeProfileCardFitScore,
  parseRoommateProfileCardData,
  type ProfileCardFact,
  resolveProfileCardPhotoUrl,
  verifyRoommateProfileCardToken,
} from "@/lib/profiles/profile-card";

export const runtime = "nodejs";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const CARD_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";
const PROFILE_PHOTO_FETCH_TIMEOUT_MS = 10_000;
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

const profilePanelStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  padding: "0 58px 58px",
  color: "#ffffff",
};

const profileNameStyle: CSSProperties = {
  display: "flex",
  fontFamily: "Fraunces",
  fontSize: 84,
  fontWeight: 650,
  lineHeight: 1,
  textShadow: "0 2px 18px rgba(0,0,0,0.38)",
};

const profileRoleStyle: CSSProperties = {
  display: "flex",
  fontSize: 42,
  fontWeight: 750,
  marginTop: 14,
  color: "rgba(255,255,255,0.9)",
  textShadow: "0 2px 14px rgba(0,0,0,0.34)",
};

const profileRowsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  marginTop: 32,
};

const profileFactRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 18,
  padding: "16px 20px",
  borderRadius: 26,
  backgroundColor: "rgba(255,255,255,0.16)",
  border: "1px solid rgba(255,255,255,0.24)",
  boxShadow: "0 18px 42px rgba(0,0,0,0.16)",
};

const profileFactLabelStyle: CSSProperties = {
  display: "flex",
  width: 150,
  flexShrink: 0,
  fontSize: 26,
  fontWeight: 850,
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.66)",
};

const profileFactValueStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  fontSize: 44,
  fontWeight: 760,
  lineHeight: 1.08,
  color: "#ffffff",
};

const matchPanelStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  padding: "0 56px 52px",
  color: "#ffffff",
};

const matchHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
};

const matchNameStyle: CSSProperties = {
  display: "flex",
  fontFamily: "Fraunces",
  fontSize: 76,
  fontWeight: 600,
};

const matchDateStyle: CSSProperties = {
  display: "flex",
  fontSize: 34,
  color: "rgba(255,255,255,0.85)",
};

const matchRoleStyle: CSSProperties = {
  display: "flex",
  fontFamily: "Fraunces",
  fontSize: 52,
  fontWeight: 600,
  marginTop: 14,
};

const matchGroupLineStyle: CSSProperties = {
  display: "flex",
  fontSize: 32,
  color: "rgba(255,255,255,0.82)",
  marginTop: 6,
};

const matchAboutStyle: CSSProperties = {
  display: "flex",
  fontSize: 32,
  lineHeight: 1.35,
  marginTop: 28,
};

const matchChipsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  marginTop: 30,
};

const matchChipStyle: CSSProperties = {
  display: "flex",
  padding: "12px 18px",
  borderRadius: 999,
  backgroundColor: "rgba(255,255,255,0.16)",
  border: "1px solid rgba(255,255,255,0.24)",
  color: "rgba(255,255,255,0.92)",
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

function buildSelfProfileRows(facts: ProfileCardFact[]) {
  const area = profileFactValue(facts, "Areas");
  const budget = profileFactValue(facts, "Budget");
  const move = profileFactValue(facts, "Move");
  const home = profileFactValue(facts, "Home");
  const roommate = profileFactValue(facts, "Roommate");
  const moveHome =
    move && home
      ? { label: "Move", value: `${move} - ${home}` }
      : move
        ? { label: "Move", value: move }
        : home
          ? { label: "Home", value: home }
          : null;

  return [
    area ? { label: "Area", value: area } : null,
    budget ? { label: "Budget", value: budget } : null,
    moveHome,
    roommate ? { label: "Fit", value: roommate } : null,
  ].flatMap((row) => (row ? [row] : []));
}

function profileFactValue(facts: ProfileCardFact[], label: string) {
  return facts.find((fact) => fact.label.toLowerCase() === label.toLowerCase())
    ?.value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const data = url.searchParams.get("data");
  if (
    !verifyRoommateProfileCardToken({
      data,
      expires: url.searchParams.get("expires"),
      token: url.searchParams.get("token"),
    })
  ) {
    return new Response("Roommate card not found.", { status: 404 });
  }

  const snapshot = parseRoommateProfileCardData(data);
  if (!snapshot) {
    return new Response("Roommate card not found.", { status: 404 });
  }

  // Profile photos can be stored as relative paths (e.g. "/synthetic-profiles/x.png"
  // for seeded matches). The card renderer fetches the URL over the network and only
  // accepts absolute https URLs, so resolve relative paths against the public base URL
  // — otherwise the photo silently drops and the card shows initials instead.
  const photo = await fetchCardPhotoDataUrl({
    height: CARD_HEIGHT,
    imageUrl: resolveProfileCardPhotoUrl({
      baseUrl: process.env.NEXT_PUBLIC_KINFOLK_BASE_URL,
      imageUrl: snapshot.imageUrl,
    }),
    timeoutMs: PROFILE_PHOTO_FETCH_TIMEOUT_MS,
    userAgent: "Kinfolk roommate card renderer",
    width: CARD_WIDTH,
  }).catch(() => null);
  const isProfileCard = snapshot.groupLabel === "Kinfolk profile";
  const score = normalizeProfileCardFitScore(snapshot.fitScore);
  const overlayLabel = isProfileCard
    ? "Kinfolk profile"
    : score == null
      ? "Roommate match"
      : `Roommate match - ${score}% fit`;
  const role = clipCardText(
    snapshot.headline ||
      (isProfileCard ? "Saved housing profile" : "Kinfolk roommate"),
    42,
  );
  const profileRows = buildSelfProfileRows(snapshot.facts);
  const fonts = await loadCardFonts();

  return new ImageResponse(
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

      {isProfileCard ? (
        <div style={profilePanelStyle}>
          <div style={profileNameStyle}>
            {clipCardText(snapshot.requesterName, 22)}
          </div>
          <div style={profileRoleStyle}>
            {role}
          </div>

          <div style={profileRowsStyle}>
            {profileRows.map((fact) => (
              <div
                key={`${fact.label}-${fact.value}`}
                style={profileFactRowStyle}
              >
                <div style={profileFactLabelStyle}>
                  {clipCardText(fact.label, 12)}
                </div>
                <div style={profileFactValueStyle}>
                  {clipCardText(fact.value, 48)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        (() => {
          const groupLine = clipCardText(
            snapshot.groupLabel || "Kinfolk roommate match",
            54,
          );
          const about = clipCardText(
            snapshot.about ??
              "This profile is still coming together. Kinfolk has enough matching signal to compare fit.",
            150,
          );
          const chips = snapshot.facts
            .flatMap((fact) => {
              const chip = clipCardText(fact.value || fact.label, 38);
              return chip ? [chip] : [];
            })
            .slice(0, 4);
          return (
            <div style={matchPanelStyle}>
              <div style={matchHeaderStyle}>
                <div style={matchNameStyle}>
                  {clipCardText(snapshot.requesterName, 22)}
                </div>
                <div style={matchDateStyle}>
                  {formatShortDate(snapshot.requestedAt, "Roommate match")}
                </div>
              </div>

              <div style={matchRoleStyle}>
                {role}
              </div>
              <div style={matchGroupLineStyle}>
                {groupLine}
              </div>

              <div style={matchAboutStyle}>
                {about}
              </div>

              {chips.length > 0 ? (
                <div style={matchChipsStyle}>
                  {chips.map((chip) => (
                    <div
                      key={chip}
                      style={matchChipStyle}
                    >
                      {chip}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })()
      )}
    </div>,
    {
      fonts,
      height: CARD_HEIGHT,
      headers: {
        "cache-control": CARD_CACHE_CONTROL,
      },
      width: CARD_WIDTH,
    },
  );
}
