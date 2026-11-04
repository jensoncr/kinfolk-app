import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchListingCardPhotoDataUrl } from "./listing-card-image";

function mockImageResponse(body: Buffer, contentType: string) {
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": contentType },
    status: 200,
  });
}

describe("listing card image helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("transcodes remote WebP photos into fixed-size JPEG data URLs", async () => {
    const webp = await sharp({
      create: {
        background: "#2d6a5a",
        channels: 3,
        height: 12,
        width: 18,
      },
    })
      .webp()
      .toBuffer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockImageResponse(webp, "image/webp")),
    );

    const dataUrl = await fetchListingCardPhotoDataUrl({
      height: 50,
      imageUrl: "https://images.example.com/card.webp",
      width: 100,
    });

    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    const encoded = dataUrl?.split(",")[1] ?? "";
    const metadata = await sharp(Buffer.from(encoded, "base64")).metadata();
    expect(metadata).toMatchObject({
      format: "jpeg",
      height: 50,
      width: 100,
    });
  });

  it("returns null when the source image cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );

    await expect(
      fetchListingCardPhotoDataUrl({
        height: 50,
        imageUrl: "https://images.example.com/missing.jpg",
        width: 100,
      }),
    ).resolves.toBeNull();
  });

  it("follows public HTTPS photo redirects", async () => {
    const jpeg = await sharp({
      create: {
        background: "#446b8f",
        channels: 3,
        height: 12,
        width: 18,
      },
    })
      .jpeg()
      .toBuffer();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://images.example.com/redirect.jpg") {
        return new Response(null, {
          headers: { Location: "https://cdn.example.com/card.jpg" },
          status: 302,
        });
      }
      if (url === "https://cdn.example.com/card.jpg") {
        return mockImageResponse(jpeg, "image/jpeg");
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataUrl = await fetchListingCardPhotoDataUrl({
      height: 50,
      imageUrl: "https://images.example.com/redirect.jpg",
      width: 100,
    });

    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://images.example.com/redirect.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://cdn.example.com/card.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not follow photo redirects into private or local image URLs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        headers: { Location: "https://127.0.0.1/internal.jpg" },
        status: 302,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchListingCardPhotoDataUrl({
        height: 50,
        imageUrl: "https://images.example.com/redirect.jpg",
        width: 100,
      }),
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://images.example.com/redirect.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not fetch private or local image URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const imageUrl of [
      "https://127.0.0.1/internal.jpg",
      "https://[::ffff:192.168.1.20]/internal.jpg",
      "https://user:pass@images.example.com/private.jpg",
    ]) {
      await expect(
        fetchListingCardPhotoDataUrl({
          height: 50,
          imageUrl,
          width: 100,
        }),
      ).resolves.toBeNull();
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the image is too large", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("too large", {
          headers: {
            "Content-Length": String(6 * 1024 * 1024),
            "Content-Type": "image/jpeg",
          },
          status: 200,
        }),
      ),
    );

    await expect(
      fetchListingCardPhotoDataUrl({
        height: 50,
        imageUrl: "https://images.example.com/huge.jpg",
        width: 100,
      }),
    ).resolves.toBeNull();
  });
});
