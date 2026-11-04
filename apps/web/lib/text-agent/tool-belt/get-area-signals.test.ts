import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAreaSignalsTool } from "./get-area-signals";

vi.mock("server-only", () => ({}));

const buildAreaSignalSummaryMock = vi.fn<
  (...args: unknown[]) => Promise<unknown>
>(async () => ({ commute: null, purpose: "commute" }));
vi.mock("../../apartments/area-signals", () => ({
  buildAreaSignalSummary: (...args: unknown[]) =>
    buildAreaSignalSummaryMock(...args),
}));

const formatCommuteAreaSignalReplyMock = vi.fn<
  (...args: unknown[]) => string | null
>(() => "Google says about 26 min door-to-door on transit.");
vi.mock("../area-signals", () => ({
  formatCommuteAreaSignalReply: (...args: unknown[]) =>
    formatCommuteAreaSignalReplyMock(...args),
  formatNoiseAreaSignalReply: () => null,
  formatRestaurantAreaSignalReply: () => null,
  formatSafetyAreaSignalReply: () => null,
}));

const resolveReferencedListingLocationMock = vi.fn<
  (...args: unknown[]) => Promise<{
    recentlyShown: string[];
    resolved: Record<string, unknown> | null;
  }>
>(async () => ({ recentlyShown: [], resolved: null }));
vi.mock("./get-listing-details", () => ({
  resolveReferencedListingLocation: (...args: unknown[]) =>
    resolveReferencedListingLocationMock(...args),
}));

const loadNeighborhoodProfilesMock = vi.fn<
  (...args: unknown[]) => Promise<Record<string, unknown>[]>
>(async () => []);
const resolveTextAgentApartmentMarketMock = vi.fn((value?: string) =>
  value?.trim() || "san-francisco-ca",
);
vi.mock("../neighborhoods", () => ({
  describeNeighborhoodVibe: () => "",
  findNeighborhoodProfile: (
    profileMap: Map<string, unknown>,
    name: string,
  ) => profileMap.get(name.trim().toLowerCase()) ?? null,
  loadNeighborhoodProfiles: (...args: unknown[]) =>
    loadNeighborhoodProfilesMock(...args),
  normalizeNeighborhoodName: (value: string) => value.trim().toLowerCase(),
  resolveTextAgentApartmentMarket: (...args: [string?]) =>
    resolveTextAgentApartmentMarketMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const context = {
  body: "how's the commute to fidi from the second one?",
  supabase: {} as never,
  threadId: "thread-1",
  userId: "user-1",
};

describe("get_area_signals commute topic", () => {
  it("routes the commute from the referenced listing's coordinates", async () => {
    resolveReferencedListingLocationMock.mockResolvedValueOnce({
      recentlyShown: ["2525 Larkin St", "742 Green St"],
      resolved: {
        address: "742 Green St",
        lat: 37.7997,
        lng: -122.4078,
        listingId: "listing-2",
        neighborhood: "North Beach",
        recommendationId: "rec-2",
      },
    });
    buildAreaSignalSummaryMock.mockResolvedValueOnce({
      commute: { durationMinutes: 26, status: "ok" },
      purpose: "commute",
    });

    const result = await getAreaSignalsTool.run(context, {
      destination: "fidi",
      listingOrdinal: 2,
      topic: "commute",
    });

    expect(buildAreaSignalSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commuteDestination: "fidi",
        commuteTravelMode: "TRANSIT",
        label: "742 Green St",
        lat: 37.7997,
        lng: -122.4078,
        neighborhood: "North Beach",
        purpose: "commute",
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Google says");
    expect(result.data).toMatchObject({
      commute: { durationMinutes: 26, status: "ok" },
      destination: "fidi",
      origin: { label: "742 Green St" },
    });
  });

  it("asks for a destination before routing anything", async () => {
    const result = await getAreaSignalsTool.run(context, {
      topic: "commute",
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("where the commute goes");
    expect(buildAreaSignalSummaryMock).not.toHaveBeenCalled();
  });

  it("falls back to the neighborhood centroid when no listing is referenced", async () => {
    resolveReferencedListingLocationMock.mockResolvedValueOnce({
      recentlyShown: ["2525 Larkin St"],
      resolved: null,
    });
    loadNeighborhoodProfilesMock.mockResolvedValueOnce([
      { display_name: "Mission", latitude: 37.7599, longitude: -122.4148 },
    ]);

    const result = await getAreaSignalsTool.run(
      { ...context, body: "how long to caltrain from the mission?" },
      { destination: "caltrain", neighborhood: "Mission", topic: "commute" },
    );

    // A lone shown listing must not silently win once a neighborhood is named.
    expect(resolveReferencedListingLocationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowLoneRecentFallback: false }),
    );
    expect(buildAreaSignalSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commuteDestination: "caltrain",
        label: "Mission",
        lat: 37.7599,
        lng: -122.4148,
        purpose: "commute",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("reads walk/bike/drive travel modes from the args", async () => {
    resolveReferencedListingLocationMock.mockResolvedValueOnce({
      recentlyShown: [],
      resolved: {
        address: "742 Green St",
        lat: 37.7997,
        lng: -122.4078,
        listingId: "listing-2",
        neighborhood: "North Beach",
        recommendationId: "rec-2",
      },
    });

    await getAreaSignalsTool.run(context, {
      destination: "ucsf",
      topic: "commute",
      travelMode: "bike",
    });

    expect(buildAreaSignalSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ commuteTravelMode: "BICYCLE" }),
    );
  });

  it("dead-ends honestly when no origin can be pinned down", async () => {
    resolveReferencedListingLocationMock.mockResolvedValueOnce({
      recentlyShown: ["2525 Larkin St"],
      resolved: null,
    });

    const result = await getAreaSignalsTool.run(context, {
      destination: "fidi",
      topic: "commute",
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("commute origin");
    expect(result.summary).toContain("2525 Larkin St");
    expect(buildAreaSignalSummaryMock).not.toHaveBeenCalled();
  });

  it("still requires a neighborhood for the non-commute topics", async () => {
    const result = await getAreaSignalsTool.run(context, { topic: "safety" });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Ask which SF neighborhood");
  });

  it("falls back to the default market when apartment market config is blank", async () => {
    vi.stubEnv("KINFOLK_APARTMENT_MARKET", "   ");
    loadNeighborhoodProfilesMock.mockResolvedValueOnce([
      {
        display_name: "Mission",
        latitude: null,
        longitude: null,
        median_rent: 3695,
        rent_max: 4695,
        rent_min: 2400,
      },
    ]);

    const result = await getAreaSignalsTool.run(context, {
      neighborhood: "Mission",
      topic: "safety",
    });

    expect(result.ok).toBe(true);
    expect(resolveTextAgentApartmentMarketMock).toHaveBeenCalledTimes(1);
    expect(loadNeighborhoodProfilesMock).toHaveBeenCalledWith(
      context.supabase,
      "san-francisco-ca",
    );
  });
});
