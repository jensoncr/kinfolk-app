import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGroupJoinProfileCardUrl,
  buildRoommateProfileCardUrl,
  normalizeProfileCardFitScore,
  parseGroupJoinProfileCardSnapshot,
  parseRoommateProfileCardData,
  resolveProfileCardPhotoUrl,
  verifyGroupJoinProfileCardToken,
  verifyRoommateProfileCardToken,
  type GroupJoinProfileCardSnapshot,
} from "./profile-card";

const snapshot: GroupJoinProfileCardSnapshot = {
  about: "Clean, early riser, and looking for a calm home base.",
  facts: [
    { label: "Age", value: "31" },
    { label: "Career", value: "Software Engineer - Carvana" },
  ],
  fitScore: 88,
  groupLabel: "2BR - 71 Water St",
  groupNeighborhood: "DUMBO",
  headline: "Software Engineer - Carvana",
  imageUrl: "https://images.example.com/profile.jpg",
  requestedAt: "2026-05-23T20:00:00.000Z",
  requesterInitials: "JM",
  requesterName: "Jack Munhall",
  requesterUserId: "user-1",
};

describe("profile card helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses a group join profile card snapshot", () => {
    expect(parseGroupJoinProfileCardSnapshot(snapshot)).toEqual(snapshot);
    expect(parseGroupJoinProfileCardSnapshot({ requesterName: "" })).toBeNull();
  });

  it("trims nullable profile-card text and image fields", () => {
    expect(
      parseGroupJoinProfileCardSnapshot({
        ...snapshot,
        about: " Quiet home base. ",
        imageUrl: " https://images.example.com/profile.jpg ",
      }),
    ).toMatchObject({
      about: "Quiet home base.",
      imageUrl: "https://images.example.com/profile.jpg",
    });
    expect(
      parseGroupJoinProfileCardSnapshot({
        ...snapshot,
        about: " ",
        imageUrl: "\n",
      }),
    ).toMatchObject({
      about: null,
      imageUrl: null,
    });
  });

  it("normalizes profile-card fit scores for display", () => {
    expect(normalizeProfileCardFitScore(87.6)).toBe(88);
    expect(normalizeProfileCardFitScore(128.4)).toBe(100);
    expect(normalizeProfileCardFitScore(0)).toBeNull();
    expect(normalizeProfileCardFitScore(-12)).toBeNull();
    expect(normalizeProfileCardFitScore(null)).toBeNull();
  });

  it("signs and verifies profile card URLs", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
    const url = new URL(
      buildGroupJoinProfileCardUrl({
        baseUrl: "https://kinfolk.example.com",
        notificationId: "notification-1",
        now,
      }),
    );

    expect(url.pathname).toBe("/api/profile-card/notification-1");
    expect(
      verifyGroupJoinProfileCardToken({
        expires: url.searchParams.get("expires"),
        notificationId: "notification-1",
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
    expect(
      verifyGroupJoinProfileCardToken({
        expires: url.searchParams.get("expires"),
        notificationId: "notification-2",
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(false);
  });

  it("encodes reserved notification ids in profile-card paths", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
    const notificationId = "notification/one?two";
    const url = new URL(
      buildGroupJoinProfileCardUrl({
        baseUrl: "https://kinfolk.example.com",
        notificationId,
        now,
      }),
    );

    expect(url.pathname).toBe("/api/profile-card/notification%2Fone%3Ftwo");
    expect(
      verifyGroupJoinProfileCardToken({
        expires: url.searchParams.get("expires"),
        notificationId,
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
  });

  it("normalizes padded, pathful, and trailing-slash profile-card base URLs", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
    const url = new URL(
      buildGroupJoinProfileCardUrl({
        baseUrl: " https://kinfolk.example.com/app/// ",
        notificationId: "notification-1",
        now,
      }),
    );

    expect(url.origin).toBe("https://kinfolk.example.com");
    expect(url.pathname).toBe("/api/profile-card/notification-1");
    expect(url.href).not.toContain("///api/");
    expect(
      verifyGroupJoinProfileCardToken({
        expires: url.searchParams.get("expires"),
        notificationId: "notification-1",
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
  });

  it("rejects unsafe profile-card base URLs before signing", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
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
        buildGroupJoinProfileCardUrl({
          baseUrl,
          notificationId: "notification-1",
          now,
        }),
      ).toThrow("public HTTPS origin");
      expect(() =>
        buildRoommateProfileCardUrl({
          baseUrl,
          now,
          snapshot,
        }),
      ).toThrow("public HTTPS origin");
    }
  });

  it("signs and verifies encoded roommate profile card URLs", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
    const url = new URL(
      buildRoommateProfileCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now,
        snapshot,
      }),
    );

    expect(url.pathname).toBe("/api/roommate-card");
    expect(parseRoommateProfileCardData(url.searchParams.get("data"))).toEqual(snapshot);
    expect(
      verifyRoommateProfileCardToken({
        data: url.searchParams.get("data"),
        expires: url.searchParams.get("expires"),
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
    expect(
      verifyRoommateProfileCardToken({
        data: `${url.searchParams.get("data")}x`,
        expires: url.searchParams.get("expires"),
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(false);
  });

  it("rejects oversized roommate-card data before token verification", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
    const oversizedData = "a".repeat(5001);

    expect(parseRoommateProfileCardData(oversizedData)).toBeNull();
    expect(
      verifyRoommateProfileCardToken({
        data: oversizedData,
        expires: String(Math.floor(now.getTime() / 1000) + 3600),
        now,
        token: "a".repeat(64),
      }),
    ).toBe(false);
  });

  it("normalizes padded, pathful, and trailing-slash roommate-card base URLs", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
    const url = new URL(
      buildRoommateProfileCardUrl({
        baseUrl: " https://kinfolk.example.com/app/// ",
        now,
        snapshot,
      }),
    );

    expect(url.origin).toBe("https://kinfolk.example.com");
    expect(url.pathname).toBe("/api/roommate-card");
    expect(url.href).not.toContain("///api/");
    expect(
      verifyRoommateProfileCardToken({
        data: url.searchParams.get("data"),
        expires: url.searchParams.get("expires"),
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
  });

  it("resolves relative profile-card photos from public HTTPS origins", () => {
    expect(
      resolveProfileCardPhotoUrl({
        baseUrl: " https://kinfolk.example.com/app/// ",
        imageUrl: " /profile-photos/jack.jpg ",
      }),
    ).toBe("https://kinfolk.example.com/profile-photos/jack.jpg");
    expect(
      resolveProfileCardPhotoUrl({
        baseUrl: "https://kinfolk.example.com",
        imageUrl: "synthetic-profiles/jack.jpg",
      }),
    ).toBe("https://kinfolk.example.com/synthetic-profiles/jack.jpg");
    expect(
      resolveProfileCardPhotoUrl({
        baseUrl: "https://kinfolk.example.com",
        imageUrl: "https://images.example.com/profile.jpg",
      }),
    ).toBe("https://images.example.com/profile.jpg");
  });

  it("omits profile-card photos when the URL or public base is unsafe", () => {
    const unsafeBaseUrls = [
      "",
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
      expect(
        resolveProfileCardPhotoUrl({
          baseUrl,
          imageUrl: "/profile-photos/jack.jpg",
        }),
      ).toBeNull();
    }
    expect(
      resolveProfileCardPhotoUrl({
        baseUrl: "https://kinfolk.example.com",
        imageUrl: "//images.example.com/profile.jpg",
      }),
    ).toBeNull();
    for (const imageUrl of [
      "http://images.example.com/profile.jpg",
      "https://127.0.0.1/profile.jpg",
      "https://[::ffff:192.168.1.20]/profile.jpg",
      "https://user:pass@images.example.com/profile.jpg",
    ]) {
      expect(
        resolveProfileCardPhotoUrl({
          baseUrl: "https://kinfolk.example.com",
          imageUrl,
        }),
      ).toBeNull();
    }
  });

  it("keeps verbose roommate profile card media URLs compact and parseable", () => {
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    const now = new Date("2026-05-23T20:00:00.000Z");
    const url = new URL(
      buildRoommateProfileCardUrl({
        baseUrl: "https://kinfolk.example.com",
        now,
        snapshot: {
          ...snapshot,
          about: "Quiet home base. ".repeat(500),
          facts: [
            { label: "Lifestyle and daily rhythm".repeat(10), value: "Early riser. ".repeat(80) },
            { label: "Work".repeat(20), value: "Software engineer. ".repeat(80) },
            { label: "Home".repeat(20), value: "Clean shared spaces. ".repeat(80) },
            { label: "Roommate".repeat(20), value: "Communicative and calm. ".repeat(80) },
            { label: "Overflow", value: "This fifth fact should not be encoded." },
          ],
          headline: "Software Engineer - Carvana ".repeat(50),
          imageUrl: `https://images.example.com/${"profile/".repeat(200)}jack.jpg`,
          requesterName: "Jack Munhall ".repeat(50),
        },
      }),
    );
    const data = url.searchParams.get("data");
    const parsed = parseRoommateProfileCardData(data);

    expect(url.href.length).toBeLessThanOrEqual(2048);
    expect(data?.length).toBeLessThanOrEqual(1900);
    expect(parsed).toMatchObject({
      fitScore: snapshot.fitScore,
      groupLabel: snapshot.groupLabel,
      requesterInitials: snapshot.requesterInitials,
      requesterUserId: snapshot.requesterUserId,
    });
    expect(parsed?.about?.length).toBeLessThanOrEqual(140);
    expect(parsed?.facts).toHaveLength(4);
    expect(parsed?.facts[0]?.label.length).toBeLessThanOrEqual(28);
    expect(parsed?.facts[0]?.value.length).toBeLessThanOrEqual(72);
    expect(parsed?.headline.length).toBeLessThanOrEqual(72);
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.requesterName.length).toBeLessThanOrEqual(72);
    expect(
      verifyRoommateProfileCardToken({
        data,
        expires: url.searchParams.get("expires"),
        now,
        token: url.searchParams.get("token"),
      }),
    ).toBe(true);
  });
});
