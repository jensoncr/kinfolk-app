import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEmbeddedListingCardUrl,
  type ListingCardSnapshot,
} from "@/lib/apartments/listing-card";
import type { TextOutboundPart } from "@/lib/integrations/text-transport-types";
import { VISIBLE_APARTMENT_MATCH_STATUSES } from "@/lib/matching/match-status";
import {
  buildRoommateMatchPreview,
  DEFAULT_ROOMMATE_NOTIFICATION_CONFIG,
} from "@/lib/matching/roommate-match-notification";
import {
  countSentNotificationsSince,
  deliverMatchNotificationText,
  getKinfolkListingUrl,
  getKinfolkMatchesUrl,
  MATCH_NOTIFICATION_TEXT_LIMITS,
  normalizeMatchNotificationText,
  normalizeRequiredMatchNotificationId,
  runMatchNotificationGates,
  type MatchNotificationSendResult,
} from "@/lib/notifications/delivery";
import type { Database, Json } from "@/lib/supabase/types";
import { getKinfolkPublicMediaBaseUrl } from "@/lib/text-agent/store-shared";

type SupabaseServiceClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// The three match-notification kinds. Each sender owns only its subject
// loading, idempotency key, and message body; the whole consent chain (prefs
// opt-in, phone, transport, idempotency + repair, quiet hours, daily cap) and
// the delivery tail live in ./delivery and are identical across kinds.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Apartment match (kind 'apartment_match')
// ---------------------------------------------------------------------------

/**
 * Deterministic idempotency key for an apartment-match notification.
 * Two scans of the same listingMatchId for the same recipient produce the same
 * key, so the second send is deduplicated by the unique constraint.
 */
export function buildApartmentMatchIdempotencyKey({
  recipientUserId,
  listingMatchId,
}: {
  recipientUserId: string;
  listingMatchId: string;
}): string {
  return `kinfolk:apt-match:${recipientUserId}:${listingMatchId}`;
}

