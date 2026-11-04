// NOTE: server-only modules must be mocked at top-level before any imports.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mock @/ deps that the module imports so Vitest's no-alias env can resolve them.
vi.mock("@/lib/integrations/text-transport", () => ({
  getActiveTextTransportProvider: vi.fn(() => "linq"),
  getTextTransportFromNumber: vi.fn(() => "+15551234567"),
  isTextAgentEnabled: vi.fn(() => true),
  sendTextMessage: vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => ({
    chatId: `dry-run:linq:+12125550100`,
    deliveryStatus: "dry_run",
    messageId: `dry-run:${idempotencyKey}`,
    service: "dry_run",
  })),
}));

vi.mock("@/lib/integrations/continue-on-phone", () => ({
  normalizeSmsRecipient: (phone: string) => phone,
}));

vi.mock("@/lib/matching/match-status", () => ({
  VISIBLE_APARTMENT_MATCH_STATUSES: ["suggested", "saved", "touring", "applied"],
}));

import { isOverDailyCap, isWithinQuietHours } from "./delivery";
import {
  buildApartmentMatchIdempotencyKey,
  sendApartmentMatchNotification,
  sendGroupReadyNotification,
  sendRoommateMatchNotification,
} from "./match-notifications";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("buildApartmentMatchIdempotencyKey", () => {
  it("is deterministic and includes both ids", () => {
    const key = buildApartmentMatchIdempotencyKey({
      recipientUserId: "u1",
      listingMatchId: "m1",
    });
    expect(key).toBe("kinfolk:apt-match:u1:m1");

    // Calling it again with the same args yields the identical key.
    expect(
      buildApartmentMatchIdempotencyKey({
        recipientUserId: "u1",
        listingMatchId: "m1",
      }),
    ).toBe(key);
  });

  it("distinguishes different users and matches", () => {
    const k1 = buildApartmentMatchIdempotencyKey({
      recipientUserId: "u1",
      listingMatchId: "m1",
    });
    const k2 = buildApartmentMatchIdempotencyKey({
      recipientUserId: "u2",
      listingMatchId: "m1",
    });
    const k3 = buildApartmentMatchIdempotencyKey({
      recipientUserId: "u1",
      listingMatchId: "m2",
    });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });
});

describe("isWithinQuietHours", () => {
  // America/New_York in January = EST = UTC-5.
  // 02:00 UTC → 21:00 EST  (inside [21, 9))
  // 06:00 UTC → 01:00 EST  (inside [21, 9))
  // 19:00 UTC → 14:00 EST  (outside [21, 9))
  // 14:00 UTC → 09:00 EST  (boundary — 9 is NOT in [21, 9), window is exclusive)

  it("returns true when local time is inside the wrapping quiet window (11pm EST)", () => {
    const nowUtc = new Date("2026-01-15T02:00:00Z");
    expect(
      isWithinQuietHours({
        nowUtc,
        timezone: "America/New_York",
        quietHoursStart: 21,
        quietHoursEnd: 9,
      }),
    ).toBe(true);
  });

  it("returns true when local time is inside the wrapping quiet window (1am EST)", () => {
    const nowUtc = new Date("2026-01-15T06:00:00Z");
    expect(
      isWithinQuietHours({
        nowUtc,
        timezone: "America/New_York",
        quietHoursStart: 21,
        quietHoursEnd: 9,
      }),
    ).toBe(true);
  });

  it("returns false when local time is outside the quiet window (2pm EST)", () => {
    const nowUtc = new Date("2026-01-15T19:00:00Z");
    expect(
      isWithinQuietHours({
        nowUtc,
        timezone: "America/New_York",
        quietHoursStart: 21,
        quietHoursEnd: 9,
      }),
    ).toBe(false);
  });

  it("returns false when local time is at quiet_hours_end (exclusive boundary)", () => {
    // 14:00 UTC → 09:00 EST — 9am is the end of quiet hours; window is [21, 9)
    // so hour=9 is NOT in the window (end is exclusive).
    const nowUtc = new Date("2026-01-15T14:00:00Z");
    expect(
      isWithinQuietHours({
        nowUtc,
        timezone: "America/New_York",
        quietHoursStart: 21,
        quietHoursEnd: 9,
      }),
    ).toBe(false);
  });

  it("handles a non-wrapping quiet window correctly", () => {
    // Window [10, 18) in UTC.
    expect(
      isWithinQuietHours({
        nowUtc: new Date("2026-01-15T15:00:00Z"),
        timezone: "UTC",
        quietHoursStart: 10,
        quietHoursEnd: 18,
      }),
    ).toBe(true);
    expect(
      isWithinQuietHours({
        nowUtc: new Date("2026-01-15T08:00:00Z"),
        timezone: "UTC",
        quietHoursStart: 10,
        quietHoursEnd: 18,
      }),
    ).toBe(false);
  });

  it("falls back to the default timezone when stored prefs contain an invalid timezone", () => {
    // 06:00Z = 10pm America/Los_Angeles (the default), inside 21–9 quiet.
    expect(
      isWithinQuietHours({
        nowUtc: new Date("2026-01-15T06:00:00Z"),
        timezone: " Mars/Phobos ",
        quietHoursStart: 21,
        quietHoursEnd: 9,
      }),
    ).toBe(true);
  });
});

