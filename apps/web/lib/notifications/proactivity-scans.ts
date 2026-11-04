import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendApartmentMatchNotification,
  sendGroupReadyNotification,
  sendRoommateMatchNotification,
} from "@/lib/notifications/match-notifications";
import { sendProfileQuestionNotification } from "@/lib/notifications/profile-question-notifications";
import { VISIBLE_APARTMENT_MATCH_STATUSES } from "@/lib/matching/match-status";
import { mapWithConcurrency } from "@/lib/shared/concurrency";
import type { Database } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Proactivity scans
//
// Each scan finds candidates changed since the cursor and hands them to its
// notification sender. Every consent, cap, quiet-hour, and idempotency rule is
// enforced inside the senders (lib/notifications/match-notifications), so
// re-running any scan is always safe.
// ---------------------------------------------------------------------------

export type ProactivityScanResult = {
  dryRun?: boolean;
  eligibleUsers: number;
  scanned: number;
  sent: number;
  skipped: Record<string, number>;
};

type ScanOptions = { dryRun?: boolean; since: Date };

function emptyScanResult(dryRun: boolean): ProactivityScanResult {
  return {
    ...(dryRun ? { dryRun: true } : {}),
    eligibleUsers: 0,
    scanned: 0,
    sent: 0,
    skipped: {},
  };
}

function isMissingNotificationSchemaError(error: unknown) {
  // PGRST205 = relation not found in the schema cache (table not migrated).
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return error.code === "PGRST205";
}

// PostgREST serializes `.in("user_id", [...])` into the request URL, which has a
// practical length limit, so we chunk the eligible cohort into bounded batches.
const ELIGIBLE_USER_CHUNK_SIZE = 200;

// Cap how many chunk queries run at once so a large cohort can't open a query
// per chunk simultaneously and exhaust the connection pool.
const CANDIDATE_QUERY_CONCURRENCY = 6;

// PostgREST caps unbounded selects at max_rows (1000), so page the eligibility
// reads by user_id keyset — a cohort larger than one page must not be cut.
const USER_ID_PAGE_SIZE = 1000;

// The verified-phone half of the eligibility cohort is identical for every
// scan in one cron run (a full keyset page-through of user_phone_numbers);
// memoized per client instance — the route creates one client per request,
// so this can't leak staleness across runs.
const verifiedPhoneCohortByClient = new WeakMap<
  SupabaseServiceClient,
  Promise<string[] | "missing-schema">
>();

function loadVerifiedPhoneCohort(
  supabase: SupabaseServiceClient,
): Promise<string[] | "missing-schema"> {
  const cached = verifiedPhoneCohortByClient.get(supabase);
  if (cached) {
    return cached;
  }
  const promise = collectAllUserIds((after) => {
    const base = supabase
      .from("user_phone_numbers")
      .select("user_id")
      .not("verified_at", "is", null)
      .eq("sms_consent_state", "opted_in");
    return (after === null ? base : base.gt("user_id", after))
      .order("user_id", { ascending: true })
      .limit(USER_ID_PAGE_SIZE);
  });
  verifiedPhoneCohortByClient.set(supabase, promise);
  return promise;
}

/**
 * Users who both opted into the given notification kind and have a verified,
 * explicitly opted-in phone — the shared eligibility gate of every scan.
 */
async function loadEligibleNotificationCohort(
  supabase: SupabaseServiceClient,
  prefsFlagColumn:
    | "apartment_matches_enabled"
    | "profile_questions_enabled"
    | "roommate_matches_enabled",
): Promise<string[] | "missing-schema"> {
  const [optedIn, verifiedPhone] = await Promise.all([
    collectAllUserIds((after) => {
      const base = supabase
        .from("match_notification_prefs")
        .select("user_id")
        .eq(prefsFlagColumn, true);
      return (after === null ? base : base.gt("user_id", after))
        .order("user_id", { ascending: true })
        .limit(USER_ID_PAGE_SIZE);
    }),
    loadVerifiedPhoneCohort(supabase),
  ]);
  if (optedIn === "missing-schema" || verifiedPhone === "missing-schema") {
    return "missing-schema";
  }

  const optedInUserIds = new Set(optedIn);
  return Array.from(new Set(verifiedPhone)).filter((userId) =>
    optedInUserIds.has(userId),
  );
}

