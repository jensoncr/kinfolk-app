import { describe, expect, it } from "vitest";
import { roommateGroupMemberKey } from "./group-member-identity";

describe("roommateGroupMemberKey", () => {
  it("uses a stable user id before display fields", () => {
    expect(
      roommateGroupMemberKey({
        userId: " user-123 ",
        name: "Mina Lee",
        initials: "ML",
        imageUrl: "https://example.com/mina.jpg",
        headline: "Designer",
      }),
    ).toBe("user:user-123");
  });

  it("derives the same fallback key when member order changes", () => {
    const members = [
      {
        name: "Mina Lee",
        initials: "ML",
        imageUrl: "https://example.com/mina.jpg",
        headline: "Designer",
      },
      {
        name: "Jamie Chen",
        initials: "JC",
        imageUrl: undefined,
        headline: "Engineer",
      },
    ];

    const originalKeys = members.map(roommateGroupMemberKey).sort();
    const reorderedKeys = [...members].reverse().map(roommateGroupMemberKey).sort();

    expect(reorderedKeys).toEqual(originalKeys);
    expect(originalKeys.every((key) => !key.includes("undefined"))).toBe(true);
  });
});