export async function sendApartmentMatchNotification(
  supabase: SupabaseServiceClient,
  {
    userId,
    listingMatchId,
    nowUtc,
  }: { userId: string; listingMatchId: string; nowUtc?: Date },
): Promise<MatchNotificationSendResult> {
  const normalizedUserId = normalizeRequiredMatchNotificationId(userId);
  const normalizedListingMatchId =
    normalizeRequiredMatchNotificationId(listingMatchId);
  if (!normalizedUserId || !normalizedListingMatchId) {
    return { sent: false, skipped: "invalid_match_notification_target" };
  }

  const matchResult = await supabase
    .from("apartment_listing_matches")
    .select(
      "id,user_id,listing_id,status,fit_score,per_person_rent,effective_per_person_rent,recommended_household_size,created_at",
    )
    .eq("id", normalizedListingMatchId)
    .eq("user_id", normalizedUserId)
    .maybeSingle();
  if (matchResult.error) throw matchResult.error;
  if (!matchResult.data) {
    return { sent: false, skipped: "match_not_found" };
  }

  const match = matchResult.data;
  const visibleStatuses: readonly string[] = VISIBLE_APARTMENT_MATCH_STATUSES;
  if (!visibleStatuses.includes(match.status)) {
    return { sent: false, skipped: "match_not_visible" };
  }

  const idempotencyKey = buildApartmentMatchIdempotencyKey({
    recipientUserId: normalizedUserId,
    listingMatchId: normalizedListingMatchId,
  });
  const gates = await runMatchNotificationGates(supabase, {
    idempotencyKey,
    kind: "apartment_match",
    nowUtc,
    prefsEnabled: (prefs) => prefs.apartment_matches_enabled,
    userId: normalizedUserId,
  });
  if ("skipped" in gates) {
    return { sent: false, skipped: gates.skipped };
  }

  // Build the message body from listing data.
  const listingResult = await supabase
    .from("apartment_listings")
    .select(
      "id,address_line,neighborhood,city,monthly_rent,effective_monthly_rent,bedrooms,bathrooms,source_url",
    )
    .eq("id", match.listing_id)
    .maybeSingle();
  if (listingResult.error) throw listingResult.error;

  const listing = listingResult.data;
  const address = normalizeMatchNotificationText(
    listing?.address_line,
    "a new listing",
    MATCH_NOTIFICATION_TEXT_LIMITS.address,
  );
  const neighborhood = normalizeMatchNotificationText(
    listing?.neighborhood ?? listing?.city,
    "your area",
    MATCH_NOTIFICATION_TEXT_LIMITS.neighborhood,
  );
  const rentStr =
    formatMatchNotificationPerPersonRent(match.effective_per_person_rent) ||
    formatMatchNotificationPerPersonRent(match.per_person_rent);
  const body = [
    `New match: ${address} — ${neighborhood}${rentStr ? `, ${rentStr}` : ""}.`,
    `See it here: ${getKinfolkListingUrl(listing?.id)}`,
  ].join(" ");

  // Attach the listing card so the notification carries the apartment photo,
  // not just a link. Best-effort: a missing public media base URL or any
  // card-build failure must never block the (more important) match text.
  let cardMediaUrl: string | null = null;
  const mediaBaseUrl = getKinfolkPublicMediaBaseUrl();
  if (mediaBaseUrl && listing?.address_line?.trim()) {
    try {
      const coverPhotoUrl = await findListingCoverPhotoUrl(
        supabase,
        match.listing_id,
      );
      const cardSnapshot: ListingCardSnapshot = {
        address: listing.address_line.trim(),
        bathrooms: listing.bathrooms,
        bedrooms: listing.bedrooms,
        description: "",
        effectivePerPersonRent: readPositiveRent(
          match.effective_per_person_rent,
        ),
        effectiveRent: listing.effective_monthly_rent,
        evidence: [],
        fitScore: readPositiveRent(match.fit_score) ?? 0,
        // The notification only fires off a precomputed apartment_listing_matches
        // row, so the card may honestly claim an engine-scored "% fit".
        fitSource: "engine",
        id: listing.id,
        imageUrl: coverPhotoUrl,
        monthlyRent: listing.monthly_rent,
        neighborhood: listing.neighborhood?.trim() || listing.city.trim(),
        perPersonRent: readPositiveRent(match.per_person_rent),
        recommendedHouseholdSize: readPositiveRent(
          match.recommended_household_size,
        ),
        sourceUrl: listing.source_url,
      };
      cardMediaUrl = buildEmbeddedListingCardUrl({
        baseUrl: mediaBaseUrl,
        snapshot: cardSnapshot,
      });
    } catch (error) {
      console.error("[match-notifications] Failed to build listing card media.", {
        error: error instanceof Error ? error.message : String(error),
        listingMatchId: normalizedListingMatchId,
      });
    }
  }

  const messageParts: TextOutboundPart[] = [{ type: "text", value: body }];
  if (cardMediaUrl) {
    messageParts.push({ type: "media", url: cardMediaUrl });
  }

  return deliverMatchNotificationText(supabase, {
    existingNotification: gates.existingNotification,
    idempotencyKey,
    kind: "apartment_match",
    messageKind: "apartment_match_notification",
    messageParts,
    phone: gates.phone,
    provider: gates.provider,
    rawPayloadExtra: {
      listing_id: match.listing_id,
      listing_match_id: normalizedListingMatchId,
    },
    subjectId: normalizedListingMatchId,
    userId: normalizedUserId,
  });
}

// ---------------------------------------------------------------------------
// Roommate match (kind 'roommate_match')
// ---------------------------------------------------------------------------

/** Component keys → short labels for the contact-free roommate preview. */
const ROOMMATE_DIMENSION_LABELS: Record<string, string> = {
  budget_location_synergy: "Budget",
  communication_fit: "Communication",
  guest_rhythm_fit: "Guests",
  home_labor_fit: "Home labor",
  lifestyle_friction_fit: "Lifestyle",
  rapport_taste_fit: "Rapport",
  schedule_collision_fit: "Schedule",
  trust_bridge_strength: "Trust",
};

function topRoommateDimensionLabels(components: Json | null): string[] {
  if (!components || typeof components !== "object" || Array.isArray(components)) {
    return [];
  }
  return Object.entries(components as Record<string, unknown>)
    .flatMap(([key, value]) =>
      typeof value === "number" && ROOMMATE_DIMENSION_LABELS[key]
        ? [{ label: ROOMMATE_DIMENSION_LABELS[key], value }]
        : [],
    )
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((entry) => entry.label);
}

