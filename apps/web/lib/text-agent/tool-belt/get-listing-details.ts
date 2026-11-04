import { parsePoiSummary } from "../../apartments/poi-summary";
import { formatListingDisplayAddress } from "../../apartments/listing-address";
import { buildListingShortlinkUrl } from "../../apartments/listing-shortlink";
import { readBoolean, readNumber, readString } from "./args";
import type { BuildingQualitySignals } from "../../apartments/area-signals";
import type { ListingRentContext } from "../rent-context";
import type {
  HousingAgentTool,
  HousingAgentToolContext,
  HousingAgentToolMedia,
} from "./types";
import type { TextThreadSentListingCard } from "../thread-data";
import type { SupabaseServiceClient, TableRow } from "../store-types";

const descriptionPreviewLength = 480;
const staleAfterDays = 3;
const listingRecordSelect =
  "id,address_line,unit,neighborhood,city,state,postal_code,bedrooms,bathrooms,monthly_rent,effective_monthly_rent,description,amenities,available_at,square_feet,no_fee,concession_months,concession_note,concession_lease_months,lease_terms,property_type,source_url,poi_summary,listing_status,last_seen_at,inactive_at,latitude,longitude";

type RecentRecommendationRow = Pick<
  TableRow<"text_listing_recommendations">,
  "card_snapshot" | "created_at" | "id" | "listing_id" | "outbound_idempotency_key" | "rank"
>;

type ListingCardSnapshot = {
  address: string | null;
  bathrooms: number | null;
  bedrooms: number | null;
  effectivePerPersonRent: number | null;
  effectiveRent: number | null;
  monthlyRent: number | null;
  neighborhood: string | null;
  perPersonRent: number | null;
  recommendedHouseholdSize: number | null;
  sourceUrl: string | null;
};

type ListingRecord = NonNullable<Awaited<ReturnType<typeof fetchListingRecord>>>;

// The outcome of pointing a get_listing_details call at a thread listing: a
// matched recommendation card, a directly-named address, or nothing resolvable.
type ListingResolution =
  | {
      source: "recommendation";
      listing: ListingRecord | null;
      snapshot: ListingCardSnapshot;
      recommendationId: string;
      media: HousingAgentToolMedia[];
    }
  | {
      source: "address";
      listing: ListingRecord;
      snapshot: ListingCardSnapshot;
      recommendationId: null;
      media: HousingAgentToolMedia[];
    }
  | { source: "none"; recentlyShown: string[] };

