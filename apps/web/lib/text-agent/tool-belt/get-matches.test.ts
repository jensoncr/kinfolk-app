import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMatchesTool } from "./get-matches";

vi.mock("server-only", () => ({}));

// ── getMatchesSnapshotForUserId ──────────────────────────────────────────────
const getMatchesSnapshotForUserIdMock = vi.fn<
  (...args: unknown[]) => Promise<unknown>
>(async () => ({ detail: "unavailable", status: "unavailable" }));
vi.mock("../../matching/matches", () => ({
  getMatchesSnapshotForUserId: (...args: unknown[]) =>
    getMatchesSnapshotForUserIdMock(...args),
}));

// ── buildRoommateProfileCardUrl ──────────────────────────────────────────────
const buildRoommateProfileCardUrlMock = vi.fn<
  (...args: unknown[]) => string
>(() => "https://example.com/card/roommate-1");
vi.mock("../../profiles/profile-card", () => ({
  buildRoommateProfileCardUrl: (...args: unknown[]) =>
    buildRoommateProfileCardUrlMock(...args),
}));

// ── buildRoommateMatchProfileCardSnapshot ────────────────────────────────────
const buildRoommateMatchProfileCardSnapshotMock = vi.fn<
  (...args: unknown[]) => Record<string, unknown>
>(() => ({ fitScore: 80, requesterName: "Alex" }));
vi.mock("../roommate-cards", () => ({
  buildRoommateMatchProfileCardSnapshot: (...args: unknown[]) =>
    buildRoommateMatchProfileCardSnapshotMock(...args),
}));

// ── getKinfolkPublicMediaBaseUrl ─────────────────────────────────────────────
const getKinfolkPublicMediaBaseUrlMock = vi.fn(() => "https://example.com");
vi.mock("../store-shared", () => ({
  getKinfolkPublicMediaBaseUrl: () => getKinfolkPublicMediaBaseUrlMock(),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function fakeRoommate(overrides: Record<string, unknown> = {}) {
  return {
    components: [],
    computedAt: "2026-06-10T00:00:00.000Z",
    detail: {
      about: null,
      age: 28,
      breakdown: [],
      company: null,
      education: null,
      hometown: null,
      interests: [],
      photos: [],
      school: null,
      signals: [],
    },
    evidence: [],
    headline: "Engineer in SF",
    id: "edge-1",
    imageUrl: null,
    initials: "AL",
    name: "Alex",
    risks: [],
    score: 75,
    userId: "user-a",
    ...overrides,
  };
}

function makeConnectedSnapshot(
  roommates: Record<string, unknown>[],
  requests: unknown[] = [],
) {
  return {
    apartments: [],
    detail: "ok",
    enrichmentReview: null,
    requests,
    roommates,
    status: "connected",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getKinfolkPublicMediaBaseUrlMock.mockReturnValue("https://example.com");
});

const context = {
  body: "who should I live with?",
  supabase: {} as never,
  threadId: "thread-1",
  userId: "user-1",
};

// ── score-0 gating ───────────────────────────────────────────────────────────

describe("get_matches score gating", () => {
  it("excludes a score-0 roommate from data.roommates and media", async () => {
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([
        fakeRoommate({ name: "Gated", score: 0, userId: "user-gated" }),
        fakeRoommate({ name: "Alex", score: 75, userId: "user-a" }),
      ]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    const roommateNames = (
      result.data as { roommates: Array<{ name: string }> }
    ).roommates.map((r) => r.name);
    expect(roommateNames).not.toContain("Gated");
    expect(roommateNames).toContain("Alex");

    // Media cards should also exclude the gated candidate.
    expect(result.media).toHaveLength(1);
    expect(result.media![0].label).toBe("Alex");
  });

  it("returns ok=true with empty roommates and honest summary when ALL are score-0", async () => {
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([
        fakeRoommate({ name: "Gated1", score: 0, userId: "user-g1" }),
        fakeRoommate({ name: "Gated2", score: 0, userId: "user-g2" }),
      ]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    const data = result.data as {
      gatedCount: number;
      roommates: unknown[];
    };
    expect(data.roommates).toHaveLength(0);
    expect(data.gatedCount).toBe(2);
    expect(result.summary).toMatch(/budget|move-in|dates/i);
    // No cards should be sent.
    expect(result.media).toHaveLength(0);
  });

  it("passes viable (score > 0) roommates through with their card", async () => {
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([
        fakeRoommate({ name: "Jordan", score: 88, userId: "user-j" }),
      ]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    const data = result.data as {
      gatedCount: number;
      roommates: Array<{ name: string; score: number }>;
    };
    expect(data.roommates).toHaveLength(1);
    expect(data.roommates[0].name).toBe("Jordan");
    expect(data.roommates[0].score).toBe(88);
    expect(data.gatedCount).toBe(0);
    expect(result.media).toHaveLength(1);
    expect(result.summary).toMatch(/found 1 roommate match/i);
  });

  it("omits roommate-card media when no public media base is available", async () => {
    getKinfolkPublicMediaBaseUrlMock.mockReturnValueOnce("");
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([
        fakeRoommate({ name: "Jordan", score: 88, userId: "user-j" }),
      ]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    expect(result.media).toHaveLength(0);
    expect(buildRoommateProfileCardUrlMock).not.toHaveBeenCalled();
  });

  it("reports gatedCount even when some viable matches also exist", async () => {
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([
        fakeRoommate({ name: "Viable", score: 60, userId: "user-v" }),
        fakeRoommate({ name: "Gated", score: 0, userId: "user-g" }),
      ]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    const data = result.data as {
      gatedCount: number;
      roommates: Array<{ name: string }>;
    };
    expect(data.roommates).toHaveLength(1);
    expect(data.gatedCount).toBe(1);
    expect(result.summary).toMatch(/found 1 roommate match/i);
  });

  it("marks thin-coverage matches as early reads and hedges the summary", async () => {
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([
        fakeRoommate({
          coverage: 0.31,
          name: "Sofia",
          score: 68,
          scoreHigh: 84,
          scoreLow: 39,
          userId: "user-s",
        }),
      ]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    const data = result.data as {
      roommates: Array<{
        coverage: number | null;
        earlyRead: boolean;
        scoreRange: string | null;
      }>;
    };
    expect(data.roommates[0].earlyRead).toBe(true);
    expect(data.roommates[0].coverage).toBe(0.31);
    expect(data.roommates[0].scoreRange).toBe("39-84");
    expect(result.summary).toMatch(/early reads/i);
  });

  it("does not hedge when coverage is solid and the range is tight", async () => {
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([
        fakeRoommate({
          coverage: 0.85,
          name: "Jordan",
          score: 84,
          scoreHigh: 88,
          scoreLow: 81,
          userId: "user-j",
        }),
      ]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    const data = result.data as {
      roommates: Array<{ earlyRead: boolean; scoreRange: string | null }>;
    };
    expect(data.roommates[0].earlyRead).toBe(false);
    expect(data.roommates[0].scoreRange).toBe("81-88");
    expect(result.summary).not.toMatch(/early reads/i);
  });

  it("returns the empty summary when snapshot.roommates is empty", async () => {
    getMatchesSnapshotForUserIdMock.mockResolvedValueOnce(
      makeConnectedSnapshot([]),
    );

    const result = await getMatchesTool.run(context, {});

    expect(result.ok).toBe(true);
    const data = result.data as { gatedCount: number; roommates: unknown[] };
    expect(data.roommates).toHaveLength(0);
    expect(data.gatedCount).toBe(0);
    expect(result.summary).toBe("No roommate matches are ready yet.");
  });
});
