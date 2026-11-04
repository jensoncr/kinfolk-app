import { ensureCurrentKinfolkUser } from "@/lib/shared/users";

export async function rejectSignedOutProfileEnrichmentMutation(message: string) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json({ error: message }, { status: 401 });
  }

  return null;
}
