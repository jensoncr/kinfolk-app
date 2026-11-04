import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// pnpm workspace: the lockfile (and Turbopack module root) live two levels up.
const workspaceRoot = join(projectRoot, "..", "..");
const publicBaseHost = readPublicBaseHost(process.env.NEXT_PUBLIC_KINFOLK_BASE_URL);

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", ...(publicBaseHost ? [publicBaseHost] : [])],
  images: {
    qualities: [72, 75],
    remotePatterns: [
      {
        hostname: "img.clerk.com",
        protocol: "https",
      },
      {
        hostname: "images.unsplash.com",
        protocol: "https",
      },
      {
        hostname: "ssl.cdn-redfin.com",
        protocol: "https",
      },
      {
        hostname: "maps.googleapis.com",
        protocol: "https",
      },
      {
        hostname: "*.supabase.co",
        protocol: "https",
      },
      {
        hostname: "*.licdn.com",
        protocol: "https",
      },
    ],
  },
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;

function readPublicBaseHost(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}
