import "server-only";

import { cache } from "react";
import { getApartmentSearchSnapshot } from "@/lib/apartments/search";
import { apartmentMatchesFromSearchSnapshot } from "@/lib/apartments/match-surface";
import { brandNameMatches } from "@/lib/orgs/org-logo";
import { parseEvidencePoints } from "@/lib/shared/evidence";
import { prependLinkedInProfilePhotoUrl } from "@/lib/profiles/photos";
import { selectPreferredIdentityAvatarUrl } from "@/lib/profiles/identity-avatar";
import { loadPublicVisibilityByUserId } from "@/lib/profiles/visibility";
import {
  ageForKinfolkUser,
  getProfileMatchingReviewState,
} from "@/lib/profiles/enrichment-store";
import {
  parseFirstCredential,
  type RoommateCredential,
} from "@/lib/profiles/enrichment-credentials";
import { VISIBLE_APARTMENT_MATCH_STATUSES } from "@/lib/matching/match-status";
import { parseScoreMeta, SCORE_META_KEYS } from "@/lib/matching/score-meta";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import type { EvidencePoint } from "@/lib/shared/types";
import { hasServerSupabaseConfig, supabaseUrl } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export type ApartmentMatch = {
  id: string;
  title: string;
  subtitle: string;
  fitScore: number;
  monthlyRent: number | null;
  perPersonRent: number | null;
  rentCaption: string | null;
  /** "2 bd · 1 ba" style label, when bedroom data exists. */
  beds: string | null;
  /** Listing photos (cover first) for the card carousel. */
  photoUrls: string[];
  /** External listing URL, when available. */
  sourceUrl: string | null;
  status: string;
  evidence: EvidencePoint[];
  tradeoffs: EvidencePoint[];
  nextAction: string;
};

export type RoommateMatchComponent = {
  key: string;
  label: string;
  /** 0–100, ready to render as a bar width. */
  score: number;
};

/** A real, human-readable living-style signal pulled from the person's profile facts. */
type RoommateProfileSignal = {
  label: string;
  value: string;
  provisional?: boolean;
};

type EnrichmentReviewBanner = {
  pendingFactCount: number;
  pendingBehavioralCount: number;
  message: string;
  memoriesHref: string;
};

// Re-exported so existing `@/lib/matching/matches` importers (matches-pane.tsx)
// keep resolving `RoommateCredential`; the source of truth lives in the shared
// enrichment-credentials leaf module.
export type { RoommateCredential };

/** Extra profile context shown when a roommate/requester card is expanded. */
export type RoommateProfileDetail = {
  age: number | null;
  about: string | null;
  interests: string[];
  education: string | null;
  hometown: string | null;
  /** All profile photos (primary first), for the modal carousel. */
  photos: string[];
  /** Company + school with enrichment logos, when available. */
  company: RoommateCredential | null;
  school: RoommateCredential | null;
  /** Lifestyle / living-style signals derived from matching-eligible profile facts. */
  signals: RoommateProfileSignal[];
  /** Full compatibility breakdown (all dimensions), ordered for display. */
  breakdown: RoommateMatchComponent[];
};

/** A compact apartment preview for the unit a join request targets. */
export type ApartmentPreview = {
  photoUrl: string | null;
  address: string;
  neighborhood: string;
  beds: string;
  monthlyRent: number | null;
  perPersonRent: number | null;
};

export type RoommateMatch = {
  id: string;
  userId: string;
  name: string;
  initials: string;
  /**
   * Anonymous-mode candidate: identity (full name, photos, work, school, age,
   * hometown, bio, interests) is stripped server-side; the behavioral matching
   * signal (score, components, evidence, lifestyle signals) stays. Cleared
   * when the candidate opted into a public profile or the intro is mutual.
   */
  locked: boolean;
  headline: string;
  imageUrl: string | null;
  score: number;
  /** Confidence range around `score`; null on edges computed before coverage. */
  scoreLow: number | null;
  scoreHigh: number | null;
  /** 0–1 share of scoring weight with real two-sided signal; null on old edges. */
  coverage: number | null;
  /** They already expressed intro intent; the viewer messaging back opens the chat. */
  incomingIntent: boolean;
  /** Ordered breakdown; the card renders the first three as bars. */
  components: RoommateMatchComponent[];
  evidence: EvidencePoint[];
  risks: EvidencePoint[];
  computedAt: string;
  detail: RoommateProfileDetail;
};

export type PendingGroupRequest = {
  /** Membership row id. */
  id: string;
  groupId: string;
  requesterUserId: string;
  requesterName: string;
  requesterInitials: string;
  requesterImageUrl: string | null;
  requesterHeadline: string;
  /** Compatibility with the viewer when an edge exists, else null. */
  fitScore: number | null;
  groupLabel: string;
  groupNeighborhood: string;
  openSpots: number;
  requestedAt: string;
  evidence: EvidencePoint[];
  risks: EvidencePoint[];
  detail: RoommateProfileDetail;
  /** The unit this request targets, for an inline preview. */
  listing: ApartmentPreview | null;
};

export type MatchesSnapshot = {
  status: "connected" | "unavailable" | "error" | "signed_out";
  detail: string;
  enrichmentReview: EnrichmentReviewBanner | null;
  apartments: ApartmentMatch[];
  roommates: RoommateMatch[];
  requests: PendingGroupRequest[];
};

