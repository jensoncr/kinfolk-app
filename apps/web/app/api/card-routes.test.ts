import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getListingCard } from "./listing-card/[recommendationId]/route";
import { GET as getProfileCard } from "./profile-card/[notificationId]/route";
import { GET as getRoommateCard } from "./roommate-card/route";
import { buildListingCardUrl } from "@/lib/apartments/listing-card";
import {
  buildGroupJoinProfileCardUrl,
  buildRoommateProfileCardUrl,
  type GroupJoinProfileCardSnapshot,
} from "@/lib/profiles/profile-card";

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  fetchCardPhotoDataUrl: vi.fn(),
  fetchListingCardPhotoDataUrl: vi.fn(),
  imageResponse: vi.fn(),
  loadCardFonts: vi.fn(),
}));

vi.mock("next/og", () => ({
  ImageResponse: mocks.imageResponse,
}));

vi.mock("@/lib/apartments/listing-card-image", () => ({
  fetchCardPhotoDataUrl: mocks.fetchCardPhotoDataUrl,
  fetchListingCardPhotoDataUrl: mocks.fetchListingCardPhotoDataUrl,
}));

vi.mock("@/lib/shared/card-fonts", () => ({
  loadCardFonts: mocks.loadCardFonts,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

const groupJoinSnapshot: GroupJoinProfileCardSnapshot = {
  about: "Clean, early riser, and looking for a calm home base.",
  facts: [
    { label: "Age", value: "31" },
    { label: "Career", value: "Software Engineer" },
  ],
  fitScore: 88,
  groupLabel: "2BR - 71 Water St",
  groupNeighborhood: "DUMBO",
  headline: "Software Engineer",
  imageUrl: "https://images.example.com/profile.jpg",
  requestedAt: "2026-06-21T20:00:00.000Z",
  requesterInitials: "JM",
  requesterName: "Jack Munhall",
  requesterUserId: "user-1",
};

const listingSnapshot = {
  address: "681 Florida St",
  bathrooms: 2,
  bedrooms: 3,
  description: "Sunny three bedroom in the Mission.",
  effectivePerPersonRent: 1824,
  effectiveRent: 5470,
  evidence: ["Near friends"],
  fitScore: 87,
  fit_source: "engine",
  id: "listing-1",
  imageUrl: "https://images.example.com/listing.jpg",
  monthlyRent: 5470,
  neighborhood: "Mission",
  perPersonRent: 1824,
  recommendedHouseholdSize: 3,
  sourceUrl: "https://example.com/listing",
};

function mockMaybeSingle(data: unknown) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data, error: null })),
        })),
      })),
    })),
  };
}

function mockMaybeSingleError(message: string) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: null,
            error: { message },
          })),
        })),
      })),
    })),
  };
}

function responseBody(response: Response) {
  return response.text();
}

function collectBackgroundImageStyles(value: unknown) {
  const styles: Array<Record<string, unknown>> = [];

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== "object") return;

    const props = (node as { props?: unknown }).props;
    if (!props || typeof props !== "object") return;

    const style = (props as { style?: unknown }).style;
    if (style && typeof style === "object") {
      const backgroundImage = (style as { backgroundImage?: unknown }).backgroundImage;
      if (typeof backgroundImage === "string") {
        styles.push(style as Record<string, unknown>);
      }
    }

    visit((props as { children?: unknown }).children);
  };

  visit(value);
  return styles;
}

function collectTextContent(value: unknown) {
  const text: string[] = [];

  const visit = (node: unknown) => {
    if (typeof node === "string" || typeof node === "number") {
      text.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== "object") return;

    const props = (node as { props?: unknown }).props;
    if (!props || typeof props !== "object") return;
    visit((props as { children?: unknown }).children);
  };

  visit(value);
  return text.join(" ");
}

