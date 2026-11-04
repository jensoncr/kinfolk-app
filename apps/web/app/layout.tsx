import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Mono, Onest } from "next/font/google";
import "./globals.css";

const onest = Onest({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono",
});

// A production deploy missing NEXT_PUBLIC_KINFOLK_BASE_URL must emit absolute
// OG/canonical URLs against the real domain, never localhost (the same
// failure class as the prod /l/ → localhost shortlink incident).
const FALLBACK_METADATA_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://usekinfolk.com"
    : "http://localhost:3000";

export function siteMetadataBase() {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_KINFOLK_BASE_URL?.trim();

  try {
    const url = new URL(configuredBaseUrl || FALLBACK_METADATA_BASE_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return new URL(FALLBACK_METADATA_BASE_URL);
    }
    return new URL(url.origin);
  } catch {
    return new URL(FALLBACK_METADATA_BASE_URL);
  }
}

const SITE_TITLE = "Kinfolk - Roommates and a place you can afford together";
const SITE_DESCRIPTION =
  "Kinfolk matches renters with compatible roommate groups and apartments they can actually afford together.";

export const metadata: Metadata = {
  metadataBase: siteMetadataBase(),
  title: {
    default: SITE_TITLE,
    template: "%s - Kinfolk",
  },
  description: SITE_DESCRIPTION,
  // Site-wide social cards: for an iMessage-first product, a texted link with
  // no OG image renders as a bare URL. Listing/profile pages override this.
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "Kinfolk",
    type: "website",
    images: [
      {
        url: "/assets/kinfolk-logo-lockup.png",
        width: 830,
        height: 640,
        alt: "Kinfolk",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/assets/kinfolk-logo-lockup.png"],
  },
  // Favicons come from the app/icon.png + app/apple-icon.png convention files
  // (the old icons entry served the raw 152KB marketing mark to every tab).
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#f7f5ef",
  // Lets env(safe-area-inset-*) resolve on notched iPhones so full-bleed
  // surfaces (the mobile chat composer) can pad above the home indicator.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body
        className={`${onest.variable} ${bricolage.variable} ${dmMono.variable} font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
