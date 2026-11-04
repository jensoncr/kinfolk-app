import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import { loadCardFonts } from "@/lib/shared/card-fonts";

// Rich link-preview card for the SMS enrichment handoff. When the text agent
// sends the /me/enrich link, iMessage (via Sendblue) fetches this image plus
// the page's OpenGraph metadata and renders a branded Kinfolk card beneath the
// message — the elegant, Ditto-style preview.
export const runtime = "nodejs";
export const alt = "Finish your Kinfolk profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const rootStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  padding: "72px 80px",
  color: "#f8f6f0",
  fontFamily: "Inter",
  background:
    "radial-gradient(120% 120% at 12% 8%, #264a36 0%, #14271e 46%, #0e1f17 100%)",
};

const topStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 28,
};

const wordmarkStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  fontSize: 26,
  textTransform: "uppercase",
  color: "#a9b4a3",
  fontWeight: 700,
};

const wordmarkDotStyle: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 999,
  background: "#3a9b66",
};

const headlineStyle: CSSProperties = {
  fontFamily: "Fraunces",
  fontWeight: 600,
  fontSize: 92,
  lineHeight: 1.02,
  maxWidth: 880,
};

const bodyStyle: CSSProperties = {
  fontSize: 34,
  lineHeight: 1.35,
  color: "rgba(248,246,240,0.82)",
  maxWidth: 820,
};

const bottomBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderTop: "1px solid rgba(169,180,163,0.28)",
  paddingTop: 28,
};

const ctaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  fontSize: 30,
  fontWeight: 700,
  color: "#f8f6f0",
};

const ctaArrowStyle: CSSProperties = {
  color: "#3a9b66",
};

const domainStyle: CSSProperties = {
  fontSize: 26,
  color: "#a9b4a3",
};

export default async function opengraphImage() {
  const fonts = await loadCardFonts();

  return new ImageResponse(
    (
      <div style={rootStyle}>
        {/* Top: wordmark + eyebrow */}
        <div style={topStackStyle}>
          <div style={wordmarkStyle}>
            <div style={wordmarkDotStyle} />
            Kinfolk
          </div>
          <div style={headlineStyle}>
            Finish your richer profile
          </div>
          <div style={bodyStyle}>
            A few form-friendly details, daily rhythm, must-haves, and the hard
            no&apos;s, make your roommate matches a lot sharper.
          </div>
        </div>

        {/* Bottom bar: CTA + domain */}
        <div style={bottomBarStyle}>
          <div style={ctaStyle}>
            Open your profile
            <span style={ctaArrowStyle}>→</span>
          </div>
          <div style={domainStyle}>
            usekinfolk.com
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.map((font) => ({
        name: font.name,
        data: font.data,
        weight: font.weight,
        style: font.style,
      })),
    },
  );
}
