import { describe, expect, it, vi } from "vitest";
import { upsertKinfolkUserFromClerk } from "./users";
import type { ClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";

vi.mock("server-only", () => ({}));

const identity: ClerkLinkedInIdentity = {
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

function existingUser(overrides: Record<string, unknown> = {}) {
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
    linkedin_url: identity.linkedin?.profileUrl ?? null,
    occupation_company: null,
    occupation_title: null,
    phone_e164: null,
    phone_verified_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type Operation = {
  action: "select" | "update" | "upsert";
  payload?: unknown;
};

function createKinfolkUsersClient(initialUser: ReturnType<typeof existingUser> | null) {
  let row = initialUser;
  const operations: Operation[] = [];

  const client = {
    from(table: string) {
      expect(table).toBe("kinfolk_users");
      return {
        select: () => {
          operations.push({ action: "select" });
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          operations.push({ action: "update", payload });
          row = row ? { ...row, ...payload } : row;
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            }),
          };
        },
        upsert: (payload: Record<string, unknown>) => {
          operations.push({ action: "upsert", payload });
          row = { ...existingUser({ id: "user-new" }), ...payload };
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
      };
    },
  };

  return { client, operations };
}

describe("upsertKinfolkUserFromClerk", () => {
  it("returns an unchanged existing user without writing", async () => {
    const user = existingUser();
    const { client, operations } = createKinfolkUsersClient(user);

    const result = await upsertKinfolkUserFromClerk(client as never, identity);

    expect(result).toBe(user);
    expect(operations).toEqual([{ action: "select" }]);
  });

  it("backfills a missing display name from Clerk", async () => {
    const { client, operations } = createKinfolkUsersClient(
      existingUser({ display_name: null }),
    );

    const result = await upsertKinfolkUserFromClerk(client as never, identity);

    expect(result).toMatchObject({
      display_name: identity.displayName,
    });
    expect(operations).toEqual([
      { action: "select" },
      {
        action: "update",
        payload: {
          display_name: identity.displayName,
        },
      },
    ]);
  });

  it("backfills a blank stored display name from Clerk", async () => {
    const { client, operations } = createKinfolkUsersClient(
      existingUser({ display_name: "   " }),
    );

    const result = await upsertKinfolkUserFromClerk(client as never, identity);

    expect(result).toMatchObject({
      display_name: identity.displayName,
    });
    expect(operations).toEqual([
      { action: "select" },
      {
        action: "update",
        payload: {
          display_name: identity.displayName,
        },
      },
    ]);
  });

  it("preserves a user-edited display name", async () => {
    const editedDisplayName = "Countess of Numbers";
    const { client, operations } = createKinfolkUsersClient(
      existingUser({ display_name: editedDisplayName }),
    );

    const result = await upsertKinfolkUserFromClerk(client as never, identity);

    expect(result).toMatchObject({
      display_name: editedDisplayName,
    });
    expect(operations).toEqual([{ action: "select" }]);
  });

  it("updates only Clerk-derived fields that changed", async () => {
    const { client, operations } = createKinfolkUsersClient(
      existingUser({
        email: "old@example.com",
        launch_market: "New York City",
        linkedin_url: null,
      }),
    );

    const result = await upsertKinfolkUserFromClerk(client as never, identity);

    expect(result).toMatchObject({
      email: identity.email,
      launch_market: "",
      linkedin_url: identity.linkedin?.profileUrl,
    });
    expect(operations).toEqual([
      { action: "select" },
      {
        action: "update",
        payload: {
          email: identity.email,
          launch_market: "",
          linkedin_url: identity.linkedin?.profileUrl,
        },
      },
    ]);
  });

  it("still creates the user row when Clerk has no matching Kinfolk user", async () => {
    const { client, operations } = createKinfolkUsersClient(null);

    const result = await upsertKinfolkUserFromClerk(client as never, identity);

    expect(result).toMatchObject({
      clerk_user_id: identity.clerkUserId,
      display_name: identity.displayName,
      email: identity.email,
      linkedin_url: identity.linkedin?.profileUrl,
    });
    expect(operations).toEqual([
      { action: "select" },
      {
        action: "upsert",
        payload: {
          clerk_user_id: identity.clerkUserId,
          display_name: identity.displayName,
          email: identity.email,
          launch_market: "",
          linkedin_url: identity.linkedin?.profileUrl,
        },
      },
    ]);
  });
});
