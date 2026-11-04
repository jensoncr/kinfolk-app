import { describe, expect, it, vi } from "vitest";
import type { ClerkLinkedInIdentity } from "@/lib/integrations/clerk-user";

vi.mock("@/lib/supabase/config", () => ({
  supabaseUrl: "https://project.supabase.co",
}));

import {
  buildLinkedInIdentityJobKey,
  buildLinkedInIdentitySnapshot,
  syncLinkedInIdentitySnapshot,
} from "@/lib/profiles/linkedin-identity-snapshot";

function identity(
  overrides: Partial<ClerkLinkedInIdentity> = {},
): ClerkLinkedInIdentity {
  return {
    clerkUserId: "clerk-user-1",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    externalAuthConnected: true,
    avatarUrl: "https://img.clerk.test/ada.jpg",
    linkedin: {
      provider: "oauth_linkedin_oidc",
      providerUserId: "linkedin-user-1",
      externalAccountId: "external-account-1",
      emailAddress: "ada@linkedin.test",
      firstName: "Ada",
      lastName: "Lovelace",
      imageUrl: "https://img.linkedin.test/ada.jpg",
      username: "ada-lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace",
      approvedScopes: ["openid", "profile", "email"],
    },
    ...overrides,
  };
}

describe("LinkedIn identity snapshots", () => {
  it("builds the same stable identity key used by enrichment jobs", () => {
    expect(buildLinkedInIdentityJobKey(identity())).toBe(
      "linkedin:clerk-user-1:linkedin-user-1",
    );
  });

  it("builds a completed, non-queued avatar snapshot without provider work", () => {
    expect(
      buildLinkedInIdentitySnapshot({
        identity: identity(),
        now: new Date("2026-07-28T16:00:00.000Z"),
        userId: "user-1",
      }),
    ).toEqual({
      user_id: "user-1",
      clerk_user_id: "clerk-user-1",
      provider_user_id: "linkedin-user-1",
      linkedin_url: "https://www.linkedin.com/in/ada-lovelace",
      email: "ada@example.com",
      display_name: "Ada Lovelace",
      image_url: "https://img.clerk.test/ada.jpg",
      idempotency_key: "linkedin:clerk-user-1:linkedin-user-1",
      status: "skipped",
      attempt_count: 0,
      last_error: null,
      locked_at: null,
      next_attempt_at: "2026-07-28T16:00:00.000Z",
      completed_at: "2026-07-28T16:00:00.000Z",
    });
  });

  it("does not create a snapshot without both LinkedIn identity and an avatar", () => {
    expect(
      buildLinkedInIdentitySnapshot({
        identity: identity({ linkedin: null }),
        userId: "user-1",
      }),
    ).toBeNull();
    expect(
      buildLinkedInIdentitySnapshot({
        identity: identity({
          avatarUrl: "",
          linkedin: {
            ...identity().linkedin!,
            imageUrl: null,
          },
        }),
        userId: "user-1",
      }),
    ).toBeNull();
  });

  it("inserts a skipped snapshot when the identity has no legacy row", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const supabase = {
      from: vi.fn(() => ({
        insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("inserted");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        image_url: "https://img.clerk.test/ada.jpg",
        status: "skipped",
      }),
    );
  });

  it("preserves a durable avatar on an existing enrichment row", async () => {
    const updateEq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const insert = vi.fn();
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "job-1",
        image_url:
          "https://project.supabase.co/storage/v1/object/public/profile-photos/user/linkedin-profile.jpg",
      },
      error: null,
    }));
    const supabase = {
      from: vi.fn(() => ({
        insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
        update,
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("unchanged");
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("refreshes a stale provider avatar with a compare-and-set update", async () => {
    const updateMaybeSingle = vi.fn(async () => ({
      data: { id: "job-1" },
      error: null,
    }));
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const compareEq = vi.fn(() => ({ select: updateSelect }));
    const updateEq = vi.fn(() => ({ eq: compareEq }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const insert = vi.fn();
    const maybeSingle = vi.fn(async () => ({
      data: { id: "job-1", image_url: "https://media.licdn.test/expired.jpg" },
      error: null,
    }));
    const supabase = {
      from: vi.fn(() => ({
        insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
        update,
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("updated");
    expect(compareEq).toHaveBeenCalledWith(
      "image_url",
      "https://media.licdn.test/expired.jpg",
    );
  });

  it("fills only missing avatar metadata on an existing enrichment row", async () => {
    const updateMaybeSingle = vi.fn(async () => ({
      data: { id: "job-1" },
      error: null,
    }));
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const updateIs = vi.fn(() => ({ select: updateSelect }));
    const updateEq = vi.fn(() => ({ is: updateIs }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const insert = vi.fn();
    const maybeSingle = vi.fn(async () => ({
      data: { id: "job-1", image_url: null },
      error: null,
    }));
    const supabase = {
      from: vi.fn(() => ({
        insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
        update,
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("updated");
    expect(update).toHaveBeenCalledWith({
      image_url: "https://img.clerk.test/ada.jpg",
    });
    expect(updateEq).toHaveBeenCalledWith("id", "job-1");
    expect(updateIs).toHaveBeenCalledWith("image_url", null);
    expect(insert).not.toHaveBeenCalled();
  });

  it("compare-and-sets an existing blank avatar using its exact stored value", async () => {
    const updateMaybeSingle = vi.fn(async () => ({
      data: { id: "job-1" },
      error: null,
    }));
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const compareEq = vi.fn(() => ({ select: updateSelect }));
    const updateEq = vi.fn(() => ({ eq: compareEq }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const maybeSingle = vi.fn(async () => ({
      data: { id: "job-1", image_url: "   " },
      error: null,
    }));
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn(),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
        update,
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("updated");
    expect(compareEq).toHaveBeenCalledWith("image_url", "   ");
  });

  it("does not overwrite an avatar populated after the missing-image read", async () => {
    const updateMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const updateIs = vi.fn(() => ({ select: updateSelect }));
    const updateEq = vi.fn(() => ({ is: updateIs }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const insert = vi.fn();
    const maybeSingle = vi.fn(async () => ({
      data: { id: "job-1", image_url: null },
      error: null,
    }));
    const supabase = {
      from: vi.fn(() => ({
        insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
        update,
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("unchanged");
    expect(updateIs).toHaveBeenCalledWith("image_url", null);
  });

  it("preserves a populated avatar when another request wins the insert race", async () => {
    const update = vi.fn();
    const insert = vi.fn(async () => ({ error: { code: "23505" } }));
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: "job-1",
          image_url:
            "https://project.supabase.co/storage/v1/object/public/profile-photos/user/linkedin-profile.jpg",
        },
        error: null,
      });
    const supabase = {
      from: vi.fn(() => ({
        insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
        update,
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("unchanged");
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("fills a missing avatar when another request wins the insert race", async () => {
    const updateMaybeSingle = vi.fn(async () => ({
      data: { id: "job-1" },
      error: null,
    }));
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const updateIs = vi.fn(() => ({ select: updateSelect }));
    const updateEq = vi.fn(() => ({ is: updateIs }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const insert = vi.fn(async () => ({ error: { code: "23505" } }));
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { id: "job-1", image_url: null },
        error: null,
      });
    const supabase = {
      from: vi.fn(() => ({
        insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
        update,
      })),
    };

    await expect(
      syncLinkedInIdentitySnapshot(supabase as never, "user-1", identity()),
    ).resolves.toBe("updated");
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(updateIs).toHaveBeenCalledWith("image_url", null);
  });
});
