import type { ProfilePhoto } from "@/lib/shared/types";

const MAX_PROFILE_PHOTOS = 6;
export const LINKEDIN_PROFILE_PHOTO_ID = "linkedin-profile-photo";

export function prependLinkedInProfilePhoto(
  photos: ProfilePhoto[],
  linkedinImageUrl: string | null | undefined,
  maxPhotos = MAX_PROFILE_PHOTOS,
): ProfilePhoto[] {
  const linkedInPhoto = profilePhotoFromLinkedInUrl(linkedinImageUrl);
  const uploadedPhotos = photos.flatMap((photo) =>
    photo.id === LINKEDIN_PROFILE_PHOTO_ID
      ? []
      : [{ ...photo, source: photo.source ?? ("upload" as const) }],
  );

  if (!linkedInPhoto) {
    return normalizeProfilePhotoPositions(uploadedPhotos, maxPhotos);
  }

  return normalizeProfilePhotoPositions(
    [
      linkedInPhoto,
      ...uploadedPhotos.filter((photo) => cleanProfilePhotoUrl(photo.url) !== linkedInPhoto.url),
    ],
    maxPhotos,
  );
}

export function prependLinkedInProfilePhotoUrl(
  photoUrls: string[],
  linkedinImageUrl: string | null | undefined,
  maxPhotos = MAX_PROFILE_PHOTOS,
): string[] {
  const cleanedLinkedInUrl = cleanProfilePhotoUrl(linkedinImageUrl);
  const uniqueUrls = uniquePhotoUrls(photoUrls);

  if (!cleanedLinkedInUrl) {
    return uniqueUrls.slice(0, maxPhotos);
  }

  return [
    cleanedLinkedInUrl,
    ...uniqueUrls.filter((url) => url !== cleanedLinkedInUrl),
  ].slice(0, maxPhotos);
}

function profilePhotoFromLinkedInUrl(url: string | null | undefined): ProfilePhoto | null {
  const cleaned = cleanProfilePhotoUrl(url);
  if (!cleaned) {
    return null;
  }

  return {
    id: LINKEDIN_PROFILE_PHOTO_ID,
    url: cleaned,
    position: 0,
    isPrimary: true,
    width: null,
    height: null,
    source: "linkedin",
  };
}

function normalizeProfilePhotoPositions(photos: ProfilePhoto[], maxPhotos: number): ProfilePhoto[] {
  return photos.slice(0, maxPhotos).map((photo, index) => ({
    ...photo,
    position: index,
    isPrimary: index === 0,
  }));
}

function uniquePhotoUrls(urls: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const url of urls) {
    const cleaned = cleanProfilePhotoUrl(url);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    unique.push(cleaned);
  }

  return unique;
}

function cleanProfilePhotoUrl(value: string | null | undefined) {
  const cleaned = value?.trim() ?? "";
  return cleaned.length > 0 ? cleaned : null;
}
