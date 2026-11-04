import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/shared/api-error";
import { PATCH as patchFact, DELETE as deleteFact } from "./facts/[factId]/route";
import { GET as getImports, POST as postImport } from "./imports/route";
import { DELETE as deleteImport } from "./imports/[importId]/route";
import { POST as reviewImport } from "./imports/[importId]/review/route";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createProfileImportForCurrentUser: vi.fn(),
  deleteProfileImportForCurrentUser: vi.fn(),
  enforceApiUserRateLimit: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  getProfileEnrichmentSnapshot: vi.fn(),
  revalidateProfileDependentPaths: vi.fn(),
  reviewProfileImportMutationForCurrentUser: vi.fn(),
  updateProfileFactMutationForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/shared/api-rate-limit", () => ({
  enforceApiUserRateLimit: mocks.enforceApiUserRateLimit,
}));

vi.mock("@/lib/profiles/enrichment-store", () => ({
  createProfileImportForCurrentUser: mocks.createProfileImportForCurrentUser,
  deleteProfileImportForCurrentUser: mocks.deleteProfileImportForCurrentUser,
  getProfileEnrichmentSnapshot: mocks.getProfileEnrichmentSnapshot,
  reviewProfileImportMutationForCurrentUser:
    mocks.reviewProfileImportMutationForCurrentUser,
  updateProfileFactMutationForCurrentUser:
    mocks.updateProfileFactMutationForCurrentUser,
}));

