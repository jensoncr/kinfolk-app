import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { ApiError } from "@/lib/shared/api-error";

const mocks = vi.hoisted(() => ({
  ensureCurrentKinfolkUser: vi.fn(),
  revalidateProfileDependentPaths: vi.fn(),
  saveListPreferenceForCurrentUser: vi.fn(),
  saveStructuredPreferenceForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  saveListPreferenceForCurrentUser: mocks.saveListPreferenceForCurrentUser,
  saveStructuredPreferenceForCurrentUser:
    mocks.saveStructuredPreferenceForCurrentUser,
}));

vi.mock("@/lib/profiles/route-cache", () => ({
  revalidateProfileDependentPaths: mocks.revalidateProfileDependentPaths,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

function jsonRequest(body: unknown): Parameters<typeof PATCH>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile/preferences", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }) as Parameters<typeof PATCH>[0];
}

function rawRequest(body: string): Parameters<typeof PATCH>[0] {
  return new Request("https://kinfolk.test/api/kinfolk/profile/preferences", {
    body,
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }) as Parameters<typeof PATCH>[0];
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/kinfolk/profile/preferences", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: { id: "user-1" },
    });
    mocks.saveListPreferenceForCurrentUser.mockResolvedValue(undefined);
    mocks.saveStructuredPreferenceForCurrentUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("saves a structured preference token and revalidates dependent profile paths", async () => {
    const response = await PATCH(
      jsonRequest({
        factKey: "cleanliness",
        value: "very tidy",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.saveStructuredPreferenceForCurrentUser).toHaveBeenCalledWith(
      "cleanliness",
      "very tidy",
    );
    expect(mocks.saveListPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("saves additive list preferences after filtering unsupported entries", async () => {
    const response = await PATCH(
      jsonRequest({
        factKey: "must_haves",
        values: ["In-unit laundry", 42, "Sunny kitchen", null],
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
    expect(mocks.saveListPreferenceForCurrentUser).toHaveBeenCalledWith(
      "must_haves",
      ["In-unit laundry", "Sunny kitchen"],
    );
    expect(mocks.saveStructuredPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("normalizes additive list preferences before saving", async () => {
    const longValue = "Morning writing in the greenhouse with sunlight";
    const response = await PATCH(
      jsonRequest({
        factKey: "dealbreakers",
        values: [
          "  No   smoking indoors ",
          "no smoking indoors",
          longValue,
          ...Array.from({ length: 12 }, (_, index) => `Extra ${index + 1}`),
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.saveListPreferenceForCurrentUser).toHaveBeenCalledWith(
      "dealbreakers",
      [
        "No smoking indoors",
        "Morning writing in the greenhouse with s",
        ...Array.from({ length: 10 }, (_, index) => `Extra ${index + 1}`),
      ],
    );
    expect(mocks.revalidateProfileDependentPaths).toHaveBeenCalledTimes(1);
  });

  it("rejects signed-out preference updates before parsing or saving", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await PATCH(rawRequest("{oops"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before editing preferences.",
    });
    expect(mocks.saveStructuredPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.saveListPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("requires a factKey before saving", async () => {
    const response = await PATCH(jsonRequest({ value: "tidy" }));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "factKey is required.",
    });
    expect(mocks.saveStructuredPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.saveListPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without saving", async () => {
    const response = await PATCH(rawRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.saveStructuredPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.saveListPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("requires either a non-empty value or a values array", async () => {
    const response = await PATCH(
      jsonRequest({
        factKey: "sleep_schedule",
        value: "",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "value or values is required.",
    });
    expect(mocks.saveStructuredPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.saveListPreferenceForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
  });

  it("surfaces known preference validation failures without revalidating dependent paths", async () => {
    mocks.saveStructuredPreferenceForCurrentUser.mockRejectedValueOnce(
      new ApiError("Unsupported preference value."),
    );

    const response = await PATCH(
      jsonRequest({
        factKey: "sleep_schedule",
        value: "nocturnal",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unsupported preference value.",
    });
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected preference save failures", async () => {
    const rawError = new Error("Supabase service role token leaked.");
    mocks.saveListPreferenceForCurrentUser.mockRejectedValueOnce(rawError);

    const response = await PATCH(
      jsonRequest({
        factKey: "dealbreakers",
        values: ["Smoking indoors"],
      }),
    );

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Preference update failed.",
    });
    expect(mocks.revalidateProfileDependentPaths).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile] preference update failed",
      { error: rawError },
    );
  });
});
