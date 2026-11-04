export function linkedInProfileUrlFromSlug(value: string | null | undefined) {
  const slug = normalizeLinkedInProfileSlug(value);
  return slug ? `https://www.linkedin.com/in/${slug}` : null;
}

export function normalizeLinkedInProfileSlug(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const fromUrl = normalizeLinkedInProfileUrl(value);
  if (fromUrl) {
    return fromUrl.split("/in/")[1] ?? null;
  }

  const trimmed = value.trim().replace(/^@/, "").replace(/\/+$/, "");

  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

export function normalizeLinkedInProfileUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();
  if (!raw || raw.includes("*")) {
    return null;
  }

  let candidate = raw;
  if (candidate.startsWith("linkedin.com/") || candidate.startsWith("www.linkedin.com/")) {
    candidate = `https://${candidate}`;
  } else if (candidate.startsWith("/in/")) {
    candidate = `https://www.linkedin.com${candidate}`;
  }

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    if (hostname !== "linkedin.com") {
      return null;
    }

    const path = url.pathname.replace(/\/+$/, "");

    if (!path.startsWith("/in/") || path.length <= "/in/".length) {
      return null;
    }

    return `https://www.linkedin.com${path}`;
  } catch {
    return null;
  }
}
