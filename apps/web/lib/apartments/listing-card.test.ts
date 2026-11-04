import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEmbeddedListingCardUrl,
  buildListingCardUrl,
  clipListingCardText,
  formatListingFitBadge,
  formatListingRent,
  type ListingCardSnapshot,
  parseEmbeddedListingCardData,
  parseListingCardSnapshot,
  verifyEmbeddedListingCardToken,
  verifyListingCardToken,
} from "./listing-card";

const embeddedSnapshot: ListingCardSnapshot = {
  address: "1487 14th Ave",
  bathrooms: 1,
  bedrooms: 2,
  description: "dropped on encode",
  effectivePerPersonRent: 1020,
  effectiveRent: 2040,
  evidence: ["dropped on encode"],
  fitScore: 91,
  fitSource: "engine",
  id: "listing-embed",
  imageUrl: "https://photos.example.com/inner-sunset.jpg",
  monthlyRent: 2040,
  neighborhood: "Inner Sunset",
  perPersonRent: 1020,
  recommendedHouseholdSize: 2,
  sourceUrl: "https://usekinfolk.com/listings/listing-embed",
};

describe("listing card helpers", () => {
  it("formats roommate-split recommendation rent per person", () => {
    expect(
      formatListingRent({
        effectivePerPersonRent: 1824,
        effectiveRent: 5470,
        monthlyRent: 5470,
        perPersonRent: 1824,
        recommendedHouseholdSize: 3,
      }),
    ).toBe("$1,824/person");
  });

  it("formats solo recommendation rent by month", () => {
    expect(
      formatListingRent({
        effectivePerPersonRent: 3276,
        effectiveRent: 3276,
        monthlyRent: 3276,
        perPersonRent: 3276,
        recommendedHouseholdSize: 1,
      }),
    ).toBe("$3,276/mo");
  });

  it("claims a % fit only for engine-scored matches", () => {
    expect(
      formatListingFitBadge({ fitScore: 87.4, fitSource: "engine" }, 1),
    ).toBe("#1 match · 87% fit");
  });

  it("clamps drifted engine fit scores before rendering card badges", () => {
    expect(
      formatListingFitBadge({ fitScore: 128.4, fitSource: "engine" }, 1),
    ).toBe("#1 match · 100% fit");
    expect(
      formatListingFitBadge({ fitScore: -12, fitSource: "engine" }, 2),
    ).toBe("#2 pick");
  });

  it("renders heuristic and unsourced scores as picks, never % fit", () => {
    expect(
      formatListingFitBadge({ fitScore: 87.4, fitSource: "heuristic" }, 2),
    ).toBe("#2 pick");
    expect(formatListingFitBadge({ fitScore: 87.4, fitSource: null }, 1)).toBe(
      "#1 pick",
    );
    expect(formatListingFitBadge({ fitScore: 0, fitSource: "engine" }, 3)).toBe(
      "#3 pick",
    );
  });

  it("parses fit_source from the snapshot and defaults it to null", () => {
    expect(
      parseListingCardSnapshot({
        address: "681 Florida St",
        fit_source: "engine",
      })?.fitSource,
    ).toBe("engine");
    expect(
      parseListingCardSnapshot({ address: "681 Florida St" })?.fitSource,
    ).toBeNull();
    expect(
      parseListingCardSnapshot({ address: "681 Florida St", fit_source: "  " })
        ?.fitSource,
    ).toBeNull();
  });

  it("normalizes padded snapshot text and URL fields before rendering cards", () => {
    expect(
      parseListingCardSnapshot({
        address: " 681 Florida St ",
        description: " Sunny Mission flat. ",
        evidence: [" Near BART ", " ", "Top floor"],
        fit_source: " engine ",
        id: " listing-1 ",
        imageUrl: " https://images.example.com/listing.jpg ",
        neighborhood: " Mission ",
        sourceUrl: " https://example.com/listing ",
      }),
    ).toMatchObject({
      address: "681 Florida St",
      description: "Sunny Mission flat.",
      evidence: ["Near BART", "Top floor"],
      fitSource: "engine",
      id: "listing-1",
      imageUrl: "https://images.example.com/listing.jpg",
      neighborhood: "Mission",
      sourceUrl: "https://example.com/listing",
    });
    expect(
      parseListingCardSnapshot({
        address: "681 Florida St",
        imageUrl: "  ",
        sourceUrl: "\n",
      }),
    ).toMatchObject({
      imageUrl: null,
      sourceUrl: null,
    });
  });

  it("clips card text at a word boundary, never mid-word", () => {
    expect(clipListingCardText("681 Florida St", 42)).toBe("681 Florida St");
    expect(
      clipListingCardText(
        "1234 South Van Ness Avenue near Precita Park Annex",
        42,
      ),
    ).toBe("1234 South Van Ness Avenue near Precita…");
    expect(clipListingCardText("Mission Dolores, San Francisco", 16)).toBe(
      "Mission…",
    );
  });
});

