import { NextRequest } from "next/server";
import { deleteProfilePhotoForCurrentUser } from "@/lib/profiles/store";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

type Context = { params: Promise<{ photoId: string }> };

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before editing photos." },
      { status: 401 },
    );
  }

  const { photoId: rawPhotoId } = await params;
  const photoId = rawPhotoId.trim();

  if (!photoId) {
    return Response.json({ error: "No photo id provided." }, { status: 400 });
  }

  try {
    await deleteProfilePhotoForCurrentUser(photoId);
    return Response.json({ ok: true });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Photo delete failed.",
      logMessage: "[profile-photos] delete failed",
    });
  }
}
