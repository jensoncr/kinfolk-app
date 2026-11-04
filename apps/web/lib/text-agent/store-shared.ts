import "server-only";
import { buildKinfolkContactCardUrl } from "@/lib/contacts/contact-card";
import { normalizePublicHttpsOrigin } from "@/lib/shared/public-url";
import type { Json } from "@/lib/supabase/types";

export { formatCurrency } from "../shared/currency";

export function getProfileEnrichmentFormUrl() {
  const baseUrl = getKinfolkBaseUrl();
  if (!baseUrl) {
    return "";
  }

  const url = new URL("/me/enrich", baseUrl);
  url.searchParams.set("source", "sms_interview");
  if (shouldRedirectProfileEnrichmentHandoffToDevLocal()) {
    url.searchParams.set("dev_local", "1");
  }
  return url.toString();
}

function shouldRedirectProfileEnrichmentHandoffToDevLocal() {
  return (
    process.env.NODE_ENV !== "production" &&
    Boolean(process.env.KINFOLK_DEV_LOCAL_BASE_URL?.trim())
  );
}

export function escapePostgrestFilterValue(value: string) {
  if (/^[a-z0-9._-]+$/i.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function getKinfolkBaseUrl() {
  const value = process.env.NEXT_PUBLIC_KINFOLK_BASE_URL?.trim();
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

export function getKinfolkPublicMediaBaseUrl() {
  return normalizePublicHttpsOrigin(process.env.NEXT_PUBLIC_KINFOLK_BASE_URL) ?? "";
}

export function getKinfolkContactCardUrl() {
  const baseUrl = getKinfolkPublicMediaBaseUrl();
  if (!baseUrl) {
    return "";
  }
  return buildKinfolkContactCardUrl({ baseUrl });
}

export function getReviewUrl() {
  const baseUrl = getKinfolkBaseUrl();
  if (!baseUrl) {
    return "";
  }

  return new URL("/me/settings/memories", baseUrl).toString();
}

export function jsonObjectOrEmpty(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}
