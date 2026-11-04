import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clampInteger } from "@/lib/shared/numbers";
import { parsePublicHttpsUrl } from "@/lib/shared/public-url";
import type { Database, Json } from "@/lib/supabase/types";

type ListingFeatureAssessmentStatus =
  | "explicit"
  | "likely"
  | "unclear"
  | "no";

type ListingFeatureEvidenceSource =
  | "amenity"
  | "detail_payload"
  | "listing_text"
  | "photo_vision";

export type ListingFeatureEvidence = {
  confidence: number;
  excerpt: string;
  featureKey: ListingFeatureKey;
  photoUrl?: string | null;
  source: ListingFeatureEvidenceSource;
  sourceColumn?: string | null;
  sourceJsonPath?: string | null;
  sourceTable?: string | null;
};

export type ListingFeatureAssessment = {
  confidence: number;
  evidence: ListingFeatureEvidence[];
  key: ListingFeatureKey;
  label: string;
  limitations: string[];
  status: ListingFeatureAssessmentStatus;
  summary: string;
};

export type ListingFeatureKey = "office_workspace";

export type ListingFeatureRequest = {
  key: ListingFeatureKey;
  label: string;
  query: string;
};

type ListingFeatureInput = {
  address?: string | null;
  amenities?: string[] | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  description?: string | null;
  id: string;
  provider_detail_payload?: Json | null;
  provider_payload_hash?: string | null;
  source_url?: string | null;
  square_feet?: number | null;
};

type PersistedEvidenceRow = {
  claim_key: string;
  claim_text: string;
  confidence: number;
  evidence_excerpt: string | null;
  listing_id: string | null;
  metadata: Json;
  source_column: string | null;
  source_json_path: string | null;
  source_table: string | null;
};

type Supabase = SupabaseClient<Database>;

const listingFeatureSourceVersion = "listing-feature-v1";

const featureDefinitions: Record<
  ListingFeatureKey,
  {
    label: string;
    negativePatterns: RegExp[];
    positivePatterns: Array<{
      confidence: number;
      pattern: RegExp;
    }>;
    queryPatterns: RegExp[];
    unclearSummary: string;
  }
> = {
  office_workspace: {
    label: "office/workspace fit",
    negativePatterns: [
      /\b(?:no|not|without)\s+(?:a\s+|an\s+)?(?:(?:dedicated|full|home|private|proper|separate)\s+){0,4}(?:office|den|desk|workspace|work\s*space)\b/iu,
    ],
    positivePatterns: [
      {
        confidence: 0.9,
        pattern:
          /\b(?:dedicated\s+(?:home\s+)?office|home\s+office|office\s+(?:space|nook|area)|private\s+office)\b/iu,
      },
      {
        confidence: 0.84,
        pattern: /\b(?:den|study|bonus\s+room|flex\s+room)\b/iu,
      },
      {
        confidence: 0.72,
        pattern:
          /\b(?:desk\s+(?:space|nook|area)|workstation|work[-\s]?from[-\s]?home|wfh)\b/iu,
      },
    ],
    queryPatterns: [
      /\b(?:office|home\s+office|den|study|desk|workspace|work\s*space|workstation|wfh|work[-\s]?from[-\s]?home)\b/iu,
      /\broom\s+for\s+(?:an?\s+)?(?:office|desk|work\s*space)\b/iu,
    ],
    unclearSummary:
      "No stored office, den, desk, or workspace evidence found for this listing.",
  },
};

export function inferListingFeatureRequestsFromTerms(
  terms: string[],
): ListingFeatureRequest[] {
  const requests: ListingFeatureRequest[] = [];
  for (const term of terms) {
    const request = inferListingFeatureRequest(term);
    if (request && !requests.some((existing) => existing.key === request.key)) {
      requests.push(request);
    }
  }
  return requests;
}