/**
 * Human labels for the compatibility dimensions emitted by `scoreCompatibility`.
 * We surface the three most legible dimensions as bars on each roommate card.
 */
const COMPONENT_LABELS: Record<string, string> = {
  lifestyle_friction_fit: "Lifestyle",
  schedule_collision_fit: "Schedule",
  guest_rhythm_fit: "Guests",
  budget_location_synergy: "Budget",
  communication_fit: "Communication",
  home_labor_fit: "Home labor",
  trust_bridge_strength: "Trust",
  preference_elasticity_fit: "Flexibility",
  rapport_taste_fit: "Rapport",
  age_comfort_fit: "Age comfort",
};

/**
 * score_components keys that are not displayable dimensions: the ride-along
 * confidence meta (owned by lib/matching/score-meta), the gate multiplier, and
 * the retired novelty term still present on old edges.
 */
const META_COMPONENT_KEYS = new Set<string>([
  ...SCORE_META_KEYS,
  "feasibility_gate",
  "novelty_learning_value",
]);

const PREFERRED_COMPONENT_ORDER = [
  "lifestyle_friction_fit",
  "schedule_collision_fit",
  "guest_rhythm_fit",
  "budget_location_synergy",
  "communication_fit",
  "home_labor_fit",
];

const CARD_COMPONENT_PRIORITY = [
  "trust_bridge_strength",
  "rapport_taste_fit",
  "communication_fit",
  ...PREFERRED_COMPONENT_ORDER,
];
const visibleApartmentQueueStatuses = ["suggested", "approved", "preparing"];

function emptySnapshot(
  status: MatchesSnapshot["status"],
  detail: string,
): MatchesSnapshot {
  return {
    status,
    detail,
    enrichmentReview: null,
    apartments: [],
    roommates: [],
    requests: [],
  };
}

function selectCardComponents(
  components: RoommateMatchComponent[],
): RoommateMatchComponent[] {
  const byKey = new Map(components.map((component) => [component.key, component]));
  const selected: RoommateMatchComponent[] = [];
  const seen = new Set<string>();

  const push = (key: string) => {
    if (seen.has(key)) return;
    const component = byKey.get(key);
    if (!component) return;
    if (
      (key === "trust_bridge_strength" || key === "rapport_taste_fit") &&
      component.score <= 52
    ) {
      return;
    }
    selected.push(component);
    seen.add(key);
  };

  for (const key of CARD_COMPONENT_PRIORITY) {
    push(key);
    if (selected.length >= 3) {
      return selected;
    }
  }

  for (const component of components) {
    if (selected.length >= 3) break;
    if (META_COMPONENT_KEYS.has(component.key)) {
      continue;
    }
    if (!seen.has(component.key)) {
      selected.push(component);
      seen.add(component.key);
    }
  }

  return selected.slice(0, 3);
}

function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "K";
}

function headlineFromUser(
  user: Pick<TableRow<"kinfolk_users">, "occupation_title" | "occupation_company"> | undefined,
): string {
  if (!user) return "Roommate match";
  const parts = [user.occupation_title, user.occupation_company]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join(" · ") || "Roommate match";
}

/** Component scores arrive as 0–1 fractions; normalize to a 0–100 bar width. */
function toPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/**
 * Full compatibility breakdown, ordered so the most legible dimensions come first.
 * The roommate card renders the first three; the expanded profile shows them all.
 */
function parseComponents(value: Json): RoommateMatchComponent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const source = value as Record<string, unknown>;
  const byKey = new Map(
    Object.entries(source).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
  if (byKey.size === 0) return [];

  const ordered: RoommateMatchComponent[] = [];
  for (const key of PREFERRED_COMPONENT_ORDER) {
    const raw = byKey.get(key);
    if (typeof raw === "number") {
      ordered.push({ key, label: COMPONENT_LABELS[key] ?? key, score: toPercent(raw) });
      byKey.delete(key);
    }
  }
  for (const [key, raw] of byKey) {
    if (META_COMPONENT_KEYS.has(key)) continue;
    ordered.push({ key, label: COMPONENT_LABELS[key] ?? key, score: toPercent(raw) });
  }
  return ordered;
}

function formatEducation(
  profile: Pick<
    UserProfileLite,
    "education_school" | "education_degree" | "education_major" | "education_year"
  >,
): string | null {
  const degree = [profile.education_degree, profile.education_major]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const parts = [profile.education_school?.trim(), degree, profile.education_year?.trim()].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

type ProfileFactLite = {
  dimension: string;
  factKey: string;
  value: string;
  confidence: number;
  importance: number;
  provisional?: boolean;
};

/** Drop placeholder/unknown fact values so we never surface filler text. */
function cleanFactValue(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower.startsWith("unknown") || lower.includes("no reliable evidence")) return null;
  return normalized;
}

function truncateValue(value: string, maxLength = 140): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function firstFactValue(
  facts: ProfileFactLite[],
  keys: string[],
): { value: string; provisional: boolean } | null {
  const keySet = new Set(keys);
  const match = facts.find((fact) => keySet.has(fact.factKey) && fact.confidence > 0);
  if (!match) return null;
  return {
    value: truncateValue(match.value),
    provisional: match.provisional ?? false,
  };
}

