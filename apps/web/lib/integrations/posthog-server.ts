import "server-only";

import { PostHog } from "posthog-node";

let cachedClient: PostHog | null | undefined;

/**
 * Server-side PostHog client. Render runs a long-lived Node server, so a
 * module-level singleton with small batches is the right shape; every capture
 * is fire-and-forget and must never block or fail a reply path.
 */
export function getPostHogServerClient(): PostHog | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }
  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  if (!apiKey) {
    cachedClient = null;
    return cachedClient;
  }
  cachedClient = new PostHog(apiKey, {
    flushAt: 3,
    flushInterval: 5_000,
    host: process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
  });
  return cachedClient;
}

export function captureProductEvent({
  distinctId,
  event,
  properties,
}: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}) {
  try {
    getPostHogServerClient()?.capture({
      distinctId,
      event,
      properties: { channel: "imessage", ...properties },
    });
  } catch (error) {
    console.error("[posthog] capture failed", { error, event });
  }
}
