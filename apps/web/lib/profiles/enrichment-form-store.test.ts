import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  applyProfileSlotEditForUserId: vi.fn(),
  buildProfileEnrichmentFormMutation: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  revalidateProfileDependentPaths: vi.fn(),
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== "matching_interviews") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async () => ({ error: null })),
          })),
        })),
      };
    }),
  },
  updateProfileFieldsForCurrentUser: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/lib/profiles/enrichment-form", () => ({
  buildProfileEnrichmentFormMutation: mocks.buildProfileEnrichmentFormMutation,
  profileEnrichmentSuccessText: "Saved test text.",
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  applyProfileSlotEditForUserId: mocks.applyProfileSlotEditForUserId,
}));

vi.mock("@/lib/profiles/route-cache", () => ({
  revalidateProfileDependentPaths: mocks.revalidateProfileDependentPaths,
}));

vi.mock("@/lib/profiles/store", () => ({
  updateProfileFieldsForCurrentUser: mocks.updateProfileFieldsForCurrentUser,
}));

vi.mock("@/lib/integrations/text-transport", () => ({
  getActiveTextTransportProvider: () => "sendblue",
  getTextTransportFromNumber: () => "+15550000000",
  isTextAgentEnabled: () => false,
  sendTextText: vi.fn(),
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.supabase,
}));

describe("profile enrichment form store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: { subject: "clerk-user" },
      user: { id: "user-1" },
    });
    mocks.buildProfileEnrichmentFormMutation.mockReturnValue({
      facts: [
        {
          confidence: 0.97,
          fact_key: "neighborhoods",
          sensitivity_level: "standard",
          value: ["Mission"],
        },
      ],
      payload: {
        profile_facts: [],
        source: "profile_enrichment_form",
      },
      profilePatch: {
        budgetMin: 1500,
        budgetMax: 2800,
      },
      revokeKeys: ["neighborhoods"],
      summary: "Profile enrichment form submitted.",
    });
  });

  it("uses the form import pipeline as the only matching refresh", async () => {
    const { saveProfileEnrichmentFormForCurrentUser } = await import(
      "./enrichment-form-store"
    );

    const result = await saveProfileEnrichmentFormForCurrentUser({} as never);

    expect(result).toEqual({ summary: "Profile enrichment form submitted." });
    expect(mocks.updateProfileFieldsForCurrentUser).toHaveBeenCalledWith(
      {
        budgetMin: 1500,
        budgetMax: 2800,
      },
      { refreshMatchingState: false },
    );
    expect(mocks.applyProfileSlotEditForUserId).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        facts: expect.any(Array),
        provider: "web",
        revokeKeys: ["neighborhoods"],
        sourceLabel: "Profile enrichment form",
      }),
      { refreshMatchingState: true, snapshotMode: "none" },
    );
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("does not fetch a mutation snapshot when there are no form facts to save", async () => {
    mocks.buildProfileEnrichmentFormMutation.mockReturnValue({
      facts: [],
      payload: {
        profile_facts: [],
        source: "profile_enrichment_form",
      },
      profilePatch: {},
      revokeKeys: [],
      summary: "Profile enrichment form submitted.",
    });

    const { saveProfileEnrichmentFormForCurrentUser } = await import(
      "./enrichment-form-store"
    );

    const result = await saveProfileEnrichmentFormForCurrentUser({} as never);

    expect(result).toEqual({ summary: "Profile enrichment form submitted." });
    expect(mocks.updateProfileFieldsForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.applyProfileSlotEditForUserId).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });
});