vi.mock("@/lib/profiles/route-cache", () => ({
  revalidateProfileDependentPaths: mocks.revalidateProfileDependentPaths,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

const snapshot = {
  facts: [{ id: "fact-1", reviewState: "approved", value: "Quiet" }],
  imports: [{ id: "import-1", status: "processed" }],
  source: { detail: "ok", kind: "supabase", status: "connected" },
};

type RouteContext<TParams extends Record<string, string>> = {
  params: Promise<TParams>;
};

function jsonRequest<THandler extends (request: never, ...rest: never[]) => unknown>(
  body: unknown,
): Parameters<THandler>[0] {
  return new Request("https://kinfolk.test/api/profile-enrichment", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<THandler>[0];
}

function rawRequest<THandler extends (request: never, ...rest: never[]) => unknown>(
  body: string,
): Parameters<THandler>[0] {
  return new Request("https://kinfolk.test/api/profile-enrichment", {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as Parameters<THandler>[0];
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function factContext(factId = "fact-1"): RouteContext<{ factId: string }> {
  return { params: Promise.resolve({ factId }) };
}

function importContext(importId = "import-1"): RouteContext<{ importId: string }> {
  return { params: Promise.resolve({ importId }) };
}

describe("profile enrichment memory routes", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.enforceApiUserRateLimit.mockResolvedValue(null);
    mocks.createProfileImportForCurrentUser.mockResolvedValue(snapshot);
    mocks.deleteProfileImportForCurrentUser.mockResolvedValue(snapshot);
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: { clerkUserId: "clerk-1" },
      user: { id: "user-1" },
    });
    mocks.getProfileEnrichmentSnapshot.mockResolvedValue(snapshot);
    mocks.reviewProfileImportMutationForCurrentUser.mockResolvedValue({ snapshot });
    mocks.updateProfileFactMutationForCurrentUser.mockResolvedValue({ snapshot });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns the current enrichment snapshot for the memories panel", async () => {
    const response = await getImports();

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ snapshot });
    expect(mocks.getProfileEnrichmentSnapshot).toHaveBeenCalledTimes(1);
  });

  it("creates a pasted profile import with normalized source metadata", async () => {
    const response = await postImport(
      jsonRequest<typeof postImport>({
        method: "upload",
        payload: { profile_facts: [] },
        provider: "chatgpt",
        sourceLabel: "  ChatGPT export  ",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ snapshot });
    expect(mocks.createProfileImportForCurrentUser).toHaveBeenCalledWith({
      method: "upload",
      payload: { profile_facts: [] },
      provider: "chatgpt",
      sourceLabel: "ChatGPT export",
    });
  });

  it("rejects signed-out import requests before parsing or creating imports", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await postImport(rawRequest<typeof postImport>("{oops"));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before importing profile data.",
    });
    expect(mocks.createProfileImportForCurrentUser).not.toHaveBeenCalled();
  });

  it("falls back to safe import metadata for unsupported provider values", async () => {
    const response = await postImport(
      jsonRequest<typeof postImport>({
        method: "from-somewhere",
        payload: "raw text",
        provider: "unknown-ai",
        sourceLabel: "   ",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createProfileImportForCurrentUser).toHaveBeenCalledWith({
      method: "paste",
      payload: "raw text",
      provider: "other",
      sourceLabel: null,
    });
  });

  it("rejects malformed import JSON before creating an import", async () => {
    const response = await postImport(rawRequest<typeof postImport>("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.createProfileImportForCurrentUser).not.toHaveBeenCalled();
  });

  it("surfaces recognized profile import validation failures", async () => {
    mocks.createProfileImportForCurrentUser.mockRejectedValueOnce(
      new ApiError("Profile import must be a JSON object or array."),
    );

    const response = await postImport(
      jsonRequest<typeof postImport>({
        method: "upload",
        payload: null,
        provider: "chatgpt",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Profile import must be a JSON object or array.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected profile import failures", async () => {
    mocks.createProfileImportForCurrentUser.mockRejectedValueOnce(
      new Error("profile import insert failed: private detail"),
    );

    const response = await postImport(
      jsonRequest<typeof postImport>({
        method: "upload",
        payload: { profile_facts: [] },
        provider: "chatgpt",
      }),
    );

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Profile import failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile-enrichment] import failed",
      { error: expect.any(Error) },
    );
  });

  it("approves, rejects, and edits individual memory facts", async () => {
    const approveResponse = await patchFact(
      jsonRequest<typeof patchFact>({ reviewState: "approved" }),
      factContext("fact-approve"),
    );
    const rejectResponse = await patchFact(
      jsonRequest<typeof patchFact>({ reviewState: "rejected" }),
      factContext("fact-reject"),
    );
    const editResponse = await patchFact(
      jsonRequest<typeof patchFact>({
        reviewNote: "Corrected by user",
        reviewState: "edited",
        value: "Quiet after 10pm",
      }),
      factContext("fact-edit"),
    );

    expect(approveResponse.status).toBe(200);
    expect(rejectResponse.status).toBe(200);
    expect(editResponse.status).toBe(200);
    expect(mocks.updateProfileFactMutationForCurrentUser).toHaveBeenNthCalledWith(
      1,
      "fact-approve",
      {
        reviewNote: undefined,
        reviewState: "approved",
        value: undefined,
      },
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
    expect(mocks.updateProfileFactMutationForCurrentUser).toHaveBeenNthCalledWith(
      2,
      "fact-reject",
      {
        reviewNote: undefined,
        reviewState: "rejected",
        value: undefined,
      },
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
    expect(mocks.updateProfileFactMutationForCurrentUser).toHaveBeenNthCalledWith(
      3,
      "fact-edit",
      {
        reviewNote: "Corrected by user",
        reviewState: "edited",
        value: "Quiet after 10pm",
      },
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
  });

  it("rejects blank memory fact edits before mutating facts", async () => {
    const response = await patchFact(
      jsonRequest<typeof patchFact>({
        reviewState: "edited",
        value: "   ",
      }),
      factContext("fact-blank"),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Fact value cannot be blank.",
    });
    expect(mocks.updateProfileFactMutationForCurrentUser).not.toHaveBeenCalled();
  });

  it("surfaces recognized memory fact validation failures", async () => {
    mocks.updateProfileFactMutationForCurrentUser.mockRejectedValueOnce(
      new ApiError("Fact value must be JSON-compatible."),
    );

    const response = await patchFact(
      jsonRequest<typeof patchFact>({
        reviewState: "edited",
        value: () => "not json",
      }),
      factContext("fact-invalid"),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Fact value must be JSON-compatible.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected memory mutation failures", async () => {
    mocks.updateProfileFactMutationForCurrentUser
      .mockRejectedValueOnce(new Error("fact update failed: private detail"))
      .mockRejectedValueOnce(new Error("fact delete failed: private detail"));
    mocks.reviewProfileImportMutationForCurrentUser.mockRejectedValueOnce(
      new Error("import review failed: private detail"),
    );
    mocks.deleteProfileImportForCurrentUser.mockRejectedValueOnce(
      new Error("import delete failed: private detail"),
    );

    const factPatchResponse = await patchFact(
      jsonRequest<typeof patchFact>({ reviewState: "approved" }),
      factContext("fact-patch"),
    );
    const factDeleteResponse = await deleteFact(
      new Request("https://kinfolk.test") as never,
      factContext("fact-delete"),
    );
    const importReviewResponse = await reviewImport(
      jsonRequest<typeof reviewImport>({ action: "approve_all" }),
      importContext("import-review"),
    );
    const importDeleteResponse = await deleteImport(
      new Request("https://kinfolk.test") as never,
      importContext("import-delete"),
    );

    expect(factPatchResponse.status).toBe(500);
    await expect(readJson(factPatchResponse)).resolves.toEqual({
      error: "Profile fact update failed.",
    });
    expect(factDeleteResponse.status).toBe(500);
    await expect(readJson(factDeleteResponse)).resolves.toEqual({
      error: "Profile fact delete failed.",
    });
    expect(importReviewResponse.status).toBe(500);
    await expect(readJson(importReviewResponse)).resolves.toEqual({
      error: "Profile import review failed.",
    });
    expect(importDeleteResponse.status).toBe(500);
    await expect(readJson(importDeleteResponse)).resolves.toEqual({
      error: "Profile import delete failed.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile-enrichment] fact update failed",
      { error: expect.any(Error) },
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile-enrichment] fact delete failed",
      { error: expect.any(Error) },
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile-enrichment] import review failed",
      { error: expect.any(Error) },
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[profile-enrichment] import delete failed",
      { error: expect.any(Error) },
    );
  });

  it("rejects signed-out memory mutations before parsing or mutating", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: null,
    });

    const factPatchResponse = await patchFact(
      rawRequest<typeof patchFact>("{oops"),
      factContext("fact-patch"),
    );
    const factDeleteResponse = await deleteFact(
      new Request("https://kinfolk.test") as never,
      factContext("fact-delete"),
    );
    const importReviewResponse = await reviewImport(
      rawRequest<typeof reviewImport>("{oops"),
      importContext("import-review"),
    );
    const importDeleteResponse = await deleteImport(
      new Request("https://kinfolk.test") as never,
      importContext("import-delete"),
    );

    expect(factPatchResponse.status).toBe(401);
    await expect(readJson(factPatchResponse)).resolves.toEqual({
      error: "Sign in before editing profile facts.",
    });
    expect(factDeleteResponse.status).toBe(401);
    await expect(readJson(factDeleteResponse)).resolves.toEqual({
      error: "Sign in before editing profile facts.",
    });
    expect(importReviewResponse.status).toBe(401);
    await expect(readJson(importReviewResponse)).resolves.toEqual({
      error: "Sign in before reviewing profile imports.",
    });
    expect(importDeleteResponse.status).toBe(401);
    await expect(readJson(importDeleteResponse)).resolves.toEqual({
      error: "Sign in before deleting profile imports.",
    });

    expect(mocks.updateProfileFactMutationForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.reviewProfileImportMutationForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.deleteProfileImportForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects malformed signed-in memory mutation JSON before store helpers", async () => {
    const factPatchResponse = await patchFact(
      rawRequest<typeof patchFact>("{oops"),
      factContext("fact-patch"),
    );
    const importReviewResponse = await reviewImport(
      rawRequest<typeof reviewImport>("{oops"),
      importContext("import-review"),
    );

    expect(factPatchResponse.status).toBe(400);
    await expect(readJson(factPatchResponse)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(importReviewResponse.status).toBe(400);
    await expect(readJson(importReviewResponse)).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });

    expect(mocks.updateProfileFactMutationForCurrentUser).not.toHaveBeenCalled();
    expect(mocks.reviewProfileImportMutationForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects memory fact request bodies without fact updates before mutating facts", async () => {
    const nullResponse = await patchFact(
      jsonRequest<typeof patchFact>(null),
      factContext("fact-null"),
    );
    const arrayResponse = await patchFact(
      jsonRequest<typeof patchFact>([]),
      factContext("fact-array"),
    );
    const emptyObjectResponse = await patchFact(
      jsonRequest<typeof patchFact>({}),
      factContext("fact-empty"),
    );

    expect(nullResponse.status).toBe(400);
    await expect(readJson(nullResponse)).resolves.toEqual({
      error: "Request body must include a fact update.",
    });
    expect(arrayResponse.status).toBe(400);
    await expect(readJson(arrayResponse)).resolves.toEqual({
      error: "Request body must include a fact update.",
    });
    expect(emptyObjectResponse.status).toBe(400);
    await expect(readJson(emptyObjectResponse)).resolves.toEqual({
      error: "Request body must include a fact update.",
    });
    expect(mocks.updateProfileFactMutationForCurrentUser).not.toHaveBeenCalled();
  });

  it("deletes an individual memory fact through the same deferred mutation path", async () => {
    const response = await deleteFact(new Request("https://kinfolk.test") as never, factContext("fact-delete"));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ snapshot });
    expect(mocks.updateProfileFactMutationForCurrentUser).toHaveBeenCalledWith(
      "fact-delete",
      { reviewState: "deleted" },
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
  });

  it("handles approve-all and reject-all import review actions", async () => {
    const approveResponse = await reviewImport(
      jsonRequest<typeof reviewImport>({ action: "approve_all" }),
      importContext("import-approve"),
    );
    const rejectResponse = await reviewImport(
      jsonRequest<typeof reviewImport>({ action: "reject_all" }),
      importContext("import-reject"),
    );

    expect(approveResponse.status).toBe(200);
    expect(rejectResponse.status).toBe(200);
    expect(mocks.reviewProfileImportMutationForCurrentUser).toHaveBeenNthCalledWith(
      1,
      "import-approve",
      "approve_all",
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
    expect(mocks.reviewProfileImportMutationForCurrentUser).toHaveBeenNthCalledWith(
      2,
      "import-reject",
      "reject_all",
      { refreshMatchingState: "deferred", snapshotMode: "summary" },
    );
  });

  it("rejects unsupported import review actions before mutating facts", async () => {
    const response = await reviewImport(
      jsonRequest<typeof reviewImport>({ action: "approve_some" }),
      importContext(),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unsupported review action.",
    });
    expect(mocks.reviewProfileImportMutationForCurrentUser).not.toHaveBeenCalled();
  });

  it("deletes an import and revokes its facts", async () => {
    const response = await deleteImport(
      new Request("https://kinfolk.test") as never,
      importContext("import-delete"),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ snapshot });
    expect(mocks.deleteProfileImportForCurrentUser).toHaveBeenCalledWith(
      "import-delete",
    );
  });

});
