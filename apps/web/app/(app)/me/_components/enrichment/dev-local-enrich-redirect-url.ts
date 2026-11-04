export function buildDevLocalEnrichRedirectUrl({
  host,
  localBaseUrl,
  searchParams,
  userAgent,
}: {
  host: string;
  localBaseUrl: string;
  searchParams?: Record<string, string | string[] | undefined>;
  userAgent: string;
}) {
  if (
    !localBaseUrl ||
    !host.endsWith(".trycloudflare.com") ||
    isLinkPreviewUserAgent(userAgent) ||
    !isDesktopUserAgent(userAgent) ||
    !isDevLocalEnrichRedirectCandidate(searchParams)
  ) {
    return "";
  }

  let local: URL;
  try {
    local = new URL(localBaseUrl);
  } catch {
    return "";
  }

  if (local.protocol !== "http:" && local.protocol !== "https:") {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item) params.append(key, item);
      });
    } else if (value) {
      params.set(key, value);
    }
  }
  params.delete("dev_local");

  const target = new URL("/me/enrich", local.origin);
  const query = params.toString();
  if (query) target.search = query;
  return target.toString();
}

export function isDevLocalEnrichRedirectCandidate(
  searchParams?: Record<string, string | string[] | undefined>,
) {
  const devLocal = searchParams?.dev_local;
  const source = searchParams?.source;
  return (
    (Array.isArray(devLocal) ? devLocal.includes("1") : devLocal === "1") ||
    (Array.isArray(source)
      ? source.includes("sms_interview")
      : source === "sms_interview")
  );
}

function isLinkPreviewUserAgent(userAgent: string) {
  return /\b(?:bot|crawler|spider|preview|facebookexternalhit|twitterbot|slackbot|discordbot|telegrambot|linkedinbot|applebot|whatsapp|messages|imessage)\b/i.test(
    userAgent,
  );
}

function isDesktopUserAgent(userAgent: string) {
  if (/\b(?:Mobile|iPhone|iPad|Android)\b/i.test(userAgent)) {
    return false;
  }

  return /\b(?:Macintosh|Windows NT|X11|Linux x86_64)\b/i.test(userAgent);
}
