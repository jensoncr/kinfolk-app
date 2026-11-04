import { NextRequest } from "next/server";
import { z } from "zod";
import {
  addProfilePhotoForCurrentUser,
  reorderProfilePhotosForCurrentUser,
} from "@/lib/profiles/store";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { parseJsonBody } from "@/lib/shared/api-body";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

const PROFILE_PHOTO_MIME_BY_EXTENSION: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const PROFILE_PHOTO_MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

const SUPPORTED_IMAGE_TYPE_ERROR = "Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF.";
const MAX_PROFILE_PHOTO_BYTES = 10 * 1024 * 1024;

const reorderSchema = z.object(
  {
    orderedIds: z
      .unknown()
      .transform((value) =>
        Array.isArray(value)
          ? value
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [],
      ),
  },
  { message: "Request body must be an object." },
);

function resolveProfilePhotoContentType(file: File) {
  const declaredType = file.type.split(";")[0]?.trim().toLowerCase();
  if (declaredType && declaredType !== "application/octet-stream") {
    const aliasedType = PROFILE_PHOTO_MIME_ALIASES[declaredType] ?? declaredType;
    return Object.values(PROFILE_PHOTO_MIME_BY_EXTENSION).includes(declaredType)
      ? declaredType
      : Object.values(PROFILE_PHOTO_MIME_BY_EXTENSION).includes(aliasedType)
        ? aliasedType
      : null;
  }

  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? (PROFILE_PHOTO_MIME_BY_EXTENSION[extension] ?? null) : null;
}

export async function POST(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before uploading photos." },
      { status: 401 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");

  if (!(file instanceof File)) {
    return Response.json({ error: "No photo file provided." }, { status: 400 });
  }

  const contentType = resolveProfilePhotoContentType(file);
  if (!contentType) {
    return Response.json({ error: SUPPORTED_IMAGE_TYPE_ERROR }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "Photo file is empty." }, { status: 400 });
  }
  if (file.size > MAX_PROFILE_PHOTO_BYTES) {
    return Response.json({ error: "Photo must be under 10 MB." }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const row = await addProfilePhotoForCurrentUser({
      filename: file.name || "photo",
      contentType,
      bytes,
    });
    return Response.json({
      photo: {
        id: row.id,
        url: row.public_url,
        position: row.position,
        isPrimary: row.is_primary,
      },
    });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Photo upload failed.",
      logMessage: "[profile-photos] upload failed",
    });
  }
}

export async function PATCH(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before reordering photos." },
      { status: 401 },
    );
  }

  const parsed = await parseJsonBody(request, reorderSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    await reorderProfilePhotosForCurrentUser(parsed.data.orderedIds);
    return Response.json({ ok: true });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Photo reorder failed.",
      logMessage: "[profile-photos] reorder failed",
    });
  }
}
