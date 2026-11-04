import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileEnrichmentFormValues } from "@/lib/profiles/enrichment-form";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  enforceApiUserRateLimit: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  saveProfileEnrichmentFormForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("@/lib/profiles/enrichment-form-store", () => ({
  saveProfileEnrichmentFormForCurrentUser:
    mocks.saveProfileEnrichmentFormForCurrentUser,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

function jsonRequest(body: unknown): Parameters<typeof POST>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile/enrichment-form", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<typeof POST>[0];
}

function rawRequest(body: string): Parameters<typeof POST>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile/enrichment-form", {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<typeof POST>[0];
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/kinfolk/profile/enrichment-form", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: { id: "user-1" },
    });
    mocks.saveProfileEnrichmentFormForCurrentUser.mockResolvedValue({
      summary: "Profile enrichment form submitted.",
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("forwards valid enrichment form values and returns the save summary", async () => {
    const values = {
      aboutText: "Sunny kitchen, thoughtful roommates, and a calm home base.",
      birthday: "1996-02-14",
      budgetMax: 3200,
      budgetMin: 1800,
      cleanliness: "tidy",
      communicationStyle: "direct",
      conflictRepair: "cooldown then talk",
      dealbreakers: ["Smoking indoors"],
      educationMajor: "Computer Science",
      educationSchool: "Stanford",
      fullName: "Ada Lovelace",
      gender: "nonbinary",
      guests: "occasional",
      hometown: "San Francisco, CA",
      householdSize: "3",
      interests: ["Cooking", "Live music"],
      moveInBy: "2026-09-01",
      musicTaste: "Jazz",
      mustHaves: ["In-unit laundry", "Natural light"],
      neighborhoods: ["Mission", "Hayes Valley"],
      noiseTolerance: "moderate",
      occupationCompany: "Kinfolk",
      occupationCompanyDomain: "",
      educationSchoolDomain: "",
      occupationTitle: "Product engineer",
      openToRoommates: true,
      pets: "pet friendly",
      rentFlexibility: "pay_more_for_fit",
      sleepSchedule: "early",
      smoking: "no",
      socialEnergy: "balanced",
      workFromHome: "hybrid",
    } satisfies ProfileEnrichmentFormValues;

    const response = await POST(jsonRequest({ values }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      summary: "Profile enrichment form submitted.",
    });
    expect(mocks.saveProfileEnrichmentFormForCurrentUser).toHaveBeenCalledWith(values);
  });

  it("rejects signed-out enrichment form saves before parsing or saving", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await POST(rawRequest("{oops"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before saving your profile.",
    });
    expect(mocks.saveProfileEnrichmentFormForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without saving", async () => {
    const response = await POST(rawRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.saveProfileEnrichmentFormForCurrentUser).not.toHaveBeenCalled();
  });

  it("requires a values object before saving", async () => {
    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must include form values.",
    });
    expect(mocks.saveProfileEnrichmentFormForCurrentUser).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected save failures as generic form errors", async () => {
    const rawError = new Error("Supabase service role token leaked.");
    mocks.saveProfileEnrichmentFormForCurrentUser.mockRejectedValueOnce(rawError);

    const response = await POST(jsonRequest({ values: { fullName: "Ada" } }));

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Profile enrichment save failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile] enrichment form save failed",
      { error: rawError },
    );
  });
});