function inferListingFeatureRequest(
  value: string | null | undefined,
): ListingFeatureRequest | null {
  const query = value?.trim() ?? "";
  if (!query) return null;

  for (const [key, definition] of Object.entries(featureDefinitions) as Array<
    [ListingFeatureKey, (typeof featureDefinitions)[ListingFeatureKey]]
  >) {
    if (
      normalizeFeatureText(query) === normalizeFeatureText(definition.label) ||
      normalizeFeatureText(query) === normalizeFeatureText(key) ||
      definition.queryPatterns.some((pattern) => pattern.test(query))
    ) {
      return { key, label: definition.label, query };
    }
  }

  return null;
}

export function isSoftListingFeatureTerm(term: string) {
  return Boolean(inferListingFeatureRequest(term));
}

export async function loadListingFeatureAssessmentsForCards(
  supabase: Supabase,
  {
    cards,
    requestedTerms,
  }: {
    cards: ListingFeatureInput[];
    requestedTerms: string[];
  },
): Promise<Map<string, ListingFeatureAssessment[]>> {
  const requests = inferListingFeatureRequestsFromTerms(requestedTerms);
  const listingIds = cards.map((card) => card.id).filter(Boolean);
  const result = new Map<string, ListingFeatureAssessment[]>();
  if (requests.length === 0 || listingIds.length === 0) {
    return result;
  }

  const [listingRows, evidenceRows] = await Promise.all([
    fetchListingFeatureRows(supabase, listingIds),
    fetchPersistedFeatureEvidence(
      supabase,
      listingIds,
      requests.map((request) => request.key),
    ),
  ]);
  const listingById = new Map(listingRows.map((row) => [row.id, row]));
  const persistedByListingAndFeature = groupPersistedEvidence(evidenceRows);

  for (const card of cards) {
    const listing = listingById.get(card.id) ?? card;
    const assessments = requests.map((request) =>
      assessListingFeature({
        listing,
        persistedEvidence:
          persistedByListingAndFeature.get(`${card.id}:${request.key}`) ?? [],
        request,
      }),
    );
    result.set(card.id, assessments);
  }

  return result;
}

export function sortCardsByFeatureAssessments<T extends { fitScore: number; id: string }>(
  cards: T[],
  assessmentsByListingId: Map<string, ListingFeatureAssessment[]>,
) {
  return [...cards].sort((left, right) => {
    const leftScore = featureAssessmentSortScore(
      assessmentsByListingId.get(left.id) ?? [],
    );
    const rightScore = featureAssessmentSortScore(
      assessmentsByListingId.get(right.id) ?? [],
    );
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return right.fitScore - left.fitScore;
  });
}

export function formatFeatureAssessmentGuidance(
  assessmentsByListingId: Map<string, ListingFeatureAssessment[]>,
) {
  const assessments = [...assessmentsByListingId.values()].flat();
  if (assessments.length === 0) return null;

  const supportedCount = assessments.filter((assessment) =>
    assessment.status === "explicit" || assessment.status === "likely",
  ).length;
  const unsupportedCount = assessments.filter(
    (assessment) => assessment.status === "no",
  ).length;
  const unclearCount = assessments.filter(
    (assessment) => assessment.status === "unclear",
  ).length;

  return [
    `Feature evidence included for ${assessments.length} listing checks (${supportedCount} supported, ${unsupportedCount} unsupported, ${unclearCount} unclear).`,
    "Only call a listing office/workspace-friendly when featureAssessments.status is explicit or likely; if status is no, say the evidence argues against it; if it is unclear, say the listing does not confirm it and offer to inspect photos/floor plans.",
  ].join(" ");
}

export function listingFeatureSourceVersionForTests() {
  return listingFeatureSourceVersion;
}

