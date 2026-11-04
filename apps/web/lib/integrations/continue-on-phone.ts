import { normalizeSmsRecipient } from "../shared/phone";

export { normalizeSmsRecipient };

export type ContinueOnPhoneConfig = {
  agentEnabled: boolean;
  challengeEndpoint: string;
  publicHandoffBaseUrl?: string | null;
};

export function buildContinueOnPhoneQrTarget({
  link,
  origin,
  publicHandoffBaseUrl,
}: {
  link: string;
  origin: string;
  publicHandoffBaseUrl?: string | null;
}) {
  const baseUrl = normalizeHttpBaseUrl(publicHandoffBaseUrl) ?? normalizeHttpBaseUrl(origin);
  if (!baseUrl || !link) {
    return "";
  }

  const url = new URL("/qr", baseUrl);
  url.searchParams.set("link", link);
  return url.toString();
}

export function normalizeSmsHandoffLink(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!/^sms:/i.test(trimmed)) {
    return "";
  }

  const payload = trimmed.slice(trimmed.indexOf(":") + 1).trim();
  const queryIndex = payload.indexOf("?");
  const rawRecipient = queryIndex === -1 ? payload : payload.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : payload.slice(queryIndex);
  const recipient = normalizeSmsRecipient(rawRecipient);
  if (!recipient) {
    return "";
  }

  return `sms:${recipient}${query}`;
}

export function normalizeHttpBaseUrl(
  value: string | null | undefined,
  { requireHttpProtocol = true }: { requireHttpProtocol?: boolean } = {},
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (
      requireHttpProtocol &&
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