/**
 * Slowly fill one safe matching gap for explicitly opted-in users. The sender
 * owns pending-state, seven-day cadence, and idempotency checks, so this scan
 * can safely revisit the full eligible cohort on every cron run.
 */
export async function scanProfileQuestions(
  supabase: SupabaseServiceClient,
  { dryRun = false }: ScanOptions,
): Promise<ProactivityScanResult> {
  const eligibleUserIds = await loadEligibleNotificationCohort(
    supabase,
    "profile_questions_enabled",
  );
  if (eligibleUserIds === "missing-schema") {
    warnMissingSchema("profile question scan");
    return emptyScanResult(dryRun);
  }

  const result: ProactivityScanResult = {
    ...emptyScanResult(dryRun),
    eligibleUsers: eligibleUserIds.length,
    scanned: eligibleUserIds.length,
  };
  if (dryRun || eligibleUserIds.length === 0) {
    return result;
  }

  const loop = await runNotificationSendLoop(result, eligibleUserIds, {
    logContext: (userId) => ({ userId }),
    logLabel: "[proactivity] profile question send failed",
    send: (userId) => sendProfileQuestionNotification(supabase, { userId }),
  });
  if (loop === "missing-schema") {
    warnMissingSchema("profile question scan");
    return emptyScanResult(dryRun);
  }
  return result;
}

/**
 * Shared send loop: one sender call per candidate, aggregating sent/skipped
 * counts. A sender failure never stops later candidates; an unmigrated
 * notification schema aborts the whole scan.
 */
async function runNotificationSendLoop<Candidate>(
  result: ProactivityScanResult,
  candidates: Candidate[],
  {
    logLabel,
    logContext,
    send,
  }: {
    logLabel: string;
    logContext: (candidate: Candidate) => Record<string, string>;
    send: (candidate: Candidate) => Promise<{ sent: boolean; skipped?: string }>;
  },
): Promise<"complete" | "missing-schema"> {
  for (const candidate of candidates) {
    try {
      const outcome = await send(candidate);
      if (outcome.sent) {
        result.sent += 1;
      } else {
        const reason = outcome.skipped ?? "unknown";
        result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
      }
    } catch (err) {
      if (isMissingNotificationSchemaError(err)) {
        return "missing-schema";
      }
      console.error(logLabel, logContext(candidate), err);
      result.skipped["error"] = (result.skipped["error"] ?? 0) + 1;
    }
  }
  return "complete";
}

function warnMissingSchema(scanLabel: string) {
  console.warn(
    `[proactivity] match notification tables are not available; skipping ${scanLabel}.`,
  );
}

/**
 * Scan for new apartment matches whose owners have opted into notifications,
 * have a verified phone, and have not already been notified for this match.
 */
