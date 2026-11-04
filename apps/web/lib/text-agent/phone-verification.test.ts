import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/text-agent", () => ({
  hashVerificationCode: vi.fn((code: string) => `hash:${code}`),
}));

import { findVerifiedPhoneForUser, isPhoneOptedOut } from "./phone-verification";

type FindVerifiedPhoneClient = Parameters<typeof findVerifiedPhoneForUser>[0];

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

  return { client: client as unknown as FindVerifiedPhoneClient, query };
}

describe("findVerifiedPhoneForUser", () => {
  it("returns the latest opted-in verified phone for handoff reuse", async () => {
    const phone = {
      id: "phone-1",
      phone_e164: "+14155550100",
      sms_consent_state: "opted_in",
      user_id: "user-1",
      verified_at: "2026-06-23T20:00:00.000Z",
    };
    const stub = createPhoneLookupClient({ data: phone, error: null });

    await expect(findVerifiedPhoneForUser(stub.client, "user-1")).resolves.toBe(phone);
    expect(stub.query.select).toHaveBeenCalledWith("*");
    expect(stub.query.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(stub.query.eq).toHaveBeenCalledWith("sms_consent_state", "opted_in");
    expect(stub.query.not).toHaveBeenCalledWith("verified_at", "is", null);
    expect(stub.query.order).toHaveBeenCalledWith("verified_at", {
      ascending: false,
    });
    expect(stub.query.limit).toHaveBeenCalledWith(1);
    expect(stub.query.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("throws lookup errors", async () => {
    const stub = createPhoneLookupClient({
      data: null,
      error: new Error("verified phone lookup failed"),
    });

    await expect(findVerifiedPhoneForUser(stub.client, "user-1")).rejects.toThrow(
      "verified phone lookup failed",
    );
  });
});

describe("isPhoneOptedOut", () => {
  it("returns true when the verified phone is opted out", async () => {
    const stub = createPhoneLookupClient({
      data: { phone_e164: "+14155550100", sms_consent_state: "opted_out" },
      error: null,
    });

    await expect(
      isPhoneOptedOut(stub.client, "+14155550100"),
    ).resolves.toBe(true);
  });

  it("returns false for opted-in or unknown phones", async () => {
    const optedIn = createPhoneLookupClient({
      data: { phone_e164: "+14155550100", sms_consent_state: "opted_in" },
      error: null,
    });
    await expect(
      isPhoneOptedOut(optedIn.client, "+14155550100"),
    ).resolves.toBe(false);

    const unknown = createPhoneLookupClient({ data: null, error: null });
    await expect(
      isPhoneOptedOut(unknown.client, "+14155550199"),
    ).resolves.toBe(false);
  });

  it("returns false without querying for empty input", async () => {
    const stub = createPhoneLookupClient({ data: null, error: null });
    await expect(isPhoneOptedOut(stub.client, "")).resolves.toBe(false);
    await expect(isPhoneOptedOut(stub.client, null)).resolves.toBe(false);
    expect(stub.client.from).not.toHaveBeenCalled();
  });
});