describe("isOverDailyCap", () => {
  it("returns true when count equals cap", () => {
    expect(isOverDailyCap({ sentTodayCount: 3, dailySendCap: 3 })).toBe(true);
  });

  it("returns true when count exceeds cap", () => {
    expect(isOverDailyCap({ sentTodayCount: 5, dailySendCap: 3 })).toBe(true);
  });

  it("returns false when count is below cap", () => {
    expect(isOverDailyCap({ sentTodayCount: 2, dailySendCap: 3 })).toBe(false);
  });

  it("returns true when cap is zero and count is zero", () => {
    expect(isOverDailyCap({ sentTodayCount: 0, dailySendCap: 0 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Supabase-mocked integration cases
// ---------------------------------------------------------------------------

/**
 * Build a minimal chainable Supabase mock. Callers register per-table results;
 * all filter/order/limit calls pass through as identity.
 */
function buildChain(result: {
  data: Record<string, unknown> | null;
  error: { message: string; code?: string } | null;
  count?: number;
}) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select", "eq", "neq", "not", "gte", "in", "order", "limit",
  ]) {
    chain[method] = () => chain;
  }
  chain["maybeSingle"] = async () => result;
  chain["single"] = async () =>
    result.data
      ? result
      : { data: null, error: result.error ?? { message: "no data" } };
  // insert / upsert / update return a chain with select().single().
  const insertChain = {
    select: () => ({
      single: async () => result,
    }),
    eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  };
  chain["insert"] = () => insertChain;
  chain["upsert"] = () => insertChain;
  chain["update"] = () => ({
    eq: () => Promise.resolve({ data: null, error: null }),
  });
  return chain;
}

function buildSupabaseMock(
  tableData: Record<
    string,
    {
      data: Record<string, unknown> | null;
      error: { message: string; code?: string } | null;
      count?: number;
    }
  >,
) {
  return {
    from: (tableName: string) => {
      const tableResult = tableData[tableName] ?? { data: null, error: null, count: 0 };
      return buildChain(tableResult);
    },
  };
}

describe("sendApartmentMatchNotification (supabase-mocked)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects blank direct ids before reading Supabase", async () => {
    const supabase = { from: vi.fn() };

    await expect(
      sendApartmentMatchNotification(
        supabase as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
        { userId: "   ", listingMatchId: "match-blank" },
      ),
    ).resolves.toEqual({
      sent: false,
      skipped: "invalid_match_notification_target",
    });

    await expect(
      sendApartmentMatchNotification(
        supabase as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
        { userId: "user-blank", listingMatchId: "   " },
      ),
    ).resolves.toEqual({
      sent: false,
      skipped: "invalid_match_notification_target",
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns disabled_by_user when apartment_matches_enabled is false", async () => {
    const supabase = buildSupabaseMock({
      apartment_listing_matches: {
        data: {
          id: "match-1",
          user_id: "user-1",
          listing_id: "listing-1",
          status: "suggested",
          fit_score: 80,
          per_person_rent: 1500,
          effective_per_person_rent: 1500,
          created_at: "2026-06-10T00:00:00Z",
        },
        error: null,
      },
      match_notification_prefs: {
        data: {
          user_id: "user-1",
          apartment_matches_enabled: false,
          roommate_matches_enabled: false,
          group_ready_enabled: false,
          quiet_hours_start: 21,
          quiet_hours_end: 9,
          timezone: "America/New_York",
          daily_send_cap: 3,
          created_at: "2026-06-10T00:00:00Z",
          updated_at: "2026-06-10T00:00:00Z",
        },
        error: null,
      },
    });

    const { sendTextMessage } = await import("@/lib/integrations/text-transport");
    vi.mocked(sendTextMessage).mockClear();

    const result = await sendApartmentMatchNotification(
      supabase as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
      { userId: "user-1", listingMatchId: "match-1" },
    );

    expect(result).toEqual({ sent: false, skipped: "disabled_by_user" });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("returns already_sent when match_notifications row has outbound_message_id", async () => {
    vi.stubEnv("KINFOLK_TEXT_TRANSPORT_DRY_RUN", "true");

    // Build a more nuanced mock: match_notifications has count query (head:true)
    // and a row-return query for idempotency.
    const supabaseMixed = {
      from: (tableName: string) => {
        if (tableName === "apartment_listing_matches") {
          return buildChain({
            data: {
              id: "match-2",
              user_id: "user-2",
              listing_id: "listing-2",
              status: "suggested",
              fit_score: 75,
              per_person_rent: 2000,
              effective_per_person_rent: 2000,
              created_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "match_notification_prefs") {
          return buildChain({
            data: {
              user_id: "user-2",
              apartment_matches_enabled: true,
              roommate_matches_enabled: false,
              group_ready_enabled: false,
              quiet_hours_start: 21,
              quiet_hours_end: 9,
              timezone: "UTC",
              daily_send_cap: 10,
              created_at: "2026-06-10T00:00:00Z",
              updated_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "user_phone_numbers") {
          return buildChain({
            data: {
              id: "phone-2",
              user_id: "user-2",
              phone_e164: "+12125550100",
              verified_at: "2026-06-01T00:00:00Z",
              sms_consent_state: "opted_in",
            },
            error: null,
          });
        }
        if (tableName === "match_notifications") {
          // For the count (head) query, return count=0.
          // For the idempotency lookup, return the row with outbound_message_id.
          const chain: Record<string, (...args: unknown[]) => unknown> = {};
          chain["select"] = (...args: unknown[]) => {
            const opts = args[1] as { head?: boolean } | undefined;
            if (opts?.head) {
              // Velocity cap — return 0 so we don't cap.
              return {
                eq: () => ({
                  eq: () => ({
                    gte: () => Promise.resolve({ data: null, error: null, count: 0 }),
                  }),
                }),
              };
            }
            // Idempotency lookup — return existing row with outbound_message_id.
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "notif-2",
                        outbound_message_id: "linq:msg-existing",
                        status: "sent",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          };
          return chain;
        }
        return buildChain({ data: null, error: null });
      },
    };

    const result = await sendApartmentMatchNotification(
      supabaseMixed as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
      { userId: "user-2", listingMatchId: "match-2" },
    );

    expect(result).toEqual({ sent: false, skipped: "already_sent" });
  });

  it("requires explicit opted-in SMS consent before using a verified phone", async () => {
    const phoneQuery: Record<string, unknown> = {};
    const phoneEq = vi.fn(() => phoneQuery);
    const phoneNeq = vi.fn(() => phoneQuery);
    phoneQuery["select"] = vi.fn(() => phoneQuery);
    phoneQuery["eq"] = phoneEq;
    phoneQuery["not"] = vi.fn(() => phoneQuery);
    phoneQuery["neq"] = phoneNeq;
    phoneQuery["order"] = vi.fn(() => phoneQuery);
    phoneQuery["limit"] = vi.fn(() => phoneQuery);
    phoneQuery["maybeSingle"] = vi.fn(async () => ({ data: null, error: null }));

    const supabase = {
      from: (tableName: string) => {
        if (tableName === "apartment_listing_matches") {
          return buildChain({
            data: {
              id: "match-consent",
              user_id: "user-consent",
              listing_id: "listing-consent",
              status: "suggested",
              fit_score: 75,
              per_person_rent: 2000,
              effective_per_person_rent: 2000,
              created_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "match_notification_prefs") {
          return buildChain({
            data: {
              user_id: "user-consent",
              apartment_matches_enabled: true,
              roommate_matches_enabled: false,
              group_ready_enabled: false,
              quiet_hours_start: 21,
              quiet_hours_end: 9,
              timezone: "UTC",
              daily_send_cap: 10,
              created_at: "2026-06-10T00:00:00Z",
              updated_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "user_phone_numbers") {
          return phoneQuery;
        }
        return buildChain({ data: null, error: null });
      },
    };

    const result = await sendApartmentMatchNotification(
      supabase as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
      { userId: "user-consent", listingMatchId: "match-consent" },
    );

    expect(result).toEqual({ sent: false, skipped: "no_verified_phone" });
    expect(phoneEq).toHaveBeenCalledWith("user_id", "user-consent");
    expect(phoneEq).toHaveBeenCalledWith("sms_consent_state", "opted_in");
    expect(phoneNeq).not.toHaveBeenCalledWith("sms_consent_state", "opted_out");
  });

  it("repairs an unsent notification reservation from an already-recorded outbound message", async () => {
    const { sendTextMessage } = await import("@/lib/integrations/text-transport");
    vi.mocked(sendTextMessage).mockClear();

    let repairedPayload: Record<string, unknown> | null = null;
    let repairTarget: unknown[] | null = null;
    const existingNotification = {
      id: "notif-retry",
      outbound_message_id: null,
      status: "failed",
      thread_id: null,
    };
    const supabase = {
      from: (tableName: string) => {
        if (tableName === "apartment_listing_matches") {
          return buildChain({
            data: {
              id: "match-retry",
              user_id: "user-retry",
              listing_id: "listing-retry",
              status: "suggested",
              fit_score: 75,
              per_person_rent: 2000,
              effective_per_person_rent: 2000,
              created_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "match_notification_prefs") {
          return buildChain({
            data: {
              user_id: "user-retry",
              apartment_matches_enabled: true,
              roommate_matches_enabled: false,
              group_ready_enabled: false,
              quiet_hours_start: 21,
              quiet_hours_end: 9,
              timezone: "UTC",
              daily_send_cap: 10,
              created_at: "2026-06-10T00:00:00Z",
              updated_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "user_phone_numbers") {
          return buildChain({
            data: {
              id: "phone-retry",
              user_id: "user-retry",
              phone_e164: "+12125550100",
              verified_at: "2026-06-01T00:00:00Z",
              sms_consent_state: "opted_in",
            },
            error: null,
          });
        }
        if (tableName === "match_notifications") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: existingNotification,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              repairedPayload = payload;
              return {
                eq: (...args: unknown[]) => {
                  repairTarget = args;
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        }
        if (tableName === "text_messages") {
          return buildChain({
            data: {
              provider_message_id: "linq:already-sent",
              thread_id: "thread-retry",
            },
            error: null,
          });
        }
        return buildChain({ data: null, error: null });
      },
    };

    const result = await sendApartmentMatchNotification(
      supabase as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
      { userId: "user-retry", listingMatchId: "match-retry" },
    );

    expect(result).toEqual({ sent: false, skipped: "already_sent" });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(repairedPayload).toEqual({
      outbound_message_id: "linq:already-sent",
      status: "sent",
      thread_id: "thread-retry",
    });
    expect(repairTarget).toEqual(["id", "notif-retry"]);
  });

  it("skips sending when a racing worker already reserved the match notification", async () => {
    const { sendTextMessage, getActiveTextTransportProvider, isTextAgentEnabled } =
      await import("@/lib/integrations/text-transport");
    vi.mocked(getActiveTextTransportProvider).mockReturnValue("linq");
    vi.mocked(isTextAgentEnabled).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockClear();

    const idempotencyKey = "kinfolk:apt-match:user-race:match-race";
    let matchNotificationLookups = 0;
    let insertedNotification: Record<string, unknown> | null = null;
    const racedReservation = {
      id: "notif-race",
      recipient_user_id: "user-race",
      kind: "apartment_match",
      outbound_idempotency_key: idempotencyKey,
      outbound_message_id: null,
      status: "failed",
      subject_id: "match-race",
      thread_id: null,
      card_snapshot: null,
      created_at: "2026-06-10T12:00:00Z",
      updated_at: "2026-06-10T12:00:00Z",
    };

    const supabase = {
      from: (tableName: string) => {
        if (tableName === "apartment_listing_matches") {
          return buildChain({
            data: {
              id: "match-race",
              user_id: "user-race",
              listing_id: "listing-race",
              status: "suggested",
              fit_score: 91,
              per_person_rent: 1900,
              effective_per_person_rent: 1900,
              created_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "match_notification_prefs") {
          return buildChain({
            data: {
              user_id: "user-race",
              apartment_matches_enabled: true,
              roommate_matches_enabled: false,
              group_ready_enabled: false,
              quiet_hours_start: 21,
              quiet_hours_end: 9,
              timezone: "UTC",
              daily_send_cap: 10,
              created_at: "2026-06-10T00:00:00Z",
              updated_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "user_phone_numbers") {
          return buildChain({
            data: {
              id: "phone-race",
              user_id: "user-race",
              phone_e164: "+12125550100",
              verified_at: "2026-06-01T00:00:00Z",
              sms_consent_state: "opted_in",
            },
            error: null,
          });
        }
        if (tableName === "match_notifications") {
          const chain: Record<string, (...args: unknown[]) => unknown> = {};
          chain["select"] = (...args: unknown[]) => {
            const opts = args[1] as { head?: boolean } | undefined;
            if (opts?.head) {
              const capChain: Record<string, (...args: unknown[]) => unknown> =
                {};
              capChain["eq"] = () => capChain;
              capChain["not"] = () => capChain;
              capChain["gte"] = () =>
                Promise.resolve({ data: null, error: null, count: 0 });
              return capChain;
            }
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => {
                      matchNotificationLookups += 1;
                      return {
                        data:
                          matchNotificationLookups === 1
                            ? null
                            : racedReservation,
                        error: null,
                      };
                    },
                  }),
                }),
              }),
            };
          };
          chain["insert"] = (...args: unknown[]) => {
            insertedNotification = args[0] as Record<string, unknown>;
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate key" },
                }),
              }),
            };
          };
          return chain;
        }
        if (tableName === "apartment_listings") {
          return buildChain({
            data: {
              id: "listing-race",
              address_line: "456 Race St",
              neighborhood: "Brooklyn",
              city: "New York",
              monthly_rent: 3800,
              effective_monthly_rent: 3800,
              bedrooms: 2,
              bathrooms: 1,
              source_url: "https://example.com/listing/race",
            },
            error: null,
          });
        }
        if (tableName === "text_threads") {
          return buildChain({ data: null, error: null });
        }
        if (tableName === "text_messages") {
          return buildChain({ data: null, error: null });
        }
        return buildChain({ data: null, error: null });
      },
    };

    const result = await sendApartmentMatchNotification(
      supabase as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
      {
        userId: "user-race",
        listingMatchId: "match-race",
        nowUtc: new Date("2026-06-10T12:00:00Z"),
      },
    );

    expect(result).toEqual({ sent: false, skipped: "already_reserved" });
    expect(matchNotificationLookups).toBe(2);
    expect(insertedNotification).toMatchObject({
      outbound_idempotency_key: idempotencyKey,
      recipient_user_id: "user-race",
      status: "failed",
    });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("does not mark a notification sent when the text provider omits a message id", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "");
    const { sendTextMessage, getActiveTextTransportProvider, isTextAgentEnabled } =
      await import("@/lib/integrations/text-transport");
    vi.mocked(getActiveTextTransportProvider).mockReturnValue("linq");
    vi.mocked(isTextAgentEnabled).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({
      chatId: "chat-no-message-id",
      deliveryStatus: "sent",
      messageId: "",
      service: "linq",
    });

    let insertedNotification: Record<string, unknown> | null = null;
    let notificationUpdates = 0;
    let textMessagesInserted = 0;
    let textThreadsUpserted = 0;

    const supabase = {
      from: (tableName: string) => {
        if (tableName === "apartment_listing_matches") {
          return buildChain({
            data: {
              id: "match-no-message-id",
              user_id: "user-no-message-id",
              listing_id: "listing-no-message-id",
              status: "suggested",
              fit_score: 87,
              per_person_rent: 2100,
              effective_per_person_rent: 2000,
              created_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "match_notification_prefs") {
          return buildChain({
            data: {
              user_id: "user-no-message-id",
              apartment_matches_enabled: true,
              roommate_matches_enabled: false,
              group_ready_enabled: false,
              quiet_hours_start: 21,
              quiet_hours_end: 9,
              timezone: "UTC",
              daily_send_cap: 10,
              created_at: "2026-06-10T00:00:00Z",
              updated_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "user_phone_numbers") {
          return buildChain({
            data: {
              id: "phone-no-message-id",
              user_id: "user-no-message-id",
              phone_e164: "+12125550100",
              verified_at: "2026-06-01T00:00:00Z",
              sms_consent_state: "opted_in",
            },
            error: null,
          });
        }
        if (tableName === "match_notifications") {
          const chain: Record<string, (...args: unknown[]) => unknown> = {};
          chain["select"] = (...args: unknown[]) => {
            const opts = args[1] as { head?: boolean } | undefined;
            if (opts?.head) {
              const capChain: Record<string, (...args: unknown[]) => unknown> =
                {};
              capChain["eq"] = () => capChain;
              capChain["not"] = () => capChain;
              capChain["gte"] = () =>
                Promise.resolve({ data: null, error: null, count: 0 });
              return capChain;
            }
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            };
          };
          chain["insert"] = (...args: unknown[]) => {
            insertedNotification = args[0] as Record<string, unknown>;
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: "notif-no-message-id",
                    outbound_idempotency_key:
                      "kinfolk:apt-match:user-no-message-id:match-no-message-id",
                    outbound_message_id: null,
                    status: "failed",
                  },
                  error: null,
                }),
              }),
            };
          };
          chain["update"] = () => {
            notificationUpdates += 1;
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          };
          return chain;
        }
        if (tableName === "apartment_listings") {
          return buildChain({
            data: {
              id: "listing-no-message-id",
              address_line: "Provider Edge Ave",
              neighborhood: "Mission",
              city: "San Francisco",
              monthly_rent: 4200,
              effective_monthly_rent: 4000,
              bedrooms: 2,
              bathrooms: 1,
              source_url: "https://example.com/listing/no-message-id",
            },
            error: null,
          });
        }
        if (tableName === "text_threads") {
          const threadChain = buildChain({ data: null, error: null }) as Record<
            string,
            unknown
          >;
          threadChain["upsert"] = () => {
            textThreadsUpserted += 1;
            return {
              select: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            };
          };
          return threadChain;
        }
        if (tableName === "text_messages") {
          return {
            insert: () => {
              textMessagesInserted += 1;
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        return buildChain({ data: null, error: null });
      },
    };

    await expect(
      sendApartmentMatchNotification(
        supabase as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
        {
          userId: "user-no-message-id",
          listingMatchId: "match-no-message-id",
          nowUtc: new Date("2026-06-10T12:00:00Z"),
        },
      ),
    ).rejects.toThrow(
      "Text transport did not return an apartment-match notification message id.",
    );

    expect(sendTextMessage).toHaveBeenCalledOnce();
    expect(insertedNotification).toMatchObject({
      outbound_idempotency_key:
        "kinfolk:apt-match:user-no-message-id:match-no-message-id",
      recipient_user_id: "user-no-message-id",
      status: "failed",
    });
    expect(textThreadsUpserted).toBe(0);
    expect(textMessagesInserted).toBe(0);
    expect(notificationUpdates).toBe(0);
  });

  it.each([
    [
      "localhost app and source URLs",
      "http://localhost:3000",
      "http://localhost:3000/listings/local",
      "https://usekinfolk.com/apartments?listing=listing-local",
    ],
    [
      "private app and source URLs",
      "https://10.0.0.5",
      "https://192.168.1.20/listings/local",
      "https://usekinfolk.com/apartments?listing=listing-local",
    ],
    [
      "IPv4-mapped private app and source URLs",
      "https://[::ffff:10.0.0.5]",
      "https://[::ffff:192.168.1.20]/listings/local",
      "https://usekinfolk.com/apartments?listing=listing-local",
    ],
    [
      "safe app URL with link-local source URL",
      "https://kinfolk.example.com",
      "http://169.254.169.254/latest/meta-data",
      "https://kinfolk.example.com/apartments?listing=listing-local",
    ],
  ])(
    "uses a safe Kinfolk listing URL for %s",
    async (_label, appBaseUrl, listingSourceUrl, expectedUrl) => {
      vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", appBaseUrl);
      const { sendTextMessage } = await import("@/lib/integrations/text-transport");
      vi.mocked(sendTextMessage).mockClear();

      const supabase = buildSupabaseMock({
        apartment_listing_matches: {
          data: {
            id: "match-local",
            user_id: "user-local",
            listing_id: "listing-local",
            status: "suggested",
            fit_score: 82,
            per_person_rent: 2400,
            effective_per_person_rent: null,
            created_at: "2026-06-10T00:00:00Z",
          },
          error: null,
        },
        apartment_listings: {
          data: {
            id: "listing-local",
            address_line: "Local Link Ave",
            neighborhood: "Mission",
            city: "San Francisco",
            monthly_rent: 4800,
            effective_monthly_rent: 4800,
            bedrooms: 2,
            bathrooms: 1,
            source_url: listingSourceUrl,
          },
          error: null,
        },
        match_notification_prefs: {
          data: {
            user_id: "user-local",
            apartment_matches_enabled: true,
            roommate_matches_enabled: false,
            group_ready_enabled: false,
            quiet_hours_start: 21,
            quiet_hours_end: 9,
            timezone: "UTC",
            daily_send_cap: 10,
            created_at: "2026-06-10T00:00:00Z",
            updated_at: "2026-06-10T00:00:00Z",
          },
          error: null,
        },
        match_notifications: {
          data: {
            id: "notif-local",
            outbound_idempotency_key: "kinfolk:apt-match:user-local:match-local",
            outbound_message_id: null,
            status: "failed",
          },
          error: null,
          count: 0,
        },
        text_messages: { data: null, error: null },
        text_threads: {
          data: {
            id: "thread-local",
            provider: "linq",
            provider_chat_id: "chat-local",
            to_phone_e164: "+12125550100",
            from_phone_e164: "+15551234567",
            user_id: "user-local",
            phone_number_id: "phone-local",
          },
          error: null,
        },
        user_phone_numbers: {
          data: {
            id: "phone-local",
            user_id: "user-local",
            phone_e164: "+12125550100",
            verified_at: "2026-06-01T00:00:00Z",
            sms_consent_state: "opted_in",
          },
          error: null,
        },
      });

      const result = await sendApartmentMatchNotification(
        supabase as unknown as Parameters<
          typeof sendApartmentMatchNotification
        >[0],
        {
          userId: "user-local",
          listingMatchId: "match-local",
          nowUtc: new Date("2026-06-10T12:00:00Z"),
        },
      );

      expect(result).toEqual({ notificationId: "notif-local", sent: true });
      // This case pins the text link's safe-URL fallback; the optional card media
      // part (gated on a public media base URL) is covered by the happy-path test.
      expect(vi.mocked(sendTextMessage).mock.calls[0][0].parts[0]).toEqual({
        type: "text",
        value: `New match: Local Link Ave — Mission, $2,400/person. See it here: ${expectedUrl}`,
      });
    },
  );

  it("returns sent:true with a dry-run messageId when all gates pass", async () => {
    vi.stubEnv("KINFOLK_TEXT_TRANSPORT_DRY_RUN", "true");
    vi.stubEnv("KINFOLK_TEXT_TRANSPORT", "linq");
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");

    // Run at midday UTC so quiet hours [21, 9) are not active.
    const { sendTextMessage, getActiveTextTransportProvider, isTextAgentEnabled } =
      await import("@/lib/integrations/text-transport");
    vi.mocked(getActiveTextTransportProvider).mockReturnValue("linq");
    vi.mocked(isTextAgentEnabled).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockClear();

    let capNotFilter: Array<unknown> | null = null;
    let insertedNotification: Record<string, unknown> | null = null;
    let insertedTextMessage: Record<string, unknown> | null = null;
    const notifRow = {
      id: "notif-3",
      recipient_user_id: "user-3",
      kind: "apartment_match",
      outbound_idempotency_key: "kinfolk:apt-match:user-3:match-3",
      outbound_message_id: null,
      status: "sent",
      subject_id: "match-3",
      thread_id: null,
      card_snapshot: null,
      created_at: "2026-06-10T12:00:00Z",
      updated_at: "2026-06-10T12:00:00Z",
    };

    const supabaseFull = {
      from: (tableName: string) => {
        if (tableName === "apartment_listing_matches") {
          return buildChain({
            data: {
              id: "match-3",
              user_id: "user-3",
              listing_id: "listing-3",
              status: "suggested",
              fit_score: 90,
              per_person_rent: 1800,
              effective_per_person_rent: -25,
              created_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "match_notification_prefs") {
          return buildChain({
            data: {
              user_id: "user-3",
              apartment_matches_enabled: true,
              roommate_matches_enabled: false,
              group_ready_enabled: false,
              // UTC timezone; run test at 12:00 UTC → hour=12, outside [21,9).
              quiet_hours_start: 21,
              quiet_hours_end: 9,
              timezone: "UTC",
              daily_send_cap: 10,
              created_at: "2026-06-10T00:00:00Z",
              updated_at: "2026-06-10T00:00:00Z",
            },
            error: null,
          });
        }
        if (tableName === "user_phone_numbers") {
          return buildChain({
            data: {
              id: "phone-3",
              user_id: "user-3",
              phone_e164: "+12125550100",
              verified_at: "2026-06-01T00:00:00Z",
              sms_consent_state: "opted_in",
            },
            error: null,
          });
        }
        if (tableName === "match_notifications") {
          const chain: Record<string, (...args: unknown[]) => unknown> = {};
          chain["select"] = (...args: unknown[]) => {
            const opts = args[1] as { head?: boolean } | undefined;
            if (opts?.head) {
              const capChain: Record<string, (...args: unknown[]) => unknown> =
                {};
              capChain["eq"] = () => capChain;
              capChain["gte"] = () =>
                Promise.resolve({ data: null, error: null, count: 0 });
              capChain["not"] = (...args: unknown[]) => {
                const [column, operator, value] = args;
                capNotFilter = [column, operator, value];
                return capChain;
              };
              // Velocity cap: 0 sent today.
              return capChain;
            }
            // Idempotency: no existing row.
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            };
          };
          chain["insert"] = (...args: unknown[]) => {
            insertedNotification = args[0] as Record<string, unknown>;
            return {
              select: () => ({
                single: async () => ({ data: notifRow, error: null }),
              }),
            };
          };
          chain["update"] = () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          });
          return chain;
        }
        if (tableName === "apartment_listings") {
          return buildChain({
            data: {
              id: "listing-3",
              address_line: " 123\n Main   St ",
              neighborhood: " Brooklyn\n Heights ",
              city: "New York",
              monthly_rent: 3600,
              effective_monthly_rent: 3600,
              bedrooms: 2,
              bathrooms: 1,
              source_url: " javascript:alert(1) ",
            },
            error: null,
          });
        }
        if (tableName === "text_threads") {
          const threadData = {
            id: "thread-3",
            provider: "linq",
            provider_chat_id: "dry-run:linq:+12125550100",
            to_phone_e164: "+12125550100",
            from_phone_e164: "+15551234567",
            user_id: "user-3",
            phone_number_id: "phone-3",
          };
          return {
            // findNotificationThread — deep chain ending in maybeSingle (null = no existing thread).
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                  }),
                  // upsertNotificationThread byChat lookup: .eq("provider",...).eq("provider_chat_id",...).maybeSingle()
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
                // also handle .eq("provider_chat_id") directly off the first .eq("provider"):
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            upsert: () => ({
              select: () => ({
                single: async () => ({ data: threadData, error: null }),
              }),
            }),
          };
        }
        if (tableName === "text_messages") {
          return {
            insert: (payload: Record<string, unknown>) => {
              insertedTextMessage = payload;
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        return buildChain({ data: null, error: null });
      },
    };

    // Pass a fixed midday-UTC timestamp so quiet hours [21, 9) are never active
    // regardless of when the test suite runs.
    const result = await sendApartmentMatchNotification(
      supabaseFull as unknown as Parameters<typeof sendApartmentMatchNotification>[0],
      {
        userId: " user-3 ",
        listingMatchId: " match-3 ",
        nowUtc: new Date("2026-06-10T12:00:00Z"),
      },
    );

    expect(result.sent).toBe(true);
    expect(result.notificationId).toBe("notif-3");
    // sendTextMessage was called (the dry-run path returns a dry-run: messageId,
    // so no real carrier was hit).
    expect(sendTextMessage).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(sendTextMessage).mock.calls[0][0];
    expect(callArgs.to).toBe("+12125550100");
    expect(callArgs.idempotencyKey).toBe("kinfolk:apt-match:user-3:match-3");
    expect(callArgs.parts[0]).toEqual({
      type: "text",
      value:
        "New match: 123 Main St — Brooklyn Heights, $1,800/person. See it here: https://kinfolk.example.com/apartments?listing=listing-3",
    });
    // The listing card rides along as a media part so the notification carries
    // the apartment photo, not just a link.
    expect(callArgs.parts).toHaveLength(2);
    expect(callArgs.parts[1]).toMatchObject({ type: "media" });
    expect((callArgs.parts[1] as { url: string }).url).toContain(
      "https://kinfolk.example.com/api/listing-card/embedded",
    );
    expect(insertedTextMessage).toMatchObject({
      body:
        "New match: 123 Main St — Brooklyn Heights, $1,800/person. See it here: https://kinfolk.example.com/apartments?listing=listing-3",
      media: [{ type: "media" }],
    });
    expect(capNotFilter).toEqual(["outbound_message_id", "is", null]);
    expect(insertedNotification).toMatchObject({
      outbound_idempotency_key: "kinfolk:apt-match:user-3:match-3",
      recipient_user_id: "user-3",
      status: "failed",
      subject_id: "match-3",
    });
    expect(insertedTextMessage).toMatchObject({
      raw_payload: expect.objectContaining({
        listing_match_id: "match-3",
        user_id: "user-3",
      }),
      user_id: "user-3",
    });
  });
});

// ---------------------------------------------------------------------------
// Roommate-match + group-ready senders
// ---------------------------------------------------------------------------

/**
 * Richer per-table stub than buildSupabaseMock: list queries are awaitable
 * (thenable chain), maybeSingle returns the first row, inserts return the
 * table's insertRow. Enough to drive the full consent chain end-to-end.
 */
function buildListAwareSupabase(
  tables: Record<
    string,
    {
      /** Overrides the thenable count (filters aren't simulated). */
      count?: number;
      insertRow?: Record<string, unknown>;
      rows?: Array<Record<string, unknown>>;
    }
  >,
) {
  return {
    from: (tableName: string) => {
      const table = tables[tableName] ?? {};
      const rows = table.rows ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "not", "gte", "in", "order", "limit"]) {
        chain[method] = () => chain;
      }
      chain["maybeSingle"] = async () => ({ data: rows[0] ?? null, error: null });
      chain["single"] = async () =>
        rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { message: "no data" } };
      chain["then"] = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          count: table.count ?? rows.length,
          data: rows,
          error: null,
        }).then(resolve, reject);
      const insertChain: Record<string, unknown> = {
        select: () => ({
          single: async () => ({ data: table.insertRow ?? null, error: null }),
        }),
      };
      insertChain["then"] = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      chain["insert"] = () => insertChain;
      chain["upsert"] = () => ({
        select: () => ({
          single: async () => ({ data: table.insertRow ?? rows[0] ?? null, error: null }),
        }),
      });
      chain["update"] = () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      });
      return chain;
    },
  } as unknown as Parameters<typeof sendRoommateMatchNotification>[0];
}

// 19:00 UTC in January = 14:00 EST — safely outside the default 21–9 window.
const OUTSIDE_QUIET_HOURS = new Date("2026-01-15T19:00:00.000Z");

const roommateEdgeRow = {
  computed_at: "2026-07-05T12:00:00.000Z",
  id: "edge-1",
  score: 84,
  score_components: {
    communication_fit: 0.6,
    home_labor_fit: 1,
    trust_bridge_strength: 1,
  },
  status: "active",
  user_a_id: "user-1",
  user_b_id: "user-2",
};

const enabledPrefsRow = {
  daily_send_cap: 3,
  group_ready_enabled: true,
  quiet_hours_end: 9,
  quiet_hours_start: 21,
  roommate_matches_enabled: true,
  timezone: "America/New_York",
};

const phoneRow = { id: "phone-1", phone_e164: "+12125550100" };

describe("sendRoommateMatchNotification", () => {
  it("skips edges below the 80-point policy threshold", async () => {
    const supabase = buildListAwareSupabase({
      compatibility_edges: { rows: [{ ...roommateEdgeRow, score: 74 }] },
    });

    await expect(
      sendRoommateMatchNotification(supabase, { userId: "user-1", edgeId: "edge-1" }),
    ).resolves.toEqual({ sent: false, skipped: "below_threshold" });
  });

  it("defaults to OFF when the user never opted into roommate notifications", async () => {
    const supabase = buildListAwareSupabase({
      compatibility_edges: { rows: [roommateEdgeRow] },
      match_notification_prefs: { rows: [] },
    });

    await expect(
      sendRoommateMatchNotification(supabase, { userId: "user-1", edgeId: "edge-1" }),
    ).resolves.toEqual({ sent: false, skipped: "disabled_by_user" });
  });

  it("sends a contact-free preview text to an opted-in recipient", async () => {
    const transport = await import("@/lib/integrations/text-transport");
    const sendTextMessageMock = vi.mocked(transport.sendTextMessage);
    sendTextMessageMock.mockClear();

    const supabase = buildListAwareSupabase({
      compatibility_edges: { rows: [roommateEdgeRow] },
      kinfolk_users: { rows: [{ display_name: "Jack Munhall" }] },
      match_notification_prefs: { rows: [enabledPrefsRow] },
      match_notifications: {
        count: 0,
        rows: [{ id: "notif-1", outbound_message_id: null }],
      },
      text_threads: {
        insertRow: { id: "thread-1", provider_chat_id: "chat-1" },
        rows: [{ id: "thread-1", provider_chat_id: "chat-1" }],
      },
      user_phone_numbers: { rows: [phoneRow] },
    });

    await expect(
      sendRoommateMatchNotification(supabase, {
        edgeId: "edge-1",
        nowUtc: OUTSIDE_QUIET_HOURS,
        userId: "user-1",
      }),
    ).resolves.toEqual({ notificationId: "notif-1", sent: true });

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    const call = sendTextMessageMock.mock.calls[0][0] as {
      parts: Array<{ type: string; value?: string }>;
    };
    const body = call.parts[0]?.value ?? "";
    // First name + fit + dimensions, and NEVER contact details or a last name.
    expect(body).toContain("Jack");
    expect(body).toContain("84% fit");
    expect(body).not.toContain("Munhall");
    expect(body).not.toContain("+1212");
  });

  it("skips inside quiet hours", async () => {
    const supabase = buildListAwareSupabase({
      compatibility_edges: { rows: [roommateEdgeRow] },
      match_notification_prefs: { rows: [enabledPrefsRow] },
      match_notifications: { rows: [] },
      user_phone_numbers: { rows: [phoneRow] },
    });

    await expect(
      sendRoommateMatchNotification(supabase, {
        edgeId: "edge-1",
        // 02:00 UTC = 21:00 EST — inside the default window.
        nowUtc: new Date("2026-01-15T02:00:00.000Z"),
        userId: "user-1",
      }),
    ).resolves.toEqual({ sent: false, skipped: "quiet_hours" });
  });
});

describe("sendGroupReadyNotification", () => {
  const fullGroup = {
    id: "group-1",
    listing_id: "listing-1",
    max_size: 2,
    status: "active",
  };
  const memberships = [{ user_id: "user-1" }, { user_id: "user-2" }];

  it("skips when the group is not at capacity", async () => {
    const supabase = buildListAwareSupabase({
      apartment_roommate_group_memberships: { rows: [{ user_id: "user-1" }] },
      apartment_roommate_groups: { rows: [{ ...fullGroup, max_size: 3 }] },
    });

    await expect(
      sendGroupReadyNotification(supabase, { userId: "user-1", groupId: "group-1" }),
    ).resolves.toEqual({ sent: false, skipped: "group_not_full" });
  });

  it("defaults to OFF without an explicit group-ready opt-in", async () => {
    const supabase = buildListAwareSupabase({
      apartment_roommate_group_memberships: { rows: memberships },
      apartment_roommate_groups: { rows: [fullGroup] },
      match_notification_prefs: { rows: [] },
    });

    await expect(
      sendGroupReadyNotification(supabase, { userId: "user-1", groupId: "group-1" }),
    ).resolves.toEqual({ sent: false, skipped: "disabled_by_user" });
  });

  it("notifies an opted-in member when the group fills", async () => {
    const transport = await import("@/lib/integrations/text-transport");
    const sendTextMessageMock = vi.mocked(transport.sendTextMessage);
    sendTextMessageMock.mockClear();

    const supabase = buildListAwareSupabase({
      apartment_listings: {
        rows: [{ address_line: "681 Florida St", city: "San Francisco", neighborhood: "Mission" }],
      },
      apartment_roommate_group_memberships: { rows: memberships },
      apartment_roommate_groups: { rows: [fullGroup] },
      match_notification_prefs: { rows: [enabledPrefsRow] },
      match_notifications: {
        count: 0,
        rows: [{ id: "notif-2", outbound_message_id: null }],
      },
      text_threads: {
        insertRow: { id: "thread-1", provider_chat_id: "chat-1" },
        rows: [{ id: "thread-1", provider_chat_id: "chat-1" }],
      },
      user_phone_numbers: { rows: [phoneRow] },
    });

    await expect(
      sendGroupReadyNotification(supabase, {
        groupId: "group-1",
        nowUtc: OUTSIDE_QUIET_HOURS,
        userId: "user-1",
      }),
    ).resolves.toEqual({ notificationId: "notif-2", sent: true });

    const call = sendTextMessageMock.mock.calls[0][0] as {
      parts: Array<{ type: string; value?: string }>;
    };
    expect(call.parts[0]?.value).toContain("681 Florida St");
    expect(call.parts[0]?.value).toContain("all 2 spots");
  });
});
