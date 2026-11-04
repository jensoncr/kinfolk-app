import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeListingShortCode } from "@/lib/apartments/listing-shortlink";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/posthog-server", () => ({
  captureProductEvent: vi.fn(),
}));

const { GET } = await import("./route");

const listingId = "8f14e45f-ceea-467f-a8d4-91b2c3d4e5f6";
const listingCode = encodeListingShortCode(listingId)!;

function request(headers: HeadersInit = {}) {
  return new Request(`https://kinfolk.test/l/${listingCode}`, { headers });
}

async function redirectLocation(
  code: string,
  headers: HeadersInit = {},
) {
  const response = await GET(
    new Request(`https://kinfolk.test/l/${code}`, { headers }),
    { params: Promise.resolve({ code }) },
  );
  return {
    location: response.headers.get("location"),
    status: response.status,
  };
}

describe("/l/[code] short listing redirects", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects decoded listing codes to the configured public web origin", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_KINFOLK_BASE_URL",
      " https://usekinfolk.com/app?from=sms ",
    );

    const response = await GET(request({ "x-forwarded-host": "internal.test" }), {
      params: Promise.resolve({ code: listingCode }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://usekinfolk.com/apartments?listing=${listingId}`,
    );
  });

  it("uses a valid forwarded web origin when no configured base is available", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "");

    const response = await GET(
      request({
        "x-forwarded-host": "usekinfolk.com",
        "x-forwarded-proto": "https",
      }),
      { params: Promise.resolve({ code: listingCode }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://usekinfolk.com/apartments?listing=${listingId}`,
    );
  });

  it("ignores credentialed configured bases and malformed forwarded bases", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://user:pass@evil.test");

    const response = await GET(
      request({
        "x-forwarded-host": "attacker@example.com",
        "x-forwarded-proto": "javascript",
      }),
      { params: Promise.resolve({ code: listingCode }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://kinfolk.test/apartments?listing=${listingId}`,
    );
  });

  it("falls back to apartments when the short code cannot be decoded", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://usekinfolk.com");

    await expect(redirectLocation("!!!")).resolves.toEqual({
      location: "https://usekinfolk.com/apartments",
      status: 302,
    });
  });
});
