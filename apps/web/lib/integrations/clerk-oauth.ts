// Client-safe Clerk OAuth helpers shared between the auth gate and the
// connected-accounts modal. Do NOT add `import "server-only"` here — these
// run in the browser.

/**
 * Extracts the first human-readable message from a Clerk API error, if any.
 */
function getFirstClerkErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("errors" in error)) {
    return null;
  }

  const errors = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
  const first = errors?.[0];
  return first?.longMessage ?? first?.message ?? null;
}

/**
 * Resolves a user-facing error message for an OAuth connection failure,
 * preferring Clerk's own message, then the raw Error message, then a
 * caller-provided fallback.
 */
export function getOAuthErrorMessage(error: unknown, fallback: string): string {
  const clerkMessage = getFirstClerkErrorMessage(error);
  if (clerkMessage) {
    return clerkMessage;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

type BuildAuthRedirectUrlsOptions = {
  origin: string;
  pathname: string;
  searchParams: URLSearchParams;
  /**
   * When true, the hash fragment is appended to the return path. Pass the
   * current `window.location.hash` to preserve in-page anchors.
   */
  hash?: string;
  /**
   * When true, the individual search params are also copied onto the
   * `/post-login` complete URL (in addition to the bundled `redirecturl`).
   */
  spreadSearchParams?: boolean;
};

/**
 * Builds the `/sso-callback` callback URL and the `/post-login` complete URL
 * used to round-trip the user back to where they started after OAuth.
 */
export function buildAuthRedirectUrls({
  origin,
  pathname,
  searchParams,
  hash = "",
  spreadSearchParams = false,
}: BuildAuthRedirectUrlsOptions): { callbackUrl: string; completeUrl: string } {
  const query = searchParams.toString();
  const targetPath = `${query ? `${pathname}?${query}` : pathname}${hash}`;

  const completeUrl = new URL("/post-login", origin);
  completeUrl.searchParams.set("redirecturl", targetPath);

  if (spreadSearchParams) {
    searchParams.forEach((value, key) => {
      // Never let a caller-supplied `redirecturl` query param overwrite the
      // bundled, path-only redirect target set above. Without this guard an
      // attacker link like `/me?redirecturl=/..//evil.com` would clobber the
      // safe value and be carried into the /post-login sink as an open redirect.
      if (key === "redirecturl") {
        return;
      }
      completeUrl.searchParams.set(key, value);
    });
  }

  const callbackUrl = new URL("/sso-callback", origin);
  callbackUrl.searchParams.set("kinfolkRedirectUrl", completeUrl.toString());

  return {
    callbackUrl: callbackUrl.toString(),
    completeUrl: completeUrl.toString(),
  };
}

/**
 * Convenience wrapper that returns just the `/sso-callback` URL used as the
 * `redirectUrl` when creating an external account.
 */
export function buildExternalAccountCallbackUrl(
  options: BuildAuthRedirectUrlsOptions,
): string {
  return buildAuthRedirectUrls(options).callbackUrl;
}
