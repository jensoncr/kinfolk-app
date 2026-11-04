import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
  mapWithConcurrency: vi.fn(),
  sendApartmentMatchNotification: vi.fn(),
  sendGroupReadyNotification: vi.fn(),
  sendProfileQuestionNotification: vi.fn(),
  sendRoommateMatchNotification: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/shared/job-auth", () => ({
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}));

vi.mock("@/lib/shared/concurrency", () => ({
  mapWithConcurrency: mocks.mapWithConcurrency,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

vi.mock("@/lib/notifications/match-notifications", () => ({
  sendApartmentMatchNotification: mocks.sendApartmentMatchNotification,
  sendGroupReadyNotification: mocks.sendGroupReadyNotification,
  sendRoommateMatchNotification: mocks.sendRoommateMatchNotification,
}));

vi.mock("@/lib/notifications/profile-question-notifications", () => ({
  sendProfileQuestionNotification: mocks.sendProfileQuestionNotification,
}));

import { GET, POST } from "./route";

type QueryResult = {
  data: Array<Record<string, string>> | null;
  error: { code?: string; message?: string } | Error | null;
};

type QueryLog = {
  eqFilters: Array<[string, unknown]>;
  gtFilters: Array<[string, unknown]>;
  gteFilters: Array<[string, unknown]>;
  inFilters: Array<[string, unknown[]]>;
  limits: number[];
  neqFilters: Array<[string, unknown]>;
  notFilters: Array<[string, string, unknown]>;
  orderBy: Array<[string, { ascending: boolean }]>;
  selects: string[];
  table: string;
};

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/proactivity", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }) as NextRequest;
}

function rawJsonRequest(body: string): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/proactivity", {
    body,
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST",
  }) as NextRequest;
}

function getRequest(): NextRequest {
  return new Request("https://kinfolk.test/api/jobs/proactivity", {
    method: "GET",
  }) as NextRequest;
}