export async function scanApartmentMatches(
  supabase: SupabaseServiceClient,
  { dryRun = false, since }: ScanOptions,
): Promise<ProactivityScanResult> {
  const eligibleUserIds = await loadEligibleNotificationCohort(
    supabase,
    "apartment_matches_enabled",
  );
  if (eligibleUserIds === "missing-schema") {
    warnMissingSchema("apartment match scan");
    return emptyScanResult(dryRun);
  }
  if (eligibleUserIds.length === 0) {
    return emptyScanResult(dryRun);
  }

  // We only need the ids for the send loop; sendApartmentMatchNotification
  // re-fetches for safety.
  const candidates = await fetchApartmentMatchCandidates(supabase, {
    eligibleUserIds,
    since,
  });
  const result: ProactivityScanResult = {
    ...emptyScanResult(dryRun),
    eligibleUsers: eligibleUserIds.length,
    scanned: candidates.length,
  };
  if (dryRun) {
    return result;
  }

  const loop = await runNotificationSendLoop(result, candidates, {
    logContext: (candidate) => ({
      listingMatchId: candidate.id,
      userId: candidate.user_id,
    }),
    logLabel: "[proactivity] apartment match send failed",
    send: (candidate) =>
      sendApartmentMatchNotification(supabase, {
        listingMatchId: candidate.id,
        userId: candidate.user_id,
      }),
  });
  if (loop === "missing-schema") {
    warnMissingSchema("apartment match scan");
    return emptyScanResult(dryRun);
  }
  return result;
}

/**
 * Scan compatibility_edges recomputed since the cursor for high-fit roommate
 * matches whose recipients opted into roommate notifications. Both users on an
 * eligible edge are candidate recipients.
 */
export async function scanRoommateMatches(
  supabase: SupabaseServiceClient,
  { dryRun = false, since }: ScanOptions,
): Promise<ProactivityScanResult> {
  const cohort = await loadEligibleNotificationCohort(
    supabase,
    "roommate_matches_enabled",
  );
  if (cohort === "missing-schema") {
    warnMissingSchema("roommate match scan");
    return emptyScanResult(dryRun);
  }
  const eligibleUserIds = new Set(cohort);
  if (eligibleUserIds.size === 0) {
    return emptyScanResult(dryRun);
  }

  const edgesResult = await supabase
    .from("compatibility_edges")
    .select("id,user_a_id,user_b_id,score,computed_at")
    .eq("status", "active")
    .gte("computed_at", since.toISOString())
    .gte("score", 80)
    .order("computed_at", { ascending: true })
    .limit(200);
  if (edgesResult.error) throw edgesResult.error;

  const candidates = (edgesResult.data ?? []).flatMap((edge) =>
    [edge.user_a_id, edge.user_b_id]
      .filter((userId) => eligibleUserIds.has(userId))
      .map((userId) => ({ edgeId: edge.id, userId })),
  );

  const result: ProactivityScanResult = {
    ...emptyScanResult(dryRun),
    eligibleUsers: eligibleUserIds.size,
    scanned: candidates.length,
  };
  if (dryRun) {
    return result;
  }

  const loop = await runNotificationSendLoop(result, candidates, {
    logContext: (candidate) => ({
      edgeId: candidate.edgeId,
      userId: candidate.userId,
    }),
    logLabel: "[proactivity] roommate match send failed",
    send: (candidate) =>
      sendRoommateMatchNotification(supabase, {
        edgeId: candidate.edgeId,
        userId: candidate.userId,
      }),
  });
  if (loop === "missing-schema") {
    warnMissingSchema("roommate match scan");
    return emptyScanResult(dryRun);
  }
  return result;
}

/**
 * Scan groups whose membership changed since the cursor and are now at
 * capacity; notify every member who opted into group-ready notifications.
 */
