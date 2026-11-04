import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/shared/api-error";
import { DELETE } from "./[photoId]/route";
import { PATCH, POST } from "./route";

const mocks = vi.hoisted(() => ({
  addProfilePhotoForCurrentUser: vi.fn(),
  deleteProfilePhotoForCurrentUser: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  reorderProfilePhotosForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/profiles/store", () => ({
  addProfilePhotoForCurrentUser: mocks.addProfilePhotoForCurrentUser,
  deleteProfilePhotoForCurrentUser: mocks.deleteProfilePhotoForCurrentUser,
  reorderProfilePhotosForCurrentUser: mocks.reorderProfilePhotosForCurrentUser,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

function multipartRequest(file?: File): Parameters<typeof POST>[0] {
  const formData = new FormData();
  if (file) {
    formData.append("photo", file, file.name);
  }
  return new Request("https://kinfolk.test/api/kinfolk/profile/photos", {
    body: formData,
    method: "POST",
  }) as Parameters<typeof POST>[0];
}

function jsonRequest(body: unknown): Parameters<typeof PATCH>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile/photos", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }) as Parameters<typeof PATCH>[0];
}

function rawJsonRequest(body: string): Parameters<typeof PATCH>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile/photos", {
    body,
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }) as Parameters<typeof PATCH>[0];
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("profile photo routes", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.addProfilePhotoForCurrentUser.mockResolvedValue({
      id: "photo-1",
      is_primary: true,
      position: 0,
      public_url: "https://cdn.example.com/photo-1.png",
    });
    mocks.deleteProfilePhotoForCurrentUser.mockResolvedValue(undefined);
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({ identity: null, user: { id: "user-1" } });
    mocks.reorderProfilePhotosForCurrentUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("uploads a multipart profile photo and returns the client photo payload", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "profile.png", {
      type: "image/png",
    });

    const response = await POST(multipartRequest(file));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      photo: {
        id: "photo-1",
        isPrimary: true,
        position: 0,
        url: "https://cdn.example.com/photo-1.png",
      },
    });
    expect(mocks.addProfilePhotoForCurrentUser).toHaveBeenCalledWith({
      bytes: Buffer.from([1, 2, 3]),
      contentType: "image/png",
      filename: "profile.png",
    });
  });

  it("infers profile photo content type from safe image extensions when MIME is blank", async () => {
    const response = await POST(
      multipartRequest(new File([new Uint8Array([4, 5])], "Profile.JPEG")),
    );

    expect(response.status).toBe(200);
    expect(mocks.addProfilePhotoForCurrentUser).toHaveBeenCalledWith({
      bytes: Buffer.from([4, 5]),
      contentType: "image/jpeg",
      filename: "Profile.JPEG",
    });
  });

  it("canonicalizes common JPEG MIME aliases before storage", async () => {
    const jpgAliasUpload = await POST(
      multipartRequest(
        new File([new Uint8Array([4, 5])], "profile.jpg", { type: "image/jpg" }),
      ),
    );

    expect(jpgAliasUpload.status).toBe(200);
    expect(mocks.addProfilePhotoForCurrentUser).toHaveBeenLastCalledWith({
      bytes: Buffer.from([4, 5]),
      contentType: "image/jpeg",
      filename: "profile.jpg",
    });

    const progressiveJpegUpload = await POST(
      multipartRequest(
        new File([new Uint8Array([6, 7])], "progressive.jpg", {
          type: "image/pjpeg",
        }),
      ),
    );

    expect(progressiveJpegUpload.status).toBe(200);
    expect(mocks.addProfilePhotoForCurrentUser).toHaveBeenLastCalledWith({
      bytes: Buffer.from([6, 7]),
      contentType: "image/jpeg",
      filename: "progressive.jpg",
    });
  });

  it("accepts HEIF profile photos from declared MIME type or extension fallback", async () => {
    const declaredMimeUpload = await POST(
      multipartRequest(new File([new Uint8Array([6])], "profile.bin", { type: "image/heif" })),
    );

    expect(declaredMimeUpload.status).toBe(200);
    expect(mocks.addProfilePhotoForCurrentUser).toHaveBeenLastCalledWith({
      bytes: Buffer.from([6]),
      contentType: "image/heif",
      filename: "profile.bin",
    });

    const extensionFallbackUpload = await POST(
      multipartRequest(new File([new Uint8Array([7, 8])], "Profile.HEIF")),
    );

    expect(extensionFallbackUpload.status).toBe(200);
    expect(mocks.addProfilePhotoForCurrentUser).toHaveBeenLastCalledWith({
      bytes: Buffer.from([7, 8]),
      contentType: "image/heif",
      filename: "Profile.HEIF",
    });
  });

  it("rejects unauthenticated upload requests before reading the photo", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({ identity: null, user: null });

    const response = await POST(multipartRequest(new File(["x"], "profile.jpg")));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before uploading photos.",
    });
    expect(mocks.addProfilePhotoForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects upload requests without a photo file", async () => {
    const response = await POST(multipartRequest());

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "No photo file provided.",
    });
    expect(mocks.addProfilePhotoForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects unsupported profile photo types before store upload work", async () => {
    const unsupportedExtension = await POST(
      multipartRequest(new File(["not really an image"], "profile.txt")),
    );
    const unsupportedMime = await POST(
      multipartRequest(
        new File(["not really an image"], "profile.jpg", { type: "text/plain" }),
      ),
    );

    expect(unsupportedExtension.status).toBe(400);
    await expect(readJson(unsupportedExtension)).resolves.toEqual({
      error: "Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF.",
    });
    expect(unsupportedMime.status).toBe(400);
    await expect(readJson(unsupportedMime)).resolves.toEqual({
      error: "Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF.",
    });
    expect(mocks.addProfilePhotoForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized profile photos before store upload work", async () => {
    const emptyUpload = await POST(
      multipartRequest(new File([], "profile.png", { type: "image/png" })),
    );
    const oversizedUpload = await POST(
      multipartRequest(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "profile.png", {
          type: "image/png",
        }),
      ),
    );

    expect(emptyUpload.status).toBe(400);
    await expect(readJson(emptyUpload)).resolves.toEqual({
      error: "Photo file is empty.",
    });
    expect(oversizedUpload.status).toBe(400);
    await expect(readJson(oversizedUpload)).resolves.toEqual({
      error: "Photo must be under 10 MB.",
    });
    expect(mocks.addProfilePhotoForCurrentUser).not.toHaveBeenCalled();
  });

  it("surfaces recognized photo upload validation failures", async () => {
    mocks.addProfilePhotoForCurrentUser.mockRejectedValueOnce(
      new ApiError("Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF."),
    );

    const response = await POST(
      multipartRequest(
        new File(["not really an image"], "profile.png", { type: "image/png" }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected photo upload failures", async () => {
    mocks.addProfilePhotoForCurrentUser.mockRejectedValueOnce(
      new Error("storage write failed: private detail"),
    );

    const response = await POST(multipartRequest(new File(["x"], "profile.jpg")));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Photo upload failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("[profile-photos] upload failed", {
      error: expect.any(Error),
    });
  });

  it("falls back to a generic upload error for non-Error throws", async () => {
    mocks.addProfilePhotoForCurrentUser.mockRejectedValueOnce("boom");

    const response = await POST(multipartRequest(new File(["x"], "profile.jpg")));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Photo upload failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("[profile-photos] upload failed", {
      error: "boom",
    });
  });

  it("reorders profile photos after filtering and trimming orderedIds", async () => {
    const response = await PATCH(
      jsonRequest({ orderedIds: [" photo-2 ", 123, "   ", "photo-1", null] }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.reorderProfilePhotosForCurrentUser).toHaveBeenCalledWith([
      "photo-2",
      "photo-1",
    ]);
  });

  it("rejects unauthenticated reorder requests before parsing or mutating photos", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({ identity: null, user: null });

    const response = await PATCH(rawJsonRequest("{oops"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before reordering photos.",
    });
    expect(mocks.reorderProfilePhotosForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects malformed reorder JSON without mutating photos", async () => {
    const response = await PATCH(rawJsonRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.reorderProfilePhotosForCurrentUser).not.toHaveBeenCalled();
  });

  it("surfaces photo reorder failures", async () => {
    mocks.reorderProfilePhotosForCurrentUser.mockRejectedValueOnce(
      new ApiError("Sign in before reordering photos.", 401),
    );

    const response = await PATCH(jsonRequest({ orderedIds: ["photo-1"] }));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before reordering photos.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected photo reorder failures", async () => {
    mocks.reorderProfilePhotosForCurrentUser.mockRejectedValueOnce(
      new Error("database update failed: private detail"),
    );

    const response = await PATCH(jsonRequest({ orderedIds: ["photo-1"] }));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Photo reorder failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("[profile-photos] reorder failed", {
      error: expect.any(Error),
    });
  });

  it("deletes a profile photo by route param", async () => {
    const response = await DELETE(
      new Request("https://kinfolk.test/api/kinfolk/profile/photos/photo-1", {
        method: "DELETE",
      }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ photoId: "photo-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.deleteProfilePhotoForCurrentUser).toHaveBeenCalledWith("photo-1");
  });

  it("trims profile photo ids before deleting", async () => {
    const response = await DELETE(
      new Request("https://kinfolk.test/api/kinfolk/profile/photos/%20photo-1%20", {
        method: "DELETE",
      }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ photoId: " photo-1 " }) },
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.deleteProfilePhotoForCurrentUser).toHaveBeenCalledWith("photo-1");
  });

  it("rejects blank profile photo ids before deleting", async () => {
    const response = await DELETE(
      new Request("https://kinfolk.test/api/kinfolk/profile/photos/%20", {
        method: "DELETE",
      }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ photoId: " " }) },
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "No photo id provided.",
    });
    expect(mocks.deleteProfilePhotoForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated delete requests before mutating photos", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({ identity: null, user: null });

    const response = await DELETE(
      new Request("https://kinfolk.test/api/kinfolk/profile/photos/photo-1", {
        method: "DELETE",
      }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ photoId: "photo-1" }) },
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before editing photos.",
    });
    expect(mocks.deleteProfilePhotoForCurrentUser).not.toHaveBeenCalled();
  });

  it("surfaces photo delete failures", async () => {
    mocks.deleteProfilePhotoForCurrentUser.mockRejectedValueOnce(
      new ApiError("Sign in before editing photos.", 401),
    );

    const response = await DELETE(
      new Request("https://kinfolk.test/api/kinfolk/profile/photos/photo-1", {
        method: "DELETE",
      }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ photoId: "photo-1" }) },
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before editing photos.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected photo delete failures", async () => {
    mocks.deleteProfilePhotoForCurrentUser.mockRejectedValueOnce(
      new Error("delete failed: private detail"),
    );

    const response = await DELETE(
      new Request("https://kinfolk.test/api/kinfolk/profile/photos/photo-1", {
        method: "DELETE",
      }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ photoId: "photo-1" }) },
    );

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Photo delete failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("[profile-photos] delete failed", {
      error: expect.any(Error),
    });
  });
});