export async function backfillListingFeatureEvidence(
  supabase: Supabase,
  {
    dryRun = false,
    force = false,
    includeVision = false,
    limit = 50,
    listingId = null,
    maxPhotosPerListing = 3,
  }: {
    dryRun?: boolean;
    force?: boolean;
    includeVision?: boolean;
    limit?: number;
    listingId?: string | null;
    maxPhotosPerListing?: number;
  } = {},
) {
  const safeLimit = clampInteger(limit, 50, 1, 500);
  const safeMaxPhotosPerListing = clampInteger(maxPhotosPerListing, 3, 1, 8);
  const listings = await fetchListingsForFeatureBackfill(supabase, {
    limit: safeLimit,
    listingId,
  });
  const featureKeys = Object.keys(featureDefinitions) as ListingFeatureKey[];
  let evidenceCandidates = 0;
  let evidenceInserted = 0;
  let listingsSkipped = 0;
  let visionPhotosChecked = 0;

  for (const listing of listings) {
    const textEvidence = featureKeys.flatMap((key) =>
      extractTextEvidence(listing, key).filter(
        (evidence) => !evidence.excerpt.toLowerCase().startsWith("no clear"),
      ),
    );
    evidenceCandidates += textEvidence.length;

    if (dryRun) {
      continue;
    }

    const vision = includeVision
      ? await loadVisionEvidenceForListing(supabase, {
          featureKeys,
          listing,
          maxPhotosPerListing: safeMaxPhotosPerListing,
        })
      : { evidence: [], photosChecked: 0 };
    visionPhotosChecked += vision.photosChecked;

    const document = await upsertListingFeatureDocument(supabase, listing, {
      force,
      skipWhenUnchanged: !includeVision,
    });
    if (document.skipped) {
      listingsSkipped += 1;
      continue;
    }

    const evidence = [...textEvidence, ...vision.evidence];
    evidenceCandidates += vision.evidence.length;
    const existingEvidenceIds = await fetchListingFeatureEvidenceIds(
      supabase,
      document.id,
      featureKeys,
    );

    if (evidence.length === 0) {
      await deleteListingFeatureEvidenceByIds(supabase, existingEvidenceIds);
      continue;
    }

    const insertResult = await supabase.from("agent_context_evidence").insert(
      evidence.map((item) => ({
        claim_key: item.featureKey,
        claim_text: item.excerpt,
        confidence: item.confidence,
        document_id: document.id,
        evidence_excerpt: item.excerpt,
        external_source: "kinfolk",
        listing_id: listing.id,
        matching_eligible: true,
        metadata: {
          featureKey: item.featureKey,
          listingId: listing.id,
          photoUrl: item.photoUrl ?? null,
          source: item.source,
          sourceVersion: listingFeatureSourceVersion,
        } satisfies Json,
        provider_payload_hash: listing.provider_payload_hash,
        sensitivity_level: "standard",
        source_column: item.sourceColumn,
        source_json_path: item.sourceJsonPath,
        source_pk: listing.id,
        source_table: item.sourceTable ?? "apartment_listings",
        source_url: listing.source_url,
      })),
    );
    if (insertResult.error) throw insertResult.error;
    await deleteListingFeatureEvidenceByIds(supabase, existingEvidenceIds);
    evidenceInserted += evidence.length;
  }

  return {
    dryRun,
    evidenceCandidates,
    evidenceInserted,
    force,
    includeVision,
    listingsScanned: listings.length,
    listingsSkipped,
    sourceVersion: listingFeatureSourceVersion,
    visionPhotosChecked,
  };
}

async function fetchListingFeatureRows(supabase: Supabase, listingIds: string[]) {
  const result = await supabase
    .from("apartment_listings")
    .select(
      "id,address_line,bedrooms,bathrooms,square_feet,description,amenities,provider_detail_payload,provider_payload_hash,source_url",
    )
    .in("id", listingIds);

  if (result.error) throw result.error;

  return (result.data ?? []).map((row) => ({
    address: row.address_line,
    amenities: row.amenities,
    bathrooms: row.bathrooms,
    bedrooms: row.bedrooms,
    description: row.description,
    id: row.id,
    provider_detail_payload: row.provider_detail_payload,
    provider_payload_hash: row.provider_payload_hash,
    source_url: row.source_url,
    square_feet: row.square_feet,
  }));
}

