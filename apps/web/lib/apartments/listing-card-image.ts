import "server-only";

import sharp from "sharp";
import { parsePublicHttpsUrl } from "@/lib/shared/public-url";

const defaultPhotoFetchTimeoutMs = 4500;
const defaultMaxPhotoBytes = 5 * 1024 * 1024;
const allowedImageContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function fetchCardPhotoDataUrl({
  height,
  imageUrl,
  timeoutMs = defaultPhotoFetchTimeoutMs,
  userAgent = "Kinfolk card renderer",
  width,
  maxBytes = defaultMaxPhotoBytes,
}: {
  height: number;
  imageUrl: string | null;
  maxBytes?: number;
  timeoutMs?: number;
  userAgent?: string;
  width: number;
}) {
  const parsedUrl = parseSafeRemoteImageUrl(imageUrl);
  if (!parsedUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchSafeRemoteImage(parsedUrl, {
      headers: {
        Accept: "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.8",
        "User-Agent": userAgent,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    if (!isAllowedImageContentType(response.headers.get("content-type"))) {
      return null;
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return null;
    }

    const bytes = await readBoundedResponseBuffer(response, maxBytes);
    if (!bytes || bytes.length === 0) {
      return null;
    }

    const jpeg = await sharp(bytes, { animated: false })
      .rotate()
      .resize(width, height, { fit: "cover" })
      .jpeg({ quality: 86 })
      .toBuffer();

    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (error) {
    console.warn("[card-image] Failed to render remote photo.", {
      error: error instanceof Error ? error.message : String(error),
      imageUrl: parsedUrl.toString(),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSafeRemoteImage(
  url: URL,
  init: RequestInit,
  redirectsRemaining = 3,
): Promise<Response> {
  const response = await fetch(url.toString(), {
    ...init,
    redirect: "manual",
  });
  if (!isRedirectStatus(response.status)) {
    return response;
  }

  if (redirectsRemaining <= 0) {
    return response;
  }

  const location = response.headers.get("location");
  if (!location) {
    return response;
  }

  let redirectedUrl: URL | null = null;
  try {
    redirectedUrl = parseSafeRemoteImageUrl(new URL(location, url).toString());
  } catch {
    redirectedUrl = null;
  }
  if (!redirectedUrl) {
    return new Response(null, { status: 400 });
  }

  return fetchSafeRemoteImage(redirectedUrl, init, redirectsRemaining - 1);
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

function parseSafeRemoteImageUrl(imageUrl: string | null) {
  return parsePublicHttpsUrl(imageUrl);
}

function isAllowedImageContentType(contentType: string | null) {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase();
  return Boolean(mime && allowedImageContentTypes.has(mime));
}

async function readBoundedResponseBuffer(response: Response, maxBytes: number) {
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= maxBytes ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    const readNext = async (): Promise<boolean> => {
      const { done, value } = await reader.read();
      if (done) {
        return true;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
      chunks.push(value);
      return readNext();
    };

    if (!(await readNext())) {
      return null;
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export async function fetchListingCardPhotoDataUrl(
  args: Omit<Parameters<typeof fetchCardPhotoDataUrl>[0], "userAgent">,
) {
  return fetchCardPhotoDataUrl({
    ...args,
    userAgent: "Kinfolk listing card renderer",
  });
}