// Living-style signals, ordered by how much they help a roommate decision. Each row is
// only shown when a real, matching-eligible fact backs it — no defaults, no filler.
const SIGNAL_DEFINITIONS: { label: string; keys: string[] }[] = [
  {
    label: "Daily rhythm",
    keys: [
      "sleep_schedule",
      "work_from_home",
      "work_hours",
      "routine_regularity",
      "weekday_routine",
      "weekend_routine",
    ],
  },
  {
    label: "Noise & environment",
    keys: ["noise_tolerance", "light_tolerance", "scent_tolerance", "temperature_preference"],
  },
  { label: "Cleanliness", keys: ["cleanliness", "chores", "dishes"] },
  {
    label: "Social style",
    keys: ["social_energy", "guests", "overnight_guests", "privacy", "parties"],
  },
  {
    label: "Communication",
    keys: ["communication_style", "conflict_repair", "planning_style", "response_time"],
  },
  {
    label: "At work",
    keys: ["verified_work_or_school", "shared_communities", "prior_roommate_context"],
  },
];

function buildSignals(facts: ProfileFactLite[]): RoommateProfileSignal[] {
  const signals: RoommateProfileSignal[] = [];
  for (const definition of SIGNAL_DEFINITIONS) {
    const match = firstFactValue(facts, definition.keys);
    if (match) {
      signals.push({
        label: definition.label,
        value: match.provisional ? `${match.value} (draft)` : match.value,
        provisional: match.provisional,
      });
    }
  }
  return signals;
}

const INTEREST_FACT_KEYS = [
  "interests",
  "music_taste",
  "media_taste",
  "aesthetic_taste",
];
const interestFactKeySet = new Set(INTEREST_FACT_KEYS);

function deriveInterests(profile: UserProfileLite): string[] {
  const explicit = profile.interests ?? [];
  if (explicit.length > 0) return explicit;

  const seen = new Set<string>();
  const derived: string[] = [];
  for (const fact of profile.facts) {
    if (!interestFactKeySet.has(fact.factKey)) continue;
    for (const part of fact.value.split(/[,;·]| and /)) {
      const cleaned = part.replace(/\s+/g, " ").trim().replace(/\.$/, "");
      const key = cleaned.toLowerCase();
      if (cleaned.length < 2 || cleaned.length > 32 || seen.has(key)) continue;
      seen.add(key);
      derived.push(cleaned);
      if (derived.length >= 8) return derived;
    }
  }
  return derived;
}

function profileDetailFor(
  profile: UserProfileLite | undefined,
  breakdown: RoommateMatchComponent[],
): RoommateProfileDetail {
  if (!profile) {
    return {
      age: null,
      about: null,
      interests: [],
      education: null,
      hometown: null,
      photos: [],
      company: null,
      school: null,
      signals: [],
      breakdown,
    };
  }

  const aboutMatch = firstFactValue(profile.facts, [
    "community_orientation",
    "independence_level",
    "rent_tradeoff",
    "privacy_orientation",
  ]);
  const about =
    profile.about_text?.trim() ||
    aboutMatch?.value ||
    null;

  // A logo is only shown beside a label it can be shown to belong to. The
  // picked column is resolved for this exact label; the enrichment credential
  // is a LinkedIn scrape that may describe an employer this person has since
  // edited away from, so it is borrowed only when its own label corroborates.
  const company = credentialFor(
    profile.occupation_company,
    profile.occupation_company_logo_url,
    profile.company,
  );
  const school = credentialFor(
    profile.education_school,
    profile.education_school_logo_url,
    profile.school,
  );

  return {
    // The modal renders the age chip whenever this is non-null; it was a
    // dead wire (hardcoded null) even though the birth fields exist.
    age: ageForKinfolkUser(profile),
    about: about || null,
    interests: deriveInterests(profile),
    education: formatEducation(profile),
    hometown: profile.hometown?.trim() || null,
    photos: profile.photos,
    company,
    school,
    signals: buildSignals(profile.facts),
    breakdown,
  };
}

/**
 * Pair a label with a logo only when their provenance matches.
 *
 * Falling back to whatever logo happened to be around rendered "Anthropic"
 * wearing Meta's mark for anyone who edited their employer after enrichment
 * ran. When nothing corroborates, the label stands alone.
 */
function credentialFor(
  label: string | null | undefined,
  ownLogoUrl: string | null | undefined,
  enrichment: RoommateCredential | null | undefined,
): RoommateCredential | null {
  const trimmed = label?.trim();
  if (!trimmed) return enrichment ?? null;
  if (ownLogoUrl) return { label: trimmed, logoUrl: ownLogoUrl };
  const borrowed =
    enrichment?.logoUrl && brandNameMatches(trimmed, enrichment.label)
      ? enrichment.logoUrl
      : null;
  return { label: trimmed, logoUrl: borrowed };
}