async function fetchPersistedFeatureEvidence(
  supabase: Supabase,
  listingIds: string[],
  featureKeys: ListingFeatureKey[],
): Promise<PersistedEvidenceRow[]> {
  const result = await supabase
    .from("agent_context_evidence")
    .select(
      "claim_key,claim_text,confidence,evidence_excerpt,listing_id,metadata,source_column,source_json_path,source_table",
    )
    .in("listing_id", listingIds)
    .in("claim_key", featureKeys)
    .eq("matching_eligible", true)
    .eq("sensitivity_level", "standard")
    .order("confidence", { ascending: false });

  if (result.error) throw result.error;

  return ((result.data ?? []) as PersistedEvidenceRow[]).filter((row) => {
    const metadata = readMetadataRecord(row.metadata);
    return readString(metadata.sourceVersion) === listingFeatureSourceVersion;
  });
}

function groupPersistedEvidence(rows: PersistedEvidenceRow[]) {
  const grouped = new Map<string, PersistedEvidenceRow[]>();
  for (const row of rows) {
    const metadata = readMetadataRecord(row.metadata);
    const listingId = row.listing_id ?? readString(metadata.listingId);
    if (!listingId) continue;
    const key = `${listingId}:${row.claim_key}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

async function fetchListingsForFeatureBackfill(
  supabase: Supabase,
  {
    limit,
    listingId,
  }: {
    limit: number;
    listingId: string | null;
  },
): Promise<ListingFeatureInput[]> {
  let query = supabase
    .from("apartment_listings")
    .select(
      "id,address_line,bedrooms,bathrooms,square_feet,description,amenities,provider_detail_payload,provider_payload_hash,source_url,listing_status,last_seen_at",
    )
    .eq("listing_status", "active")
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (listingId) {
    query = query.eq("id", listingId);
  }

  const result = await query;
  if (result.error) throw result.error;

  return (result.data ?? []).map((row) => ({
    address: row.address_line,
    amenities: row.amenities,
    bathrooms: row.bathrooms,
    bedrooms: row.bedrooms,
    description: row.description,
    id: row.id,
    provider_detail_payload: row.provider_detail_payload,
    provider_payload_hash: row.provider_payload_hash,
    source_url: row.source_url,
    square_feet: row.square_feet,
  }));
}

async function upsertListingFeatureDocument(
  supabase: Supabase,
  listing: ListingFeatureInput,
  {
    force,
    skipWhenUnchanged,
  }: {
    force: boolean;
    skipWhenUnchanged: boolean;
  },
) {
  const body = [
    listing.description,
    ...(listing.amenities ?? []),
    JSON.stringify(listing.provider_detail_payload ?? {}),
  ]
    .filter(Boolean)
    .join("\n");
  const contentHash = createHash("sha256")
    .update(`${listingFeatureSourceVersion}:${listing.id}:${body}`)
    .digest("hex");

  const existing = await supabase
    .from("agent_context_documents")
    .select("id,content_hash")
    .eq("entity_type", "apartment_listing")
    .eq("entity_id", listing.id)
    .eq("source_version", listingFeatureSourceVersion)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (
    existing.data?.id &&
    !force &&
    skipWhenUnchanged &&
    existing.data.content_hash === contentHash
  ) {
    return { id: existing.data.id, skipped: true };
  }

  const payload = {
    body,
    content_hash: contentHash,
    entity_id: listing.id,
    entity_type: "apartment_listing",
    listing_id: listing.id,
    metadata: {
      source: "listing_feature_assessment",
      sourceVersion: listingFeatureSourceVersion,
    } satisfies Json,
    source_updated_at: new Date().toISOString(),
    source_version: listingFeatureSourceVersion,
    status: "active",
    summary: `Feature evidence for ${listing.address ?? "apartment listing"}.`,
    title: listing.address ?? "Apartment listing feature evidence",
    visibility_scope: "service_only",
  };

  if (existing.data?.id) {
    const update = await supabase
      .from("agent_context_documents")
      .update(payload)
      .eq("id", existing.data.id)
      .select("id")
      .single();
    if (update.error) throw update.error;
    return { id: update.data.id, skipped: false };
  }

  const insert = await supabase
    .from("agent_context_documents")
    .insert(payload)
    .select("id")
    .single();
  if (insert.error) throw insert.error;
  return { id: insert.data.id, skipped: false };
}

async function loadVisionEvidenceForListing(
  supabase: Supabase,
  {
    featureKeys,
    listing,
    maxPhotosPerListing,
  }: {
    featureKeys: ListingFeatureKey[];
    listing: ListingFeatureInput;
    maxPhotosPerListing: number;
  },
): Promise<{ evidence: ListingFeatureEvidence[]; photosChecked: number }> {
  if (!readString(process.env.OPENROUTER_API_KEY)) {
    return { evidence: [], photosChecked: 0 };
  }
  const photos = await fetchListingPhotos(supabase, listing.id, maxPhotosPerListing);
  const evidence: ListingFeatureEvidence[] = [];
  let photosChecked = 0;
  for (const photo of photos) {
    const photoUrl = normalizeListingVisionPhotoUrl(photo.url);
    if (!photoUrl) continue;
    photosChecked += 1;
    evidence.push(
      ...(await analyzeListingPhotoForFeatureEvidence({
        featureKeys,
        listing,
        photoUrl,
      })),
    );
  }
  return { evidence, photosChecked };
}

async function fetchListingPhotos(
  supabase: Supabase,
  listingId: string,
  limit: number,
) {
  const result = await supabase
    .from("apartment_listing_photos")
    .select("url,position")
    .eq("listing_id", listingId)
    .order("position", { ascending: true })
    .limit(limit);
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function fetchListingFeatureEvidenceIds(
  supabase: Supabase,
  documentId: string,
  featureKeys: ListingFeatureKey[],
) {
  const result = await supabase
    .from("agent_context_evidence")
    .select("id")
    .eq("document_id", documentId)
    .in("claim_key", featureKeys);
  if (result.error) throw result.error;
  return (result.data ?? []).map((row) => row.id);
}

async function deleteListingFeatureEvidenceByIds(
  supabase: Supabase,
  evidenceIds: string[],
) {
  if (evidenceIds.length === 0) return;
  const result = await supabase
    .from("agent_context_evidence")
    .delete()
    .in("id", evidenceIds);
  if (result.error) throw result.error;
}

async function analyzeListingPhotoForFeatureEvidence({
  featureKeys,
  listing,
  photoUrl,
}: {
  featureKeys: ListingFeatureKey[];
  listing: ListingFeatureInput;
  photoUrl: string;
}): Promise<ListingFeatureEvidence[]> {
  const { fetchOpenRouterJson, normalizeOpenRouterModelId, openRouterBaseUrl } =
    await import("@/lib/integrations/openrouter-client");
  const model = normalizeOpenRouterModelId(
    readString(process.env.KINFOLK_LISTING_FEATURE_VISION_MODEL) ??
      "google/gemini-2.5-flash-lite",
  );
  const featureLabels = featureKeys
    .map((key) => `${key}: ${featureDefinitions[key].label}`)
    .join(", ");
  const response = await fetchOpenRouterJson<{
    evidence?: Array<{
      confidence?: unknown;
      excerpt?: unknown;
      featureKey?: unknown;
      status?: unknown;
    }>;
  }>({
    body: {
      max_tokens: 500,
      messages: [
        {
          content:
            "You inspect real apartment listing photos for grounded feature evidence. Return JSON only. Do not infer beyond visible evidence.",
          role: "system",
        },
        {
          content: [
            {
              text: `Listing: ${listing.address ?? listing.id}. Check these features: ${featureLabels}. Return {\"evidence\":[{\"featureKey\":\"office_workspace\",\"status\":\"explicit|likely|unclear|no\",\"confidence\":0-1,\"excerpt\":\"short visual evidence\"}]}. Use explicit only for a visible dedicated office/den/study; likely for visible desk nook or clearly desk-sized alcove; unclear when the photo does not show enough.`,
              type: "text",
            },
            { image_url: { url: photoUrl }, type: "image_url" },
          ],
          role: "user",
        },
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0.1,
    },
    operation: "listing feature vision",
    timeoutMs: 20_000,
    url: `${openRouterBaseUrl}/chat/completions`,
  });

  return (response.data.evidence ?? []).flatMap((entry) => {
    const featureKey = readString(entry.featureKey) as ListingFeatureKey | null;
    if (!featureKey || !featureKeys.includes(featureKey)) return [];
    const status = readString(entry.status);
    if (status !== "explicit" && status !== "likely") return [];
    const excerpt = readString(entry.excerpt);
    if (!excerpt) return [];
    return [
      {
        confidence: clampConfidence(Number(entry.confidence ?? 0.55)),
        excerpt,
        featureKey,
        photoUrl,
        source: "photo_vision",
        sourceColumn: "url",
        sourceJsonPath: null,
        sourceTable: "apartment_listing_photos",
      } satisfies ListingFeatureEvidence,
    ];
  });
}

