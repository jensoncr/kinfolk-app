import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/apartments/group-actions", () => ({
  respondToApartmentGroupJoinRequest: vi.fn(),
}));

vi.mock("@/lib/integrations/continue-on-phone", () => ({
  normalizeSmsRecipient: (phone: string) => phone,
}));

vi.mock("@/lib/integrations/text-transport", () => ({
  getActiveTextTransportProvider: vi.fn(() => "linq"),
  getTextTransportFromNumber: vi.fn(() => "+15551234567"),
  isTextAgentEnabled: vi.fn(() => true),
  readTextProviderForRow: vi.fn((provider: string) => provider),
  sendTextMessage: vi.fn(),
}));

vi.mock("@/lib/text-agent/rate-limit", () => ({
  hitTextAgentRateLimit: vi.fn(async () => ({
    allowed: true,
    bucket: "group_join_recipient_hour:test",
  })),
}));

import { sendTextMessage } from "@/lib/integrations/text-transport";
import { hitTextAgentRateLimit } from "@/lib/text-agent/rate-limit";
import { sendGroupJoinRequestNotification } from "./group-join-notifications";

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type QueryLog = {
  eqFilters: Array<[string, unknown]>;
  insertPayloads: unknown[];
  neqFilters: Array<[string, unknown]>;
  table: string;
  updatePayloads: unknown[];
};

function makeChain(result: QueryResult, log: QueryLog) {
  let activeResult = result;
  const chain: Record<string, unknown> & PromiseLike<QueryResult> = {
    then: (onfulfilled, onrejected) =>
      Promise.resolve(activeResult).then(onfulfilled, onrejected),
  };

  chain["select"] = vi.fn(() => chain);
  chain["insert"] = vi.fn((payload: unknown) => {
    log.insertPayloads.push(payload);
    activeResult = result;
    return chain;
  });
  chain["update"] = vi.fn((payload: unknown) => {
    log.updatePayloads.push(payload);
    activeResult = result;
    return chain;
  });
  chain["eq"] = vi.fn((column: string, value: unknown) => {
    log.eqFilters.push([column, value]);
    return chain;
  });
  chain["neq"] = vi.fn((column: string, value: unknown) => {
    log.neqFilters.push([column, value]);
    return chain;
  });

  for (const method of ["not", "in", "or", "order", "limit", "gte", "lte"]) {
    chain[method] = vi.fn(() => chain);
  }

  chain["maybeSingle"] = vi.fn(async () => activeResult);
  chain["single"] = vi.fn(async () =>
    activeResult.data
      ? activeResult
      : { data: null, error: activeResult.error ?? { message: "no data" } },
  );

  return chain;
}

function makeSupabase(
  overrides: Record<string, QueryResult | QueryResult[]> = {},
) {
  const logs: QueryLog[] = [];
  const tableResults: Record<string, QueryResult | QueryResult[]> = {
    apartment_listings: {
      data: {
        address_line: "123 Pine St",
        city: "San Francisco",
        neighborhood: "Nob Hill",
      },
      error: null,
    },
    apartment_roommate_group_memberships: {
      data: {
        id: "membership-1",
        requested_at: "2026-06-24T12:00:00.000Z",
        status: "requested",
      },
      error: null,
    },
    apartment_roommate_groups: {
      data: {
        bedrooms: 2,
        created_by_user_id: "owner-1",
        floor_plan_name: "2BR",
        id: "group-1",
        listing_id: "listing-1",
        max_size: 2,
        target_unit_name: "Unit 4",
      },
      error: null,
    },
    compatibility_edges: {
      data: null,
      error: null,
    },
    kinfolk_user_photos: {
      data: null,
      error: null,
    },
    kinfolk_users: {
      data: {
        about_text: "Quiet, tidy, early riser.",
        display_name: "Ada Lovelace",
        education_degree: null,
        education_major: null,
        education_school: null,
        education_year: null,
        hometown: "London",
        id: "requester-1",
        occupation_company: "Analytical Engines",
        occupation_title: "Engineer",
      },
      error: null,
    },
    profile_facts: {
      data: [],
      error: null,
    },
    user_phone_numbers: {
      data: null,
      error: null,
    },
    ...overrides,
  };

  return {
    logs,
    supabase: {
      from: vi.fn((table: string) => {
        const configuredResult = tableResults[table] ?? {
          data: null,
          error: null,
        };
        const result = Array.isArray(configuredResult)
          ? configuredResult.shift() ?? { data: null, error: null }
          : configuredResult;
        const log: QueryLog = {
          eqFilters: [],
          insertPayloads: [],
          neqFilters: [],
          table,
          updatePayloads: [],
        };
        logs.push(log);
        return makeChain(result, log);
      }),
    },
  };
}

