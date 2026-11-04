import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: mocks.currentUser,
}));

function clerkUser(overrides: Record<string, unknown> = {}) {
  return {
    externalAccounts: [],
    firstName: "Ada",
    fullName: "Ada Lovelace",
    id: "clerk-user-1",
    imageUrl: "https://img.example.com/ada.png",
    lastName: "Lovelace",
    primaryEmailAddress: { emailAddress: "ada@example.com" },
    ...overrides,
  };
}

function linkedInAccount(overrides: Record<string, unknown> = {}) {
  return {
    approvedScopes: "r_profile_basicinfo email",
    emailAddress: "linkedin@example.com",
    firstName: "Linked",
    id: "external-1",
    imageUrl: "https://img.example.com/linkedin.png",
    lastName: "In",
    provider: "oauth_linkedin_oidc",
    providerUserId: "linkedin-1",
    publicMetadata: {},
    username: "ada",
    ...overrides,
  };
}

describe("getCurrentClerkLinkedInIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("trims Clerk identity fields before returning the current Kinfolk identity", async () => {
    mocks.currentUser.mockResolvedValue(
      clerkUser({
        externalAccounts: [
          linkedInAccount({
            approvedScopes: " r_profile_basicinfo   email ",
            emailAddress: " linkedin@example.com ",
            firstName: " Linked ",
            id: " external-1 ",
            imageUrl: " https://img.example.com/linkedin.png ",
            lastName: " In ",
            provider: " oauth_linkedin_oidc ",
            providerUserId: " linkedin-1 ",
            publicMetadata: {
              profile_url: " linkedin.com/in/ada-lovelace/ ",
            },
            username: " @ada ",
          }),
        ],
        firstName: " Ada ",
        fullName: "   ",
        imageUrl: " https://img.example.com/ada.png ",
        lastName: " Lovelace ",
        primaryEmailAddress: { emailAddress: " ada@example.com " },
      }),
    );
    const { getCurrentClerkLinkedInIdentity } = await import("./clerk-user");

    await expect(getCurrentClerkLinkedInIdentity()).resolves.toEqual({
      avatarUrl: "https://img.example.com/ada.png",
      clerkUserId: "clerk-user-1",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      externalAuthConnected: true,
      linkedin: {
        approvedScopes: ["r_profile_basicinfo", "email"],
        emailAddress: "linkedin@example.com",
        externalAccountId: "external-1",
        firstName: "Linked",
        imageUrl: "https://img.example.com/linkedin.png",
        lastName: "In",
        profileUrl: "https://www.linkedin.com/in/ada-lovelace",
        provider: "oauth_linkedin_oidc",
        providerUserId: "linkedin-1",
        username: "ada",
      },
    });
  });

  it("falls back to Kinfolk member when Clerk and LinkedIn names are blank", async () => {
    mocks.currentUser.mockResolvedValue(
      clerkUser({
        externalAccounts: [
          linkedInAccount({
            firstName: " ",
            lastName: "",
          }),
        ],
        firstName: " ",
        fullName: " ",
        lastName: "",
      }),
    );
    const { getCurrentClerkLinkedInIdentity } = await import("./clerk-user");

    await expect(getCurrentClerkLinkedInIdentity()).resolves.toMatchObject({
      displayName: "Kinfolk member",
    });
  });
});