describe("listing card signing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs and verifies card URLs with the dedicated secret", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "card-secret");
    const now = new Date("2026-06-10T20:00:00.000Z");
    const url = new URL(
      buildListingCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now,
        recommendationId: "rec-1",
      }),
    );

    expect(url.pathname).toBe("/api/listing-card/rec-1");
    expect(
      verifyListingCardToken({
        expires: url.searchParams.get("expires"),
        now,
        recommendationId: "rec-1",
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
  });

  it("encodes reserved recommendation ids in listing-card paths", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "card-secret");
    const now = new Date("2026-06-10T20:00:00.000Z");
    const recommendationId = "rec/one?two";
    const url = new URL(
      buildListingCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now,
        recommendationId,
      }),
    );

    expect(url.pathname).toBe("/api/listing-card/rec%2Fone%3Ftwo");
    expect(
      verifyListingCardToken({
        expires: url.searchParams.get("expires"),
        now,
        recommendationId,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
  });

  it("normalizes padded, pathful, and trailing-slash base URLs", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "card-secret");
    const now = new Date("2026-06-10T20:00:00.000Z");
    const url = new URL(
      buildListingCardUrl({
        baseUrl: " https://kinfolk.example.com/app/// ",
        now,
        recommendationId: "rec-1",
      }),
    );
    const embeddedUrl = new URL(
      buildEmbeddedListingCardUrl({
        baseUrl: " https://kinfolk.example.com/app/// ",
        now,
        snapshot: embeddedSnapshot,
      }),
    );

    expect(url.origin).toBe("https://kinfolk.example.com");
    expect(url.pathname).toBe("/api/listing-card/rec-1");
    expect(embeddedUrl.origin).toBe("https://kinfolk.example.com");
    expect(embeddedUrl.pathname).toBe("/api/listing-card/embedded");
    expect(url.href).not.toContain("///api/");
    expect(
      verifyListingCardToken({
        expires: url.searchParams.get("expires"),
        now,
        recommendationId: "rec-1",
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
  });

  it("rejects unsafe listing-card base URLs before signing", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "card-secret");
    const now = new Date("2026-06-10T20:00:00.000Z");
    const unsafeBaseUrls = [
      "http://kinfolk.example.com",
      "https://localhost:3000",
      "https://192.168.1.20/app",
      "https://[fd00::1]/app",
      "https://[::ffff:127.0.0.1]/app",
      "https://user:pass@kinfolk.example.com",
      "javascript:alert(1)",
      "not a url",
    ];

    for (const baseUrl of unsafeBaseUrls) {
      expect(() =>
        buildListingCardUrl({
          baseUrl,
          now,
          recommendationId: "rec-1",
        }),
      ).toThrow("public HTTPS origin");
      expect(() =>
        buildEmbeddedListingCardUrl({
          baseUrl,
          now,
          snapshot: embeddedSnapshot,
        }),
      ).toThrow("public HTTPS origin");
    }
  });

  it("never derives the signing key from the service role key", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "");
    const devUrl = buildListingCardUrl({
      baseUrl: "https://kinfolk.example.com",
      now: new Date("2026-06-10T20:00:00.000Z"),
      recommendationId: "rec-1",
    });

    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("KINFOLK_JOBS_SECRET", "jobs-secret");

    expect(
      buildListingCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now: new Date("2026-06-10T20:00:00.000Z"),
        recommendationId: "rec-1",
      }),
    ).toBe(devUrl);
  });

  it("fails closed in production when the card secret is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "");
    const now = new Date("2026-06-10T20:00:00.000Z");

    expect(() =>
      buildListingCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now,
        recommendationId: "rec-1",
      }),
    ).toThrow("KINFOLK_LISTING_CARD_SECRET must be set in production.");
    expect(
      verifyListingCardToken({
        expires: String(Math.floor(now.getTime() / 1000) + 3600),
        now,
        recommendationId: "rec-1",
        token: "a".repeat(64),
      }),
    ).toBe(false);
  });
});

describe("embedded listing card", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a snapshot through a signed, stateless URL", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "card-secret");
    const now = new Date("2026-06-10T20:00:00.000Z");
    const url = new URL(
      buildEmbeddedListingCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now,
        rank: 1,
        snapshot: embeddedSnapshot,
      }),
    );

    expect(url.pathname).toBe("/api/listing-card/embedded");
    expect(url.searchParams.get("rank")).toBe("1");
    expect(
      verifyEmbeddedListingCardToken({
        data: url.searchParams.get("data"),
        expires: url.searchParams.get("expires"),
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);

    const decoded = parseEmbeddedListingCardData(url.searchParams.get("data"));
    expect(decoded).toMatchObject({
      address: "1487 14th Ave",
      bedrooms: 2,
      effectivePerPersonRent: 1020,
      fitScore: 91,
      fitSource: "engine",
      imageUrl: "https://photos.example.com/inner-sunset.jpg",
      neighborhood: "Inner Sunset",
      recommendedHouseholdSize: 2,
    });
    // Heavy, render-irrelevant fields are dropped to keep the link short.
    expect(decoded?.description).toBe("");
    expect(decoded?.evidence).toEqual([]);
  });

  it("rejects a tampered data blob under a valid-looking token", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "card-secret");
    const now = new Date("2026-06-10T20:00:00.000Z");
    const url = new URL(
      buildEmbeddedListingCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now,
        snapshot: embeddedSnapshot,
      }),
    );

    const tampered = Buffer.from(
      JSON.stringify({ ...embeddedSnapshot, perPersonRent: 1 }),
      "utf8",
    ).toString("base64url");

    expect(
      verifyEmbeddedListingCardToken({
        data: tampered,
        expires: url.searchParams.get("expires"),
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(false);
  });

  it("rejects an expired embedded card token", () => {
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "card-secret");
    const signedAt = new Date("2026-06-10T20:00:00.000Z");
    const url = new URL(
      buildEmbeddedListingCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now: signedAt,
        snapshot: embeddedSnapshot,
      }),
    );

    expect(
      verifyEmbeddedListingCardToken({
        data: url.searchParams.get("data"),
        expires: url.searchParams.get("expires"),
        // Eight days later — past the 7-day TTL.
        now: new Date("2026-06-18T20:00:01.000Z"),
        token: url.searchParams.get("token"),
      }),
    ).toBe(false);
  });
});