function makeSupabase(results: Record<string, QueryResult[]>) {
  const queues = new Map(
    Object.entries(results).map(([table, tableResults]) => [
      table,
      [...tableResults],
    ]),
  );
  const queries: QueryLog[] = [];
  const supabase = {
    from: vi.fn((table: string) => {
      const log: QueryLog = {
        eqFilters: [],
        gtFilters: [],
        gteFilters: [],
        inFilters: [],
        limits: [],
        neqFilters: [],
        notFilters: [],
        orderBy: [],
        selects: [],
        table,
      };
      const query = {
        eq: vi.fn((column: string, value: unknown) => {
          log.eqFilters.push([column, value]);
          return query;
        }),
        gt: vi.fn((column: string, value: unknown) => {
          log.gtFilters.push([column, value]);
          return query;
        }),
        gte: vi.fn((column: string, value: unknown) => {
          log.gteFilters.push([column, value]);
          return query;
        }),
        in: vi.fn((column: string, values: unknown[]) => {
          log.inFilters.push([column, values]);
          return query;
        }),
        limit: vi.fn(async (limit: number) => {
          log.limits.push(limit);
          return queues.get(table)?.shift() ?? { data: [], error: null };
        }),
        neq: vi.fn((column: string, value: unknown) => {
          log.neqFilters.push([column, value]);
          return query;
        }),
        not: vi.fn((column: string, operator: string, value: unknown) => {
          log.notFilters.push([column, operator, value]);
          return query;
        }),
        order: vi.fn((column: string, options: { ascending: boolean }) => {
          log.orderBy.push([column, options]);
          return query;
        }),
        select: vi.fn((columns: string) => {
          log.selects.push(columns);
          return query;
        }),
      };

      queries.push(log);
      return query;
    }),
  };

  return { queries, supabase };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/jobs/proactivity", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn> | null;

  beforeEach(() => {
    dateNowSpy = null;
    vi.clearAllMocks();
    mocks.isAuthorizedJobRequest.mockReturnValue(true);
    mocks.mapWithConcurrency.mockImplementation(
      async (
        items: unknown[],
        _concurrency: number,
        worker: (item: unknown) => Promise<unknown>,
      ) => Promise.all(items.map((item) => worker(item))),
    );
    mocks.sendApartmentMatchNotification.mockResolvedValue({ sent: true });
    mocks.sendProfileQuestionNotification.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    dateNowSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it("rejects unauthorized GET requests before reading Supabase", async () => {
    mocks.isAuthorizedJobRequest.mockReturnValueOnce(false);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.sendApartmentMatchNotification).not.toHaveBeenCalled();
  });

  it("scans eligible apartment matches since the requested cursor and aggregates send outcomes", async () => {
    const { queries, supabase } = makeSupabase({
      apartment_listing_matches: [
        {
          data: [
            {
              created_at: "2026-06-21T18:03:00.000Z",
              id: "match-late",
              user_id: "user-1",
            },
            {
              created_at: "2026-06-21T18:01:00.000Z",
              id: "match-early",
              user_id: "user-1",
            },
          ],
          error: null,
        },
      ],
      match_notification_prefs: [
        {
          data: [{ user_id: "user-1" }, { user_id: "user-2" }],
          error: null,
        },
      ],
      user_phone_numbers: [
        {
          data: [{ user_id: "user-1" }, { user_id: "user-3" }],
          error: null,
        },
      ],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    mocks.sendApartmentMatchNotification
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: false, skipped: "quiet_hours" });

    const response = await POST(
      jsonRequest({ since: "2026-06-21T18:00:00.000Z" }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      apartmentMatches: {
        eligibleUsers: 1,
        scanned: 2,
        sent: 1,
        skipped: { quiet_hours: 1 },
      },
      groupReady: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });
    expect(mocks.mapWithConcurrency).toHaveBeenCalledWith(
      [["user-1"]],
      6,
      expect.any(Function),
    );
    const candidateQuery = queries.find(
      (query) => query.table === "apartment_listing_matches",
    );
    const phoneQuery = queries.find((query) => query.table === "user_phone_numbers");
    expect(phoneQuery?.eqFilters).toContainEqual([
      "sms_consent_state",
      "opted_in",
    ]);
    expect(phoneQuery?.neqFilters).not.toContainEqual([
      "sms_consent_state",
      "opted_out",
    ]);
    expect(candidateQuery?.gteFilters).toContainEqual([
      "created_at",
      "2026-06-21T18:00:00.000Z",
    ]);
    expect(candidateQuery?.inFilters).toContainEqual(["user_id", ["user-1"]]);
    expect(mocks.sendApartmentMatchNotification).toHaveBeenNthCalledWith(
      1,
      supabase,
      { listingMatchId: "match-early", userId: "user-1" },
    );
    expect(mocks.sendApartmentMatchNotification).toHaveBeenNthCalledWith(
      2,
      supabase,
      { listingMatchId: "match-late", userId: "user-1" },
    );
  });

  it("continues sending later matches after one candidate sender fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { supabase } = makeSupabase({
      apartment_listing_matches: [
        {
          data: [
            {
              created_at: "2026-06-21T18:01:00.000Z",
              id: "match-early",
              user_id: "user-1",
            },
            {
              created_at: "2026-06-21T18:02:00.000Z",
              id: "match-late",
              user_id: "user-1",
            },
          ],
          error: null,
        },
      ],
      match_notification_prefs: [{ data: [{ user_id: "user-1" }], error: null }],
      user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    const carrierError = new Error("carrier timeout");
    mocks.sendApartmentMatchNotification
      .mockRejectedValueOnce(carrierError)
      .mockResolvedValueOnce({ sent: true });

    const response = await POST(
      jsonRequest({ since: "2026-06-21T18:00:00.000Z" }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      apartmentMatches: {
        eligibleUsers: 1,
        scanned: 2,
        sent: 1,
        skipped: { error: 1 },
      },
      groupReady: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });
    expect(mocks.sendApartmentMatchNotification).toHaveBeenNthCalledWith(
      1,
      supabase,
      { listingMatchId: "match-early", userId: "user-1" },
    );
    expect(mocks.sendApartmentMatchNotification).toHaveBeenNthCalledWith(
      2,
      supabase,
      { listingMatchId: "match-late", userId: "user-1" },
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[proactivity] apartment match send failed",
      { listingMatchId: "match-early", userId: "user-1" },
      carrierError,
    );
    consoleError.mockRestore();
  });

  it("scans only explicitly opted-in profile-question users", async () => {
    const { queries, supabase } = makeSupabase({
      match_notification_prefs: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [{ user_id: "user-1" }], error: null },
      ],
      user_phone_numbers: [
        { data: [{ user_id: "user-1" }], error: null },
      ],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await POST(
      jsonRequest({ since: "2026-06-21T18:00:00.000Z" }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      profileQuestions: {
        eligibleUsers: 1,
        scanned: 1,
        sent: 1,
        skipped: {},
      },
    });
    expect(mocks.sendProfileQuestionNotification).toHaveBeenCalledWith(
      supabase,
      { userId: "user-1" },
    );
    const profilePrefsQuery = queries.filter(
      (query) => query.table === "match_notification_prefs",
    )[2];
    expect(profilePrefsQuery.eqFilters).toContainEqual([
      "profile_questions_enabled",
      true,
    ]);
  });

  it("rejects malformed JSON before scanning apartment matches", async () => {
    const response = await POST(rawJsonRequest("{oops"));

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mocks.createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(mocks.mapWithConcurrency).not.toHaveBeenCalled();
    expect(mocks.sendApartmentMatchNotification).not.toHaveBeenCalled();
  });

  it("dry-runs eligible apartment match scans without calling the sender", async () => {
    const { queries, supabase } = makeSupabase({
      apartment_listing_matches: [
        {
          data: [
            {
              created_at: "2026-06-21T18:01:00.000Z",
              id: "match-1",
              user_id: "user-1",
            },
          ],
          error: null,
        },
      ],
      match_notification_prefs: [{ data: [{ user_id: "user-1" }], error: null }],
      user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await POST(
      jsonRequest({
        dryRun: "true",
        since: "2026-06-21T18:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      apartmentMatches: {
        dryRun: true,
        eligibleUsers: 1,
        scanned: 1,
        sent: 0,
        skipped: {},
      },
      groupReady: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });
    const candidateQuery = queries.find(
      (query) => query.table === "apartment_listing_matches",
    );
    expect(candidateQuery?.gteFilters).toContainEqual([
      "created_at",
      "2026-06-21T18:00:00.000Z",
    ]);
    expect(mocks.sendApartmentMatchNotification).not.toHaveBeenCalled();
  });

  it("parses numeric and numeric-string dry-run options before choosing send mode", async () => {
    const { supabase: dryRunSupabase } = makeSupabase({
      apartment_listing_matches: [
        {
          data: [
            {
              created_at: "2026-06-21T18:01:00.000Z",
              id: "match-1",
              user_id: "user-1",
            },
          ],
          error: null,
        },
      ],
      match_notification_prefs: [{ data: [{ user_id: "user-1" }], error: null }],
      user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(dryRunSupabase);

    const dryRunResponse = await POST(
      jsonRequest({
        dryRun: 1,
        since: "2026-06-21T18:00:00.000Z",
      }),
    );

    expect(dryRunResponse.status).toBe(200);
    await expect(readJson(dryRunResponse)).resolves.toEqual({
      apartmentMatches: {
        dryRun: true,
        eligibleUsers: 1,
        scanned: 1,
        sent: 0,
        skipped: {},
      },
      groupReady: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });
    expect(mocks.sendApartmentMatchNotification).not.toHaveBeenCalled();

    mocks.sendApartmentMatchNotification.mockClear();
    const { supabase: mutatingSupabase } = makeSupabase({
      apartment_listing_matches: [
        {
          data: [
            {
              created_at: "2026-06-21T18:01:00.000Z",
              id: "match-1",
              user_id: "user-1",
            },
          ],
          error: null,
        },
      ],
      match_notification_prefs: [{ data: [{ user_id: "user-1" }], error: null }],
      user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(mutatingSupabase);

    const mutatingResponse = await POST(
      jsonRequest({
        dryRun: "0",
        since: "2026-06-21T18:00:00.000Z",
      }),
    );

    expect(mutatingResponse.status).toBe(200);
    await expect(readJson(mutatingResponse)).resolves.toEqual({
      apartmentMatches: {
        eligibleUsers: 1,
        scanned: 1,
        sent: 1,
        skipped: {},
      },
      groupReady: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });
    expect(mocks.sendApartmentMatchNotification).toHaveBeenCalledWith(
      mutatingSupabase,
      { listingMatchId: "match-1", userId: "user-1" },
    );
  });

  it("paginates large eligible cohorts and chunks candidate scans during dry-runs", async () => {
    const userIds = Array.from(
      { length: 1001 },
      (_, index) => `user-${String(index).padStart(4, "0")}`,
    );
    const firstPage = userIds
      .slice(0, 1000)
      .map((user_id) => ({ user_id }));
    const secondPage = userIds
      .slice(1000)
      .map((user_id) => ({ user_id }));
    const { queries, supabase } = makeSupabase({
      apartment_listing_matches: Array.from({ length: 6 }, () => ({
        data: [],
        error: null,
      })),
      match_notification_prefs: [
        { data: firstPage, error: null },
        { data: secondPage, error: null },
      ],
      user_phone_numbers: [
        { data: firstPage, error: null },
        { data: secondPage, error: null },
      ],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await POST(
      jsonRequest({
        dryRun: true,
        since: "2026-06-21T18:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      apartmentMatches: {
        dryRun: true,
        eligibleUsers: 1001,
        scanned: 0,
        sent: 0,
        skipped: {},
      },
      groupReady: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { dryRun: true, eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });

    const prefQueries = queries.filter(
      (query) => query.table === "match_notification_prefs",
    );
    const phoneQueries = queries.filter(
      (query) => query.table === "user_phone_numbers",
    );
    // Prefs: two pages for the apartment cohort + one each for the roommate
    // and profile-question flags. Phones: two pages, once per run; later scans
    // reuse the memoized verified-phone cohort.
    expect(prefQueries).toHaveLength(4);
    expect(phoneQueries).toHaveLength(2);
    expect(prefQueries[1].gtFilters).toContainEqual(["user_id", "user-0999"]);
    expect(phoneQueries[1].gtFilters).toContainEqual(["user_id", "user-0999"]);

    const [chunks, concurrency] = mocks.mapWithConcurrency.mock
      .calls[0] as [string[][], number];
    expect(concurrency).toBe(6);
    expect(chunks).toHaveLength(6);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      200,
      200,
      200,
      200,
      200,
      1,
    ]);

    const candidateQueries = queries.filter(
      (query) => query.table === "apartment_listing_matches",
    );
    expect(candidateQueries).toHaveLength(6);
    expect(
      candidateQueries.map(
        (query) =>
          query.inFilters.find(([column]) => column === "user_id")?.[1].length,
      ),
    ).toEqual([200, 200, 200, 200, 200, 1]);
    expect(mocks.sendApartmentMatchNotification).not.toHaveBeenCalled();
  });

  it("uses the default cursor for null, array, primitive, blank, and invalid since bodies", async () => {
    dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-06-21T18:15:00.000Z").getTime());

    for (const body of [
      null,
      [],
      "oops",
      42,
      false,
      { since: "" },
      { since: "   " },
      { since: "not-a-date" },
      { since: "2026-06-21T18:16:00.000Z" },
      { since: 123 },
    ]) {
      vi.clearAllMocks();
      mocks.isAuthorizedJobRequest.mockReturnValue(true);
      mocks.mapWithConcurrency.mockImplementation(
        async (
          items: unknown[],
          _concurrency: number,
          worker: (item: unknown) => Promise<unknown>,
        ) => Promise.all(items.map((item) => worker(item))),
      );
      mocks.sendApartmentMatchNotification.mockResolvedValue({ sent: true });
      const { queries, supabase } = makeSupabase({
        apartment_listing_matches: [{ data: [], error: null }],
        match_notification_prefs: [
          { data: [{ user_id: "user-1" }], error: null },
        ],
        user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
      });
      mocks.createSupabaseServiceClient.mockReturnValue(supabase);

      const response = await POST(jsonRequest(body));

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        apartmentMatches: { eligibleUsers: 1, scanned: 0, sent: 0, skipped: {} },
        ok: true,
      });
      const candidateQuery = queries.find(
        (query) => query.table === "apartment_listing_matches",
      );
      // Default window is 48h back from the mocked now (deferral-safe cursor).
      expect(candidateQuery?.gteFilters).toContainEqual([
        "created_at",
        "2026-06-19T18:15:00.000Z",
      ]);
    }
  });

  it("skips scans without sending when notification tables are not migrated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = makeSupabase({
      match_notification_prefs: [
        {
          data: null,
          error: { code: "PGRST205" },
        },
      ],
      user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      apartmentMatches: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      groupReady: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });
    expect(mocks.mapWithConcurrency).not.toHaveBeenCalled();
    expect(mocks.sendApartmentMatchNotification).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[proactivity] match notification tables are not available; skipping apartment match scan.",
    );
  });

  it("skips the scan when the notification send path finds an unmigrated notifications table", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = makeSupabase({
      apartment_listing_matches: [
        {
          data: [
            {
              created_at: "2026-06-21T18:01:00.000Z",
              id: "match-1",
              user_id: "user-1",
            },
            {
              created_at: "2026-06-21T18:02:00.000Z",
              id: "match-2",
              user_id: "user-1",
            },
          ],
          error: null,
        },
      ],
      match_notification_prefs: [{ data: [{ user_id: "user-1" }], error: null }],
      user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    mocks.sendApartmentMatchNotification.mockRejectedValueOnce({
      code: "PGRST205",
    });

    const response = await POST(
      jsonRequest({ since: "2026-06-21T18:00:00.000Z" }),
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      apartmentMatches: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      groupReady: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      profileQuestions: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      roommateMatches: { eligibleUsers: 0, scanned: 0, sent: 0, skipped: {} },
      ok: true,
    });
    expect(mocks.sendApartmentMatchNotification).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[proactivity] match notification tables are not available; skipping apartment match scan.",
    );
  });

  it("returns redacted JSON when candidate scanning fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("candidate query failed: service-role-token");
    const { supabase } = makeSupabase({
      apartment_listing_matches: [
        {
          data: null,
          error,
        },
      ],
      match_notification_prefs: [{ data: [{ user_id: "user-1" }], error: null }],
      user_phone_numbers: [{ data: [{ user_id: "user-1" }], error: null }],
    });
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    const response = await POST(
      jsonRequest({ since: "2026-06-21T18:00:00.000Z" }),
    );

    expect(response.status).toBe(500);
    const body = await readJson(response);
    expect(body).toEqual({
      error: "Proactivity job failed.",
      ok: false,
    });
    expect(JSON.stringify(body)).not.toContain("service-role-token");
    expect(mocks.sendApartmentMatchNotification).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[proactivity] job scan failed",
      error,
    );
    consoleError.mockRestore();
  });
});