export const getListingDetailsTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Pull the full stored record for one listing already shown in this thread — description, amenities, availability date, square footage, fees and concessions, lease terms, property type, nearby spots, source link, and freshness. Use it for any follow-up question about a specific listing ('the second one', 'the Larkin St place', 'does it take dogs'). When the user questions the price itself ('is this overpriced?', 'is that a fair deal?', 'seems steep'), pass priceCheck: true so the answer can cite a third-party rent estimate. Answer only from what it returns: if a field comes back missing, the listing doesn't say.",
      name: "get_listing_details",
      parameters: {
        additionalProperties: false,
        properties: {
          address: {
            description:
              "Street address (or fragment of it) the user used to name the listing.",
            type: "string",
          },
          ordinal: {
            description:
              "1-based position in the most recently shown batch — 'the second one' is 2.",
            type: "number",
          },
          priceCheck: {
            description:
              "Set true only when the user is questioning or negotiating the price of this listing — 'is this overpriced?', 'fair price?', 'too expensive?'. Pulls a rate-limited third-party (RentCast) rent estimate, so leave it off for ordinary detail questions.",
            type: "boolean",
          },
          recommendationId: {
            description:
              "Kinfolk recommendationId from a prior search_listings result, if known.",
            type: "string",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const resolution = await resolveListing(context, args);
    if (resolution.source === "none") {
      const { recentlyShown } = resolution;
      return {
        data: { recentlyShown },
        ok: false,
        summary:
          recentlyShown.length > 0
            ? `Could not tell which listing they mean. Recently shown: ${recentlyShown.join("; ")}. Ask which one — by address or position — then call get_listing_details again.`
            : "No listings have been shown in this thread yet, so there is nothing to detail. Run search_listings first or ask what they're looking for.",
        toolName: "get_listing_details",
      };
    }

    const { listing, media, recommendationId, snapshot } = resolution;
    const address =
      listingRecordDisplayAddress(listing) ?? snapshot.address ?? "this listing";

    if (!listing) {
      return {
        data: {
          address,
          bathrooms: snapshot.bathrooms,
          bedrooms: snapshot.bedrooms,
          monthlyRent: snapshot.effectiveRent ?? snapshot.monthlyRent,
          neighborhood: snapshot.neighborhood,
          perPersonRent: snapshot.effectivePerPersonRent ?? snapshot.perPersonRent,
          recommendationId,
          sourceUrl: snapshot.sourceUrl,
        },
        media,
        ok: true,
        summary: `Kinfolk no longer has a live record for ${address} — it may have been taken down. Share only what the original card said, say you can't confirm anything beyond it, and ${snapshot.sourceUrl ? "point them at the source link to verify" : "offer fresh options instead"}.`,
        toolName: "get_listing_details",
      };
    }

    // Grounded context lookups: DataSF building signals (external, cached) and
    // rent comps (internal, upgraded to RentCast when the sample is thin or
    // the user questions price). Both degrade to null — they never fail the
    // tool.
    const priceCheck = readBoolean(args.priceCheck);
    const [rawBuildingSignals, rentContext] = await Promise.all([
      loadBuildingQualitySignals(listing.address_line),
      loadListingRentContext(context.supabase, listing, priceCheck, context.userId),
    ]);
    // Zero results stay silent: absence of reported complaints is not a clean
    // bill of health, so the model never sees zeros it could spin into a "no
    // complaints!" comfort claim.
    const buildingSignals = hasReportableBuildingSignals(rawBuildingSignals)
      ? rawBuildingSignals
      : null;

    const description = trimListingDescription(listing.description);
    const amenities = (listing.amenities ?? []).slice(0, 18);
    const petPolicy = findPolicySignal(
      /\b(?:pets?|dogs?|cats?)\b|pet[-\s]?friendly/iu,
      listing,
    );
    const parking = findPolicySignal(
      /\b(?:parking|garage|carport)\b/iu,
      listing,
    );
    const leaseTerms = listing.lease_terms ?? [];

    const notStated: string[] = [];
    if (!petPolicy) notStated.push("a pet policy");
    if (!parking) notStated.push("parking");
    if (listing.square_feet == null) notStated.push("square footage");
    if (!listing.available_at) notStated.push("an availability date");
    if (leaseTerms.length === 0) notStated.push("lease terms");

    const freshnessWarning = buildFreshnessWarning(listing);
    const kinfolkUrl = buildListingShortlinkUrl(
      process.env.NEXT_PUBLIC_KINFOLK_BASE_URL,
      listing.id,
    );
    const perPersonRent =
      snapshot.effectivePerPersonRent ?? snapshot.perPersonRent;
    const rent = listing.effective_monthly_rent ?? listing.monthly_rent;

    const headline: string[] = [];
    headline.push(
      listing.bedrooms == null
        ? "bedroom count unlisted"
        : listing.bedrooms === 0
          ? "studio"
          : `${listing.bedrooms} bed`,
    );
    if (listing.bathrooms != null) {
      headline.push(`${listing.bathrooms} bath`);
    }
    if (rent != null) {
      headline.push(`$${Math.round(rent).toLocaleString()}/mo`);
    }
    if (perPersonRent != null) {
      headline.push(
        `about $${Math.round(perPersonRent).toLocaleString()}/person${snapshot.recommendedHouseholdSize != null && snapshot.recommendedHouseholdSize > 1 ? ` split ${snapshot.recommendedHouseholdSize} ways` : ""}`,
      );
    }
    if (listing.available_at) {
      headline.push(`available ${listing.available_at.slice(0, 10)}`);
    }
    if (listing.square_feet != null) {
      headline.push(`${listing.square_feet.toLocaleString()} sq ft`);
    }
    if (listing.no_fee) {
      headline.push("no broker fee");
    }
    if (listing.concession_months > 0) {
      headline.push(
        `${listing.concession_months} month${listing.concession_months === 1 ? "" : "s"} free${listing.concession_lease_months > 0 ? ` on a ${listing.concession_lease_months}-month lease` : ""}`,
      );
    }

    const summaryParts: string[] = [
      `Stored details for ${address}: ${headline.join(", ")}.`,
    ];
    if (notStated.length > 0) {
      summaryParts.push(
        `The listing does not state ${formatNotStated(notStated)} — if they ask about any of those, say the listing doesn't specify it and point them at ${listing.source_url ? "the source link" : "the listing card"}; never guess or fill it in.`,
      );
    }
    const buildingGuidance = formatBuildingSignalsGuidance(buildingSignals);
    if (buildingGuidance) {
      summaryParts.push(buildingGuidance);
    }
    const rentContextGuidance = await formatRentContextGuidance(
      rentContext,
      listing.bedrooms,
    );
    if (rentContextGuidance) {
      summaryParts.push(rentContextGuidance);
    }
    if (freshnessWarning) {
      summaryParts.push(freshnessWarning);
    }
    if (kinfolkUrl) {
      summaryParts.push(
        `If they want the link to this place — or to open it on the Kinfolk map — send this Kinfolk link and nothing else: ${kinfolkUrl}. Never share the original listing site as the link, and do not re-send the card when they just want the link.`,
      );
    }

    return {
      data: {
        address,
        kinfolkUrl,
        amenities,
        availableAt: listing.available_at?.slice(0, 10) ?? null,
        bathrooms: listing.bathrooms,
        bedrooms: listing.bedrooms,
        buildingSignals,
        concession:
          listing.concession_months > 0
            ? {
                leaseMonths: listing.concession_lease_months || null,
                months: listing.concession_months,
                note: listing.concession_note,
              }
            : null,
        description,
        effectiveRent: listing.effective_monthly_rent,
        freshnessWarning,
        leaseTerms,
        monthlyRent: listing.monthly_rent,
        neighborhood: listing.neighborhood ?? snapshot.neighborhood,
        noFee: listing.no_fee,
        notStated,
        parking,
        perPersonRent,
        petPolicy,
        poiHighlights: buildPoiHighlights(listing.poi_summary),
        propertyType: listing.property_type,
        recommendationId,
        recommendedHouseholdSize: snapshot.recommendedHouseholdSize,
        rentContext,
        sourceUrl: listing.source_url,
        squareFeet: listing.square_feet,
      },
      media,
      ok: true,
      summary: summaryParts.join(" "),
      toolName: "get_listing_details",
    };
  },
};

async function resolveListing(
  context: HousingAgentToolContext,
  args: Record<string, unknown>,
): Promise<ListingResolution> {
  const addressArg = readString(args.address);
  const { ordered, rows } = await loadRecentRecommendations(context);
  const resolved = resolveReferencedRecommendation({
    address: addressArg,
    body: context.body ?? "",
    ordered,
    ordinal: readOrdinal(args.ordinal),
    recommendationId: readRecommendationIdArg(args.recommendationId),
    rows,
  });

  if (resolved) {
    const [{ buildListingCardUrl }, { getKinfolkPublicMediaBaseUrl }] =
      await Promise.all([
        import("../../apartments/listing-card"),
        import("../store-shared"),
      ]);
    const listing = await fetchListingRecord(context.supabase, resolved.listing_id);
    const snapshot = readCardSnapshot(resolved.card_snapshot);
    const baseUrl = getKinfolkPublicMediaBaseUrl();
    const media: HousingAgentToolMedia[] = baseUrl
      ? [
          {
            label:
              listingRecordDisplayAddress(listing) ??
              snapshot.address ??
              "this listing",
            url: buildListingCardUrl({ baseUrl, recommendationId: resolved.id }),
          },
        ]
      : [];
    return {
      listing,
      media,
      recommendationId: resolved.id,
      snapshot,
      source: "recommendation",
    };
  }

  if (addressArg) {
    const listing = await fetchListingRecordByAddress(context.supabase, addressArg);
    if (listing) {
      return {
        listing,
        media: [],
        recommendationId: null,
        snapshot: listingSnapshotFromRecord(listing),
        source: "address",
      };
    }
  }

  const recentlyShown = ordered.map(
    (row) => readCardSnapshot(row.card_snapshot).address ?? row.listing_id,
  );
  return { recentlyShown, source: "none" };
}

async function fetchListingRecord(
  supabase: SupabaseServiceClient,
  listingId: string,
) {
  const result = await supabase
    .from("apartment_listings")
    .select(listingRecordSelect)
    .eq("id", listingId)
    .maybeSingle();
  if (result.error) {
    throw result.error;
  }
  return result.data;
}

async function fetchListingRecordByAddress(
  supabase: SupabaseServiceClient,
  rawAddress: string,
): Promise<ListingRecord | null> {
  const address = stripUnitFromAddress(rawAddress);
  if (!address || address.length < 5) {
    return null;
  }
  const target = normalizeMatchText(address);
  const targetHouseNumber = leadingHouseNumber(address);
  // Anchor the house number at the DB when we have one ("8 Cypress St%" excludes
  // "18 Cypress St"), so digit-prefix collisions don't consume the fetch window;
  // otherwise fall back to a substring match. No status filter here — we prefer
  // active rows below but still resolve a taken-down listing (with a freshness
  // caveat) rather than dead-ending, matching the by-id path.
  const pattern = targetHouseNumber
    ? `${escapeIlikePattern(address)}%`
    : `%${escapeIlikePattern(address)}%`;
  const result = await supabase
    .from("apartment_listings")
    .select(listingRecordSelect)
    .ilike("address_line", pattern)
    .order("last_seen_at", { ascending: false })
    .limit(25);
  if (result.error) {
    throw result.error;
  }
  // Whole-word, house-number-anchored street match: "8 Main St" must NOT resolve
  // to "28 Main St" (a substring), and a bare "Larkin St" must NOT silently pick
  // one of several Larkin buildings.
  const streetMatches = (result.data ?? []).filter((candidate) => {
    const candidateAddress = normalizeMatchText(
      stripUnitFromAddress(candidate.address_line ?? ""),
    );
    if (!candidateAddress) return false;
    if (
      targetHouseNumber !== null &&
      leadingHouseNumber(candidate.address_line ?? "") !== targetHouseNumber
    ) {
      return false;
    }
    return (
      tokensContain(candidateAddress, target) ||
      tokensContain(target, candidateAddress)
    );
  });
  // Prefer active listings; only surface an inactive one when nothing active
  // matches, so a taken-down listing still resolves with its freshness caveat.
  const activeMatches = streetMatches.filter(
    (candidate) => candidate.listing_status === "active",
  );
  const pool = activeMatches.length > 0 ? activeMatches : streetMatches;
  if (pool.length === 1) {
    return pool[0];
  }
  // Several units of one building survive the street match. If the user named a
  // unit ("8 Cypress St Unit 8"), use it to pick the exact unit instead of
  // giving up as ambiguous.
  if (pool.length > 1) {
    const targetUnit = unitFromQuery(rawAddress);
    if (targetUnit) {
      const unitMatches = pool.filter(
        (candidate) => normalizeUnitToken(candidate.unit) === targetUnit,
      );
      if (unitMatches.length === 1) {
        return unitMatches[0];
      }
    }
  }
  return null;
}

function leadingHouseNumber(value: string): string | null {
  const match = value.trim().match(/^(\d{1,6})\b/u);
  return match ? match[1] : null;
}

// Whole-word phrase containment: ` haystack `.includes(` needle `) so "main st"
// matches "8 main st" but "ain st" never matches "main st".
function tokensContain(haystack: string, needle: string): boolean {
  return Boolean(needle && ` ${haystack} `.includes(` ${needle} `));
}

function stripUnitFromAddress(value: string) {
  // The unit keyword must be a whole word (\b on BOTH sides) so street names
  // that merely start with one — "Aptos", "Unity", "Unitarian", "Apartment" —
  // aren't mangled. "#" is its own alternative (\b never matches before a
  // non-word char), so "#1679" still strips like "Unit 1679" / "Apt 4".
  return value
    .replace(/(?:\b(?:unit|apt|apartment)\b|#)\s*[a-z0-9-]+\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

// The unit identifier the user named, if any: "8 Cypress St Unit 8" -> "8",
// "#8" -> "8", "Apt 4B" -> "4b". Null when there's no unit designator.
function unitFromQuery(rawAddress: string): string | null {
  const match = rawAddress.match(
    /(?:\b(?:unit|apt|apartment)\b|#)\s*([a-z0-9-]+)/iu,
  );
  return match ? match[1].toLowerCase() : null;
}

// Normalizes a stored unit value ("Unit 8", "#8", "Apt 4B", or a bare "8") to a
// comparable token for matching against unitFromQuery.
function normalizeUnitToken(unit: string | null): string | null {
  if (!unit) return null;
  const stripped = unit
    .replace(/^\s*(?:unit|apt|apartment|#|no\.?|number)\s*/iu, "")
    .trim();
  const token = stripped.toLowerCase().replace(/[^a-z0-9-]+/gu, "");
  return token || null;
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/gu, "\\$&");
}

// Adapts a fetched DB row (address_line / unit) onto the canonical display rule.
function listingRecordDisplayAddress(
  listing: { address_line: string | null; unit: string | null } | null,
): string | null {
  if (!listing) return null;
  return formatListingDisplayAddress(listing.address_line, listing.unit);
}

function listingSnapshotFromRecord(listing: ListingRecord): ListingCardSnapshot {
  return {
    address: listingRecordDisplayAddress(listing),
    bathrooms: readNumber(listing.bathrooms),
    bedrooms: readNumber(listing.bedrooms),
    effectivePerPersonRent: null,
    effectiveRent: readNumber(listing.effective_monthly_rent),
    monthlyRent: readNumber(listing.monthly_rent),
    neighborhood: readString(listing.neighborhood),
    perPersonRent: null,
    recommendedHouseholdSize: null,
    sourceUrl: readString(listing.source_url),
  };
}

// Loads what was recently texted in this thread: the persisted recommendation
// rows plus the agent-memory registry that fixes their spoken order.
async function loadRecentRecommendations(context: HousingAgentToolContext) {
  const { loadTextThreadAgentMemory } = await import("../thread-data");

  const recent = await context.supabase
    .from("text_listing_recommendations")
    .select("id,listing_id,rank,created_at,card_snapshot,outbound_idempotency_key")
    .eq("user_id", context.userId)
    .eq("thread_id", context.threadId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (recent.error) {
    throw recent.error;
  }
  const rows: RecentRecommendationRow[] = recent.data ?? [];

  let sentListingCards: TextThreadSentListingCard[] = [];
  try {
    const memory = await loadTextThreadAgentMemory(
      context.supabase,
      context.threadId,
      context.userId,
    );
    sentListingCards = memory.sentListingCards;
  } catch (error) {
    console.error("[get_listing_details] failed to read last sent cards", error);
  }

  return { ordered: orderRecentlyShown(rows, sentListingCards), rows };
}

export type ReferencedListingLocation = {
  address: string;
  lat: number | null;
  lng: number | null;
  listingId: string;
  neighborhood: string | null;
  recommendationId: string;
};

// Resolves "the second one" / an address fragment to the lat/lng of a listing
// already shown in this thread, for tools (like get_area_signals' commute
// topic) that need a listing as a geographic origin. Pass
// allowLoneRecentFallback: false when an unreferenced lone listing should NOT
// win over other context (e.g. the user named a neighborhood instead).
export async function resolveReferencedListingLocation(
  context: HousingAgentToolContext,
  {
    address = null,
    allowLoneRecentFallback = true,
    ordinal = null,
    recommendationId = null,
  }: {
    address?: string | null;
    allowLoneRecentFallback?: boolean;
    ordinal?: number | null;
    recommendationId?: string | null;
  } = {},
): Promise<{
  recentlyShown: string[];
  resolved: ReferencedListingLocation | null;
}> {
  const { ordered, rows } = await loadRecentRecommendations(context);
  const resolved = resolveReferencedRecommendation({
    address,
    allowLoneRecentFallback,
    body: context.body ?? "",
    ordered,
    ordinal,
    recommendationId,
    rows,
  });
  const recentlyShown = ordered.map(
    (row) => readCardSnapshot(row.card_snapshot).address ?? row.listing_id,
  );
  if (!resolved) {
    return { recentlyShown, resolved: null };
  }

  const snapshot = readCardSnapshot(resolved.card_snapshot);
  const listing = await fetchListingRecord(context.supabase, resolved.listing_id);

  return {
    recentlyShown,
    resolved: {
      address: listing?.address_line ?? snapshot.address ?? "this listing",
      lat: readNumber(listing?.latitude ?? null),
      lng: readNumber(listing?.longitude ?? null),
      listingId: resolved.listing_id,
      neighborhood: listing?.neighborhood ?? snapshot.neighborhood,
      recommendationId: resolved.id,
    },
  };
}

async function loadBuildingQualitySignals(
  addressLine: string | null | undefined,
): Promise<BuildingQualitySignals | null> {
  try {
    const { fetchBuildingQualitySignals } = await import(
      "../../apartments/area-signals"
    );
    return await fetchBuildingQualitySignals({ addressLine });
  } catch (error) {
    console.error("[get_listing_details] building signal lookup failed", error);
    return null;
  }
}

async function loadListingRentContext(
  supabase: SupabaseServiceClient,
  listing: {
    address_line: string | null;
    bathrooms: number | null;
    bedrooms: number | null;
    city: string | null;
    effective_monthly_rent: number | null;
    id: string;
    latitude: number | null;
    longitude: number | null;
    monthly_rent: number | null;
    neighborhood: string | null;
    postal_code: string | null;
    square_feet: number | null;
    state: string | null;
  },
  priceCheck: boolean,
  userId: string | null,
): Promise<ListingRentContext | null> {
  try {
    const { resolveListingRentContext } = await import("../rent-context");
    return await resolveListingRentContext(supabase, listing, {
      priceCheck,
      userId,
    });
  } catch (error) {
    console.error("[get_listing_details] rent context lookup failed", error);
    return null;
  }
}

function hasReportableBuildingSignals(
  signals: BuildingQualitySignals | null,
): signals is BuildingQualitySignals {
  if (!signals) {
    return false;
  }
  return (
    (signals.openComplaints.status === "ok" &&
      signals.openComplaints.count > 0) ||
    (signals.evictionNotices.status === "ok" &&
      signals.evictionNotices.noticeCount > 0)
  );
}

// Only nonzero, successfully fetched signals get a line — and always with the
// DataSF/DBI attribution so the agent quotes a source, not a vibe.
function formatBuildingSignalsGuidance(
  signals: BuildingQualitySignals | null,
) {
  if (!signals) {
    return null;
  }

  const lines: string[] = [];
  const complaints = signals.openComplaints;
  if (complaints.status === "ok" && complaints.count > 0) {
    const categories = complaints.categories
      .slice(0, 2)
      .map((category) => category.label)
      .filter((label) => label && label !== "Unknown")
      .join(", ");
    lines.push(
      `DBI shows ${complaints.count} open building complaint${complaints.count === 1 ? "" : "s"} for this building${categories ? ` (${categories})` : ""}${complaints.mostRecentDate ? `, most recent ${complaints.mostRecentDate}` : ""}`,
    );
  }
  const evictions = signals.evictionNotices;
  if (evictions.status === "ok" && evictions.noticeCount > 0) {
    lines.push(
      `DataSF shows ${evictions.noticeCount} eviction notice${evictions.noticeCount === 1 ? "" : "s"} filed on this block in the last ${evictions.windowMonths} months${evictions.mostRecentDate ? ` (most recent ${evictions.mostRecentDate})` : ""}`,
    );
  }
  if (lines.length === 0) {
    return null;
  }

  return `Building check worth mentioning: ${lines.join("; ")}. Share it plainly with that attribution — it's public record, not a verdict on the unit.`;
}

async function formatRentContextGuidance(
  rentContext: ListingRentContext | null,
  bedrooms: number | null,
) {
  if (!rentContext) {
    return null;
  }
  try {
    const { describeListingRentContext } = await import("../rent-context");
    const phrase = describeListingRentContext(rentContext, bedrooms);
    if (rentContext.source === "rentcast") {
      const range =
        rentContext.rentRangeLow != null && rentContext.rentRangeHigh != null
          ? `, range $${rentContext.rentRangeLow.toLocaleString()}–$${rentContext.rentRangeHigh.toLocaleString()}`
          : "";
      const comps =
        rentContext.compCount > 0
          ? ` from ${rentContext.compCount} comp${rentContext.compCount === 1 ? "" : "s"}`
          : "";
      return `Rent context: this one is ${phrase} (RentCast AVM estimate${range}${comps}). Share it with RentCast named as the source — "RentCast puts the going rate around $X" — never as Kinfolk's own market read.`;
    }
    return `Rent context: this one is ${phrase} (median $${rentContext.medianRent.toLocaleString()}/mo across ${rentContext.sampleSize} active listings) — fine to share phrased exactly like that.`;
  } catch (error) {
    console.error("[get_listing_details] rent context phrasing failed", error);
    return null;
  }
}

function orderRecentlyShown(
  rows: RecentRecommendationRow[],
  sentListingCards: TextThreadSentListingCard[],
) {
  // The loop's agent_memory registry (thread-data.ts, written via
  // saveTextThreadAgentMemory) is authoritative for what was actually texted
  // and in what order; fall back to the latest persisted recommendation batch
  // when it's empty (older threads, or memory not yet written this turn).
  if (sentListingCards.length > 0) {
    const ordered = [...sentListingCards]
      .sort((left, right) => left.ordinal - right.ordinal)
      .flatMap((card) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === card.recommendationId ||
            (card.listingId != null && candidate.listing_id === card.listingId),
        );
        return row ? [row] : [];
      });
    if (ordered.length > 0) {
      return dedupeRowsByListing(ordered);
    }
  }

  if (rows.length === 0) {
    return [];
  }
  const batchKey = recommendationBatchKey(rows[0]);
  const batch = rows.filter((row) => recommendationBatchKey(row) === batchKey);
  return dedupeRowsByListing(
    [...batch].sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0)),
  );
}

function recommendationBatchKey(row: RecentRecommendationRow) {
  const key = row.outbound_idempotency_key ?? "";
  const lastColon = key.lastIndexOf(":");
  return lastColon > 0 ? key.slice(0, lastColon) : row.created_at.slice(0, 16);
}

function dedupeRowsByListing(rows: RecentRecommendationRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.listing_id)) {
      return false;
    }
    seen.add(row.listing_id);
    return true;
  });
}