function assessListingFeature({
  listing,
  persistedEvidence,
  request,
}: {
  listing: ListingFeatureInput;
  persistedEvidence: PersistedEvidenceRow[];
  request: ListingFeatureRequest;
}): ListingFeatureAssessment {
  const definition = featureDefinitions[request.key];
  const extractedEvidence = [
    ...extractPersistedEvidence(persistedEvidence),
    ...extractTextEvidence(listing, request.key),
  ].sort((left, right) => right.confidence - left.confidence);
  const negative = extractedEvidence.find((evidence) =>
    evidence.excerpt.toLowerCase().startsWith("no clear"),
  );
  const positive = extractedEvidence.find(
    (evidence) => !evidence.excerpt.toLowerCase().startsWith("no clear"),
  );

  if (positive) {
    const status = positive.confidence >= 0.8 ? "explicit" : "likely";
    return {
      confidence: clampConfidence(positive.confidence),
      evidence: extractedEvidence.slice(0, 3),
      key: request.key,
      label: definition.label,
      limitations:
        status === "likely"
          ? ["This is a suitability signal, not a confirmed dedicated office."]
          : [],
      status,
      summary:
        status === "explicit"
          ? `Listing evidence explicitly supports ${definition.label}: "${positive.excerpt}".`
          : `Listing evidence suggests ${definition.label}: "${positive.excerpt}".`,
    };
  }

  if (negative) {
    return {
      confidence: clampConfidence(negative.confidence),
      evidence: [negative],
      key: request.key,
      label: definition.label,
      limitations: [],
      status: "no",
      summary: `Listing evidence argues against ${definition.label}: "${negative.excerpt}".`,
    };
  }

  return {
    confidence: 0.15,
    evidence: [],
    key: request.key,
    label: definition.label,
    limitations: [
      "The stored listing text, amenities, detail payload, and persisted photo evidence do not confirm this feature.",
    ],
    status: "unclear",
    summary: definition.unclearSummary,
  };
}

