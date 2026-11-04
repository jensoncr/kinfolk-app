import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  recomputeCompatibilityForUserId: vi.fn(),
  syncMatchingSetupFactsForUserId: vi.fn(),
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

import { getKinfolkPhoneVerificationStatusForCurrentUser } from "./store";

function createPhoneLookupClient(result: {
  data: unknown;
  error: Error | null;
}) {
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    not: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
  };
  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe("user_phone_numbers");
      return query;
    }),
  };

  return { client, query };
}

describe("getKinfolkPhoneVerificationStatusForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: { subject: "clerk-user" },
      user: { id: "user-1" },
    });
  });

  it("returns the latest opted-in verified phone for the signed-in user", async () => {
    const stub = createPhoneLookupClient({
      data: {
        phone_e164: "+14155550100",
        sms_consent_state: "opted_in",
        verified_at: "2026-06-21T20:00:00.000Z",
      },
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      getKinfolkPhoneVerificationStatusForCurrentUser(),
    ).resolves.toEqual({
      phone: "+14155550100",
      phoneVerified: true,
      phoneVerifiedAt: "2026-06-21T20:00:00.000Z",
      smsConsentState: "opted_in",
    });
    expect(mocks.ensureCurrentKinfolkUser).toHaveBeenCalledWith(stub.client);
    expect(stub.query.select).toHaveBeenCalledWith(
      "phone_e164,verified_at,sms_consent_state",
    );
    expect(stub.query.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(stub.query.eq).toHaveBeenCalledWith("sms_consent_state", "opted_in");
    expect(stub.query.not).toHaveBeenCalledWith("verified_at", "is", null);
    expect(stub.query.order).toHaveBeenCalledWith("verified_at", {
      ascending: false,
    });
    expect(stub.query.limit).toHaveBeenCalledWith(1);
  });

  it("returns an unverified status when no opted-in verified phone exists", async () => {
    const stub = createPhoneLookupClient({ data: null, error: null });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      getKinfolkPhoneVerificationStatusForCurrentUser(),
    ).resolves.toEqual({
      phone: "",
      phoneVerified: false,
      phoneVerifiedAt: null,
      smsConsentState: null,
    });
  });

  it("does not report a verified phone from a blank stored phone value", async () => {
    const stub = createPhoneLookupClient({
      data: {
        phone_e164: "   ",
        sms_consent_state: "opted_in",
        verified_at: "2026-06-21T20:00:00.000Z",
      },
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      getKinfolkPhoneVerificationStatusForCurrentUser(),
    ).resolves.toEqual({
      phone: "",
      phoneVerified: false,
      phoneVerifiedAt: "2026-06-21T20:00:00.000Z",
      smsConsentState: "opted_in",
    });
  });

  it("does not report a verified phone from a malformed stored phone value", async () => {
    const stub = createPhoneLookupClient({
      data: {
        phone_e164: "not verified",
        sms_consent_state: "opted_in",
        verified_at: "2026-06-21T20:00:00.000Z",
      },
      error: null,
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      getKinfolkPhoneVerificationStatusForCurrentUser(),
    ).resolves.toEqual({
      phone: "",
      phoneVerified: false,
      phoneVerifiedAt: "2026-06-21T20:00:00.000Z",
      smsConsentState: "opted_in",
    });
  });

  it("requires a signed-in user before querying phone numbers", async () => {
    const stub = createPhoneLookupClient({ data: null, error: null });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    await expect(
      getKinfolkPhoneVerificationStatusForCurrentUser(),
    ).rejects.toThrow("Sign in before checking phone verification.");
    expect(stub.client.from).not.toHaveBeenCalled();
  });

  it("throws phone lookup errors", async () => {
    const stub = createPhoneLookupClient({
      data: null,
      error: new Error("phone lookup failed"),
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      getKinfolkPhoneVerificationStatusForCurrentUser(),
    ).rejects.toThrow("phone lookup failed");
  });
});
