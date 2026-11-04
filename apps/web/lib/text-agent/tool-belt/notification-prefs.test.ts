import { describe, expect, it, vi } from "vitest";
import { setNotificationPrefsTool } from "./notification-prefs";
import type { HousingAgentToolContext } from "./types";

function makeContext({
  allowWrites = true,
  state = {
    apartment_matches_enabled: false,
    group_ready_enabled: false,
    profile_questions_enabled: false,
    roommate_matches_enabled: true,
  },
}: {
  allowWrites?: boolean;
  state?: Record<string, boolean>;
} = {}) {
  const upsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: state, error: null })),
    })),
  }));
  const context: HousingAgentToolContext = {
    allowWrites,
    supabase: { from: vi.fn(() => ({ upsert })) } as never,
    threadId: "thread-1",
    userId: "user-1",
  };
  return { context, upsert };
}

describe("set_notification_prefs", () => {
  it("updates only the kinds the user named and reports the final state", async () => {
    const { context, upsert } = makeContext();

    const result = await setNotificationPrefsTool.run(context, {
      roommate_matches: true,
    });

    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      { roommate_matches_enabled: true, user_id: "user-1" },
      { onConflict: "user_id" },
    );
    expect(result.summary).toContain("roommate matches: on");
    expect(result.summary).toContain("apartment matches: off");
  });

  it("requires at least one explicit kind", async () => {
    const { context, upsert } = makeContext();

    const result = await setNotificationPrefsTool.run(context, {});

    expect(result.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("previews without writing when writes are disabled", async () => {
    const { context, upsert } = makeContext({ allowWrites: false });

    const result = await setNotificationPrefsTool.run(context, {
      apartment_matches: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data.previewOnly).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("supports turning a kind off without touching the others", async () => {
    const { context, upsert } = makeContext();

    await setNotificationPrefsTool.run(context, { roommate_matches: false });

    expect(upsert).toHaveBeenCalledWith(
      { roommate_matches_enabled: false, user_id: "user-1" },
      { onConflict: "user_id" },
    );
  });

  it("requires explicit opt-in for slow profile questions", async () => {
    const { context, upsert } = makeContext({
      state: {
        apartment_matches_enabled: false,
        group_ready_enabled: false,
        profile_questions_enabled: true,
        roommate_matches_enabled: false,
      },
    });

    const result = await setNotificationPrefsTool.run(context, {
      profile_questions: true,
    });

    expect(upsert).toHaveBeenCalledWith(
      { profile_questions_enabled: true, user_id: "user-1" },
      { onConflict: "user_id" },
    );
    expect(result.summary).toContain("profile questions: on");
  });
});
