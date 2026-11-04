import { describe, expect, it } from "vitest";
import type { ProfilePhoto } from "@/lib/shared/types";
import {
  appendProfilePhoto,
  buildProfilePhotoDeletePath,
  getPhotoSlotStatus,
  mergeUploadedPhotoOrder,
  photoMoveControls,
  readUploadedProfilePhoto,
  removeProfilePhotoById,
  reorderUploadedPhotosById,
} from "./photo-gallery-state";

function photo(id: string, position: number, source: ProfilePhoto["source"] = "upload") {
  return {
    id,
    url: `https://images.example.com/${id}.jpg`,
    position,
    isPrimary: position === 0,
    width: null,
    height: null,
    source,
  } satisfies ProfilePhoto;
}

describe("photo gallery state", () => {
  it("builds encoded delete paths for profile photo ids", () => {
    expect(buildProfilePhotoDeletePath(" photo/one?two ")).toBe(
      "/api/kinfolk/profile/photos/photo%2Fone%3Ftwo",
    );
    expect(buildProfilePhotoDeletePath("   ")).toBeNull();
  });

  it("locks the gallery while an upload is pending except for the visible upload slot", () => {
    expect(
      [0, 1, 2, 3].map((slotIndex) =>
        getPhotoSlotStatus({
          busyId: null,
          photoCount: 2,
          slotIndex,
          uploading: true,
        }),
      ),
    ).toEqual(["busy", "busy", "uploading", "busy"]);
  });

  it("locks every slot while a photo action is busy", () => {
    expect(
      [0, 1, 2].map((slotIndex) =>
        getPhotoSlotStatus({
          busyId: "photo-2",
          photoCount: 2,
          slotIndex,
          uploading: false,
        }),
      ),
    ).toEqual(["busy", "busy", "busy"]);
  });

  it("keeps uploaded photo moves bounded and hides move controls for LinkedIn photos", () => {
    const photos = [photo("linkedin", 0, "linkedin"), photo("one", 1), photo("two", 2)];

    expect(photoMoveControls(photos[0], photos.filter((item) => item.source !== "linkedin")))
      .toBe("none");
    expect(photoMoveControls(photos[1], photos.filter((item) => item.source !== "linkedin")))
      .toBe("right");
    expect(photoMoveControls(photos[2], photos.filter((item) => item.source !== "linkedin")))
      .toBe("left");
  });

  it("merges uploaded reorder results around LinkedIn photos and resequences primaries", () => {
    const photos = [photo("linkedin", 0, "linkedin"), photo("one", 1), photo("two", 2)];

    expect(mergeUploadedPhotoOrder(photos, [photos[2], photos[1]])).toEqual([
      { ...photos[0], position: 0, isPrimary: true },
      { ...photos[2], position: 1, isPrimary: false },
      { ...photos[1], position: 2, isPrimary: false },
    ]);
  });

  it("appends uploaded photos to the latest gallery state and resequences", () => {
    const photos = [photo("linkedin", 0, "linkedin"), photo("one", 1), photo("two", 2)];
    const uploaded = photo("three", 0);

    expect(appendProfilePhoto(photos, uploaded)).toEqual([
      { ...photos[0], position: 0, isPrimary: true },
      { ...photos[1], position: 1, isPrimary: false },
      { ...photos[2], position: 2, isPrimary: false },
      { ...uploaded, position: 3, isPrimary: false },
    ]);
  });

  it("replaces a matching uploaded photo without duplicating it", () => {
    const photos = [photo("one", 0), photo("two", 1)];
    const replacement = {
      ...photo("two", 9),
      url: "https://images.example.com/two-replacement.jpg",
    };

    expect(appendProfilePhoto(photos, replacement)).toEqual([
      { ...photos[0], position: 0, isPrimary: true },
      { ...replacement, position: 1, isPrimary: false },
    ]);
  });

  it("removes photos from the latest gallery state and resequences", () => {
    const photos = [photo("linkedin", 0, "linkedin"), photo("one", 1), photo("two", 2)];

    expect(removeProfilePhotoById(photos, "one")).toEqual([
      { ...photos[0], position: 0, isPrimary: true },
      { ...photos[2], position: 1, isPrimary: false },
    ]);
  });

  it("reorders known uploaded photos while preserving newer uploads", () => {
    const photos = [
      photo("linkedin", 0, "linkedin"),
      photo("one", 1),
      photo("two", 2),
      photo("newer", 3),
    ];

    expect(reorderUploadedPhotosById(photos, ["two", "one"])).toEqual([
      { ...photos[0], position: 0, isPrimary: true },
      { ...photos[2], position: 1, isPrimary: false },
      { ...photos[1], position: 2, isPrimary: false },
      { ...photos[3], position: 3, isPrimary: false },
    ]);
  });

  it("normalizes a valid upload response into gallery photo state", () => {
    expect(
      readUploadedProfilePhoto({
        photo: {
          id: " photo-1 ",
          isPrimary: true,
          position: 0,
          url: " https://cdn.example.com/photo-1.webp ",
        },
      }),
    ).toEqual({
      height: null,
      id: "photo-1",
      isPrimary: true,
      position: 0,
      source: "upload",
      url: "https://cdn.example.com/photo-1.webp",
      width: null,
    });
  });

  it("rejects malformed upload success payloads", () => {
    expect(readUploadedProfilePhoto({})).toBeNull();
    expect(readUploadedProfilePhoto({ photo: [] })).toBeNull();
    expect(
      readUploadedProfilePhoto({
        photo: {
          id: "photo-1",
          isPrimary: true,
          position: 0,
        },
      }),
    ).toBeNull();
    expect(
      readUploadedProfilePhoto({
        photo: {
          id: "photo-1",
          isPrimary: true,
          position: 0.5,
          url: "https://cdn.example.com/photo-1.webp",
        },
      }),
    ).toBeNull();
  });
});
