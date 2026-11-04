export type IdentityAvatarCandidate = {
  idempotency_key?: string | null;
  image_url?: string | null;
  updated_at?: string | null;
};

const PUBLIC_PROFILE_PHOTO_PATH = "/storage/v1/object/public/profile-photos/";
const RENDERED_PROFILE_PHOTO_PATH = "/storage/v1/render/image/public/profile-photos/";

export function isDurableIdentityAvatarUrl(
  value: string | null | undefined,
  trustedStorageUrl: string | null | undefined,
) {
  const imageUrl = cleanIdentityAvatarUrl(value);
  if (!imageUrl || !trustedStorageUrl) {
    return false;
  }

  try {
    const parsedImageUrl = new URL(imageUrl);
    const parsedTrustedUrl = new URL(trustedStorageUrl);
    if (
      !["http:", "https:"].includes(parsedTrustedUrl.protocol) ||
      parsedTrustedUrl.origin === "null" ||
      parsedImageUrl.origin !== parsedTrustedUrl.origin
    ) {
      return false;
    }

    const pathname = parsedImageUrl.pathname;
    return (
      pathname.startsWith(PUBLIC_PROFILE_PHOTO_PATH) ||
      pathname.startsWith(RENDERED_PROFILE_PHOTO_PATH)
    );
  } catch {
    return false;
  }
}

export function shouldReplaceIdentityAvatarUrl(
  storedValue: string | null | undefined,
  currentValue: string | null | undefined,
  trustedStorageUrl: string | null | undefined,
) {
  const storedUrl = cleanIdentityAvatarUrl(storedValue);
  const currentUrl = cleanIdentityAvatarUrl(currentValue);

  if (!currentUrl || storedUrl === currentUrl) {
    return false;
  }
  if (!storedUrl) {
    return true;
  }

  return !isDurableIdentityAvatarUrl(storedUrl, trustedStorageUrl);
}

export function selectPreferredIdentityAvatarUrl(
  candidates: IdentityAvatarCandidate[],
  trustedStorageUrl: string | null | undefined,
) {
  const usable = candidates
    .flatMap((candidate) => {
      const imageUrl = cleanIdentityAvatarUrl(candidate.image_url);
      return imageUrl ? [{ ...candidate, imageUrl }] : [];
    })
    .sort((left, right) =>
      (right.updated_at ?? "").localeCompare(left.updated_at ?? ""),
    );

  return (
    usable.find((candidate) =>
      isDurableIdentityAvatarUrl(candidate.imageUrl, trustedStorageUrl),
    )
      ?.imageUrl ??
    usable.find(
      (candidate) => !candidate.idempotency_key?.endsWith(":manual-url"),
    )?.imageUrl ??
    usable[0]?.imageUrl ??
    null
  );
}

function cleanIdentityAvatarUrl(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}