function extractPersistedEvidence(rows: PersistedEvidenceRow[]) {
  return rows.flatMap<ListingFeatureEvidence>((row) => {
    const metadata = readMetadataRecord(row.metadata);
    const source = readEvidenceSource(metadata.source) ?? "photo_vision";
    const excerpt =
      row.evidence_excerpt?.trim() || row.claim_text.trim() || "Persisted listing feature evidence.";
    if (!excerpt) return [];
    return [
      {
        confidence: clampConfidence(row.confidence),
        excerpt,
        featureKey: row.claim_key as ListingFeatureKey,
        photoUrl: readString(metadata.photoUrl),
        source,
        sourceColumn: row.source_column,
        sourceJsonPath: row.source_json_path,
        sourceTable: row.source_table,
      },
    ];
  });
}

function extractTextEvidence(
  listing: ListingFeatureInput,
  key: ListingFeatureKey,
): ListingFeatureEvidence[] {
  const definition = featureDefinitions[key];
  const sources = listingTextSources(listing);
  const evidence: ListingFeatureEvidence[] = [];

  for (const source of sources) {
    let sourceHasNegativeEvidence = false;
    for (const pattern of definition.negativePatterns) {
      const match = source.text.match(pattern);
      if (match?.index != null) {
        sourceHasNegativeEvidence = true;
        evidence.push({
          confidence: 0.88,
          excerpt: `No clear ${definition.label}: ${excerptAround(source.text, match.index)}`,
          featureKey: key,
          source: source.source,
          sourceColumn: source.column,
          sourceJsonPath: source.path,
          sourceTable: "apartment_listings",
        });
      }
    }
    if (sourceHasNegativeEvidence) continue;

    for (const candidate of definition.positivePatterns) {
      const match = source.text.match(candidate.pattern);
      if (match?.index == null) continue;
      evidence.push({
        confidence: candidate.confidence,
        excerpt: excerptAround(source.text, match.index),
        featureKey: key,
        source: source.source,
        sourceColumn: source.column,
        sourceJsonPath: source.path,
        sourceTable: "apartment_listings",
      });
    }
  }

  return dedupeEvidence(evidence);
}