async function loadApartmentMatches(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<ApartmentMatch[]> {
  const searchSnapshot = await getApartmentSearchSnapshot(userId);
  const searchMatches = apartmentMatchesFromSearchSnapshot(searchSnapshot);
  if (searchMatches) {
    return searchMatches;
  }

  const profileResult = await supabase
    .from("matching_profiles")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (profileResult.error) throw profileResult.error;

  const profileId = profileResult.data?.id ?? null;
  if (!profileId) return [];

  // Prefer the listing-match path: unlike the generic queue mirror, these rows
  // carry a listing_id, so we can attach photos, per-person rent, and bed counts.
  const listingMatches = await supabase
    .from("apartment_listing_matches")
    .select("id,fit_score,status,evidence,tradeoffs,listing_id,per_person_rent,effective_per_person_rent")
    .eq("user_id", userId)
    .eq("profile_id", profileId)
    .in("status", VISIBLE_APARTMENT_MATCH_STATUSES)
    .order("fit_score", { ascending: false })
    .limit(80);
  if (listingMatches.error) throw listingMatches.error;

  if ((listingMatches.data ?? []).length > 0) {
    const listingIds = listingMatches.data.map((row) => row.listing_id);
    const [listingsResult, photosByListing] = await Promise.all([
      supabase
        .from("apartment_listings")
        .select(
          "id,address_line,neighborhood,city,monthly_rent,effective_monthly_rent,bedrooms,bathrooms,source_url",
        )
        .in("id", listingIds),
      loadListingPhotos(supabase, listingIds),
    ]);

    if (listingsResult.error) throw listingsResult.error;
    const listingById = new Map((listingsResult.data ?? []).map((row) => [row.id, row]));

    return (listingMatches.data ?? []).flatMap((row) => {
      const listing = listingById.get(row.listing_id);
      if (!listing) return [];
      // Whole-unit only: falling back to per_person_rent here presented a
      // per-person figure as the unit's rent on the card.
      const monthlyRent =
        listing.effective_monthly_rent ?? listing.monthly_rent;
      const neighborhood = listing.neighborhood ?? listing.city ?? "Neighborhood";
      return [
        {
          id: row.id,
          title: listing.address_line,
          subtitle: neighborhood,
          fitScore: Math.round(row.fit_score),
          monthlyRent: monthlyRent ?? null,
          perPersonRent: row.effective_per_person_rent ?? row.per_person_rent ?? null,
          rentCaption: null,
          beds:
            listing.bedrooms == null
              ? null
              : formatBeds(listing.bedrooms, listing.bathrooms),
          photoUrls: photosByListing.get(row.listing_id) ?? [],
          sourceUrl: listing.source_url ?? null,
          status: row.status,
          evidence: parseEvidencePoints(row.evidence),
          tradeoffs: parseEvidencePoints(row.tradeoffs),
          nextAction: "Review the match",
        },
      ];
    });
  }

  // Fallback: the generic match queue (no listing_id, so no photos or beds).
  const queueResult = await supabase
    .from("match_queue_items")
    .select("*")
    .eq("user_id", userId)
    .eq("candidate_type", "apartment")
    .eq("profile_id", profileId)
    .in("status", visibleApartmentQueueStatuses)
    .order("fit_score", { ascending: false });
  if (queueResult.error) throw queueResult.error;

  return (queueResult.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    fitScore: Math.round(row.fit_score),
    monthlyRent: row.monthly_rent,
    perPersonRent: null,
    rentCaption: null,
    beds: null,
    photoUrls: [],
    sourceUrl: null,
    status: row.status,
    evidence: parseEvidencePoints(row.evidence),
    tradeoffs: parseEvidencePoints(row.tradeoffs),
    nextAction: row.next_action?.trim() || "Review the match",
  }));
}

/** All photos for the given listings, cover-first, capped per listing for the card carousel. */
async function loadListingPhotos(
  supabase: SupabaseServiceClient,
  listingIds: string[],
  perListingLimit = 8,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (listingIds.length === 0) return map;

  const result = await supabase
    .from("apartment_listing_photos")
    .select("listing_id,url,position")
    .in("listing_id", listingIds)
    .order("position", { ascending: true });

  if (result.error) throw result.error;

  for (const row of result.data ?? []) {
    if (!row.url) continue;
    const list = map.get(row.listing_id) ?? [];
    if (list.length >= perListingLimit) continue;
    list.push(row.url);
    map.set(row.listing_id, list);
  }
  return map;
}

/** Full compatibility edge involving the viewer, keyed by the other user's id. */
type ViewerEdge = {
  id: string;
  score: number;
  scoreLow: number | null;
  scoreHigh: number | null;
  coverage: number | null;
  incomingIntent: boolean;
  /** Both sides' latest match event is approved_intro — identity unlocks. */
  mutualIntent: boolean;
  components: RoommateMatchComponent[];
  evidence: EvidencePoint[];
  risks: EvidencePoint[];
  computedAt: string;
};