export async function scanGroupReady(
  supabase: SupabaseServiceClient,
  { dryRun = false, since }: ScanOptions,
): Promise<ProactivityScanResult> {
  const recentMemberships = await supabase
    .from("apartment_roommate_group_memberships")
    .select("group_id")
    .eq("status", "member")
    .gte("updated_at", since.toISOString())
    .limit(500);
  if (recentMemberships.error) {
    if (isMissingNotificationSchemaError(recentMemberships.error)) {
      return emptyScanResult(dryRun);
    }
    throw recentMemberships.error;
  }

  const groupIds = Array.from(
    new Set((recentMemberships.data ?? []).map((row) => row.group_id)),
  );
  if (groupIds.length === 0) {
    return emptyScanResult(dryRun);
  }

  const [groupsResult, membersResult] = await Promise.all([
    supabase
      .from("apartment_roommate_groups")
      .select("id,max_size,status")
      .in("id", groupIds),
    supabase
      .from("apartment_roommate_group_memberships")
      .select("group_id,user_id")
      .in("group_id", groupIds)
      .eq("status", "member"),
  ]);
  if (groupsResult.error) throw groupsResult.error;
  if (membersResult.error) throw membersResult.error;

  const membersByGroup = new Map<string, string[]>();
  for (const row of membersResult.data ?? []) {
    const list = membersByGroup.get(row.group_id) ?? [];
    list.push(row.user_id);
    membersByGroup.set(row.group_id, list);
  }

  const candidates = (groupsResult.data ?? []).flatMap((group) => {
    const members = membersByGroup.get(group.id) ?? [];
    return members.length >= group.max_size
      ? members.map((userId) => ({ groupId: group.id, userId }))
      : [];
  });

  const result: ProactivityScanResult = {
    ...emptyScanResult(dryRun),
    eligibleUsers: new Set(candidates.map((candidate) => candidate.userId)).size,
    scanned: candidates.length,
  };
  if (dryRun) {
    return result;
  }

  const loop = await runNotificationSendLoop(result, candidates, {
    logContext: (candidate) => ({
      groupId: candidate.groupId,
      userId: candidate.userId,
    }),
    logLabel: "[proactivity] group ready send failed",
    send: (candidate) =>
      sendGroupReadyNotification(supabase, {
        groupId: candidate.groupId,
        userId: candidate.userId,
      }),
  });
  if (loop === "missing-schema") {
    return emptyScanResult(dryRun);
  }
  return result;
}

async function fetchApartmentMatchCandidates(
  supabase: SupabaseServiceClient,
  { eligibleUserIds, since }: { eligibleUserIds: string[]; since: Date },
): Promise<Array<{ id: string; user_id: string; created_at: string }>> {
  const chunks: string[][] = [];
  for (let i = 0; i < eligibleUserIds.length; i += ELIGIBLE_USER_CHUNK_SIZE) {
    chunks.push(eligibleUserIds.slice(i, i + ELIGIBLE_USER_CHUNK_SIZE));
  }

  // Bound the fan-out: a large cohort produces many chunks, and an unbounded
  // Promise.all would open one PostgREST connection per chunk at once.
  const results = await mapWithConcurrency(
    chunks,
    CANDIDATE_QUERY_CONCURRENCY,
    async (chunk) =>
      supabase
        .from("apartment_listing_matches")
        .select("id,user_id,created_at")
        .in("status", VISIBLE_APARTMENT_MATCH_STATUSES)
        .gte("created_at", since.toISOString())
        .in("user_id", chunk)
        .order("created_at", { ascending: true })
        .limit(100),
  );

  const rows: Array<{ id: string; user_id: string; created_at: string }> = [];
  for (const result of results) {
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
  }

  // Globally order by recency and cap, so chunking can never surface more than
  // the single-query limit would have.
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rows.slice(0, 100);
}

// Collects the full set of user_ids matching a query, paging past PostgREST's
// max_rows cap. Keyset-paginates by user_id (gt cursor), which captures every
// distinct user even when a table has multiple rows per user (e.g. phones).
async function collectAllUserIds(
  fetchPage: (
    afterUserId: string | null,
  ) => PromiseLike<{ data: Array<{ user_id: string }> | null; error: { code?: string } | null }>,
): Promise<string[] | "missing-schema"> {
  const userIds: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { data, error } = await fetchPage(cursor);
    if (error) {
      if (isMissingNotificationSchemaError(error)) return "missing-schema";
      throw error;
    }
    const rows = data ?? [];
    for (const row of rows) {
      userIds.push(row.user_id);
    }
    if (rows.length < USER_ID_PAGE_SIZE) break;
    cursor = rows[rows.length - 1].user_id;
  }
  return userIds;
}
