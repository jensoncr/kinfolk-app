import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { ApiError } from "@/lib/shared/api-error";

const mocks = vi.hoisted(() => ({
  enforceApiUserRateLimit: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  revalidateProfileDependentPaths: vi.fn(),
  updateProfileFieldsForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("@/lib/profiles/route-cache", () => ({
  revalidateProfileDependentPaths: mocks.revalidateProfileDependentPaths,
}));

vi.mock("@/lib/profiles/store", () => ({
  updateProfileFieldsForCurrentUser: mocks.updateProfileFieldsForCurrentUser,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

function jsonRequest(body: unknown): Parameters<typeof PATCH>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }) as Parameters<typeof PATCH>[0];
}

function rawRequest(body: string): Parameters<typeof PATCH>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile", {
    body,
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }) as Parameters<typeof PATCH>[0];
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/kinfolk/profile", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: { id: "user-1" },
    });
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.updateProfileFieldsForCurrentUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("forwards profile, work, education, interests, and matching basics patches", async () => {
    const response = await PATCH(
      jsonRequest({
        aboutText: "Quiet mornings.\nDinner with friends sometimes.",
        age: "29",
        budgetMax: "",
        budgetMin: "2200",
        dateOfBirth: "1997-05-12",
        displayName: "Jamie Chen",
        educationDegree: "BS",
        educationMajor: "Computer Science",
        educationSchool: "Stanford University",
        educationYear: "2020",
        householdSizeMax: "3",
        householdSizeMin: 1,
        hometown: "Chicago, IL",
        interests: ["Cooking", 42, "Running", null],
        moveInEnd: "2026-08-01",
        moveInStart: "2026-07-15",
        occupationCompany: "Kinfolk Labs",
        occupationTitle: "Product designer",
        preferredAgeMax: "36",
        preferredAgeMin: "not-a-number",
        preferredAgeStrict: "true",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.updateProfileFieldsForCurrentUser).toHaveBeenCalledWith({
      aboutText: "Quiet mornings.\nDinner with friends sometimes.",
      age: 29,
      budgetMax: null,
      budgetMin: 2200,
      dateOfBirth: "1997-05-12",
      displayName: "Jamie Chen",
      educationDegree: "BS",
      educationMajor: "Computer Science",
      educationSchool: "Stanford University",
      educationYear: "2020",
      householdSizeMax: 3,
      householdSizeMin: 1,
      hometown: "Chicago, IL",
      interests: ["Cooking", "Running"],
      moveInEnd: "2026-08-01",
      moveInStart: "2026-07-15",
      occupationCompany: "Kinfolk Labs",
      occupationTitle: "Product designer",
      preferredAgeMax: 36,
      preferredAgeMin: null,
      preferredAgeStrict: true,
    });
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("rejects signed-out profile updates before parsing or saving", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await PATCH(rawRequest("{oops"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before editing your profile.",
    });
    expect(mocks.updateProfileFieldsForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response before parsing or saving when throttled", async () => {
    mocks.enforceApiUserRateLimit.mockResolvedValueOnce(
      Response.json({ error: "Too many requests." }, { status: 429 }),
    );

    const response = await PATCH(jsonRequest({ displayName: "Jamie" }));

    expect(response.status).toBe(429);
    expect(mocks.updateProfileFieldsForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without saving", async () => {
    const response = await PATCH(rawRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.updateProfileFieldsForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("drops fields with unsupported value types", async () => {
    const response = await PATCH(
      jsonRequest({
        aboutText: { value: "too rich" },
        interests: "Cooking,Running",
        preferredAgeStrict: "false",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.updateProfileFieldsForCurrentUser).toHaveBeenCalledWith({
      aboutText: null,
      interests: [],
      preferredAgeStrict: false,
    });
  });

  it("surfaces known profile validation errors without revalidating dependent paths", async () => {
    mocks.updateProfileFieldsForCurrentUser.mockRejectedValueOnce(
      new ApiError("Age must be between 18 and 100."),
    );

    const response = await PATCH(jsonRequest({ aboutText: "Hello" }));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Age must be between 18 and 100.",
    });
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected profile update failures", async () => {
    const rawError = new Error("Supabase service role token leaked.");
    mocks.updateProfileFieldsForCurrentUser.mockRejectedValueOnce(rawError);

    const response = await PATCH(jsonRequest({ displayName: "Jamie" }));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Profile update failed.",
    });
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith("[profile] update failed", {
      error: rawError,
    });
  });
});
