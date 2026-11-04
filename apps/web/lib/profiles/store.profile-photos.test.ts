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

import {
  addProfilePhotoForCurrentUser,
  deleteProfilePhotoForCurrentUser,
  reorderProfilePhotosForCurrentUser,
} from "./store";

type PhotoRow = { id: string; position: number };

function createPhotoReorderClient(rows: PhotoRow[]) {
  const selectQuery = {
    data: rows,
    error: null,
    eq: vi.fn(() => selectQuery),
    order: vi.fn(() => selectQuery),
  };
  const updates: Array<{
    eqCalls: Array<[string, string]>;
    error: null;
    payload: Record<string, unknown>;
  }> = [];
  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe("kinfolk_user_photos");
      return {
        select: vi.fn(() => selectQuery),
        update: vi.fn((payload: Record<string, unknown>) => {
          const updateQuery = {
            eqCalls: [] as Array<[string, string]>,
            error: null,
            payload,
            eq: vi.fn((column: string, value: string) => {
              updateQuery.eqCalls.push([column, value]);
              return updateQuery;
            }),
          };
          updates.push(updateQuery);
          return updateQuery;
        }),
      };
    }),
  };

  return { client, selectQuery, updates };
}

function createPhotoMutationClient({
  existingPhotos = [],
  insertError = null,
  removeError = null,
  removeThrow = null,
  targetPhoto = null,
  resequenceRows = [],
}: {
  existingPhotos?: PhotoRow[];
  insertError?: Error | null;
  removeError?: Error | null;
  removeThrow?: Error | null;
  targetPhoto?: ({ storage_path: string } & PhotoRow) | null;
  resequenceRows?: PhotoRow[];
} = {}) {
  const uploads: Array<{
    bytes: Buffer;
    options: Record<string, unknown>;
    path: string;
  }> = [];
  const removals: string[][] = [];
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{
    eqCalls: Array<[string, string]>;
    payload: Record<string, unknown>;
  }> = [];

  const existingQuery = {
    data: existingPhotos,
    error: null,
    eq: vi.fn(() => existingQuery),
    order: vi.fn(() => existingQuery),
  };

  const targetQuery = {
    eq: vi.fn(() => targetQuery),
    maybeSingle: vi.fn(async () => ({ data: targetPhoto, error: null })),
  };

  const resequenceQuery = {
    data: resequenceRows,
    error: null,
    eq: vi.fn(() => resequenceQuery),
    order: vi.fn(() => resequenceQuery),
  };

  let selectCalls = 0;
  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe("kinfolk_user_photos");
      return {
        delete: vi.fn(() => {
          const deleteQuery = {
            error: null,
            eq: vi.fn(() => deleteQuery),
          };
          return deleteQuery;
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserts.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: "photo-new", ...payload },
                error: insertError,
              })),
            })),
          };
        }),
        select: vi.fn((columns: string) => {
          if (columns === "*") {
            selectCalls += 1;
            if (targetPhoto && selectCalls === 1) {
              return targetQuery;
            }
            return existingQuery;
          }
          if (columns === "id, position") {
            return resequenceQuery;
          }
          throw new Error(`Unexpected select columns: ${columns}`);
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          const updateQuery = {
            eqCalls: [] as Array<[string, string]>,
            error: null,
            payload,
            eq: vi.fn((column: string, value: string) => {
              updateQuery.eqCalls.push([column, value]);
              return updateQuery;
            }),
          };
          updates.push(updateQuery);
          return updateQuery;
        }),
      };
    }),
    storage: {
      from: vi.fn((bucket: string) => {
        expect(bucket).toBe("profile-photos");
        return {
          getPublicUrl: vi.fn((path: string) => ({
            data: { publicUrl: `https://cdn.example.com/${path}` },
          })),
          remove: vi.fn(async (paths: string[]) => {
            removals.push(paths);
            if (removeThrow) {
              throw removeThrow;
            }
            return { data: null, error: removeError };
          }),
          upload: vi.fn(
            async (path: string, bytes: Buffer, options: Record<string, unknown>) => {
              uploads.push({ bytes, options, path });
              return { data: null, error: null };
            },
          ),
        };
      }),
    },
  };

  return {
    client,
    existingQuery,
    inserts,
    removals,
    resequenceQuery,
    targetQuery,
    updates,
    uploads,
  };
}

