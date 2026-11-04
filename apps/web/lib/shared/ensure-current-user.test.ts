import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  getCurrentClerkLinkedInIdentity: vi.fn(),
  hasServerSupabaseConfig: vi.fn(() => true),
}));

vi.mock("@/lib/integrations/clerk-user", () => ({
  getCurrentClerkLinkedInIdentity: mocks.getCurrentClerkLinkedInIdentity,
}));

vi.mock("@/lib/supabase/config", () => ({
  hasServerSupabaseConfig: mocks.hasServerSupabaseConfig,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

const identity = {
  avatarUrl: "https://img.example.com/ada.png",
  clerkUserId: "clerk-user-1",
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  externalAuthConnected: true,
  linkedin: {
    approvedScopes: [],
    emailAddress: "ada@example.com",
    externalAccountId: "external-1",
    firstName: "Ada",
    imageUrl: null,
    lastName: "Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada/",
    provider: "oauth_linkedin",
    providerUserId: "linkedin-1",
    username: "ada",
  },
};

function existingUser() {
  return {
    about_text: null,
    birth_year: null,
    clerk_user_id: identity.clerkUserId,
    created_at: "2026-01-01T00:00:00.000Z",
    date_of_birth: null,
    display_name: identity.displayName,
    education_degree: null,
    education_major: null,
    education_school: null,
    education_year: null,
    email: identity.email,
    hometown: null,
    id: "user-1",
    interests: [],
    launch_market: "",
    linkedin_url: identity.linkedin.profileUrl,
    occupation_company: null,
    occupation_title: null,
    phone_e164: null,
    phone_verified_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function createKinfolkUsersClient() {
  const row = existingUser();
  const operations: string[] = [];

  const client = {
    from(table: string) {
      expect(table).toBe("kinfolk_users");
      return {
        select: () => {
          operations.push("select");
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          };
        },
        upsert: () => {
          operations.push("upsert");
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
      };
    },
  };

  return { client, operations, row };
}

describe("ensureCurrentKinfolkUser", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.hasServerSupabaseConfig.mockReturnValue(true);
  });

  it("returns signed-out without creating a Supabase client", async () => {
    const { ensureCurrentKinfolkUser } = await import("./users");
    mocks.getCurrentClerkLinkedInIdentity.mockResolvedValue(null);

    await expect(ensureCurrentKinfolkUser()).resolves.toEqual({
      identity: null,
      user: null,
    });

    expect(mocks.hasServerSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("returns identity without creating a client when Supabase is not configured", async () => {
    const { ensureCurrentKinfolkUser } = await import("./users");
    mocks.getCurrentClerkLinkedInIdentity.mockResolvedValue(identity);
    mocks.hasServerSupabaseConfig.mockReturnValue(false);

    await expect(ensureCurrentKinfolkUser()).resolves.toEqual({
      identity,
      user: null,
    });

    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("dedupes concurrent no-arg user ensures", async () => {
    const { ensureCurrentKinfolkUser } = await import("./users");
    const stub = createKinfolkUsersClient();
    mocks.getCurrentClerkLinkedInIdentity.mockResolvedValue(identity);
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    const [first, second] = await Promise.all([
      ensureCurrentKinfolkUser(),
      ensureCurrentKinfolkUser(),
    ]);

    expect(mocks.createSupabaseServiceClient).toHaveBeenCalledTimes(1);
    expect(stub.operations).toEqual(["select"]);
    expect(first).toEqual({ identity, user: stub.row });
    expect(second).toEqual(first);
  });
});
