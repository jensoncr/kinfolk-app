import { describe, expect, it } from "vitest";
import type { ProfilePhoto } from "@/lib/shared/types";
import {
  LINKEDIN_PROFILE_PHOTO_ID,
  prependLinkedInProfilePhoto,
  prependLinkedInProfilePhotoUrl,
} from "./photos";

function uploadPhoto(id: string, position: number): ProfilePhoto {
  return {
    id,
    url: `https://images.example.com/${id}.jpg`,
    position,
    isPrimary: position === 0,
    width: null,
    height: null,
    source: "upload",
  };
}

describe("profile photos", () => {
  it("prepends the LinkedIn image and caps the visible photo set at six", () => {
    const photos = Array.from({ length: 6 }, (_, index) => uploadPhoto(`upload-${index}`, index));

    const result = prependLinkedInProfilePhoto(
      photos,
      "https://media.example.com/linkedin.jpg",
    );

    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({
      id: LINKEDIN_PROFILE_PHOTO_ID,
      url: "https://media.example.com/linkedin.jpg",
      position: 0,
      isPrimary: true,
      source: "linkedin",
    });
    expect(result.slice(1).map((photo) => photo.id)).toEqual([
      "upload-0",
      "upload-1",
      "upload-2",
      "upload-3",
      "upload-4",
    ]);
  });

  it("dedupes the LinkedIn image if it is already in the uploaded photo list", () => {
    const photos = [
      { ...uploadPhoto("same", 0), url: "https://media.example.com/linkedin.jpg" },
      uploadPhoto("other", 1),
    ];

    const result = prependLinkedInProfilePhoto(
      photos,
      " https://media.example.com/linkedin.jpg ",
    );

    expect(result.map((photo) => photo.url)).toEqual([
      "https://media.example.com/linkedin.jpg",
      "https://images.example.com/other.jpg",
    ]);
  });

  it("prepends LinkedIn URLs for roommate photo carousels", () => {
    const result = prependLinkedInProfilePhotoUrl(
      ["https://images.example.com/one.jpg", "https://media.example.com/linkedin.jpg"],
      "https://media.example.com/linkedin.jpg",
    );

    expect(result).toEqual([
      "https://media.example.com/linkedin.jpg",
      "https://images.example.com/one.jpg",
    ]);
  });
});