describe("profile photo store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: {
        avatarUrl: "",
        linkedin: null,
        subject: "clerk-user",
      },
      user: { id: "user-1" },
    });
  });

  it("uploads a new photo, inserts the next position, and returns the stored row", async () => {
    const stub = createPhotoMutationClient({
      existingPhotos: [{ id: "photo-1", position: 0 }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      addProfilePhotoForCurrentUser({
        bytes: Buffer.from([1, 2, 3]),
        contentType: "image/png",
        filename: "profile.png",
      }),
    ).resolves.toMatchObject({
      content_type: "image/png",
      id: "photo-new",
      is_primary: false,
      position: 1,
      public_url: expect.stringContaining("https://cdn.example.com/user-1/"),
      user_id: "user-1",
    });

    expect(stub.existingQuery.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(stub.uploads).toEqual([
      {
        bytes: Buffer.from([1, 2, 3]),
        options: { contentType: "image/png", upsert: false },
        path: expect.stringMatching(/^user-1\/.+\.png$/),
      },
    ]);
    expect(stub.inserts).toEqual([
      expect.objectContaining({
        content_type: "image/png",
        is_primary: false,
        position: 1,
        public_url: expect.stringMatching(/^https:\/\/cdn\.example\.com\/user-1\/.+\.png$/),
        storage_path: stub.uploads[0]?.path,
        user_id: "user-1",
      }),
    ]);
  });

  it("stores HEIF profile photos with HEIF content type and extension", async () => {
    const stub = createPhotoMutationClient();
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      addProfilePhotoForCurrentUser({
        bytes: Buffer.from([6, 7, 8]),
        contentType: "image/heif",
        filename: "profile.heif",
      }),
    ).resolves.toMatchObject({
      content_type: "image/heif",
      id: "photo-new",
      public_url: expect.stringContaining(".heif"),
    });

    expect(stub.uploads).toEqual([
      {
        bytes: Buffer.from([6, 7, 8]),
        options: { contentType: "image/heif", upsert: false },
        path: expect.stringMatching(/^user-1\/.+\.heif$/),
      },
    ]);
    expect(stub.inserts).toEqual([
      expect.objectContaining({
        content_type: "image/heif",
        public_url: expect.stringMatching(/^https:\/\/cdn\.example\.com\/user-1\/.+\.heif$/),
        storage_path: stub.uploads[0]?.path,
      }),
    ]);
  });

  it("counts a visible LinkedIn photo against the six-photo upload cap", async () => {
    const existingPhotos = Array.from({ length: 5 }, (_, index) => ({
      id: `photo-${index + 1}`,
      position: index,
    }));
    const stub = createPhotoMutationClient({ existingPhotos });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: {
        avatarUrl: "",
        linkedin: { imageUrl: "https://media.example.com/linkedin.jpg" },
        subject: "clerk-user",
      },
      user: { id: "user-1" },
    });

    await expect(
      addProfilePhotoForCurrentUser({
        bytes: Buffer.from([1]),
        contentType: "image/jpeg",
        filename: "profile.jpg",
      }),
    ).rejects.toThrow("You can store up to 6 photos.");

    expect(stub.uploads).toEqual([]);
    expect(stub.inserts).toEqual([]);
  });

  it("does not mark the first upload primary while a LinkedIn photo is visible", async () => {
    const stub = createPhotoMutationClient();
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: {
        avatarUrl: "https://img.example.com/avatar.jpg",
        linkedin: { imageUrl: null },
        subject: "clerk-user",
      },
      user: { id: "user-1" },
    });

    await expect(
      addProfilePhotoForCurrentUser({
        bytes: Buffer.from([1, 2, 3]),
        contentType: "image/png",
        filename: "profile.png",
      }),
    ).resolves.toMatchObject({
      is_primary: false,
      position: 0,
    });

    expect(stub.inserts).toEqual([
      expect.objectContaining({
        is_primary: false,
        position: 0,
      }),
    ]);
  });

  it("removes the uploaded object when inserting the photo row fails", async () => {
    const stub = createPhotoMutationClient({
      insertError: new Error("insert failed"),
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      addProfilePhotoForCurrentUser({
        bytes: Buffer.from([1]),
        contentType: "image/jpeg",
        filename: "profile.jpg",
      }),
    ).rejects.toThrow("insert failed");

    expect(stub.uploads).toHaveLength(1);
    expect(stub.removals).toEqual([[stub.uploads[0]?.path]]);
  });

  it("preserves the insert error when failed-upload storage cleanup throws", async () => {
    const stub = createPhotoMutationClient({
      insertError: new Error("insert failed"),
      removeThrow: new Error("storage cleanup unavailable"),
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await expect(
      addProfilePhotoForCurrentUser({
        bytes: Buffer.from([1]),
        contentType: "image/jpeg",
        filename: "profile.jpg",
      }),
    ).rejects.toThrow("insert failed");

    expect(stub.uploads).toHaveLength(1);
    expect(stub.removals).toEqual([[stub.uploads[0]?.path]]);
  });

  it("deletes the photo row, removes storage, and resequences remaining photos", async () => {
    const stub = createPhotoMutationClient({
      resequenceRows: [
        { id: "photo-2", position: 1 },
        { id: "photo-3", position: 2 },
      ],
      targetPhoto: {
        id: "photo-1",
        position: 0,
        storage_path: "user-1/photo-1.png",
      },
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await deleteProfilePhotoForCurrentUser("photo-1");

    expect(stub.targetQuery.eq).toHaveBeenCalledWith("id", "photo-1");
    expect(stub.targetQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(stub.removals).toEqual([["user-1/photo-1.png"]]);
    expect(stub.resequenceQuery.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(stub.updates.map((update) => update.payload)).toEqual([
      { is_primary: false, position: 1000 },
      { is_primary: false, position: 1001 },
      { is_primary: true, position: 0 },
      { is_primary: false, position: 1 },
    ]);
    expect(
      stub.updates.map((update) =>
        update.eqCalls.find(([column]) => column === "id")?.[1],
      ),
    ).toEqual(["photo-2", "photo-3", "photo-2", "photo-3"]);
  });

  it("still resequences deleted photos when storage cleanup is best-effort", async () => {
    const stub = createPhotoMutationClient({
      removeError: new Error("storage unavailable"),
      resequenceRows: [
        { id: "photo-2", position: 1 },
        { id: "photo-3", position: 2 },
      ],
      targetPhoto: {
        id: "photo-1",
        position: 0,
        storage_path: "user-1/photo-1.png",
      },
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await deleteProfilePhotoForCurrentUser("photo-1");

    expect(stub.removals).toEqual([["user-1/photo-1.png"]]);
    expect(stub.resequenceQuery.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(stub.updates.map((update) => update.payload)).toEqual([
      { is_primary: false, position: 1000 },
      { is_primary: false, position: 1001 },
      { is_primary: true, position: 0 },
      { is_primary: false, position: 1 },
    ]);
  });

  it("still resequences deleted photos when storage cleanup throws", async () => {
    const stub = createPhotoMutationClient({
      removeThrow: new Error("storage unavailable"),
      resequenceRows: [
        { id: "photo-2", position: 1 },
        { id: "photo-3", position: 2 },
      ],
      targetPhoto: {
        id: "photo-1",
        position: 0,
        storage_path: "user-1/photo-1.png",
      },
    });
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await deleteProfilePhotoForCurrentUser("photo-1");

    expect(stub.removals).toEqual([["user-1/photo-1.png"]]);
    expect(stub.resequenceQuery.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(stub.updates.map((update) => update.payload)).toEqual([
      { is_primary: false, position: 1000 },
      { is_primary: false, position: 1001 },
      { is_primary: true, position: 0 },
      { is_primary: false, position: 1 },
    ]);
  });

  it("preserves omitted existing photos when applying a partial reorder", async () => {
    const stub = createPhotoReorderClient([
      { id: "photo-1", position: 0 },
      { id: "photo-2", position: 1 },
      { id: "photo-3", position: 2 },
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    await reorderProfilePhotosForCurrentUser([
      " photo-2 ",
      "unknown-photo",
      " ",
      "photo-2",
    ]);

    expect(mocks.ensureCurrentKinfolkUser).toHaveBeenCalledWith(stub.client);
    expect(stub.selectQuery.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(stub.updates.map((update) => update.payload)).toEqual([
      { is_primary: false, position: 1000 },
      { is_primary: false, position: 1001 },
      { is_primary: false, position: 1002 },
      { is_primary: true, position: 0 },
      { is_primary: false, position: 1 },
      { is_primary: false, position: 2 },
    ]);
    expect(
      stub.updates.map((update) =>
        update.eqCalls.find(([column]) => column === "id")?.[1],
      ),
    ).toEqual(["photo-2", "photo-1", "photo-3", "photo-2", "photo-1", "photo-3"]);
  });
});
