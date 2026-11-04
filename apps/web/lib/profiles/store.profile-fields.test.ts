import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  resolveOrgLogoUrl: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  recomputeCompatibilityForUserId: vi.fn(),
  syncMatchingSetupFactsForUserId: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/lib/integrations/mapbox-location", () => ({
  normalizeMapboxLocationValue: vi.fn((value: string) => value),
}));

vi.mock("@/lib/shared/launch-market", () => ({
  normalizeLaunchMarket: vi.fn((value: string | null | undefined) => value ?? ""),
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  recomputeCompatibilityForUserId: mocks.recomputeCompatibilityForUserId,
  syncMatchingSetupFactsForUserId: mocks.syncMatchingSetupFactsForUserId,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

vi.mock("@/lib/orgs/org-logo", () => ({
  resolveOrgLogoUrl: mocks.resolveOrgLogoUrl,
}));

import { updateProfileFieldsForCurrentUser } from "./store";

type ScheduledTask = () => Promise<void> | void;

const scheduledTasks: ScheduledTask[] = [];

function makeProfileFieldsClient() {
  const kinfolkUserUpdates: Array<Record<string, unknown>> = [];
  const matchingProfileUpdates: Array<Record<string, unknown>> = [];
  const matchingProfileSelect = {
    eq: vi.fn(() => matchingProfileSelect),
    limit: vi.fn(() => matchingProfileSelect),
    maybeSingle: vi.fn(async () => ({
      data: {
        budget_max: null,
        budget_min: null,
        household_size_max: 0,
        household_size_min: 0,
        id: "matching-profile-1",
        move_in_end: null,
        move_in_start: null,
      },
      error: null,
    })),
    order: vi.fn(() => matchingProfileSelect),
  };

  const client = {
    from: vi.fn((table: string) => {
      if (table === "kinfolk_users") {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            kinfolkUserUpdates.push(payload);
            const query = {
              error: null,
              eq: vi.fn(() => query),
            };
            return query;
          }),
        };
      }

      if (table === "matching_profiles") {
        return {
          insert: vi.fn(async () => ({ error: null })),
          select: vi.fn(() => matchingProfileSelect),
          update: vi.fn((payload: Record<string, unknown>) => {
            matchingProfileUpdates.push(payload);
            const query = {
              error: null,
              eq: vi.fn(() => query),
            };
            return query;
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client, kinfolkUserUpdates, matchingProfileSelect, matchingProfileUpdates };
}

describe("updateProfileFieldsForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduledTasks.length = 0;
    mocks.after.mockImplementation((task: ScheduledTask) => {
      scheduledTasks.push(task);
    });
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: { subject: "clerk-user" },
      user: { id: "user-1", launch_market: "san-francisco-ca" },
    });
    mocks.recomputeCompatibilityForUserId.mockResolvedValue(undefined);
    mocks.syncMatchingSetupFactsForUserId.mockResolvedValue(undefined);
    mocks.resolveOrgLogoUrl.mockResolvedValue("https://cdn.example/org-logos/fifthwall.com.webp");
  });

  // Label, domain, and logo are one fact. Every way of writing them
  // independently produces a profile that claims one employer and shows
  // another's mark.
  describe("organization identity", () => {
    function userWithOrg() {
      return {
        id: "user-1",
        launch_market: "san-francisco-ca",
        occupation_company: "Fifth Wall",
        occupation_company_domain: "fifthwall.com",
        occupation_company_logo_url: "https://cdn.example/org-logos/fifthwall.com.webp",
      };
    }

    it("clears a stale domain and logo when only the label changes", async () => {
      const stub = makeProfileFieldsClient();
      mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
      mocks.ensureCurrentKinfolkUser.mockResolvedValue({
        identity: { subject: "clerk-user" },
        user: userWithOrg(),
      });

      await updateProfileFieldsForCurrentUser({ occupationCompany: "Acme" });

      expect(stub.kinfolkUserUpdates[0]).toMatchObject({
        occupation_company: "Acme",
        occupation_company_domain: null,
        occupation_company_logo_url: null,
      });
      expect(mocks.resolveOrgLogoUrl).not.toHaveBeenCalled();
    });

    it("refuses a domain when the label is cleared in the same patch", async () => {
      const stub = makeProfileFieldsClient();
      mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
      mocks.ensureCurrentKinfolkUser.mockResolvedValue({
        identity: { subject: "clerk-user" },
        user: userWithOrg(),
      });

      await updateProfileFieldsForCurrentUser({
        occupationCompany: null,
        occupationCompanyDomain: "acme.com",
      });

      expect(stub.kinfolkUserUpdates[0]).toMatchObject({
        occupation_company: null,
        occupation_company_domain: null,
        occupation_company_logo_url: null,
      });
    });

    it("treats an unparseable domain as free text", async () => {
      const stub = makeProfileFieldsClient();
      mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

      await updateProfileFieldsForCurrentUser({
        occupationCompany: "Fifth Wall",
        occupationCompanyDomain: "fifth wall.com",
      });

      expect(stub.kinfolkUserUpdates[0]).toMatchObject({
        occupation_company_domain: null,
        occupation_company_logo_url: null,
      });
      expect(mocks.resolveOrgLogoUrl).not.toHaveBeenCalled();
    });

    it("keeps the existing logo when the domain is unchanged", async () => {
      const stub = makeProfileFieldsClient();
      mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
      mocks.ensureCurrentKinfolkUser.mockResolvedValue({
        identity: { subject: "clerk-user" },
        user: userWithOrg(),
      });

      await updateProfileFieldsForCurrentUser({
        occupationCompany: "Fifth Wall",
        occupationCompanyDomain: "fifthwall.com",
      });

      expect(stub.kinfolkUserUpdates[0]).toMatchObject({
        occupation_company_logo_url: "https://cdn.example/org-logos/fifthwall.com.webp",
      });
      expect(mocks.resolveOrgLogoUrl).not.toHaveBeenCalled();
    });

    it("ignores a domain that arrives without the label it describes", async () => {
      const stub = makeProfileFieldsClient();
      mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
      mocks.ensureCurrentKinfolkUser.mockResolvedValue({
        identity: { subject: "clerk-user" },
        user: userWithOrg(),
      });

      await updateProfileFieldsForCurrentUser({ occupationCompanyDomain: "acme.com" });

      expect(stub.kinfolkUserUpdates[0]).toMatchObject({
        occupation_company_domain: "fifthwall.com",
      });
      expect(mocks.resolveOrgLogoUrl).not.toHaveBeenCalled();
    });

    it("resolves a logo when the domain actually changes", async () => {
      const stub = makeProfileFieldsClient();
      mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
      mocks.ensureCurrentKinfolkUser.mockResolvedValue({
        identity: { subject: "clerk-user" },
        user: userWithOrg(),
      });

      await updateProfileFieldsForCurrentUser({
        occupationCompany: "Notre Dame",
        occupationCompanyDomain: "nd.edu",
      });

      expect(mocks.resolveOrgLogoUrl).toHaveBeenCalledWith("nd.edu", "Notre Dame");
    });
  });

  it("saves profile fields before queueing compatibility recompute in the background", async () => {
    const stub = makeProfileFieldsClient();
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.recomputeCompatibilityForUserId.mockRejectedValueOnce(
      new Error("background recompute failed"),
    );

    await expect(
      updateProfileFieldsForCurrentUser({ aboutText: "  Hello there  " }),
    ).resolves.toEqual({});

    expect(stub.kinfolkUserUpdates).toEqual([{ about_text: "Hello there" }]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.recomputeCompatibilityForUserId).not.toHaveBeenCalled();

    await expect(scheduledTasks[0]?.()).resolves.toBeUndefined();

    expect(mocks.recomputeCompatibilityForUserId).toHaveBeenCalledWith("user-1");
    expect(errorSpy).toHaveBeenCalledWith(
      "[profile] background recompute failed",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("queues matching setup fact sync after matching-basic saves", async () => {
    const stub = makeProfileFieldsClient();
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      updateProfileFieldsForCurrentUser({
        budgetMax: 3200,
        budgetMin: 1800,
      }),
    ).resolves.toEqual({});

    expect(stub.matchingProfileSelect.maybeSingle).toHaveBeenCalledTimes(1);
    expect(stub.matchingProfileUpdates).toEqual([
      expect.objectContaining({
        budget_max: 3200,
        budget_min: 1800,
      }),
    ]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.syncMatchingSetupFactsForUserId).not.toHaveBeenCalled();

    await expect(scheduledTasks[0]?.()).resolves.toBeUndefined();

    expect(mocks.syncMatchingSetupFactsForUserId).toHaveBeenCalledWith("user-1", {
      budgetMax: 3200,
      budgetMin: 1800,
    });
    expect(mocks.recomputeCompatibilityForUserId).not.toHaveBeenCalled();
  });

  it("skips deferred matching work when callers explicitly disable refresh", async () => {
    const stub = makeProfileFieldsClient();
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      updateProfileFieldsForCurrentUser(
        { aboutText: "Save only" },
        { refreshMatchingState: false },
      ),
    ).resolves.toEqual({});

    expect(stub.kinfolkUserUpdates).toEqual([{ about_text: "Save only" }]);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.recomputeCompatibilityForUserId).not.toHaveBeenCalled();
    expect(mocks.syncMatchingSetupFactsForUserId).not.toHaveBeenCalled();
  });
});