function resolveReferencedRecommendation({
  address,
  allowLoneRecentFallback = true,
  body,
  ordered,
  ordinal,
  recommendationId,
  rows,
}: {
  address: string | null;
  allowLoneRecentFallback?: boolean;
  body: string;
  ordered: RecentRecommendationRow[];
  ordinal: number | null;
  recommendationId: string | null;
  rows: RecentRecommendationRow[];
}) {
  if (recommendationId) {
    const row = rows.find(
      (candidate) =>
        candidate.id === recommendationId ||
        candidate.listing_id === recommendationId,
    );
    if (row) {
      return row;
    }
  }

  if (address) {
    const target = normalizeMatchText(address);
    if (target) {
      const row = [...ordered, ...rows].find((candidate) => {
        const candidateAddress = normalizeMatchText(
          readCardSnapshot(candidate.card_snapshot).address ?? "",
        );
        return (
          candidateAddress.length > 0 &&
          (candidateAddress.includes(target) || target.includes(candidateAddress))
        );
      });
      if (row) {
        return row;
      }
    }
  }

  const index = ordinal ?? inferOrdinalFromBody(body);
  if (index != null && ordered.length > 0) {
    if (index === -1) {
      return ordered[ordered.length - 1] ?? null;
    }
    return ordered[index - 1] ?? null;
  }

  return allowLoneRecentFallback && ordered.length === 1 ? ordered[0] : null;
}

