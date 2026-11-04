import { describe, expect, it, beforeEach, vi } from "vitest";
import { POST as postIntent } from "./intent/route";
import { GET as getSaved, POST as postSaved } from "./saved/route";

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  enforceApiUserRateLimit: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  revalidatePath: vi.fn(),
  toggleSavedPlaceForCurrentUser: vi.fn(),
  updateLivingPlanForCurrentUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/plan/plan", () => ({
  MOVE_HORIZONS: ["now", "lt_3mo", "3_6mo", "6_12mo", "1_2yr", "exploring"],
  RELOCATION_FLEXIBILITIES: ["locked", "some", "flexible", "ready"],
  toggleSavedPlaceForCurrentUser: mocks.toggleSavedPlaceForCurrentUser,
  updateLivingPlanForCurrentUser: mocks.updateLivingPlanForCurrentUser,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

function jsonRequest<TPost extends (request: never) => Promise<Response>>(
  url: string,
  body: unknown,
): Parameters<TPost>[0] {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<TPost>[0];
}

function rawRequest<TPost extends (request: never) => Promise<Response>>(
  url: string,
  body: string,
): Parameters<TPost>[0] {
  return new Request(url, {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<TPost>[0];
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/plan/intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: { id: "user-1" },
    });
  });

  it("forwards valid plan intent edits and revalidates only the plan page", async () => {
    const savedPlan = {
      futureCities: ["San Francisco, CA", "New York, NY"],
      intentConfirmedAt: "2026-06-21T20:00:00.000Z",
      intentNote: "Need a sunny kitchen.",
      moveHorizon: "3_6mo",
      relocationFlexibility: "flexible",
      silentMatcherEnabled: true,
    };
    mocks.updateLivingPlanForCurrentUser.mockResolvedValue(savedPlan);

    const response = await postIntent(
      jsonRequest<typeof postIntent>("https://kinfolk.test/api/plan/intent", {
        futureCities: ["San Francisco, CA", 123, "New York, NY"],
        intentNote: `${"a".repeat(620)}tail`,
        moveHorizon: "3_6mo",
        relocationFlexibility: "flexible",
        silentMatcherEnabled: true,
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ plan: savedPlan });
    expect(mocks.updateLivingPlanForCurrentUser).toHaveBeenCalledWith({
      futureCities: ["San Francisco, CA", "New York, NY"],
      intentNote: "a".repeat(600),
      moveHorizon: "3_6mo",
      relocationFlexibility: "flexible",
      silentMatcherEnabled: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/me/plan");
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/me/matches");
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/apartments");
  });

  it("rejects signed-out intent edits before parsing or persisting", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await postIntent(
      rawRequest<typeof postIntent>("https://kinfolk.test/api/plan/intent", "{oops"),
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before saving your plan.",
    });
    expect(mocks.updateLivingPlanForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid enum values without persisting or revalidating", async () => {
    const response = await postIntent(
      jsonRequest<typeof postIntent>("https://kinfolk.test/api/plan/intent", {
        moveHorizon: "tomorrow-ish",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unexpected value for a plan field.",
    });
    expect(mocks.updateLivingPlanForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await postIntent(
      rawRequest<typeof postIntent>("https://kinfolk.test/api/plan/intent", "{oops"),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.updateLivingPlanForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("redacts unexpected plan persistence failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateLivingPlanForCurrentUser.mockRejectedValueOnce(
      new Error("supabase service-role-token failed"),
    );

    try {
      const response = await postIntent(
        jsonRequest<typeof postIntent>("https://kinfolk.test/api/plan/intent", {
          moveHorizon: "3_6mo",
        }),
      );
      const body = await readJson(response);

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: "Unable to save your plan." });
      expect(JSON.stringify(body)).not.toContain("service-role-token");
      expect(consoleError).toHaveBeenCalledWith("[plan] intent save failed", {
        error: expect.any(Error),
      });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("/api/plan/saved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: { id: "user-1" },
    });
  });

  it("toggles a saved listing and revalidates the plan page", async () => {
    mocks.toggleSavedPlaceForCurrentUser.mockResolvedValue({ saved: true });

    const response = await postSaved(
      jsonRequest<typeof postSaved>("https://kinfolk.test/api/plan/saved", {
        kind: "listing",
        listingId: "listing-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ saved: true });
    expect(mocks.toggleSavedPlaceForCurrentUser).toHaveBeenCalledWith(
      { kind: "listing", listingId: "listing-1" },
      undefined,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/me/plan");
  });

  it("passes an explicit desired state through to the store", async () => {
    mocks.toggleSavedPlaceForCurrentUser.mockResolvedValue({ saved: true });

    const response = await postSaved(
      jsonRequest<typeof postSaved>("https://kinfolk.test/api/plan/saved", {
        kind: "listing",
        listingId: "listing-1",
        saved: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.toggleSavedPlaceForCurrentUser).toHaveBeenCalledWith(
      { kind: "listing", listingId: "listing-1" },
      true,
    );
  });

  it("rejects signed-out saved-place updates before parsing or persisting", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await postSaved(
      rawRequest<typeof postSaved>("https://kinfolk.test/api/plan/saved", "{oops"),
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before updating saved places.",
    });
    expect(mocks.toggleSavedPlaceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("toggles a saved area and revalidates the plan page", async () => {
    mocks.toggleSavedPlaceForCurrentUser.mockResolvedValue({ saved: false });

    const response = await postSaved(
      jsonRequest<typeof postSaved>("https://kinfolk.test/api/plan/saved", {
        areaLabel: "  Pacific   Heights ",
        kind: "area",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ saved: false });
    expect(mocks.toggleSavedPlaceForCurrentUser).toHaveBeenCalledWith(
      { areaLabel: "Pacific Heights", kind: "area" },
      undefined,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/me/plan");
  });

  it("rejects blank saved-area labels without persisting or revalidating", async () => {
    const response = await postSaved(
      jsonRequest<typeof postSaved>("https://kinfolk.test/api/plan/saved", {
        areaLabel: "   ",
        kind: "area",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Add an area to save.",
    });
    expect(mocks.toggleSavedPlaceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid saved-place bodies without persisting or revalidating", async () => {
    const response = await postSaved(
      jsonRequest<typeof postSaved>("https://kinfolk.test/api/plan/saved", {
        kind: "listing",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Provide a listing id or an area label to save.",
    });
    expect(mocks.toggleSavedPlaceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("redacts unexpected saved-place persistence failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.toggleSavedPlaceForCurrentUser.mockRejectedValueOnce(
      new Error("supabase service-role-token failed"),
    );

    try {
      const response = await postSaved(
        jsonRequest<typeof postSaved>("https://kinfolk.test/api/plan/saved", {
          kind: "listing",
          listingId: "listing-1",
        }),
      );
      const body = await readJson(response);

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: "Unable to update saved places." });
      expect(JSON.stringify(body)).not.toContain("service-role-token");
      expect(consoleError).toHaveBeenCalledWith("[plan] saved-place update failed", {
        error: expect.any(Error),
      });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("/api/plan/saved GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list when signed out", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({ user: null });

    const response = await getSaved();

    expect(await readJson(response)).toEqual({ listingIds: [] });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("returns the current user's saved listing ids", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: [{ listing_id: "listing-1" }, { listing_id: null }],
        error: null,
      }).then(resolve);
    mocks.createSupabaseServiceClient.mockReturnValueOnce({
      from: vi.fn(() => chain),
    });

    const response = await getSaved();

    expect(await readJson(response)).toEqual({ listingIds: ["listing-1"] });
  });

  it("surfaces read failures instead of masking them as an empty list", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: new Error("read failed") }).then(resolve);
    mocks.createSupabaseServiceClient.mockReturnValueOnce({
      from: vi.fn(() => chain),
    });

    try {
      const response = await getSaved();

      expect(response.status).toBe(500);
      expect(await readJson(response)).toEqual({
        error: "Unable to load saved places.",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