function buildRoommateMatchIdempotencyKey({
  recipientUserId,
  edgeId,
  computedAt,
}: {
  recipientUserId: string;
  edgeId: string;
  computedAt: string;
}): string {
  // computed_at is part of the key so a genuinely re-scored edge may notify
  // again; an identical re-run cannot (plan-017 policy contract).
  return `kinfolk:roommate-match-notification:${recipientUserId}:${edgeId}:${computedAt}`;
}

/**
 * Proactive "new high-fit roommate" text. Beyond the shared consent chain:
 * the 80+ score threshold, and the stricter plan-017 policy cap of one
 * roommate notification per rolling 24h. The body is contact-free: first
 * name, fit score, dimension labels only.
 */
export async function sendRoommateMatchNotification(
  supabase: SupabaseServiceClient,
  {
    userId,
    edgeId,
    nowUtc,
  }: { userId: string; edgeId: string; nowUtc?: Date },
): Promise<MatchNotificationSendResult> {
  const normalizedUserId = normalizeRequiredMatchNotificationId(userId);
  const normalizedEdgeId = normalizeRequiredMatchNotificationId(edgeId);
  if (!normalizedUserId || !normalizedEdgeId) {
    return { sent: false, skipped: "invalid_match_notification_target" };
  }

  const edgeResult = await supabase
    .from("compatibility_edges")
    .select("id,user_a_id,user_b_id,score,computed_at,score_components,status")
    .eq("id", normalizedEdgeId)
    .eq("status", "active")
    .maybeSingle();
  if (edgeResult.error) throw edgeResult.error;
  const edge = edgeResult.data;
  if (
    !edge ||
    (edge.user_a_id !== normalizedUserId && edge.user_b_id !== normalizedUserId)
  ) {
    return { sent: false, skipped: "match_not_found" };
  }
  const score = Math.round(Number(edge.score));
  if (
    !Number.isFinite(score) ||
    score < DEFAULT_ROOMMATE_NOTIFICATION_CONFIG.minScore
  ) {
    return { sent: false, skipped: "below_threshold" };
  }

  const idempotencyKey = buildRoommateMatchIdempotencyKey({
    computedAt: edge.computed_at,
    edgeId: normalizedEdgeId,
    recipientUserId: normalizedUserId,
  });
  const gates = await runMatchNotificationGates(supabase, {
    idempotencyKey,
    kind: "roommate_match",
    nowUtc,
    prefsEnabled: (prefs) => prefs.roommate_matches_enabled,
    userId: normalizedUserId,
  });
  if ("skipped" in gates) {
    return { sent: false, skipped: gates.skipped };
  }

  // Plan-017 policy: at most one proactive roommate text per rolling 24h.
  const roommateSentInWindow = await countSentNotificationsSince(supabase, {
    kind: "roommate_match",
    since: new Date(gates.now.getTime() - 24 * 60 * 60 * 1000),
    userId: normalizedUserId,
  });
  if (roommateSentInWindow >= DEFAULT_ROOMMATE_NOTIFICATION_CONFIG.maxPerDay) {
    return { sent: false, skipped: "roommate_daily_cap" };
  }

  const otherUserId =
    edge.user_a_id === normalizedUserId ? edge.user_b_id : edge.user_a_id;
  const otherUser = await supabase
    .from("kinfolk_users")
    .select("display_name")
    .eq("id", otherUserId)
    .maybeSingle();
  if (otherUser.error) throw otherUser.error;

  const preview = buildRoommateMatchPreview({
    computedAt: edge.computed_at,
    dimensionLabels: topRoommateDimensionLabels(edge.score_components),
    edgeId: normalizedEdgeId,
    name: otherUser.data?.display_name ?? "",
    otherUserId,
    score,
  });
  const strongOn =
    preview.dimensionLabels.length > 0
      ? ` — strong on ${preview.dimensionLabels.join(", ").toLowerCase()}`
      : "";
  const body = [
    `New roommate match: ${preview.firstName}, ${preview.fitScore}% fit${strongOn}.`,
    `See their profile: ${getKinfolkMatchesUrl()}`,
  ].join(" ");

  return deliverMatchNotificationText(supabase, {
    existingNotification: gates.existingNotification,
    idempotencyKey,
    kind: "roommate_match",
    messageKind: "roommate_match_notification",
    messageParts: [{ type: "text", value: body }],
    phone: gates.phone,
    provider: gates.provider,
    rawPayloadExtra: { compatibility_edge_id: normalizedEdgeId },
    subjectId: normalizedEdgeId,
    userId: normalizedUserId,
  });
}