function readOrdinal(value: unknown) {
  const parsed = readNumber(value);
  if (parsed == null || !Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    return null;
  }
  return parsed;
}

function readRecommendationIdArg(value: unknown) {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  return raw.match(/listing-card\/([^/?#\s]+)/u)?.[1] ?? raw;
}

const ordinalWordValues = [
  [/\b(?:first|1st)\b/u, 1],
  [/\b(?:second|2nd)\b/u, 2],
  [/\b(?:third|3rd)\b/u, 3],
  [/\b(?:fourth|4th)\b/u, 4],
  [/\b(?:fifth|5th)\b/u, 5],
] as const;

function inferOrdinalFromBody(body: string) {
  const normalized = body.toLowerCase();
  if (/\b(?:the\s+)?last\s+(?:one|listing|place|apartment)\b/u.test(normalized)) {
    return -1;
  }
  for (const [pattern, value] of ordinalWordValues) {
    if (pattern.test(normalized)) {
      return value;
    }
  }
  return null;
}

function readCardSnapshot(value: unknown): ListingCardSnapshot {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    address: readString(raw.address),
    bathrooms: readNumber(raw.bathrooms),
    bedrooms: readNumber(raw.bedrooms),
    effectivePerPersonRent: readNumber(raw.effectivePerPersonRent),
    effectiveRent: readNumber(raw.effectiveRent),
    monthlyRent: readNumber(raw.monthlyRent),
    neighborhood: readString(raw.neighborhood),
    perPersonRent: readNumber(raw.perPersonRent),
    recommendedHouseholdSize: readNumber(raw.recommendedHouseholdSize),
    sourceUrl: readString(raw.sourceUrl),
  };
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function trimListingDescription(value: string | null | undefined) {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) {
    return null;
  }
  if (text.length <= descriptionPreviewLength) {
    return text;
  }
  const cut = text.slice(0, descriptionPreviewLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > descriptionPreviewLength - 80 ? lastSpace : descriptionPreviewLength).trim()}…`;
}

function findPolicySignal(
  pattern: RegExp,
  listing: { amenities: string[] | null; description: string | null },
) {
  const amenityHits = (listing.amenities ?? []).filter((amenity) =>
    pattern.test(amenity),
  );
  if (amenityHits.length > 0) {
    return amenityHits.slice(0, 3).join("; ");
  }
  const sentence = (listing.description ?? "")
    .split(/(?<=[.!?])\s+/u)
    .find((candidate) => pattern.test(candidate));
  return sentence ? sentence.trim().slice(0, 160) : null;
}

function buildPoiHighlights(raw: unknown) {
  const summary = parsePoiSummary(raw as Parameters<typeof parsePoiSummary>[0]);
  if (!summary) {
    return [];
  }
  return [summary.transit, summary.grocery, summary.parks, summary.restaurant]
    .flatMap((group) =>
      (group ?? []).slice(0, 2).map((poi) =>
        Number.isFinite(poi.distance) && poi.distance > 0
          ? `${poi.name} (${poi.distance < 0.1 ? "<0.1" : poi.distance.toFixed(1)} mi)`
          : poi.name,
      ),
    )
    .slice(0, 6);
}

function buildFreshnessWarning(
  listing: {
    inactive_at: string | null;
    last_seen_at: string;
    listing_status: string;
  },
  now = new Date(),
) {
  if (listing.listing_status !== "active" || listing.inactive_at != null) {
    return "Heads-up: this listing has gone inactive since it was sent — it may already be taken. Say so and offer fresh options.";
  }
  const lastSeen = Date.parse(listing.last_seen_at);
  if (Number.isFinite(lastSeen)) {
    const days = Math.floor((now.getTime() - lastSeen) / 86_400_000);
    if (days >= staleAfterDays) {
      return `Heads-up: Kinfolk last confirmed this listing ${days} days ago — suggest they verify it's still up before getting attached.`;
    }
  }
  return null;
}

function formatNotStated(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} or ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}
