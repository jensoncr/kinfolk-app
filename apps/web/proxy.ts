import { clerkMiddleware } from "@clerk/nextjs/server";

const clerkFrontendApiProxyPath = getClerkFrontendApiProxyPath();

export default clerkMiddleware(
  clerkFrontendApiProxyPath
    ? {
        frontendApiProxy: {
          enabled: true,
          path: clerkFrontendApiProxyPath,
        },
      }
    : {},
);

function getClerkFrontendApiProxyPath() {
  const proxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;

  if (!proxyUrl || process.env.NODE_ENV !== "production") {
    return null;
  }

  if (proxyUrl.startsWith("/")) {
    return proxyUrl;
  }

  try {
    return new URL(proxyUrl).pathname;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    "/((?!api/jobs|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/((?!api/jobs)(?:api|trpc|clerk-proxy).*)",
  ],
};
