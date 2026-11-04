import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/shared/site-origin";

const MARKETING_PATHS = ["/", "/how-it-works", "/landlords", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return MARKETING_PATHS.map((path) => ({
    url: path === "/" ? origin : `${origin}${path}`,
  }));
}
