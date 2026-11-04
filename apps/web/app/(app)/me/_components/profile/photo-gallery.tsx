"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { ProfilePhoto } from "@/lib/shared/types";
import {
  appendProfilePhoto,
  buildProfilePhotoDeletePath,
  getPhotoSlotStatus,
  MAX_PROFILE_PHOTOS,
  photoMoveControls,
  readUploadedProfilePhoto,
  removeProfilePhotoById,
  reorderUploadedPhotosById,
  type PhotoMoveControls,
  type PhotoSlotStatus,
} from "./photo-gallery-state";

export function PhotoGallery({
  photos,
  onPhotosChange,
  onError,
}: {
  photos: ProfilePhoto[];
  onPhotosChange: (next: ProfilePhoto[]) => void;
  onError: (message: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef(photos);
  const slots = Array.from({ length: MAX_PROFILE_PHOTOS }).map((_, i) => photos[i] ?? null);
  const uploadedPhotos = photos.filter((photo) => photo.source !== "linkedin");
  const galleryBusy = uploading || busyId !== null;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  async function handleUpload(file: File) {
    if (galleryBusy) {
      return;
    }
    if (photos.length >= MAX_PROFILE_PHOTOS) {
      onError(`You can store up to ${MAX_PROFILE_PHOTOS} photos.`);
      return;
    }
    onError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const response = await fetch("/api/kinfolk/profile/photos", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      const uploadedPhoto = readUploadedProfilePhoto(data);
      if (!response.ok || data?.error || !uploadedPhoto) {
        onError(typeof data.error === "string" ? data.error : "Photo upload failed.");
        return;
      }
      onPhotosChange(appendProfilePhoto(photosRef.current, uploadedPhoto));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Photo upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (galleryBusy) {
      return;
    }
    onError(null);
    const deletePath = buildProfilePhotoDeletePath(id);
    if (!deletePath) {
      onError("Photo delete failed.");
      return;
    }
    setBusyId(id);
    try {
      const response = await fetch(deletePath, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) {
        onError(typeof data.error === "string" ? data.error : "Photo delete failed.");
        return;
      }
      onPhotosChange(removeProfilePhotoById(photosRef.current, id));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Photo delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(id: string, direction: -1 | 1) {
    if (galleryBusy) {
      return;
    }
    onError(null);
    const fromIndex = uploadedPhotos.findIndex((photo) => photo.id === id);
    const toIndex = fromIndex + direction;

    if (fromIndex < 0 || toIndex < 0 || toIndex >= uploadedPhotos.length) {
      return;
    }

    const reorderedUploads = [...uploadedPhotos];
    const [movedPhoto] = reorderedUploads.splice(fromIndex, 1);
    reorderedUploads.splice(toIndex, 0, movedPhoto);

    const uploadedOrder = reorderedUploads.map((photo) => photo.id);
    setBusyId(id);

    try {
      const response = await fetch("/api/kinfolk/profile/photos", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds: uploadedOrder }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) {
        onError(typeof data.error === "string" ? data.error : "Photo reorder failed.");
        return;
      }
      onPhotosChange(reorderUploadedPhotosById(photosRef.current, uploadedOrder));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Photo reorder failed.");
    } finally {
      setBusyId(null);
    }
  }

  function triggerFilePicker() {
    if (galleryBusy) {
      return;
    }
    fileInputRef.current?.click();
  }

  return (
    <div className="mt-5">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {slots.map((photo, index) => (
          <PhotoSlot
            key={photo?.id ?? `empty-${index}`}
            index={index}
            photo={photo}
            moveControls={photoMoveControls(photo, uploadedPhotos)}
            status={getPhotoSlotStatus({
              busyId,
              photoCount: photos.length,
              slotIndex: index,
              uploading,
            })}
            onUpload={triggerFilePicker}
            onDelete={handleDelete}
            onMove={handleMove}
          />
        ))}
      </div>
      <input
        aria-label="Upload profile photo"
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/pjpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        disabled={galleryBusy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleUpload(file);
          }
          event.target.value = "";
        }}
      />
      <p className="m-0 mt-2.5 text-[12px] text-[var(--pp-ink-40)]">
        Up to {MAX_PROFILE_PHOTOS} photos. JPEG, PNG, WebP, HEIC, or HEIF under 10 MB.
        First photo is your main one.
      </p>
    </div>
  );
}
function PhotoSlot({
  index,
  photo,
  moveControls,
  status,
  onUpload,
  onDelete,
  onMove,
}: {
  index: number;
  photo: ProfilePhoto | null;
  moveControls: PhotoMoveControls;
  status: PhotoSlotStatus;
  onUpload: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  if (photo) {
    const isLinkedInPhoto = photo.source === "linkedin";
    const isBusy = status === "busy";
    const photoActionLabel = `photo ${index + 1}`;
    return (
      <div className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas-soft)]">
        <Image
          alt=""
          fill
          className="size-full object-cover"
          priority={index === 0}
          sizes="(min-width: 640px) 210px, 33vw"
          src={photo.url}
          unoptimized
        />
        {isLinkedInPhoto ? (
          <span className="pp-mono pointer-events-none absolute left-2 top-2 inline-flex items-center rounded-full bg-[rgba(15,26,20,0.78)] px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-white">
            LinkedIn
          </span>
        ) : index === 0 ? (
          <span className="pp-mono pointer-events-none absolute left-2 top-2 inline-flex items-center rounded-full bg-[rgba(15,26,20,0.78)] px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-white">
            Main
          </span>
        ) : null}
        {isLinkedInPhoto ? null : (
          <button
            aria-label={`Remove ${photoActionLabel}`}
            className="kin-focus absolute right-2 top-2 inline-grid size-7 place-items-center rounded-full bg-[rgba(15,26,20,0.78)] text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-50"
            disabled={isBusy}
            onClick={() => onDelete(photo.id)}
            title="Remove"
            type="button"
          >
            <Trash2 size={13} strokeWidth={1.8} aria-hidden />
          </button>
        )}
        {!isLinkedInPhoto && moveControls !== "none" ? (
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {moveControls === "left" || moveControls === "both" ? (
              <button
                aria-label={`Move ${photoActionLabel} left`}
                className="kin-focus inline-grid size-7 place-items-center rounded-full bg-[rgba(15,26,20,0.78)] text-white transition hover:bg-[rgba(15,26,20,0.92)] disabled:opacity-50"
                disabled={isBusy}
                onClick={() => onMove(photo.id, -1)}
                title="Move left"
                type="button"
              >
                <ChevronLeft size={13} strokeWidth={1.9} aria-hidden />
              </button>
            ) : null}
            {moveControls === "right" || moveControls === "both" ? (
              <button
                aria-label={`Move ${photoActionLabel} right`}
                className="kin-focus inline-grid size-7 place-items-center rounded-full bg-[rgba(15,26,20,0.78)] text-white transition hover:bg-[rgba(15,26,20,0.92)] disabled:opacity-50"
                disabled={isBusy}
                onClick={() => onMove(photo.id, 1)}
                title="Move right"
                type="button"
              >
                <ChevronRight size={13} strokeWidth={1.9} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const uploadLabel = index === 0 ? "Add main photo" : `Add photo ${index + 1}`;

  return (
    <button
      aria-label={uploadLabel}
      className="kin-focus group flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas-soft)] text-[var(--pp-ink-40)] transition hover:border-[var(--pp-ink-40)] hover:text-[var(--pp-ink-80)] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={status !== "idle"}
      onClick={onUpload}
      type="button"
    >
      {status === "uploading" ? (
        <span className="text-[12px]">Uploading…</span>
      ) : (
        <>
          {index === 0 ? (
            <Camera size={18} strokeWidth={1.7} aria-hidden />
          ) : (
            <Plus size={18} strokeWidth={1.7} aria-hidden />
          )}
          <span className="text-[12px]">{index === 0 ? "Add main photo" : "Add"}</span>
        </>
      )}
    </button>
  );
}