// ---------------------------------------------------------------------------
// Group ready (kind 'group_ready')
// ---------------------------------------------------------------------------

/**
 * Fires when the recipient's apartment group reaches max_size capacity.
 * Idempotent per (group, member-count) so a group that empties and refills may
 * notify again, an unchanged full group cannot.
 */
export async function sendGroupReadyNotification(
  supabase: SupabaseServiceClient,
  {
    userId,
    groupId,
    nowUtc,
  }: { userId: string; groupId: string; nowUtc?: Date },
): Promise<MatchNotificationSendResult> {
  const normalizedUserId = normalizeRequiredMatchNotificationId(userId);
  const normalizedGroupId = normalizeRequiredMatchNotificationId(groupId);
  if (!normalizedUserId || !normalizedGroupId) {
    return { sent: false, skipped: "invalid_match_notification_target" };
  }

  const [groupResult, membersResult] = await Promise.all([
    supabase
      .from("apartment_roommate_groups")
      .select("id,listing_id,max_size,status")
      .eq("id", normalizedGroupId)
      .maybeSingle(),
    supabase
      .from("apartment_roommate_group_memberships")
      .select("user_id")
      .eq("group_id", normalizedGroupId)
      .eq("status", "member"),
  ]);
  if (groupResult.error) throw groupResult.error;
  if (membersResult.error) throw membersResult.error;

  const group = groupResult.data;
  const members = membersResult.data ?? [];
  if (!group || !members.some((member) => member.user_id === normalizedUserId)) {
    return { sent: false, skipped: "match_not_found" };
  }
  if (members.length < group.max_size) {
    return { sent: false, skipped: "group_not_full" };
  }

  const idempotencyKey = `kinfolk:group-ready-notification:${normalizedUserId}:${normalizedGroupId}:${members.length}`;
  const gates = await runMatchNotificationGates(supabase, {
    idempotencyKey,
    kind: "group_ready",
    nowUtc,
    prefsEnabled: (prefs) => prefs.group_ready_enabled,
    userId: normalizedUserId,
  });
  if ("skipped" in gates) {
    return { sent: false, skipped: gates.skipped };
  }

  const listingResult = await supabase
    .from("apartment_listings")
    .select("address_line,neighborhood,city")
    .eq("id", group.listing_id)
    .maybeSingle();
  if (listingResult.error) throw listingResult.error;
  const address = normalizeMatchNotificationText(
    listingResult.data?.address_line,
    "your apartment",
    MATCH_NOTIFICATION_TEXT_LIMITS.address,
  );

  const body = [
    `Your group for ${address} is full — all ${group.max_size} spots are claimed.`,
    `Coordinate next steps: ${getKinfolkMatchesUrl()}`,
  ].join(" ");

  return deliverMatchNotificationText(supabase, {
    existingNotification: gates.existingNotification,
    idempotencyKey,
    kind: "group_ready",
    messageKind: "group_ready_notification",
    messageParts: [{ type: "text", value: body }],
    phone: gates.phone,
    provider: gates.provider,
    rawPayloadExtra: { apartment_group_id: normalizedGroupId },
    subjectId: normalizedGroupId,
    userId: normalizedUserId,
  });
}

// ---------------------------------------------------------------------------
// Apartment-card helpers
// ---------------------------------------------------------------------------

async function findListingCoverPhotoUrl(
  supabase: SupabaseServiceClient,
  listingId: string,
): Promise<string | null> {
  const result = await supabase
    .from("apartment_listing_photos")
    .select("url")
    .eq("listing_id", listingId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    throw result.error;
  }
  return result.data?.url?.trim() || null;
}

function readPositiveRent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function formatMatchNotificationPerPersonRent(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "";
  }
  return `$${Math.round(value).toLocaleString()}/person`;
}
