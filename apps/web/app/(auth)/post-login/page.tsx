import { redirect } from "next/navigation";

export const metadata = {
  title: "Opening Kinfolk",
};

export default async function PostLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirecturl?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectUrl = Array.isArray(params.redirecturl) ? params.redirecturl[0] : params.redirecturl;

  redirect(getSafeRedirectPath(redirectUrl));
}

function getSafeRedirectPath(redirectUrl: string | undefined) {
  if (!redirectUrl || !redirectUrl.startsWith("/")) {
    return "/me";
  }

  if (redirectUrl.startsWith("//")) {
    return "/me";
  }

  try {
    const safeBaseUrl = "https://kinfolk.local";
    const url = new URL(redirectUrl, safeBaseUrl);
    if (url.origin !== safeBaseUrl) {
      return "/me";
    }
    const safePath = `${url.pathname}${url.search}${url.hash}`;
    // Guard the *resolved* path, not just the raw input: a same-origin URL like
    // "/..//evil.com" (or its encoded form "/%2e%2e//evil.com") passes the origin
    // check but normalizes to pathname "//evil.com", which the browser would
    // follow as a protocol-relative, off-site redirect. Reject anything that
    // isn't a single-leading-slash, same-origin path.
    if (!safePath.startsWith("/") || safePath.startsWith("//")) {
      return "/me";
    }
    return safePath;
  } catch {
    return "/me";
  }
}
