import { describe, expect, it } from "vitest";
import {
  isDurableIdentityAvatarUrl,
  selectPreferredIdentityAvatarUrl,
  shouldReplaceIdentityAvatarUrl,
} from "@/lib/profiles/identity-avatar";

const durableUrl =
  "https://project.supabase.co/storage/v1/object/public/profile-photos/user/linkedin-profile.jpg";
const trustedStorageUrl = "https://project.supabase.co";

describe("identity avatar provenance", () => {
  it("recognizes public and transformed Kinfolk profile-photo URLs as durable", () => {
    expect(isDurableIdentityAvatarUrl(durableUrl, trustedStorageUrl)).toBe(true);
    expect(
      isDurableIdentityAvatarUrl(
        "https://project.supabase.co/storage/v1/render/image/public/profile-photos/user/photo.jpg?width=200",
        trustedStorageUrl,
      ),
    ).toBe(true);
    expect(
      isDurableIdentityAvatarUrl(
        "https://img.clerk.test/user.jpg",
        trustedStorageUrl,
      ),
    ).toBe(false);
  });

  it("rejects lookalike paths on untrusted origins or outside the bucket root", () => {
    expect(
      isDurableIdentityAvatarUrl(
        "https://attacker.test/storage/v1/object/public/profile-photos/user.jpg",
        trustedStorageUrl,
      ),
    ).toBe(false);
    expect(
      isDurableIdentityAvatarUrl(
        "https://project.supabase.co/proxy/storage/v1/object/public/profile-photos/user.jpg",
        trustedStorageUrl,
      ),
    ).toBe(false);
    expect(isDurableIdentityAvatarUrl(durableUrl, "not a URL")).toBe(false);
    expect(isDurableIdentityAvatarUrl(durableUrl, "")).toBe(false);
    expect(
      isDurableIdentityAvatarUrl(
        "file:///storage/v1/object/public/profile-photos/user.jpg",
        "file:///tmp",
      ),
    ).toBe(false);
  });

  it("preserves durable images but refreshes missing or stale provider URLs", () => {
    expect(
      shouldReplaceIdentityAvatarUrl(
        durableUrl,
        "https://img.clerk.test/new.jpg",
        trustedStorageUrl,
      ),
    ).toBe(false);
    expect(
      shouldReplaceIdentityAvatarUrl(
        null,
        "https://img.clerk.test/new.jpg",
        trustedStorageUrl,
      ),
    ).toBe(true);
    expect(
      shouldReplaceIdentityAvatarUrl(
        "https://media.licdn.test/expired.jpg",
        "https://img.clerk.test/new.jpg",
        trustedStorageUrl,
      ),
    ).toBe(true);
    expect(
      shouldReplaceIdentityAvatarUrl(
        "https://img.clerk.test/new.jpg",
        "https://img.clerk.test/new.jpg",
        trustedStorageUrl,
      ),
    ).toBe(false);
  });

  it("prefers durable images across historical rows", () => {
    expect(
      selectPreferredIdentityAvatarUrl(
        [
          {
            idempotency_key: "linkedin:user:provider",
            image_url: "https://img.clerk.test/new.jpg",
            updated_at: "2026-07-28T12:00:00.000Z",
          },
          {
            idempotency_key: "linkedin:user:manual-url",
            image_url: durableUrl,
            updated_at: "2026-07-27T12:00:00.000Z",
          },
        ],
        trustedStorageUrl,
      ),
    ).toBe(durableUrl);
  });

  it("otherwise prefers the freshest linked-account row over a manual URL row", () => {
    expect(
      selectPreferredIdentityAvatarUrl(
        [
          {
            idempotency_key: "linkedin:user:manual-url",
            image_url: "https://media.licdn.test/manual.jpg",
            updated_at: "2026-07-28T13:00:00.000Z",
          },
          {
            idempotency_key: "linkedin:user:provider",
            image_url: "https://img.clerk.test/current.jpg",
            updated_at: "2026-07-28T12:00:00.000Z",
          },
        ],
        trustedStorageUrl,
      ),
    ).toBe("https://img.clerk.test/current.jpg");
  });

  it("does not promote a lookalike storage path from an untrusted origin", () => {
    expect(
      selectPreferredIdentityAvatarUrl(
        [
          {
            idempotency_key: "linkedin:user:manual-url",
            image_url:
              "https://attacker.test/storage/v1/object/public/profile-photos/spoof.jpg",
            updated_at: "2026-07-27T12:00:00.000Z",
          },
          {
            idempotency_key: "linkedin:user:provider",
            image_url: "https://img.clerk.test/current.jpg",
            updated_at: "2026-07-28T12:00:00.000Z",
          },
        ],
        trustedStorageUrl,
      ),
    ).toBe("https://img.clerk.test/current.jpg");
  });
});
