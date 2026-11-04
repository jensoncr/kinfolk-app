import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  ensureCurrentKinfolkUser: vi.fn(),
  getKinfolkPhoneVerificationStatusForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/profiles/store", () => ({
  getKinfolkPhoneVerificationStatusForCurrentUser:
    mocks.getKinfolkPhoneVerificationStatusForCurrentUser,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/kinfolk/profile/phone", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: { id: "user-1" },
    });
    mocks.getKinfolkPhoneVerificationStatusForCurrentUser.mockResolvedValue({
      phone: "+14155550100",
      phoneVerified: true,
      phoneVerifiedAt: "2026-06-21T20:00:00.000Z",
      smsConsentState: "opted_in",
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns the current user's phone verification status", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      phone: "+14155550100",
      phoneVerified: true,
      phoneVerifiedAt: "2026-06-21T20:00:00.000Z",
      smsConsentState: "opted_in",
    });
    expect(
      mocks.getKinfolkPhoneVerificationStatusForCurrentUser,
    ).toHaveBeenCalledTimes(1);
  });

  it("supports POST as a status refresh alias for the profile UI", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      phoneVerified: true,
    });
    expect(
      mocks.getKinfolkPhoneVerificationStatusForCurrentUser,
    ).toHaveBeenCalledTimes(1);
  });

  it("rejects signed-out checks before loading phone status", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before checking phone verification.",
    });
    expect(
      mocks.getKinfolkPhoneVerificationStatusForCurrentUser,
    ).not.toHaveBeenCalled();
  });

  it("redacts unexpected phone verification failures", async () => {
    const rawError = new Error("Supabase service role token leaked.");
    mocks.getKinfolkPhoneVerificationStatusForCurrentUser.mockRejectedValueOnce(
      rawError,
    );

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Phone verification check failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile] phone verification check failed",
      { error: rawError },
    );
  });
});
