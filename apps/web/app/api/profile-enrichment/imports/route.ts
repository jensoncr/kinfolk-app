import { NextRequest } from "next/server";
import {
  profileImportMethods,
  profileImportProviders,
  type ProfileImportMethod,
  type ProfileImportProvider,
} from "@/lib/profiles/enrichment";
import {
  createProfileImportForCurrentUser,
  getProfileEnrichmentSnapshot,
} from "@/lib/profiles/enrichment-store";
import { enforceApiUserRateLimit } from "@/lib/shared/api-rate-limit";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { ApiError, apiFailureResponse } from "@/lib/shared/api-error";

export const runtime = "nodejs";

export async function GET() {
  try {
    const snapshot = await getProfileEnrichmentSnapshot();
    return Response.json({ snapshot });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Unable to load profile memories.",
      logMessage: "[profile-enrichment] snapshot load failed",
    });
  }
}

export async function POST(request: NextRequest) {
  const { user } = await ensureCurrentKinfolkUser();
  if (!user) {
    return Response.json(
      { error: "Sign in before importing profile data." },
      { status: 401 },
    );
  }

  // Imports store a payload and kick off embedding + compatibility recompute, so
  // throttle per user to stop a loop from hammering those expensive paths.
  const limited = await enforceApiUserRateLimit({
    userId: user.id,
    bucketType: "profile_import",
    limit: 10,
    window: "minute",
  });
  if (limited) {
    return limited;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const payload = readBodyValue(body, "payload");
    const provider = readProvider(readBodyValue(body, "provider"));
    const method = readMethod(readBodyValue(body, "method"));
    const sourceLabel = readOptionalString(readBodyValue(body, "sourceLabel"));
    const snapshot = await createProfileImportForCurrentUser({
      provider,
      method,
      sourceLabel,
      payload,
    });

    return Response.json({ snapshot });
  } catch (error) {
    return apiFailureResponse({
      error,
      fallback: "Profile import failed.",
      logMessage: "[profile-enrichment] import failed",
    });
  }
}

function readBodyValue(body: unknown, key: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("Request body must be an object.");
  }
  return (body as Record<string, unknown>)[key];
}

function readProvider(value: unknown): ProfileImportProvider {
  const provider = typeof value === "string" ? value : "manual";
  if (profileImportProviders.includes(provider as ProfileImportProvider)) {
    return provider as ProfileImportProvider;
  }
  return "other";
}

function readMethod(value: unknown): ProfileImportMethod {
  const method = typeof value === "string" ? value : "paste";
  if (profileImportMethods.includes(method as ProfileImportMethod)) {
    return method as ProfileImportMethod;
  }
  return "paste";
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