function listingTextSources(listing: ListingFeatureInput) {
  const sources: Array<{
    column: string;
    path: string | null;
    source: ListingFeatureEvidenceSource;
    text: string;
  }> = [];

  if (listing.description?.trim()) {
    sources.push({
      column: "description",
      path: null,
      source: "listing_text",
      text: listing.description,
    });
  }

  for (const [index, amenity] of (listing.amenities ?? []).entries()) {
    if (!amenity?.trim()) continue;
    sources.push({
      column: "amenities",
      path: `$[${index}]`,
      source: "amenity",
      text: amenity,
    });
  }

  collectJsonTextSources(listing.provider_detail_payload, "$").forEach((source) =>
    sources.push({
      column: "provider_detail_payload",
      path: source.path,
      source: "detail_payload",
      text: source.text,
    }),
  );

  return sources;
}

function collectJsonTextSources(
  value: Json | undefined,
  path: string,
  output: Array<{ path: string; text: string }> = [],
) {
  if (typeof value === "string") {
    if (value.trim()) output.push({ path, text: value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectJsonTextSources(item, `${path}[${index}]`, output),
    );
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectJsonTextSources(child, `${path}.${key}`, output);
    }
  }
  return output;
}

function featureAssessmentSortScore(assessments: ListingFeatureAssessment[]) {
  return assessments.reduce((score, assessment) => {
    const statusScore =
      assessment.status === "explicit"
        ? 100
        : assessment.status === "likely"
          ? 70
          : assessment.status === "unclear"
            ? 5
            : -20;
    return score + statusScore + assessment.confidence;
  }, 0);
}

function excerptAround(text: string, index: number) {
  return text
    .slice(Math.max(0, index - 72), index + 132)
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeFeatureText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

function readMetadataRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeListingVisionPhotoUrl(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;

  return parsePublicHttpsUrl(raw)?.toString() ?? null;
}

function readEvidenceSource(value: unknown): ListingFeatureEvidenceSource | null {
  return value === "amenity" ||
    value === "detail_payload" ||
    value === "listing_text" ||
    value === "photo_vision"
    ? value
    : null;
}

function dedupeEvidence(evidence: ListingFeatureEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.source}:${item.excerpt.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