describe("generated card image routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KINFOLK_LISTING_CARD_SECRET", "listing-card-secret");
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-card-secret");
    mocks.fetchCardPhotoDataUrl.mockResolvedValue("data:image/jpeg;base64,profile");
    mocks.fetchListingCardPhotoDataUrl.mockResolvedValue("data:image/jpeg;base64,listing");
    mocks.imageResponse.mockImplementation(
      function ImageResponseMock(_element: unknown, init?: { headers?: HeadersInit }) {
        return (
        new Response("image", {
          headers: {
            "content-type": "image/png",
            ...(init?.headers ?? {}),
          },
          status: 200,
        })
        );
      },
    );
    mocks.loadCardFonts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed for invalid listing-card tokens before reading Supabase", async () => {
    const response = await getListingCard(
      new Request("https://kinfolk.test/api/listing-card/rec-1?expires=1&token=nope"),
      { params: Promise.resolve({ recommendationId: "rec-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(responseBody(response)).resolves.toBe("Listing card not found.");
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.imageResponse).not.toHaveBeenCalled();
  });

  it("renders a listing card image from a signed recommendation snapshot", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: listingSnapshot,
        rank: 2,
      }),
    );
    const requestUrl = buildListingCardUrl({
      baseUrl: "https://kinfolk.test",
      recommendationId: "rec-1",
    });

    const response = await getListingCard(new Request(requestUrl), {
      params: Promise.resolve({ recommendationId: "rec-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400",
    );
    expect(mocks.fetchListingCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: listingSnapshot.imageUrl,
      width: 1080,
    });
    expect(mocks.loadCardFonts).toHaveBeenCalled();
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("trims padded listing-card snapshot fields before rendering the image", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: {
          ...listingSnapshot,
          address: " 681 Florida St ",
          imageUrl: " https://images.example.com/listing.jpg ",
          neighborhood: " Mission ",
        },
        rank: 2,
      }),
    );
    const requestUrl = buildListingCardUrl({
      baseUrl: "https://kinfolk.test",
      recommendationId: "rec-1",
    });

    const response = await getListingCard(new Request(requestUrl), {
      params: Promise.resolve({ recommendationId: "rec-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.fetchListingCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: "https://images.example.com/listing.jpg",
      width: 1080,
    });
    const [element] = mocks.imageResponse.mock.calls.at(-1) ?? [];
    const text = collectTextContent(element);
    expect(text).toContain("681 Florida St");
    expect(text).toContain("Mission");
  });

  it("renders the listing card shell when listing photo fetch fails", async () => {
    mocks.fetchListingCardPhotoDataUrl.mockRejectedValueOnce(
      new Error("photo unavailable"),
    );
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: listingSnapshot,
        rank: 2,
      }),
    );
    const requestUrl = buildListingCardUrl({
      baseUrl: "https://kinfolk.test",
      recommendationId: "rec-1",
    });

    const response = await getListingCard(new Request(requestUrl), {
      params: Promise.resolve({ recommendationId: "rec-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(mocks.loadCardFonts).toHaveBeenCalled();
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("returns a controlled error when a signed listing-card snapshot lookup fails", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingleError("database unavailable"),
    );
    const requestUrl = buildListingCardUrl({
      baseUrl: "https://kinfolk.test",
      recommendationId: "rec-1",
    });

    const response = await getListingCard(new Request(requestUrl), {
      params: Promise.resolve({ recommendationId: "rec-1" }),
    });

    expect(response.status).toBe(500);
    await expect(responseBody(response)).resolves.toBe("Listing card unavailable.");
    expect(mocks.fetchListingCardPhotoDataUrl).not.toHaveBeenCalled();
    expect(mocks.imageResponse).not.toHaveBeenCalled();
  });

  it("fails closed for invalid profile-card tokens before reading Supabase", async () => {
    const response = await getProfileCard(
      new Request("https://kinfolk.test/api/profile-card/notification-1?expires=1&token=nope"),
      { params: Promise.resolve({ notificationId: "notification-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(responseBody(response)).resolves.toBe("Profile card not found.");
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.imageResponse).not.toHaveBeenCalled();
  });

  it("renders a group-join profile card image from a signed notification snapshot", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: groupJoinSnapshot,
      }),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400",
    );
    expect(mocks.fetchCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: groupJoinSnapshot.imageUrl,
      timeoutMs: 10_000,
      userAgent: "Kinfolk profile card renderer",
      width: 1080,
    });
    expect(mocks.loadCardFonts).toHaveBeenCalled();
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("trims padded profile-card snapshot image URLs before photo fetch", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: {
          ...groupJoinSnapshot,
          about: " Quiet and tidy. ",
          imageUrl: " https://images.example.com/profile.jpg ",
        },
      }),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.fetchCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: "https://images.example.com/profile.jpg",
      timeoutMs: 10_000,
      userAgent: "Kinfolk profile card renderer",
      width: 1080,
    });
    const [element] = mocks.imageResponse.mock.calls.at(-1) ?? [];
    expect(collectTextContent(element)).toContain("Quiet and tidy.");
  });

  it("clamps profile-card fit labels before rendering the generated image", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: {
          ...groupJoinSnapshot,
          fitScore: 128.4,
        },
      }),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    const [element] = mocks.imageResponse.mock.calls.at(-1) ?? [];
    const text = collectTextContent(element);
    expect(text).toContain("Join request · 100% fit");
    expect(text).not.toContain("128% fit");
  });

  it("renders profile-card photo data URLs in the same unquoted CSS format as listing cards", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: groupJoinSnapshot,
      }),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    const [element] = mocks.imageResponse.mock.calls.at(-1) ?? [];
    const backgroundStyles = collectBackgroundImageStyles(element);
    const backgroundImages = backgroundStyles.flatMap((style) =>
      typeof style.backgroundImage === "string" ? [style.backgroundImage] : [],
    );
    const photoStyle = backgroundStyles.find(
      (style) => style.backgroundImage === "url(data:image/jpeg;base64,profile)",
    );
    expect(backgroundImages).toContain("url(data:image/jpeg;base64,profile)");
    expect(backgroundImages).not.toContain('url("data:image/jpeg;base64,profile")');
    expect(photoStyle).toMatchObject({
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
    });
    expect(photoStyle).not.toHaveProperty("inset");
  });

  it("resolves relative profile-card image URLs against the public base origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.test/app/");
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: {
          ...groupJoinSnapshot,
          imageUrl: "/profile-photos/jack.jpg",
        },
      }),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.fetchCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: "https://kinfolk.test/profile-photos/jack.jpg",
      timeoutMs: 10_000,
      userAgent: "Kinfolk profile card renderer",
      width: 1080,
    });
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("omits relative profile-card image URLs when the public base is unsafe", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://localhost:3000/app/");
    mocks.fetchCardPhotoDataUrl.mockResolvedValueOnce(null);
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: {
          ...groupJoinSnapshot,
          imageUrl: "/profile-photos/jack.jpg",
        },
      }),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.fetchCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: null,
      timeoutMs: 10_000,
      userAgent: "Kinfolk profile card renderer",
      width: 1080,
    });
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("renders the profile card initials fallback when profile photo fetch fails", async () => {
    mocks.fetchCardPhotoDataUrl.mockRejectedValueOnce(
      new Error("photo unavailable"),
    );
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingle({
        card_snapshot: groupJoinSnapshot,
      }),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(mocks.loadCardFonts).toHaveBeenCalled();
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("returns a controlled error when a signed profile-card snapshot lookup fails", async () => {
    mocks.createSupabaseServiceClient.mockReturnValue(
      mockMaybeSingleError("database unavailable"),
    );
    const requestUrl = buildGroupJoinProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      notificationId: "notification-1",
    });

    const response = await getProfileCard(new Request(requestUrl), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(500);
    await expect(responseBody(response)).resolves.toBe("Profile card unavailable.");
    expect(mocks.fetchCardPhotoDataUrl).not.toHaveBeenCalled();
    expect(mocks.imageResponse).not.toHaveBeenCalled();
  });

  it("fails closed for invalid roommate-card tokens", async () => {
    const response = await getRoommateCard(
      new Request("https://kinfolk.test/api/roommate-card?expires=1&token=nope"),
    );

    expect(response.status).toBe(404);
    await expect(responseBody(response)).resolves.toBe("Roommate card not found.");
    expect(mocks.imageResponse).not.toHaveBeenCalled();
  });

  it("renders an encoded roommate card image from a signed snapshot", async () => {
    const requestUrl = buildRoommateProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      snapshot: groupJoinSnapshot,
    });

    const response = await getRoommateCard(new Request(requestUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400",
    );
    expect(mocks.fetchCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: groupJoinSnapshot.imageUrl,
      timeoutMs: 10_000,
      userAgent: "Kinfolk roommate card renderer",
      width: 1080,
    });
    expect(mocks.loadCardFonts).toHaveBeenCalled();
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("labels standalone Kinfolk profile home facts as home on roommate cards", async () => {
    const requestUrl = buildRoommateProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      snapshot: {
        ...groupJoinSnapshot,
        facts: [{ label: "Home", value: "Quiet weekdays" }],
        groupLabel: "Kinfolk profile",
        headline: "Saved housing profile",
      },
    });

    const response = await getRoommateCard(new Request(requestUrl));

    expect(response.status).toBe(200);
    const [element] = mocks.imageResponse.mock.calls.at(-1) ?? [];
    const text = collectTextContent(element);
    expect(text).toContain("Home");
    expect(text).toContain("Quiet weekdays");
    expect(text).not.toContain("Move Quiet weekdays");
  });

  it("clamps roommate-card fit labels before rendering the generated image", async () => {
    const requestUrl = buildRoommateProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      snapshot: {
        ...groupJoinSnapshot,
        fitScore: 142.2,
      },
    });

    const response = await getRoommateCard(new Request(requestUrl));

    expect(response.status).toBe(200);
    const [element] = mocks.imageResponse.mock.calls.at(-1) ?? [];
    const text = collectTextContent(element);
    expect(text).toContain("Roommate match - 100% fit");
    expect(text).not.toContain("142% fit");
  });

  it("renders roommate-card photo data URLs in the same unquoted CSS format as listing cards", async () => {
    const requestUrl = buildRoommateProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      snapshot: groupJoinSnapshot,
    });

    const response = await getRoommateCard(new Request(requestUrl));

    expect(response.status).toBe(200);
    const [element] = mocks.imageResponse.mock.calls.at(-1) ?? [];
    const backgroundStyles = collectBackgroundImageStyles(element);
    const backgroundImages = backgroundStyles.flatMap((style) =>
      typeof style.backgroundImage === "string" ? [style.backgroundImage] : [],
    );
    const photoStyle = backgroundStyles.find(
      (style) => style.backgroundImage === "url(data:image/jpeg;base64,profile)",
    );
    expect(backgroundImages).toContain("url(data:image/jpeg;base64,profile)");
    expect(backgroundImages).not.toContain('url("data:image/jpeg;base64,profile")');
    expect(photoStyle).toMatchObject({
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
    });
    expect(photoStyle).not.toHaveProperty("inset");
  });

  it("renders the roommate card initials fallback when profile photo fetch fails", async () => {
    mocks.fetchCardPhotoDataUrl.mockRejectedValueOnce(
      new Error("photo unavailable"),
    );
    const requestUrl = buildRoommateProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      snapshot: groupJoinSnapshot,
    });

    const response = await getRoommateCard(new Request(requestUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(mocks.loadCardFonts).toHaveBeenCalled();
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("resolves relative roommate card image URLs against the public base origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.test/app/");
    const requestUrl = buildRoommateProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      snapshot: {
        ...groupJoinSnapshot,
        imageUrl: "/synthetic-profiles/jack.jpg",
      },
    });

    const response = await getRoommateCard(new Request(requestUrl));

    expect(response.status).toBe(200);
    expect(mocks.fetchCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: "https://kinfolk.test/synthetic-profiles/jack.jpg",
      timeoutMs: 10_000,
      userAgent: "Kinfolk roommate card renderer",
      width: 1080,
    });
    expect(mocks.imageResponse).toHaveBeenCalled();
  });

  it("omits relative roommate card image URLs when the public base is unsafe", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://192.168.1.20/app/");
    mocks.fetchCardPhotoDataUrl.mockResolvedValueOnce(null);
    const requestUrl = buildRoommateProfileCardUrl({
      baseUrl: "https://kinfolk.test",
      snapshot: {
        ...groupJoinSnapshot,
        imageUrl: "/synthetic-profiles/jack.jpg",
      },
    });

    const response = await getRoommateCard(new Request(requestUrl));

    expect(response.status).toBe(200);
    expect(mocks.fetchCardPhotoDataUrl).toHaveBeenCalledWith({
      height: 1350,
      imageUrl: null,
      timeoutMs: 10_000,
      userAgent: "Kinfolk roommate card renderer",
      width: 1080,
    });
    expect(mocks.imageResponse).toHaveBeenCalled();
  });
});
