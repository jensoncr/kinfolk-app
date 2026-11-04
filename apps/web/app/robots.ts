import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/shared/site-origin";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in and tokenized surfaces have nothing for a crawler.
      disallow: ["/me", "/chats", "/post-login", "/sso-callback", "/invite", "/qr"],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