describe("sendGroupJoinRequestNotification", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("requires explicit opted-in SMS consent before using a verified recipient phone", async () => {
    const { logs, supabase } = makeSupabase();

    const result = await sendGroupJoinRequestNotification(
      supabase as unknown as Parameters<typeof sendGroupJoinRequestNotification>[0],
      {
        groupId: "group-1",
        membershipId: "membership-1",
        requesterUserId: "requester-1",
      },
    );

    expect(result).toEqual({ sent: false, skipped: "no_verified_phone" });
    const phoneQuery = logs.find((log) => log.table === "user_phone_numbers");
    expect(phoneQuery?.eqFilters).toContainEqual(["user_id", "owner-1"]);
    expect(phoneQuery?.eqFilters).toContainEqual([
      "sms_consent_state",
      "opted_in",
    ]);
    expect(phoneQuery?.neqFilters).not.toContainEqual([
      "sms_consent_state",
      "opted_out",
    ]);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("skips re-paging a creator about the same requester within the cooldown window", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");
    const { logs, supabase } = makeSupabase({
      text_group_join_notifications: {
        // a recent successfully-sent page for this (group, requester, recipient)
        data: { id: "notification-prev" },
        error: null,
      },
      user_phone_numbers: {
        data: {
          id: "phone-1",
          phone_e164: "+15551234567",
          sms_consent_state: "opted_in",
          verified_at: "2026-06-24T12:00:00.000Z",
        },
        error: null,
      },
    });

    const result = await sendGroupJoinRequestNotification(
      supabase as unknown as Parameters<typeof sendGroupJoinRequestNotification>[0],
      {
        groupId: "group-1",
        membershipId: "membership-2",
        requesterUserId: "requester-1",
      },
    );

    expect(result).toEqual({ sent: false, skipped: "recently_notified" });
    // The cooldown query scopes to the stable (group, requester, recipient).
    const cooldownQuery = logs.find(
      (log) =>
        log.table === "text_group_join_notifications" &&
        log.eqFilters.some(([column]) => column === "status"),
    );
    expect(cooldownQuery?.eqFilters).toContainEqual(["status", "sent"]);
    expect(cooldownQuery?.eqFilters).toContainEqual([
      "requester_user_id",
      "requester-1",
    ]);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("skips sending when the recipient's hourly notification budget is exhausted", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");
    vi.mocked(hitTextAgentRateLimit).mockResolvedValueOnce({
      allowed: false,
      bucket: "group_join_recipient_hour:test",
      limit: 6,
      windowLabel: "hour",
    });
    const { supabase } = makeSupabase({
      text_group_join_notifications: { data: null, error: null },
      user_phone_numbers: {
        data: {
          id: "phone-1",
          phone_e164: "+15551234567",
          sms_consent_state: "opted_in",
          verified_at: "2026-06-24T12:00:00.000Z",
        },
        error: null,
      },
    });

    const result = await sendGroupJoinRequestNotification(
      supabase as unknown as Parameters<typeof sendGroupJoinRequestNotification>[0],
      {
        groupId: "group-1",
        membershipId: "membership-1",
        requesterUserId: "requester-1",
      },
    );

    expect(result).toEqual({ sent: false, skipped: "rate_limited" });
    expect(hitTextAgentRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bucketKey: "owner-1",
        bucketType: "group_join_recipient_hour",
        window: "hour",
      }),
    );
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("does not send profile-card media from a local app base URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "http://localhost:3000");
    const { logs, supabase } = makeSupabase({
      user_phone_numbers: {
        data: {
          id: "phone-1",
          phone_e164: "+15551234567",
          sms_consent_state: "opted_in",
          verified_at: "2026-06-24T12:00:00.000Z",
        },
        error: null,
      },
    });

    const result = await sendGroupJoinRequestNotification(
      supabase as unknown as Parameters<typeof sendGroupJoinRequestNotification>[0],
      {
        groupId: "group-1",
        membershipId: "membership-1",
        requesterUserId: "requester-1",
      },
    );

    expect(result).toEqual({ sent: false, skipped: "missing_base_url" });
    expect(
      logs
        .filter((log) => log.table === "text_group_join_notifications")
        .flatMap((log) => log.insertPayloads),
    ).toHaveLength(0);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("skips sending when a racing worker already reserved the group-join notification", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");
    const { logs, supabase } = makeSupabase({
      text_group_join_notifications: [
        // cooldown lookup (no recent send for this pair)
        { data: null, error: null },
        { data: null, error: null },
        {
          data: null,
          error: { code: "23505", message: "duplicate key value" },
        },
      ],
      user_phone_numbers: {
        data: {
          id: "phone-1",
          phone_e164: "+15551234567",
          sms_consent_state: "opted_in",
          verified_at: "2026-06-24T12:00:00.000Z",
        },
        error: null,
      },
    });

    const result = await sendGroupJoinRequestNotification(
      supabase as unknown as Parameters<typeof sendGroupJoinRequestNotification>[0],
      {
        groupId: "group-1",
        membershipId: "membership-1",
        requesterUserId: "requester-1",
      },
    );

    expect(result).toEqual({ sent: false, skipped: "already_reserved" });
    const notificationInsert = logs
      .filter((log) => log.table === "text_group_join_notifications")
      .flatMap((log) => log.insertPayloads)
      .at(0);
    expect(notificationInsert).toMatchObject({
      group_id: "group-1",
      membership_id: "membership-1",
      outbound_idempotency_key:
        "kinfolk:group-join:membership-1:1782302400000",
      recipient_user_id: "owner-1",
      requester_user_id: "requester-1",
      status: "failed",
    });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("normalizes profile-card snapshot and message text before sending", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", " https://kinfolk.example.com/// ");
    vi.stubEnv("KINFOLK_PROFILE_CARD_SECRET", "profile-secret");
    vi.mocked(sendTextMessage).mockResolvedValue({
      chatId: "chat-1",
      deliveryStatus: "queued",
      messageId: "message-1",
      service: "linq",
    });
    const { logs, supabase } = makeSupabase({
      apartment_listings: {
        data: {
          address_line: " 123\n  Pine   St ",
          city: "San Francisco",
          neighborhood: " Nob\n  Hill ",
        },
        error: null,
      },
      kinfolk_user_photos: {
        data: {
          public_url: " https://images.example.com/ada.jpg ",
        },
        error: null,
      },
      kinfolk_users: {
        data: {
          about_text: " Quiet,\n tidy,   early riser. ",
          display_name: " Ada\n  Lovelace ",
          education_degree: null,
          education_major: null,
          education_school: null,
          education_year: null,
          hometown: " London\n UK ",
          id: "requester-1",
          occupation_company: " Analytical\n Engines ",
          occupation_title: " Engineer ",
        },
        error: null,
      },
      text_group_join_notifications: [
        // cooldown lookup (no recent send for this pair)
        { data: null, error: null },
        { data: null, error: null },
        {
          data: {
            id: "notification-1",
            outbound_idempotency_key:
              "kinfolk:group-join:membership-1:1782302400000",
            status: "failed",
          },
          error: null,
        },
        { data: { id: "notification-1" }, error: null },
      ],
      text_messages: {
        data: { id: "message-row-1" },
        error: null,
      },
      text_threads: [
        { data: null, error: null },
        { data: null, error: null },
        {
          data: {
            id: "thread-1",
            provider_chat_id: "chat-1",
            user_id: "owner-1",
          },
          error: null,
        },
      ],
      user_phone_numbers: {
        data: {
          id: "phone-1",
          phone_e164: "+15551234567",
          sms_consent_state: "opted_in",
          verified_at: "2026-06-24T12:00:00.000Z",
        },
        error: null,
      },
    });

    const result = await sendGroupJoinRequestNotification(
      supabase as unknown as Parameters<typeof sendGroupJoinRequestNotification>[0],
      {
        groupId: "group-1",
        membershipId: "membership-1",
        requesterUserId: "requester-1",
      },
    );

    expect(result).toEqual({ notificationId: "notification-1", sent: true });
    const notificationInsert = logs
      .filter((log) => log.table === "text_group_join_notifications")
      .flatMap((log) => log.insertPayloads)
      .at(0) as { card_snapshot?: Record<string, unknown> } | undefined;
    expect(notificationInsert?.card_snapshot).toMatchObject({
      about: "Quiet, tidy, early riser.",
      groupLabel: "2BR - 123 Pine St",
      groupNeighborhood: "Nob Hill",
      headline: "Engineer - Analytical Engines",
      imageUrl: "https://images.example.com/ada.jpg",
      requesterInitials: "AL",
      requesterName: "Ada Lovelace",
    });
    expect(notificationInsert?.card_snapshot?.facts).toContainEqual({
      label: "From",
      value: "London UK",
    });

    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "kinfolk:group-join:membership-1:1782302400000",
        parts: [
          {
            type: "text",
            value:
              "Ada Lovelace wants to join your 2BR - 123 Pine St group.\nTap thumbs up to accept or thumbs down to decline.",
          },
          expect.objectContaining({
            type: "media",
            url: expect.stringMatching(
              /^https:\/\/kinfolk\.example\.com\/api\/profile-card\/notification-1\?/,
            ),
          }),
        ],
        provider: "linq",
        to: "+15551234567",
      }),
    );

    const textMessageInsert = logs
      .filter((log) => log.table === "text_messages")
      .flatMap((log) => log.insertPayloads)
      .at(0) as { body?: string; media?: Array<{ url?: string }> } | undefined;
    expect(textMessageInsert?.body).toBe(
      "Ada Lovelace wants to join your 2BR - 123 Pine St group.\nTap thumbs up to accept or thumbs down to decline.",
    );
    expect(textMessageInsert?.media?.[0]?.url).not.toContain("///api/");
  });
});
