import type { ProfilePhoto } from "@/lib/shared/types";

export const MAX_PROFILE_PHOTOS = 6;

export type PhotoSlotStatus = "idle" | "uploading" | "busy";
export type PhotoMoveControls = "none" | "left" | "right" | "both";

export function buildProfilePhotoDeletePath(photoId: string): string | null {
  const trimmedId = photoId.trim();
  if (!trimmedId) {
    return null;
  }

  return `/api/kinfolk/profile/photos/${encodeURIComponent(trimmedId)}`;
}

export function getPhotoSlotStatus({
  busyId,
  photoCount,
  slotIndex,
  uploading,
}: {
  busyId: string | null;
  photoCount: number;
  slotIndex: number;
  uploading: boolean;
}): PhotoSlotStatus {
  if (busyId !== null) {
    return "busy";
  }
  if (!uploading) {
    return "idle";
  }
  return slotIndex === photoCount ? "uploading" : "busy";
}

export function mergeUploadedPhotoOrder(
  photos: ProfilePhoto[],
  reorderedUploads: ProfilePhoto[],
): ProfilePhoto[] {
  let uploadIndex = 0;

  return photos.map((photo, index) => {
    const nextPhoto =
      photo.source === "linkedin" ? photo : (reorderedUploads[uploadIndex++] ?? photo);

    return {
      ...nextPhoto,
      position: index,
      isPrimary: index === 0,
    };
  });
}

export function appendProfilePhoto(
  photos: ProfilePhoto[],
  photo: ProfilePhoto,
  maxPhotos = MAX_PROFILE_PHOTOS,
): ProfilePhoto[] {
  const nextPhotos = photos.some((item) => item.id === photo.id)
    ? photos.map((item) => (item.id === photo.id ? photo : item))
    : [...photos, photo];

  return normalizePhotoPositions(nextPhotos, maxPhotos);
}

export function removeProfilePhotoById(
  photos: ProfilePhoto[],
  photoId: string,
): ProfilePhoto[] {
  return normalizePhotoPositions(photos.filter((photo) => photo.id !== photoId));
}

export function reorderUploadedPhotosById(
  photos: ProfilePhoto[],
  orderedIds: string[],
): ProfilePhoto[] {
  const uploadsById = new Map<string, ProfilePhoto>();
  for (const photo of photos) {
    if (photo.source !== "linkedin") {
      uploadsById.set(photo.id, photo);
    }
  }
  const orderedIdSet = new Set(orderedIds);
  const orderedUploads = orderedIds.flatMap((id) => {
    const photo = uploadsById.get(id);
    return photo ? [photo] : [];
  });
  const remainingUploads = photos.filter(
    (photo) => photo.source !== "linkedin" && !orderedIdSet.has(photo.id),
  );

  return mergeUploadedPhotoOrder(photos, [...orderedUploads, ...remainingUploads]);
}

export function photoMoveControls(
  photo: ProfilePhoto | null,
  uploadedPhotos: ProfilePhoto[],
): PhotoMoveControls {
  if (!photo || photo.source === "linkedin" || uploadedPhotos.length < 2) {
    return "none";
  }

  const uploadIndex = uploadedPhotos.findIndex((item) => item.id === photo.id);

  if (uploadIndex < 0) {
    return "none";
  }
  if (uploadIndex <= 0) {
    return "right";
  }
  if (uploadIndex >= uploadedPhotos.length - 1) {
    return "left";
  }
  return "both";
}

export function readUploadedProfilePhoto(value: unknown): ProfilePhoto | null {
  const photo = asRecord(asRecord(value)?.photo);
  if (!photo) {
    return null;
  }

  const id = typeof photo.id === "string" ? photo.id.trim() : photo.id;
  const url = typeof photo.url === "string" ? photo.url.trim() : photo.url;
  const position = photo.position;
  const isPrimary = photo.isPrimary;

  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof url !== "string" ||
    !url.trim() ||
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    typeof isPrimary !== "boolean"
  ) {
    return null;
  }

  return {
    id,
    url,
    position,
    isPrimary,
    width: null,
    height: null,
    source: "upload",
  };
}

function normalizePhotoPositions(
  photos: ProfilePhoto[],
  maxPhotos = MAX_PROFILE_PHOTOS,
): ProfilePhoto[] {
  return photos.slice(0, maxPhotos).map((photo, index) => ({
    ...photo,
    position: index,
    isPrimary: index === 0,
  }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