async function loadViewerEdgeMap(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<Map<string, ViewerEdge>> {
  const map = new Map<string, ViewerEdge>();
  const result = await supabase
    .from("compatibility_edges")
    .select("*")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .eq("status", "active")
    .order("score", { ascending: false });

  if (result.error) throw result.error;

  for (const edge of result.data ?? []) {
    const otherId = edge.user_a_id === userId ? edge.user_b_id : edge.user_a_id;
    // Keep the highest-scoring edge if duplicates exist (query is score-desc).
    if (map.has(otherId)) continue;
    const meta = parseScoreMeta(edge.score_components);
    map.set(otherId, {
      id: edge.id,
      score: Math.round(edge.score),
      scoreLow: meta.scoreLow,
      scoreHigh: meta.scoreHigh,
      coverage: meta.coverage,
      incomingIntent: false,
      mutualIntent: false,
      components: parseComponents(edge.score_components),
      evidence: parseEvidencePoints(edge.evidence),
      risks: parseEvidencePoints(edge.risks),
      computedAt: edge.computed_at,
    });
  }

  await markIncomingIntents(supabase, userId, map);
  return map;
}

/**
 * Flag edges where the OTHER person's latest match event is approved_intro
 * and the viewer's isn't: they reached out, the chat is one tap from opening,
 * and the viewer must be able to SEE that — a mutual-consent model with no
 * visibility is a dead loop.
 */
async function markIncomingIntents(
  supabase: SupabaseServiceClient,
  userId: string,
  edgeMap: Map<string, ViewerEdge>,
): Promise<void> {
  const edgeIdByOther = new Map(
    Array.from(edgeMap.entries()).map(([otherId, edge]) => [edge.id, otherId]),
  );
  if (edgeIdByOther.size === 0) return;

  const events = await supabase
    .from("match_feedback_events")
    .select("compatibility_edge_id, actor_user_id, event_type, created_at")
    .in("compatibility_edge_id", Array.from(edgeIdByOther.keys()))
    .order("created_at", { ascending: false });
  if (events.error) throw events.error;

  const latestByEdgeActor = new Map<string, string>();
  for (const event of events.data ?? []) {
    const key = `${event.compatibility_edge_id}:${event.actor_user_id}`;
    if (!latestByEdgeActor.has(key)) {
      latestByEdgeActor.set(key, event.event_type);
    }
  }

  for (const [edgeId, otherId] of edgeIdByOther) {
    const theirs = latestByEdgeActor.get(`${edgeId}:${otherId}`);
    const mine = latestByEdgeActor.get(`${edgeId}:${userId}`);
    const edge = edgeMap.get(otherId);
    if (!edge) continue;
    if (theirs === "approved_intro" && mine !== "approved_intro") {
      edge.incomingIntent = true;
    }
    // Mirrors the chat-store DM gate: mutual latest approved_intro. This is
    // the second identity unlock (alongside the person opting into a public
    // profile) for anonymous-mode matches.
    if (theirs === "approved_intro" && mine === "approved_intro") {
      edge.mutualIntent = true;
    }
  }
}

/**
 * User ids sharing an accepted apartment-group membership with the viewer.
 * Mirrors the group-surface unlock (persisted-roommate-groups.ts): accepted
 * co-members see each other in full, so the matches surface must agree.
 *
 * "Accepted" means more than a membership row: the group must be
 * CREATOR-OWNED (migration-seeded groups have created_by_user_id null and
 * nobody ever consented to them) and still ACTIVE (closed groups no longer
 * exist on the group surface, so they stop unlocking here too).
 */
async function loadSharedGroupMemberIds(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<Set<string>> {
  const own = await supabase
    .from("apartment_roommate_group_memberships")
    .select("group_id")
    .eq("user_id", userId)
    .eq("status", "member");
  if (own.error) throw own.error;
  const groupIds = Array.from(new Set((own.data ?? []).map((row) => row.group_id)));
  if (groupIds.length === 0) return new Set();

  const consentedGroups = await supabase
    .from("apartment_roommate_groups")
    .select("id")
    .in("id", groupIds)
    .not("created_by_user_id", "is", null)
    .in("status", ["forming", "ready", "touring"]);
  if (consentedGroups.error) throw consentedGroups.error;
  const consentedGroupIds = (consentedGroups.data ?? []).map((row) => row.id);
  if (consentedGroupIds.length === 0) return new Set();

  const members = await supabase
    .from("apartment_roommate_group_memberships")
    .select("user_id")
    .in("group_id", consentedGroupIds)
    .eq("status", "member");
  if (members.error) throw members.error;
  return new Set(
    (members.data ?? [])
      .map((row) => row.user_id)
      .filter((id) => id !== userId),
  );
}

async function loadRoommateMatches(
  supabase: SupabaseServiceClient,
  userId: string,
  edgeMap: Map<string, ViewerEdge>,
): Promise<RoommateMatch[]> {
  const otherIds = Array.from(edgeMap.keys());
  if (otherIds.length === 0) return [];
  const [profiles, publicVisibility, sharedGroupMemberIds] = await Promise.all([
    loadUserProfiles(supabase, otherIds),
    loadPublicVisibilityByUserId(supabase, otherIds),
    loadSharedGroupMemberIds(supabase, userId),
  ]);

  return otherIds
    .map((otherId) => {
      const edge = edgeMap.get(otherId)!;
      const profile = profiles.get(otherId);
      if (!isVisibleRoommateProfile(profile)) return null;
      // PRIVACY: anonymous-mode candidates stay identity-hidden until they opt
      // into a public profile, both sides approve the intro, or they already
      // share an accepted group with the viewer (same unlocks as the listing
      // group surface — the two must not contradict each other).
      const locked =
        !(publicVisibility.get(otherId) ?? false) &&
        !edge.mutualIntent &&
        !sharedGroupMemberIds.has(otherId);
      const fullName = profile?.display_name?.trim() || "Roommate";
      const name = locked ? firstNameOf(fullName) : fullName;
      const breakdown = edge.components;
      const detail = profileDetailFor(profile, breakdown);
      return {
        id: edge.id,
        userId: otherId,
        name,
        initials: initialsFor(name),
        locked,
        headline: locked ? "Anonymous profile" : headlineFromUser(profile),
        imageUrl: locked ? null : (profile?.imageUrl ?? null),
        score: edge.score,
        scoreLow: edge.scoreLow,
        scoreHigh: edge.scoreHigh,
        coverage: edge.coverage,
        incomingIntent: edge.incomingIntent,
        components: selectCardComponents(breakdown),
        // Evidence, risks, and lifestyle signals are free text that routinely
        // embeds identity ("Ada and Grace H. share…", "At work: …") — locked
        // profiles keep only the structured score breakdown.
        evidence: locked ? [] : edge.evidence,
        risks: locked ? [] : edge.risks,
        computedAt: edge.computedAt,
        detail: locked ? lockedProfileDetail(detail) : detail,
      } satisfies RoommateMatch;
    })
    .filter((match): match is RoommateMatch => match != null)
    // People who already reached out surface first — the one-tap chat opens.
    .sort(
      (a, b) =>
        Number(b.incomingIntent) - Number(a.incomingIntent) || b.score - a.score,
    );
}

type UserProfileLite = Pick<
  TableRow<"kinfolk_users">,
  | "id"
  | "display_name"
  | "email"
  | "occupation_title"
  | "occupation_company"
  | "occupation_company_logo_url"
  | "education_school_logo_url"
  | "about_text"
  | "interests"
  | "education_school"
  | "education_degree"
  | "education_major"
  | "education_year"
  | "hometown"
  | "birth_year"
  | "date_of_birth"
> & {
  imageUrl: string | null;
  photos: string[];
  facts: ProfileFactLite[];
  company: RoommateCredential | null;
  school: RoommateCredential | null;
};

function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/**
 * The identity-stripped detail for anonymous-mode candidates: only the
 * structured score breakdown survives. Lifestyle signals are dropped too —
 * they are fact-derived free text that can carry identity ("At work: …").
 * Written as a literal allowlist (not a spread) so adding a field to
 * RoommateProfileDetail fails to compile here until someone decides whether
 * it survives locking.
 */
function lockedProfileDetail(detail: RoommateProfileDetail): RoommateProfileDetail {
  return {
    age: null,
    about: null,
    interests: [],
    education: null,
    hometown: null,
    photos: [],
    company: null,
    school: null,
    signals: [],
    breakdown: detail.breakdown,
  };
}

function isVisibleRoommateProfile(profile: UserProfileLite | undefined): boolean {
  if (!profile) return true;

  const displayName = profile.display_name.trim().toLowerCase();
  const email = profile.email?.trim().toLowerCase() ?? "";
  return !(
    displayName.includes("sample") ||
    email.startsWith("profile-seed-")
  );
}

async function loadProfessionalCredentials(
  supabase: SupabaseServiceClient,
  userIds: string[],
): Promise<Map<string, { company: RoommateCredential | null; school: RoommateCredential | null }>> {
  const map = new Map<string, { company: RoommateCredential | null; school: RoommateCredential | null }>();
  if (userIds.length === 0) return map;

  const result = await supabase
    .from("professional_profiles")
    .select("user_id,experiences,education,updated_at")
    .in("user_id", userIds)
    .order("updated_at", { ascending: false });

  if (result.error) throw result.error;
  for (const row of result.data ?? []) {
    // First (most recent) row per user wins; query is updated_at desc.
    if (map.has(row.user_id)) continue;
    map.set(row.user_id, {
      company: parseFirstCredential(row.experiences),
      school: parseFirstCredential(row.education),
    });
  }
  return map;
}

async function loadLinkedInProfileImages(
  supabase: SupabaseServiceClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;

  const result = await supabase
    .from("linkedin_enrichment_jobs")
    .select("user_id,image_url,idempotency_key,updated_at")
    .in("user_id", userIds)
    .not("image_url", "is", null)
    .order("updated_at", { ascending: false });

  if (result.error) throw result.error;
  const candidatesByUser = new Map<
    string,
    Array<{
      idempotency_key: string;
      image_url: string | null;
      updated_at: string;
    }>
  >();
  for (const row of result.data ?? []) {
    const candidates = candidatesByUser.get(row.user_id) ?? [];
    candidates.push(row);
    candidatesByUser.set(row.user_id, candidates);
  }
  for (const [userId, candidates] of candidatesByUser) {
    const imageUrl = selectPreferredIdentityAvatarUrl(candidates, supabaseUrl);
    if (imageUrl) map.set(userId, imageUrl);
  }
  return map;
}

async function loadUserProfiles(
  supabase: SupabaseServiceClient,
  userIds: string[],
): Promise<Map<string, UserProfileLite>> {
  const map = new Map<string, UserProfileLite>();
  if (userIds.length === 0) return map;

  const [usersResult, photosResult, factsResult, credentials, linkedinImages] = await Promise.all([
    supabase
      .from("kinfolk_users")
      .select(
        "id,display_name,email,occupation_title,occupation_company,occupation_company_logo_url,about_text,interests,education_school,education_degree,education_major,education_year,education_school_logo_url,hometown,birth_year,date_of_birth",
      )
      .in("id", userIds),
    supabase
      .from("kinfolk_user_photos")
      .select("user_id,public_url,is_primary,position")
      .in("user_id", userIds)
      .order("is_primary", { ascending: false })
      .order("position", { ascending: true }),
    supabase
      .from("profile_facts")
      .select("user_id,dimension,fact_key,normalized_value,confidence,importance,user_review_state,matching_eligible")
      .in("user_id", userIds)
      .eq("sensitivity_level", "standard")
      .eq("matching_eligible", true)
      .in("user_review_state", ["approved", "edited"])
      .order("importance", { ascending: false })
      .order("confidence", { ascending: false }),
    loadProfessionalCredentials(supabase, userIds),
    loadLinkedInProfileImages(supabase, userIds),
  ]);

  if (usersResult.error) throw usersResult.error;
  if (photosResult.error) throw photosResult.error;
  if (factsResult.error) throw factsResult.error;

  // All photos per user, primary first (query is is_primary desc, position asc).
  const photosByUser = new Map<string, string[]>();
  for (const photo of photosResult.data ?? []) {
    if (!photo.public_url) continue;
    const list = photosByUser.get(photo.user_id) ?? [];
    list.push(photo.public_url);
    photosByUser.set(photo.user_id, list);
  }

  const factsByUser = new Map<string, ProfileFactLite[]>();
  for (const row of factsResult.data ?? []) {
    const value = cleanFactValue(row.normalized_value);
    if (!value) continue;
    const list = factsByUser.get(row.user_id) ?? [];
    list.push({
      dimension: row.dimension,
      factKey: row.fact_key,
      value,
      confidence: row.confidence,
      importance: row.importance,
      provisional: false,
    });
    factsByUser.set(row.user_id, list);
  }

  for (const user of usersResult.data ?? []) {
    const photos = prependLinkedInProfilePhotoUrl(
      photosByUser.get(user.id) ?? [],
      linkedinImages.get(user.id),
    );
    const credential = credentials.get(user.id);
    map.set(user.id, {
      ...user,
      imageUrl: photos[0] ?? null,
      photos,
      facts: factsByUser.get(user.id) ?? [],
      company: credential?.company ?? null,
      school: credential?.school ?? null,
    });
  }
  return map;
}

async function loadPendingRequests(
  supabase: SupabaseServiceClient,
  userId: string,
  edgeMap: Map<string, ViewerEdge>,
): Promise<PendingGroupRequest[]> {
  // Groups this user owns — only the creator can approve or decline joins.
  const groupsResult = await supabase
    .from("apartment_roommate_groups")
    .select("id,listing_id,floor_plan_name,target_unit_name,bedrooms,max_size,status")
    .eq("created_by_user_id", userId)
    .in("status", ["forming", "ready", "touring"]);

  if (groupsResult.error) throw groupsResult.error;
  const groups = groupsResult.data ?? [];
  if (groups.length === 0) return [];

  const groupIds = groups.map((group) => group.id);
  const membershipsResult = await supabase
    .from("apartment_roommate_group_memberships")
    .select("id,group_id,user_id,status,requested_at")
    .in("group_id", groupIds)
    .in("status", ["requested", "member"]);

  if (membershipsResult.error) throw membershipsResult.error;
  const memberships = membershipsResult.data ?? [];

  const memberCount = new Map<string, number>();
  for (const membership of memberships) {
    if (membership.status === "member") {
      memberCount.set(membership.group_id, (memberCount.get(membership.group_id) ?? 0) + 1);
    }
  }

  const pending = memberships.filter((membership) => membership.status === "requested");
  if (pending.length === 0) return [];

  const [profiles, listings] = await Promise.all([
    loadUserProfiles(
      supabase,
      Array.from(new Set(pending.map((membership) => membership.user_id))),
    ),
    loadListingContext(supabase, Array.from(new Set(groups.map((group) => group.listing_id)))),
  ]);

  const groupById = new Map(groups.map((group) => [group.id, group]));

  return pending
    .map((membership) => {
      const group = groupById.get(membership.group_id);
      if (!group) return null;
      const listing = listings.get(group.listing_id);
      const profile = profiles.get(membership.user_id);
      if (!isVisibleRoommateProfile(profile)) return null;
      const edge = edgeMap.get(membership.user_id);
      const name = profile?.display_name?.trim() || "Someone";
      const bedrooms = group.bedrooms ? `${group.bedrooms}BR` : group.floor_plan_name;
      const address = listing?.address ?? group.target_unit_name ?? "a unit";
      const filled = memberCount.get(group.id) ?? 0;
      const listingPreview: ApartmentPreview | null = listing
        ? {
            photoUrl: listing.photoUrl,
            address: listing.address,
            neighborhood: listing.neighborhood,
            beds: formatBeds(listing.bedrooms, listing.bathrooms),
            monthlyRent: listing.monthlyRent,
            perPersonRent:
              listing.monthlyRent != null && group.max_size > 0
                ? Math.round(listing.monthlyRent / group.max_size)
                : null,
          }
        : null;
      return {
        id: membership.id,
        groupId: group.id,
        requesterUserId: membership.user_id,
        requesterName: name,
        requesterInitials: initialsFor(name),
        requesterImageUrl: profile?.imageUrl ?? null,
        requesterHeadline: headlineFromUser(profile),
        fitScore: edge?.score ?? null,
        groupLabel: `${bedrooms} · ${address}`,
        groupNeighborhood: listing?.neighborhood ?? "",
        openSpots: Math.max(0, group.max_size - filled),
        requestedAt: membership.requested_at,
        evidence: edge?.evidence ?? [],
        risks: edge?.risks ?? [],
        detail: profileDetailFor(profile, edge?.components ?? []),
        listing: listingPreview,
      } satisfies PendingGroupRequest;
    })
    .filter((request): request is PendingGroupRequest => request != null)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

type ListingContext = {
  address: string;
  neighborhood: string;
  bedrooms: number | null;
  bathrooms: number | null;
  monthlyRent: number | null;
  photoUrl: string | null;
};

async function loadListingContext(
  supabase: SupabaseServiceClient,
  listingIds: string[],
): Promise<Map<string, ListingContext>> {
  const map = new Map<string, ListingContext>();
  if (listingIds.length === 0) return map;

  const [listingsResult, photosResult] = await Promise.all([
    supabase
      .from("apartment_listings")
      .select("id,address_line,neighborhood,city,bedrooms,bathrooms,monthly_rent,effective_monthly_rent")
      .in("id", listingIds),
    supabase
      .from("apartment_listing_photos")
      .select("listing_id,url,position")
      .in("listing_id", listingIds)
      .order("position", { ascending: true }),
  ]);

  if (listingsResult.error) throw listingsResult.error;
  if (photosResult.error) throw photosResult.error;

  const coverPhoto = new Map<string, string>();
  for (const photo of photosResult.data ?? []) {
    if (!coverPhoto.has(photo.listing_id) && photo.url) {
      coverPhoto.set(photo.listing_id, photo.url);
    }
  }

  for (const row of listingsResult.data ?? []) {
    map.set(row.id, {
      address: row.address_line,
      neighborhood: row.neighborhood ?? row.city ?? "",
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      monthlyRent: row.effective_monthly_rent ?? row.monthly_rent,
      photoUrl: coverPhoto.get(row.id) ?? null,
    });
  }
  return map;
}

function formatBeds(bedrooms: number | null, bathrooms: number | null): string {
  const bedLabel = bedrooms == null ? "Apartment" : bedrooms === 0 ? "Studio" : `${bedrooms} bd`;
  return bathrooms ? `${bedLabel} · ${bathrooms} ba` : bedLabel;
}

function buildEnrichmentReviewBanner(
  review: Awaited<ReturnType<typeof getProfileMatchingReviewState>>,
): EnrichmentReviewBanner | null {
  if (review.pendingFactCount === 0 && !review.hasPendingImports) {
    return null;
  }

  const message =
    review.pendingBehavioralCount > 0
      ? `${review.pendingBehavioralCount} lifestyle ${review.pendingBehavioralCount === 1 ? "fact is" : "facts are"} waiting in Memories — approve them to sharpen roommate scores.`
      : `${review.pendingFactCount} imported ${review.pendingFactCount === 1 ? "fact is" : "facts are"} waiting for review in Memories.`;

  return {
    pendingFactCount: review.pendingFactCount,
    pendingBehavioralCount: review.pendingBehavioralCount,
    message,
    memoriesHref: "/me/settings/memories",
  };
}

export async function getMatchesSnapshotForUserId(
  userId: string,
  supabase?: SupabaseServiceClient,
): Promise<MatchesSnapshot> {
  if (!hasServerSupabaseConfig()) {
    return emptySnapshot("unavailable", "Supabase is not configured.");
  }

  const client = supabase ?? createSupabaseServiceClient();

  try {
    const [edgeMap, enrichmentReview] = await Promise.all([
      loadViewerEdgeMap(client, userId),
      getProfileMatchingReviewState(client, userId),
    ]);
    const [apartments, roommates, requests] = await Promise.all([
      loadApartmentMatches(client, userId),
      loadRoommateMatches(client, userId, edgeMap),
      loadPendingRequests(client, userId, edgeMap),
    ]);

    return {
      status: "connected",
      detail: "Reading matches from Supabase.",
      enrichmentReview: buildEnrichmentReviewBanner(enrichmentReview),
      apartments,
      roommates,
      requests,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Supabase error";
    return emptySnapshot("error", `Matches query failed: ${message}`);
  }
}

export const getMatchesSnapshot = cache(async (): Promise<MatchesSnapshot> => {
  if (!hasServerSupabaseConfig()) {
    return emptySnapshot("unavailable", "Supabase is not configured.");
  }

  const { identity, user } = await ensureCurrentKinfolkUser();

  if (!identity) {
    return emptySnapshot("signed_out", "Sign in to load your matches.");
  }
  if (!user) {
    return emptySnapshot(
      "connected",
      "Supabase is connected but has no Kinfolk row for this user yet.",
    );
  }

  return getMatchesSnapshotForUserId(user.id, createSupabaseServiceClient());
});
