import "server-only";

import { cache } from "react";
import { parseEvidencePoints } from "@/lib/shared/evidence";
import { chunks } from "@/lib/shared/arrays";
import {
  attachPersistedRoommateGroupsToEnriched,
  bestPersistedFormingGroupFitScore,
  buildPersistedFormingGroupsForListing,
  topReasonLabels,
  type PersistedCompatibilityEdge,
  type PersistedRoommateFact,
  type PersistedRoommateGroupContext,
  type PersistedRoommateGroupMembershipRow,
  type PersistedRoommateGroupRow,
  type PersistedRoommateProfile,
} from "@/lib/apartments/persisted-roommate-groups";
import {
  cheapestFloorPlanEffectiveMonthlyRent,
  cheapestFloorPlanMonthlyRent,
  displayFloorPlans,
  floorPlanBedroomRange,
} from "@/lib/apartments/floor-plan-pricing";
import {
  canSplitByRoommates,
  clampRoommateSplitSize,
  householdSizeLimitFromBedrooms,
  roommateSplitLimitFromBedrooms,
} from "@/lib/apartments/roommate-splits";
import { apartmentListingSurfaceFitScore } from "@/lib/apartments/match-surface";
import { calculateEffectiveMonthlyRent } from "@/lib/apartments/rent";
import { VISIBLE_APARTMENT_MATCH_STATUSES } from "@/lib/matching/match-status";
import { ensureCompatibilityEdgesForPairs } from "@/lib/profiles/enrichment-store";
import { brandNameMatches } from "@/lib/orgs/org-logo";
import { parseFirstCredential } from "@/lib/profiles/enrichment-credentials";
import { loadPublicVisibilityByUserId } from "@/lib/profiles/visibility";
import { clampInteger } from "@/lib/shared/numbers";
import { hasServerSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { parsePoiSummary } from "@/lib/apartments/poi-summary";
import type {
  ApartmentListing,
  ApartmentSearchSnapshot,
  EnrichedDetail,
  FloorPlanGroup,
  FloorPlanType,
  FloorPlanUnit,
  LeasingHour,
  ListingAgent,
  ParkingOption,
  PetPolicy,
  VideoTour,
} from "@/lib/apartments/types";
import { toListingSummary } from "./listing-summary";

type ListingRow = Database["public"]["Tables"]["apartment_listings"]["Row"];
type MatchRow =
  Database["public"]["Tables"]["apartment_listing_matches"]["Row"];
type PhotoRow = Database["public"]["Tables"]["apartment_listing_photos"]["Row"];
type UnitRow = Database["public"]["Tables"]["apartment_listing_units"]["Row"];
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];
type UserProfileRow = Pick<
  TableRow<"kinfolk_users">,
  | "id"
  | "display_name"
  | "about_text"
  | "interests"
  | "occupation_title"
  | "occupation_company"
  | "occupation_company_logo_url"
  | "education_school"
  | "education_school_logo_url"
  | "education_degree"
  | "education_major"
  | "education_year"
>;
type UserPhotoRow = Pick<
  TableRow<"kinfolk_user_photos">,
  "user_id" | "public_url"
>;
type RoommateFactRow = Pick<
  TableRow<"profile_facts">,
  | "user_id"
  | "dimension"
  | "fact_key"
  | "value_json"
  | "normalized_value"
  | "confidence"
  | "importance"
>;
type CompatibilityEdgeRow = Pick<
  TableRow<"compatibility_edges">,
  "user_a_id" | "user_b_id" | "score" | "evidence"
>;
type ProfessionalCredentialRow = Pick<
  TableRow<"professional_profiles">,
  "user_id" | "experiences" | "education" | "updated_at"
>;
type ListingMapRow = Pick<
  ListingRow,
  | "id"
  | "external_source"
  | "source_url"
  | "listing_status"
  | "provider_market"
  | "address_line"
  | "unit"
  | "city"
  | "state"
  | "postal_code"
  | "neighborhood"
  | "latitude"
  | "longitude"
  | "monthly_rent"
  | "rent_min"
  | "rent_max"
  | "bedrooms"
  | "bedrooms_min"
  | "bedrooms_max"
  | "bathrooms"
  | "bathrooms_min"
  | "bathrooms_max"
  | "square_feet"
  | "available_at"
  | "description"
  | "amenities"
  | "lease_terms"
  | "no_fee"
  | "concession_months"
  | "concession_lease_months"
  | "concession_note"
  | "effective_monthly_rent"
  | "first_seen_at"
  | "last_seen_at"
> &
  Partial<
    Pick<
      ListingRow,
      | "provider_detail_payload"
      | "contact_name"
      | "contact_phone"
      | "contact_email"
      | "poi_summary"
    >
  >;

const defaultApartmentListingLimit = 1000;
const defaultApartmentListingMarket = "san-francisco-ca";
const relatedListingChunkSize = 100;
const relatedRowsPageSize = 1000;
const listingSummarySelectFields = [
  "id",
  "external_source",
  "source_url",
  "listing_status",
  "provider_market",
  "address_line",
  "unit",
  "city",
  "state",
  "postal_code",
  "neighborhood",
  "latitude",
  "longitude",
  "monthly_rent",
  "rent_min",
  "rent_max",
  "bedrooms",
  "bedrooms_min",
  "bedrooms_max",
  "bathrooms",
  "bathrooms_min",
  "bathrooms_max",
  "square_feet",
  "available_at",
  "description",
  "amenities",
  "lease_terms",
  "no_fee",
  "concession_months",
  "concession_lease_months",
  "concession_note",
  "effective_monthly_rent",
  "first_seen_at",
  "last_seen_at",
];
const listingSummarySelect = listingSummarySelectFields.join(",");
const listingDetailSelect = [
  ...listingSummarySelectFields,
  "provider_detail_payload",
  "contact_name",
  "contact_phone",
  "contact_email",
  "poi_summary",
].join(",");

const emptyActiveProfile = {
  budgetMin: 0,
  budgetMax: 0,
  dealbreakers: [] as string[],
  householdSizeMin: 0,
  householdSizeMax: 0,
  moveInEnd: "",
  moveInStart: "",
  mustHaves: [] as string[],
  neighborhoods: [] as string[],
  pets: "",
};

function apartmentSearchListingLimit() {
  const rawValue = process.env.KINFOLK_APARTMENT_LISTING_LIMIT?.trim();
  if (!rawValue) {
    return defaultApartmentListingLimit;
  }

  return clampInteger(
    rawValue,
    defaultApartmentListingLimit,
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

function apartmentSearchMarket() {
  return (
    process.env.KINFOLK_APARTMENT_MARKET?.trim() ||
    defaultApartmentListingMarket
  );
}

function marketLabel(market: string) {
  if (market === "san-francisco-ca") return "San Francisco";
  return market
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function splits(value: Json): { name: string; amount: number }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const name =
      typeof item.name === "string"
        ? item.name
        : typeof item.label === "string"
          ? item.label
          : null;
    return name != null && typeof item.amount === "number"
      ? [{ name, amount: item.amount }]
      : [];
  });
}

function equalSplitBreakdown(
  totalRent: number | null,
  householdSize: number,
): { name: string; amount: number }[] {
  const total = positiveNumber(totalRent);
  if (total == null) return [];

  const normalizedHouseholdSize = Math.max(1, Math.round(householdSize));
  const roundedTotal = Math.round(total);
  const baseAmount = Math.floor(roundedTotal / normalizedHouseholdSize);
  const remainder = roundedTotal - baseAmount * normalizedHouseholdSize;

  return Array.from({ length: normalizedHouseholdSize }, (_, index) => ({
    name: `Roommate ${index + 1}`,
    amount: baseAmount + (index < remainder ? 1 : 0),
  }));
}

function asObject(value: Json | undefined): Record<string, Json> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, Json>;
  }
  return null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const placeholderRentalDescriptions = new Set([
  "imported rental listing.",
  "imported redfin rental listing.",
]);
const apartmentSearchCatalogCacheTtlMs = 60_000;

type ApartmentSearchCatalog = {
  refreshedAt: string | null;
  listings: ListingMapRow[];
  photos: PhotoRow[];
  units: UnitRow[];
};

type ActiveApartmentProfile = ApartmentSearchSnapshot["activeProfile"];

let apartmentSearchCatalogCache: {
  data: ApartmentSearchCatalog;
  expiresAt: number;
} | null = null;
let apartmentSearchCatalogCachePromise: Promise<ApartmentSearchCatalog> | null =
  null;

function normalizeListingDescription(value: string | null | undefined) {
  const description = value?.trim() ?? "";
  if (!description) return "";
  return placeholderRentalDescriptions.has(description.toLowerCase())
    ? ""
    : description;
}

function asNumber(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function asStringArray(value: Json | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
}

function normalizeProviderLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatPetType(value: string): string {
  const normalized = normalizeProviderLabel(value);
  const key = normalized.toLowerCase();

  if (/^cats?$/.test(key)) return "Cats";
  if (/^dogs?$/.test(key)) return "Dogs";
  if (/^pets?$/.test(key)) return "Pets";

  return normalized.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function parseLeasingHours(value: Json | undefined): LeasingHour[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<LeasingHour>((entry) => {
    const obj = asObject(entry as Json);
    if (!obj) return [];
    const day = asString(obj.day);
    const open = asString(obj.open);
    const close = asString(obj.close);
    if (!day) return [];
    return [{ day, open: open ?? "", close: close ?? "" }];
  });
}

function parsePetPolicies(value: Json | undefined): PetPolicy[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<PetPolicy>((entry) => {
    const obj = asObject(entry as Json);
    if (!obj) return [];
    const raw = asString(obj.policyName);
    if (!raw) return [];
    const cleaned = normalizeProviderLabel(raw);
    const normalized = cleaned.toLowerCase();
    const allowed =
      !/\bno\s+pets?\b/.test(normalized) &&
      !/\bpets?\s+(not\s+allowed|prohibited)\b/.test(normalized) &&
      !/\bnot\s+allowed\b|\bprohibited\b/.test(normalized);
    return [{ type: formatPetType(cleaned), allowed }];
  });
}

function parseParkingTypes(value: Json | undefined): ParkingOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<ParkingOption>((entry) => {
    const obj = asObject(entry as Json);
    if (!obj) return [];
    const type = asString(obj.parkingTypeName);
    if (!type) return [];
    return [
      {
        type,
        spaces: asNumber(obj.parkingSpaces),
        note: asString(obj.parkingComment),
      },
    ];
  });
}

function parseVideoTours(value: Json | undefined): VideoTour[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<VideoTour>((entry) => {
    const obj = asObject(entry as Json);
    if (!obj) return [];
    const url = asString(obj.scanUrl);
    if (!url) return [];
    return [{ url }];
  });
}

function parseListingAgent(
  contacts: Record<string, Json>,
): ListingAgent | null {
  const first = asString(contacts.mlsAgentFirstName);
  const last = asString(contacts.mlsAgentLastName);
  const name = [first, last].filter(Boolean).join(" ").trim();
  if (!name) return null;
  const rawEmail = asString(contacts.mlsAgentEmail);
  const email =
    rawEmail && /@/.test(rawEmail) && !rawEmail.includes("stop@")
      ? rawEmail
      : null;
  return { name, email };
}

function parseFloorPlanUnit(value: Json): FloorPlanUnit | null {
  const obj = asObject(value);
  if (!obj) return null;
  const name = asString(obj.name);
  if (!name) return null;
  const fullBaths = asNumber(obj.fullBaths);
  const halfBaths = asNumber(obj.halfBaths);
  const bathrooms =
    fullBaths != null || halfBaths != null
      ? (fullBaths ?? 0) + (halfBaths ?? 0) * 0.5
      : null;
  return {
    name,
    sqft: asNumber(obj.sqft),
    bedrooms: asNumber(obj.bedrooms),
    bathrooms,
    rentPrice: asNumber(obj.rentPrice),
    effectiveRentPrice: asNumber(obj.effectiveRentPrice),
    status: asString(obj.status) ?? "unknown",
    availableAt: asString(obj.availableDate),
    specificAmenities: asStringArray(obj.specificAmenities),
  };
}

function parseImageRange(value: Json | undefined): {
  startPos: number;
  version: string;
} | null {
  const obj = asObject(value);
  if (!obj) return null;
  const startPos = asNumber(obj.startPos);
  const version = asString(obj.version);
  if (startPos == null || !Number.isInteger(startPos) || !version) return null;
  return { startPos, version };
}

function floorPlanImageUrl(
  rentalMediaId: string | null,
  unitTypeId: string | null,
  value: Record<string, Json>,
): string | null {
  if (!rentalMediaId || !unitTypeId) return null;
  const floorPlanRange = parseImageRange(value.availableFloorPlanImage);
  const availablePhotos = Array.isArray(value.availablePhotos)
    ? value.availablePhotos
    : [];
  const firstAvailablePhoto =
    floorPlanRange ??
    availablePhotos
      .map((photo) => parseImageRange(photo as Json))
      .find(
        (photo): photo is { startPos: number; version: string } =>
          photo != null,
      ) ??
    null;
  if (!firstAvailablePhoto) return null;

  return `https://ssl.cdn-redfin.com/photo/rent/${rentalMediaId}/bigphoto/ut/${unitTypeId}/${firstAvailablePhoto.startPos}_${firstAvailablePhoto.version}.jpg`;
}

function rentalMediaIdFromDetailPayload(
  root: Record<string, Json>,
): string | null {
  for (const key of ["about", "floorPlans", "contacts"]) {
    const endpoint = asObject(root[key]);
    const rentalId = endpoint ? asString(endpoint.rentalId) : null;
    if (rentalId) return rentalId;
  }
  return null;
}

function parseFloorPlanType(
  value: Json,
  rentalMediaId: string | null,
): FloorPlanType | null {
  const obj = asObject(value);
  if (!obj) return null;
  const unitTypeId = asString(obj.unitTypeId);
  const name = asString(obj.name) ?? asString(obj.style);
  if (!name) return null;
  const fullBaths = asNumber(obj.fullBaths);
  const halfBaths = asNumber(obj.halfBaths);
  const bathrooms =
    fullBaths != null || halfBaths != null
      ? (fullBaths ?? 0) + (halfBaths ?? 0) * 0.5
      : null;
  const unitsRaw = Array.isArray(obj.units) ? obj.units : [];
  const units = unitsRaw
    .map((u) => parseFloorPlanUnit(u as Json))
    .filter((u): u is FloorPlanUnit => u != null);
  return {
    id: unitTypeId,
    name,
    bedrooms: asNumber(obj.bedrooms),
    bathrooms,
    sqftMin: asNumber(obj.sqftMin),
    sqftMax: asNumber(obj.sqftMax),
    rentPriceMin: asNumber(obj.rentPriceMin),
    rentPriceMax: asNumber(obj.rentPriceMax),
    effectiveRentPriceMin: asNumber(obj.effectiveRentPriceMin),
    effectiveRentPriceMax: asNumber(obj.effectiveRentPriceMax),
    availableAt: asString(obj.availableDate),
    totalUnits: asNumber(obj.totalUnits) ?? units.length,
    availableUnits: asNumber(obj.availableUnits) ?? 0,
    units,
    specificAmenities: asStringArray(obj.specificAmenities),
    leaseTerms: asStringArray(obj.availableLeaseTerms),
    imageUrl: floorPlanImageUrl(rentalMediaId, unitTypeId, obj),
    groups: [],
  };
}

function parseFloorPlanGroups(
  value: Json | undefined,
  rentalMediaId: string | null,
): FloorPlanGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<FloorPlanGroup>((entry) => {
    const obj = asObject(entry as Json);
    if (!obj) return [];
    const title = asString(obj.bedroomTitle) ?? "Units";
    const typesRaw = Array.isArray(obj.availableUnitTypes)
      ? obj.availableUnitTypes
      : [];
    const types = typesRaw
      .map((t) => parseFloorPlanType(t as Json, rentalMediaId))
      .filter((t): t is FloorPlanType => t != null);
    if (types.length === 0) return [];
    return [{ bedroomTitle: title, availableUnitTypes: types }];
  });
}

function parseFloorPlanGroupsFromPayload(
  payload: Json | undefined,
): FloorPlanGroup[] {
  const root = asObject(payload);
  if (!root) return [];
  const floorPlansObj = asObject(root.floorPlans) ?? {};
  return parseFloorPlanGroups(
    floorPlansObj.unitTypesByBedroom,
    rentalMediaIdFromDetailPayload(root),
  );
}

function normalizedUnitName(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function decorateFloorPlanGroupsWithEffectiveRent(
  floorPlanGroups: FloorPlanGroup[],
  units: UnitRow[],
  concession: Pick<ListingRow, "concession_months" | "concession_lease_months">,
): FloorPlanGroup[] {
  if (floorPlanGroups.length === 0) return floorPlanGroups;

  const unitsByName = new Map<string, UnitRow>();
  for (const unit of units) {
    const key = normalizedUnitName(unit.unit_name);
    if (key && !unitsByName.has(key)) unitsByName.set(key, unit);
  }

  const effectiveRentFor = (rent: number | null | undefined) =>
    positiveNumber(
      calculateEffectiveMonthlyRent(
        positiveNumber(rent),
        concession.concession_months,
        concession.concession_lease_months,
      ),
    ) ?? positiveNumber(rent);

  return floorPlanGroups.map((group) => ({
    ...group,
    availableUnitTypes: group.availableUnitTypes.map((type) => {
      const decoratedUnits = type.units.map((unit) => {
        const syncedUnit = unitsByName.get(normalizedUnitName(unit.name));
        const effectiveRentPrice =
          positiveNumber(syncedUnit?.effective_monthly_rent) ??
          (syncedUnit
            ? positiveNumber(syncedUnit.monthly_rent)
            : effectiveRentFor(unit.rentPrice));
        return { ...unit, effectiveRentPrice };
      });
      const effectiveUnitRents = decoratedUnits.flatMap((unit) => {
        const rent = positiveNumber(unit.effectiveRentPrice);
        return rent == null ? [] : [rent];
      });
      const effectiveRentPriceMin =
        effectiveUnitRents.length > 0
          ? Math.min(...effectiveUnitRents)
          : effectiveRentFor(type.rentPriceMin);
      const effectiveRentPriceMax =
        effectiveUnitRents.length > 0
          ? Math.max(...effectiveUnitRents)
          : effectiveRentFor(type.rentPriceMax);

      return {
        ...type,
        units: decoratedUnits,
        effectiveRentPriceMin,
        effectiveRentPriceMax,
      };
    }),
  }));
}

function formatPhoneE164ish(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function parseEnriched(
  payload: Json,
  rowContact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  },
  rawPoiSummary?: Json | null,
): EnrichedDetail | null {
  const root = asObject(payload);
  if (!root) return null;

  const about = asObject(root.about) ?? {};
  const amenities = asObject(root.amenities) ?? {};
  const floorPlansObj = asObject(root.floorPlans) ?? {};
  const fees = asObject(root.feesAndPolicies) ?? {};
  const contacts = asObject(root.contacts) ?? {};
  const media = asObject(root.mediaBrowserInfo) ?? {};
  const streetView = asObject(media.streetView) ?? {};
  const mgmt = asObject(about.managementCompany) ?? {};

  const phoneRaw =
    asString(contacts.desktopPhone) ??
    asString(contacts.paidPhone) ??
    asString(contacts.mobileWebPhone) ??
    asString(contacts.mobileAppPhone) ??
    rowContact.phone;
  const email = asString(contacts.mlsAgentEmail) ?? rowContact.email;
  const brokerage = asString(contacts.mlsBrokerName);
  const agent = parseListingAgent(contacts);

  return {
    description: asString(about.description),
    managementCompany: asString(mgmt.name) ?? brokerage ?? rowContact.name,
    brokerage,
    agent,
    mlsId: asString(contacts.mlsId),
    hasApplication: contacts.hasApplication === true,
    leasingOfficeSchedules:
      parseLeasingHours(about.leasingOfficeSchedules).length > 0
        ? parseLeasingHours(about.leasingOfficeSchedules)
        : parseLeasingHours(contacts.leasingOfficeSchedules),
    unitAmenities: asStringArray(amenities.unitAmenities),
    communityAmenities: asStringArray(amenities.communityAmenities),
    otherAmenities: asStringArray(amenities.otherAmenities),
    standardizedAmenities: asStringArray(amenities.standardizedAmenities),
    floorPlans: parseFloorPlanGroupsFromPayload(payload),
    totalUnits: asNumber(floorPlansObj.totalUnits),
    totalUnitTypes: asNumber(floorPlansObj.totalUnitTypes),
    petPolicies: parsePetPolicies(fees.petPolicies),
    parking: parseParkingTypes(fees.parkingTypes),
    videoTours: parseVideoTours(media.scans),
    applicationFee: asNumber(fees.applicationFee),
    phone: formatPhoneE164ish(phoneRaw),
    email: email && /@/.test(email) && !email.includes("stop@") ? email : null,
    streetViewUrl:
      streetView.streetViewAvailable === true
        ? asString(streetView.streetViewUrl)
        : null,
    poiSummary: parsePoiSummary(rawPoiSummary),
  };
}

type NumberRange = {
  min: number | null;
  max: number | null;
};

type RentSummary = {
  monthlyRent: number | null;
  effectiveMonthlyRent: number | null;
  unitRentMin: number | null;
  unitRentMax: number | null;
  unitEffectiveRentMin: number | null;
  unitEffectiveRentMax: number | null;
  concession: Pick<
    ListingRow,
    "concession_months" | "concession_lease_months" | "concession_note"
  >;
};

function includeRent(range: NumberRange, value: number | null) {
  const positive = positiveNumber(value);
  if (positive == null) return;
  range.min = range.min == null ? positive : Math.min(range.min, positive);
  range.max = range.max == null ? positive : Math.max(range.max, positive);
}

function concessionWeight(
  concession: Pick<ListingRow, "concession_months" | "concession_lease_months">,
) {
  const leaseMonths =
    concession.concession_lease_months > 0
      ? concession.concession_lease_months
      : 12;
  return concession.concession_months / leaseMonths;
}

function summarizeRent(row: ListingMapRow, units: UnitRow[]): RentSummary {
  const listingMonthlyRent =
    positiveNumber(row.monthly_rent) ??
    positiveNumber(row.rent_min) ??
    positiveNumber(row.rent_max);
  const calculatedListingEffectiveMonthlyRent = calculateEffectiveMonthlyRent(
    listingMonthlyRent,
    row.concession_months,
    row.concession_lease_months,
  );
  const listingEffectiveMonthlyRent =
    positiveNumber(row.effective_monthly_rent) ??
    positiveNumber(calculatedListingEffectiveMonthlyRent);
  const unitRentRange: NumberRange = { min: null, max: null };
  const unitEffectiveRentRange: NumberRange = { min: null, max: null };
  let strongestUnitConcession: Pick<
    UnitRow,
    "concession_months" | "concession_lease_months" | "concession_note"
  > | null = null;

  for (const unit of units) {
    includeRent(unitRentRange, unit.monthly_rent);
    includeRent(
      unitEffectiveRentRange,
      positiveNumber(unit.effective_monthly_rent) ??
        positiveNumber(
          calculateEffectiveMonthlyRent(
            unit.monthly_rent,
            unit.concession_months,
            unit.concession_lease_months,
          ),
        ),
    );
    if (
      unit.concession_months > 0 &&
      (!strongestUnitConcession ||
        concessionWeight(unit) > concessionWeight(strongestUnitConcession))
    ) {
      strongestUnitConcession = unit;
    }
  }

  const monthlyRent = unitRentRange.min ?? listingMonthlyRent;
  const effectiveMonthlyRent =
    unitEffectiveRentRange.min ?? listingEffectiveMonthlyRent ?? monthlyRent;
  const concession =
    strongestUnitConcession &&
    concessionWeight(strongestUnitConcession) > concessionWeight(row)
      ? strongestUnitConcession
      : row;

  return {
    monthlyRent,
    effectiveMonthlyRent,
    unitRentMin: unitRentRange.min,
    unitRentMax: unitRentRange.max,
    unitEffectiveRentMin: unitEffectiveRentRange.min,
    unitEffectiveRentMax: unitEffectiveRentRange.max,
    concession,
  };
}

function displayBathrooms(row: ListingMapRow, units: UnitRow[]): number | null {
  const positiveUnitBathrooms = units.flatMap((unit) => {
    const value = positiveNumber(unit.bathrooms);
    return value == null ? [] : [value];
  });
  const minUnitBathrooms =
    positiveUnitBathrooms.length > 0
      ? Math.min(...positiveUnitBathrooms)
      : null;

  return (
    positiveNumber(row.bathrooms) ??
    positiveNumber(row.bathrooms_min) ??
    minUnitBathrooms ??
    positiveNumber(row.bathrooms_max)
  );
}

function mapListing(
  row: ListingMapRow,
  match: MatchRow | undefined,
  photos: PhotoRow[],
  units: UnitRow[],
  options: {
    includeEnriched?: boolean;
    roommateGroupContext?: PersistedRoommateGroupContext | null;
  } = {},
): ApartmentListing {
  const rent = summarizeRent(row, units);
  const floorPlanGroupsForPricing = decorateFloorPlanGroupsWithEffectiveRent(
    parseFloorPlanGroupsFromPayload(row.provider_detail_payload),
    units,
    rent.concession,
  );
  const floorPlanMonthlyRent =
    cheapestFloorPlanEffectiveMonthlyRent(floorPlanGroupsForPricing, {
      concessionMonths: rent.concession.concession_months,
      concessionLeaseMonths: rent.concession.concession_lease_months,
    }) ?? cheapestFloorPlanMonthlyRent(floorPlanGroupsForPricing);
  const floorPlanBedrooms = floorPlanBedroomRange(floorPlanGroupsForPricing);
  const floorPlanTypeCount = displayFloorPlans(
    floorPlanGroupsForPricing,
  ).length;
  const floorPlanBedroomForSplit =
    floorPlanBedrooms.max ?? floorPlanBedrooms.min;
  const bedroomsForSplit =
    row.bedrooms ??
    row.bedrooms_max ??
    row.bedrooms_min ??
    floorPlanBedroomForSplit ??
    null;
  const roommateSplitLimit = roommateSplitLimitFromBedrooms(bedroomsForSplit);
  const canRoommateSplit = canSplitByRoommates(bedroomsForSplit);
  const householdSizeLimit = householdSizeLimitFromBedrooms(bedroomsForSplit);
  const householdSize = clampRoommateSplitSize(
    match?.recommended_household_size ?? householdSizeLimit,
    bedroomsForSplit,
  );
  const matchHouseholdSize =
    typeof match?.recommended_household_size === "number" &&
    Number.isFinite(match.recommended_household_size)
      ? Math.round(match.recommended_household_size)
      : null;
  const canUseMatchRent =
    canRoommateSplit && matchHouseholdSize === householdSize;
  const perPersonRent =
    (canUseMatchRent ? positiveNumber(match?.per_person_rent) : null) ??
    (rent.monthlyRent == null
      ? null
      : Math.round(rent.monthlyRent / householdSize));
  const effectiveRent =
    (canUseMatchRent
      ? positiveNumber(match?.effective_per_person_rent)
      : null) ??
    (rent.effectiveMonthlyRent == null
      ? perPersonRent
      : Math.round(rent.effectiveMonthlyRent / householdSize));
  const matchSplitBreakdown = splits(match?.split_breakdown ?? []);
  const splitBreakdown =
    canRoommateSplit && matchSplitBreakdown.length === householdSize
      ? matchSplitBreakdown
      : canRoommateSplit
        ? equalSplitBreakdown(
            rent.effectiveMonthlyRent ?? rent.monthlyRent,
            householdSize,
          )
        : [];
  const photoUrls = photos.map((photo) => photo.url);
  const persistedFormingGroups = buildPersistedFormingGroupsForListing({
    listingId: row.id,
    monthlyRent:
      rent.effectiveMonthlyRent ?? rent.monthlyRent ?? floorPlanMonthlyRent,
    context: options.roommateGroupContext,
  });
  const rawEnriched = options.includeEnriched
    ? parseEnriched(
        row.provider_detail_payload ?? {},
        {
          name: row.contact_name ?? null,
          phone: row.contact_phone ?? null,
          email: row.contact_email ?? null,
        },
        row.poi_summary,
      )
    : null;
  const rawEnrichedWithEffectiveFloorPlans = rawEnriched
    ? { ...rawEnriched, floorPlans: floorPlanGroupsForPricing }
    : null;
  const enriched = options.includeEnriched
    ? attachPersistedRoommateGroupsToEnriched(
        row.id,
        rawEnrichedWithEffectiveFloorPlans,
        options.roommateGroupContext,
      )
    : null;
  const formingGroups = persistedFormingGroups;
  const fitScore =
    match?.fit_score ?? bestPersistedFormingGroupFitScore(formingGroups) ?? 0;
  // The homecard description is often truncated to ~200 chars with a trailing "...".
  // Prefer the full enriched description whenever it is materially longer.
  const enrichedDescription = normalizeListingDescription(
    enriched?.description,
  );
  const rowDescription = normalizeListingDescription(row.description);
  const description =
    enrichedDescription &&
    (!rowDescription || enrichedDescription.length > rowDescription.length)
      ? enrichedDescription
      : rowDescription;

  return {
    id: row.id,
    source: row.external_source,
    sourceUrl: row.source_url,
    listingStatus: row.listing_status,
    providerMarket: row.provider_market,
    address: row.address_line,
    unit: row.unit,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    neighborhood: row.neighborhood ?? row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    monthlyRent: rent.monthlyRent,
    bedrooms: row.bedrooms,
    bathrooms: displayBathrooms(row, units),
    squareFeet: row.square_feet,
    availableAt: row.available_at,
    description,
    amenities: row.amenities,
    leaseTerms: row.lease_terms ?? [],
    noFee: row.no_fee,
    concessionMonths: rent.concession.concession_months,
    concessionLeaseMonths: rent.concession.concession_lease_months,
    concessionNote: rent.concession.concession_note,
    effectiveMonthlyRent: rent.effectiveMonthlyRent,
    availableUnitCount: units.length,
    unitRentMin: rent.unitRentMin,
    unitRentMax: rent.unitRentMax,
    unitEffectiveRentMin: rent.unitEffectiveRentMin,
    unitEffectiveRentMax: rent.unitEffectiveRentMax,
    photoUrl: photoUrls[0] ?? null,
    floorPlanMonthlyRent,
    floorPlanTypeCount,
    floorPlanBedroomMin: floorPlanBedrooms.min,
    floorPlanBedroomMax: floorPlanBedrooms.max,
    photoUrls,
    fitScore,
    roommateSplitLimit,
    householdSize,
    perPersonRent,
    effectivePerPersonRent: effectiveRent,
    splitBreakdown,
    evidence: parseEvidencePoints(match?.evidence ?? []),
    tradeoffs: parseEvidencePoints(match?.tradeoffs ?? []),
    formingGroups,
    enriched,
    firstSeenAt: row.first_seen_at,
  };
}

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

async function fetchPhotoRows(
  supabase: SupabaseServiceClient,
  listingIds: string[],
  options: { coverOnly?: boolean } = {},
): Promise<PhotoRow[]> {
  const chunkRows = await Promise.all(
    chunks(listingIds, relatedListingChunkSize).map(async (listingIdChunk) => {
      const rows: PhotoRow[] = [];
      for (let from = 0; ; from += relatedRowsPageSize) {
        let query = supabase
          .from("apartment_listing_photos")
          .select("*")
          .in("listing_id", listingIdChunk)
          .order("listing_id", { ascending: true })
          .order("position", { ascending: true });

        if (options.coverOnly) {
          query = query.eq("position", 0);
        }

        const { data, error } = await query.range(
          from,
          from + relatedRowsPageSize - 1,
        );

        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < relatedRowsPageSize) break;
      }
      return rows;
    }),
  );
  return chunkRows.flat();
}

async function fetchAvailableUnitRows(
  supabase: SupabaseServiceClient,
  listingIds: string[],
): Promise<UnitRow[]> {
  const chunkRows = await Promise.all(
    chunks(listingIds, relatedListingChunkSize).map(async (listingIdChunk) => {
      const rows: UnitRow[] = [];
      const fetchPage = async (from: number): Promise<void> => {
        const { data, error } = await supabase
          .from("apartment_listing_units")
          .select("*")
          .in("listing_id", listingIdChunk)
          .eq("unit_status", "available")
          .order("listing_id", { ascending: true })
          .order("effective_monthly_rent", {
            ascending: true,
            nullsFirst: false,
          })
          .order("monthly_rent", { ascending: true })
          .range(from, from + relatedRowsPageSize - 1);

        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length >= relatedRowsPageSize) {
          await fetchPage(from + relatedRowsPageSize);
        }
      };
      await fetchPage(0);
      return rows;
    }),
  );
  return chunkRows.flat();
}

// The freshness the UI reports must reflect when listing data was actually
// scraped from the source (last_seen_at), never when this process happened to
// re-query Supabase — the two diverge badly when the import cron isn't running.
const listingFreshnessStaleAfterMs = 48 * 60 * 60 * 1000;

function isRefreshStale(refreshedAt: string | null): boolean {
  if (!refreshedAt) return false;
  const refreshedMs = Date.parse(refreshedAt);
  if (!Number.isFinite(refreshedMs)) return false;
  return Date.now() - refreshedMs > listingFreshnessStaleAfterMs;
}

// Lower median, not max: the importer stamps last_seen_at batch-by-batch and
// only deactivates unseen rows after every batch succeeds, so a run that dies
// mid-way leaves a few fresh rows on top of a mostly-old catalog. The max
// would read "up to date"; the median answers "is most of what's displayed
// still current". After a healthy full run every row shares one timestamp and
// the two are identical.
function catalogLastSeenAt(listings: ListingMapRow[]): string | null {
  const seen = listings
    .map((listing) => {
      const seenAt = listing.last_seen_at;
      if (!seenAt) return null;
      const seenMs = Date.parse(seenAt);
      return Number.isFinite(seenMs) ? { seenAt, seenMs } : null;
    })
    .filter((entry) => entry != null)
    .sort((a, b) => a.seenMs - b.seenMs);
  if (seen.length === 0) return null;
  return seen[Math.floor((seen.length - 1) / 2)].seenAt;
}

async function loadApartmentSearchCatalog(
  supabase: SupabaseServiceClient,
): Promise<ApartmentSearchCatalog> {
  const now = Date.now();
  if (
    apartmentSearchCatalogCache &&
    apartmentSearchCatalogCache.expiresAt > now
  ) {
    return apartmentSearchCatalogCache.data;
  }

  apartmentSearchCatalogCachePromise ??= (async () => {
    const apartmentMarket = apartmentSearchMarket();
    const listingsResult = await supabase
      .from("apartment_listings")
      .select(listingSummarySelect)
      .eq("listing_status", "active")
      .eq("provider_market", apartmentMarket)
      .order("bedrooms", { ascending: false })
      .order("effective_monthly_rent", { ascending: true, nullsFirst: false })
      .order("monthly_rent", { ascending: true })
      .limit(apartmentSearchListingLimit());

    if (listingsResult.error) throw listingsResult.error;

    const listings = (listingsResult.data ?? []) as unknown as ListingMapRow[];
    const listingIds = listings.map((listing) => listing.id);
    const [photos, units] =
      listingIds.length > 0
        ? await Promise.all([
            fetchPhotoRows(supabase, listingIds, { coverOnly: true }),
            fetchAvailableUnitRows(supabase, listingIds),
          ])
        : [[], []];
    const data = {
      refreshedAt: catalogLastSeenAt(listings),
      listings,
      photos,
      units,
    };
    apartmentSearchCatalogCache = {
      data,
      expiresAt: Date.now() + apartmentSearchCatalogCacheTtlMs,
    };
    return data;
  })().finally(() => {
    apartmentSearchCatalogCachePromise = null;
  });

  return apartmentSearchCatalogCachePromise;
}

export function preloadApartmentSearchCatalog(): Promise<void> {
  if (!hasServerSupabaseConfig()) {
    return Promise.resolve();
  }

  try {
    return loadApartmentSearchCatalog(createSupabaseServiceClient()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

function coerceNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toRoommateFact(row: RoommateFactRow): PersistedRoommateFact {
  return {
    userId: row.user_id,
    dimension: row.dimension,
    factKey: row.fact_key,
    value: row.value_json,
    normalizedValue: row.normalized_value,
    confidence: coerceNumber(row.confidence),
    importance: coerceNumber(row.importance),
  };
}

async function fetchPersistedGroupRows(
  supabase: SupabaseServiceClient,
  listingIds: string[],
): Promise<PersistedRoommateGroupRow[]> {
  const chunkRows = await Promise.all(
    chunks(listingIds, relatedListingChunkSize).map(async (listingIdChunk) => {
      const { data, error } = await supabase
        .from("apartment_roommate_groups")
        .select(
          [
            "id",
            "listing_id",
            "floor_plan_key",
            "floor_plan_name",
            "target_unit_name",
            "bedrooms",
            "max_size",
            "monthly_rent",
            "status",
            "preferences",
            "match_summary",
            "created_by_user_id",
            "updated_at",
          ].join(","),
        )
        .in("listing_id", listingIdChunk)
        .in("status", ["forming", "ready", "touring"])
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as PersistedRoommateGroupRow[];
    }),
  );
  return chunkRows.flat();
}

async function fetchPersistedMembershipRows(
  supabase: SupabaseServiceClient,
  groupIds: string[],
): Promise<PersistedRoommateGroupMembershipRow[]> {
  const chunkRows = await Promise.all(
    chunks(groupIds, relatedListingChunkSize).map(async (groupIdChunk) => {
      const { data, error } = await supabase
        .from("apartment_roommate_group_memberships")
        .select("group_id,user_id,status,role,updated_at")
        .in("group_id", groupIdChunk)
        .in("status", ["member", "requested"])
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as PersistedRoommateGroupMembershipRow[];
    }),
  );
  return chunkRows.flat();
}

function compatibilityEdgePairKey(userAId: string, userBId: string) {
  return userAId < userBId ? `${userAId}:${userBId}` : `${userBId}:${userAId}`;
}

// Exported for the security regression test that locks in the viewer gate.
export async function loadPersistedRoommateGroupContext(
  supabase: SupabaseServiceClient,
  listingIds: string[],
  activeUserId: string | null,
  options?: { ensureViewerEdges?: boolean },
): Promise<PersistedRoommateGroupContext | null> {
  if (listingIds.length === 0) return null;
  // SECURITY (P0): the member profiles loaded below are OTHER users' PII —
  // name, photo, employer, school, and lifestyle facts. Only ever load them
  // for an authenticated viewer; never for an anonymous request or the
  // KINFOLK_APARTMENT_USER_ID demo fallback. Callers pass the real Clerk-backed
  // user id here, so a null viewer yields no context — listings still render,
  // they just expose no forming-group member identities.
  if (!activeUserId) return null;
  try {
    const groups = await fetchPersistedGroupRows(supabase, listingIds);
    if (groups.length === 0) return null;

    const memberships = await fetchPersistedMembershipRows(
      supabase,
      groups.map((group) => group.id),
    );
    const userIds = Array.from(
      new Set(memberships.map((membership) => membership.user_id)),
    );
    if (userIds.length === 0) {
      return {
        activeUserId,
        groups,
        memberships,
        profiles: [],
        compatibilityEdges: [],
      };
    }

    // Join flow: compute & cache any missing viewer↔member compatibility edges
    // so each prospective roommate shows a fit score. Runs alongside the reads
    // below; merged into the edge set once both resolve.
    const ensuredEdgesPromise =
      options?.ensureViewerEdges && activeUserId
        ? ensureCompatibilityEdgesForPairs(
            supabase,
            activeUserId,
            userIds.filter((id) => id !== activeUserId),
          )
        : Promise.resolve<
            { userAId: string; userBId: string; score: number }[]
          >([]);

    const edgeUserIds = Array.from(
      new Set([...userIds, ...(activeUserId ? [activeUserId] : [])]),
    );

    const [
      usersResult,
      photosResult,
      factsResult,
      edgesResult,
      credentialsResult,
      publicVisibilityByUser,
    ] =
      await Promise.all([
        supabase
          .from("kinfolk_users")
          .select(
            [
              "id",
              "display_name",
              "about_text",
              "interests",
              "occupation_title",
              "occupation_company",
              "occupation_company_logo_url",
              "education_school",
              "education_school_logo_url",
              "education_degree",
              "education_major",
              "education_year",
            ].join(","),
          )
          .in("id", userIds),
        supabase
          .from("kinfolk_user_photos")
          .select("user_id,public_url")
          .in("user_id", userIds)
          .not("public_url", "is", null)
          .order("is_primary", { ascending: false })
          .order("position", { ascending: true }),
        supabase
          .from("profile_facts")
          .select(
            [
              "user_id",
              "dimension",
              "fact_key",
              "value_json",
              "normalized_value",
              "confidence",
              "importance",
            ].join(","),
          )
          .in("user_id", userIds)
          // Canonical roommate-facing fact filter, matching matches.ts /
          // apartment-listing-matches.ts / group-join-notifications.ts:
          // standard-sensitivity, matching-eligible, reviewer-approved only.
          // Defense-in-depth so this path can't leak unreviewed/sensitive facts
          // if the matching_eligible↔approved coupling is ever broken upstream.
          .eq("sensitivity_level", "standard")
          .eq("matching_eligible", true)
          .in("user_review_state", ["approved", "edited"])
          .order("importance", { ascending: false })
          .order("confidence", { ascending: false })
          .limit(Math.max(24, userIds.length * 24)),
        edgeUserIds.length > 0
          ? supabase
              .from("compatibility_edges")
              .select("user_a_id,user_b_id,score,evidence")
              .eq("status", "active")
              .or(
                `user_a_id.in.(${edgeUserIds.join(",")}),user_b_id.in.(${edgeUserIds.join(",")})`,
              )
          : Promise.resolve({ data: [], error: null }),
        // Enrichment-sourced company/school logos. The flat occupation_company /
        // education_school text above pairs with the first (most-recent) timeline
        // entry's logo here; the modal falls back to a monogram when absent.
        supabase
          .from("professional_profiles")
          .select("user_id,experiences,education,updated_at")
          .in("user_id", userIds)
          .order("updated_at", { ascending: false }),
        // PRIVACY: which members opted into a public profile. Everyone else is
        // anonymous and gets the stripped member projection for non-members.
        loadPublicVisibilityByUserId(supabase, userIds),
      ]);

    const firstError = [
      usersResult.error,
      photosResult.error,
      factsResult.error,
      edgesResult.error,
      credentialsResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const usersById = new Map(
      ((usersResult.data ?? []) as unknown as UserProfileRow[]).map((user) => [
        user.id,
        user,
      ]),
    );
    const photosByUser = new Map<string, string>();
    for (const photo of (photosResult.data ??
      []) as unknown as UserPhotoRow[]) {
      if (!photosByUser.has(photo.user_id) && photo.public_url) {
        photosByUser.set(photo.user_id, photo.public_url);
      }
    }

    const factsByUser = new Map<string, PersistedRoommateFact[]>();
    for (const fact of (factsResult.data ??
      []) as unknown as RoommateFactRow[]) {
      const list = factsByUser.get(fact.user_id) ?? [];
      list.push(toRoommateFact(fact));
      factsByUser.set(fact.user_id, list);
    }

    // Company/school enrichment logos, keyed by user. The query is ordered
    // updated_at desc, so the first row per user is the freshest profile.
    const logosByUser = new Map<
      string,
      { company: string | null; school: string | null }
    >();
    // The label each enrichment logo was scraped for. A logo may only be shown
    // beside a label its own source corroborates.
    const credentialLabels = new Map<
      string,
      { company: string | null; school: string | null }
    >();
    for (const row of (credentialsResult.data ??
      []) as unknown as ProfessionalCredentialRow[]) {
      if (logosByUser.has(row.user_id)) continue;
      const company = parseFirstCredential(row.experiences);
      const school = parseFirstCredential(row.education);
      logosByUser.set(row.user_id, {
        company: company?.logoUrl ?? null,
        school: school?.logoUrl ?? null,
      });
      credentialLabels.set(row.user_id, {
        company: company?.label ?? null,
        school: school?.label ?? null,
      });
    }

    // Include the viewer so their edges to members aren't filtered out — a
    // non-member viewer (browsing to join) is never in the membership set.
    const relevantUserIds = new Set(userIds);
    if (activeUserId) relevantUserIds.add(activeUserId);
    const compatibilityEdges = (
      (edgesResult.data ?? []) as unknown as CompatibilityEdgeRow[]
    ).flatMap<PersistedCompatibilityEdge>((edge) =>
      relevantUserIds.has(edge.user_a_id) && relevantUserIds.has(edge.user_b_id)
        ? [
            {
              userAId: edge.user_a_id,
              userBId: edge.user_b_id,
              score: coerceNumber(edge.score),
              reasons: topReasonLabels(edge.evidence),
            },
          ]
        : [],
    );

    // Merge on-demand viewer↔member edges (deduped against what we just read).
    const edgePairKeys = new Set(
      compatibilityEdges.map((edge) =>
        compatibilityEdgePairKey(edge.userAId, edge.userBId),
      ),
    );
    for (const edge of await ensuredEdgesPromise) {
      const pairKey = compatibilityEdgePairKey(edge.userAId, edge.userBId);
      if (edgePairKeys.has(pairKey)) continue;
      edgePairKeys.add(pairKey);
      compatibilityEdges.push(edge);
    }

    const profiles = userIds.flatMap<PersistedRoommateProfile>((userId) => {
      const user = usersById.get(userId);
      if (!user) return [];
      return [
        {
          userId,
          isPublic: publicVisibilityByUser.get(userId) ?? false,
          name: user.display_name,
          imageUrl: photosByUser.get(userId),
          about: user.about_text,
          interests: user.interests,
          occupationTitle: user.occupation_title,
          occupationCompany: user.occupation_company,
          // Only a logo whose provenance matches this label: the picked column
          // was resolved for it, whereas the enrichment credential describes
          // whatever LinkedIn last said and may name a different employer.
          occupationCompanyLogoUrl: pairedLogoUrl(
            user.occupation_company,
            user.occupation_company_logo_url,
            logosByUser.get(userId)?.company ?? null,
            credentialLabels.get(userId)?.company ?? null,
          ),
          educationSchool: user.education_school,
          educationDegree: user.education_degree,
          educationMajor: user.education_major,
          educationYear: user.education_year,
          educationSchoolLogoUrl: pairedLogoUrl(
            user.education_school,
            user.education_school_logo_url,
            logosByUser.get(userId)?.school ?? null,
            credentialLabels.get(userId)?.school ?? null,
          ),
          facts: factsByUser.get(userId) ?? [],
        },
      ];
    });

    return {
      activeUserId,
      groups,
      memberships,
      profiles,
      compatibilityEdges,
    };
  } catch (error) {
    console.warn("Unable to load persisted apartment roommate groups", error);
    return null;
  }
}

type ApartmentSearchUserContext = {
  profile: TableRow<"matching_profiles"> | null;
  housing: TableRow<"housing_preferences"> | null;
  matches: MatchRow[];
};

async function loadApartmentSearchUserContext(
  supabase: SupabaseServiceClient,
  userId: string | null,
): Promise<ApartmentSearchUserContext> {
  if (!userId) {
    return { profile: null, housing: null, matches: [] };
  }

  const [profileResult, housingResult] = await Promise.all([
    supabase
      .from("matching_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("housing_preferences")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const firstError = [profileResult.error, housingResult.error].find(Boolean);
  if (firstError) throw firstError;

  const profile = profileResult.data;
  const housing = housingResult.data;
  if (!profile?.id) {
    return { profile, housing, matches: [] };
  }

  const matchesResult = await supabase
    .from("apartment_listing_matches")
    .select("*")
    .eq("user_id", userId)
    .eq("profile_id", profile.id)
    .in("status", VISIBLE_APARTMENT_MATCH_STATUSES)
    .order("fit_score", { ascending: false });
  if (matchesResult.error) throw matchesResult.error;

  return { profile, housing, matches: matchesResult.data ?? [] };
}

function activeProfileFromContext({
  housing,
  profile,
}: Pick<ApartmentSearchUserContext, "housing" | "profile">): ActiveApartmentProfile {
  return {
    budgetMin: profile?.budget_min ?? emptyActiveProfile.budgetMin,
    budgetMax: profile?.budget_max ?? emptyActiveProfile.budgetMax,
    dealbreakers: housing?.dealbreakers ?? emptyActiveProfile.dealbreakers,
    householdSizeMin:
      profile?.household_size_min ?? emptyActiveProfile.householdSizeMin,
    householdSizeMax:
      profile?.household_size_max ?? emptyActiveProfile.householdSizeMax,
    moveInEnd: profile?.move_in_end ?? emptyActiveProfile.moveInEnd,
    moveInStart: profile?.move_in_start ?? emptyActiveProfile.moveInStart,
    mustHaves: housing?.must_haves ?? emptyActiveProfile.mustHaves,
    neighborhoods: housing?.neighborhoods ?? emptyActiveProfile.neighborhoods,
    pets: housing?.pets ?? emptyActiveProfile.pets,
  };
}

function positiveWholeNumber(value: number) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function defaultRoommatesFromActiveProfile(
  profile: ActiveApartmentProfile,
  listings: ApartmentListing[],
) {
  const householdSize = positiveWholeNumber(profile.householdSizeMax);
  if (householdSize == null) {
    return null;
  }

  const maxRoommates = listings.reduce(
    (max, listing) => Math.max(max, listing.roommateSplitLimit),
    0,
  );
  const roommates = householdSize - 1;
  if (roommates < 1 || maxRoommates <= 0) {
    return null;
  }

  return Math.min(roommates, maxRoommates);
}

function withSurfaceFitScores(
  listings: ApartmentListing[],
  profile: ActiveApartmentProfile,
) {
  const roommatesOverride = defaultRoommatesFromActiveProfile(profile, listings);
  return listings.map((listing) => ({
    ...listing,
    surfaceFitScore: apartmentListingSurfaceFitScore({
      listing,
      profile,
      roommatesOverride,
    }),
  }));
}

export const getApartmentSearchSnapshot = cache(
  async (activeUserId?: string | null): Promise<ApartmentSearchSnapshot> => {
    const apartmentMarket = apartmentSearchMarket();
    if (!hasServerSupabaseConfig()) {
      return {
        source: {
          kind: "supabase",
          status: "unavailable",
          detail:
            "Supabase is not configured. No mock apartment listings are shown.",
        },
        refreshedAt: null,
        refreshStale: false,
        market: marketLabel(apartmentMarket),
        listings: [],
        neighborhoods: [],
        activeProfile: emptyActiveProfile,
      };
    }

    try {
      const supabase = createSupabaseServiceClient();
      // Real authenticated viewer (Clerk-backed). Only this id may unlock other
      // users' forming-group member PII — see loadPersistedRoommateGroupContext.
      const authenticatedUserId = activeUserId?.trim() || null;
      // The KINFOLK_APARTMENT_USER_ID fallback only personalizes the viewer's
      // OWN match context (their fit scores / active profile) for local + demo
      // previews; it must never authorize exposure of other users' PII.
      const userId =
        authenticatedUserId ||
        process.env.KINFOLK_APARTMENT_USER_ID?.trim() ||
        null;
      const catalogPromise = loadApartmentSearchCatalog(supabase);
      const userContextPromise = loadApartmentSearchUserContext(
        supabase,
        userId,
      );

      const [catalog, userContext] = await Promise.all([
        catalogPromise,
        userContextPromise,
      ]);
      const { profile, housing, matches } = userContext;
      const activeProfile = activeProfileFromContext({ profile, housing });

      const {
        listings,
        photos,
        refreshedAt: catalogRefreshedAt,
        units,
      } = catalog;
      const listingIds = listings.map((listing) => listing.id);
      const roommateGroupContext =
        authenticatedUserId && listingIds.length > 0
          ? await loadPersistedRoommateGroupContext(
              supabase,
              listingIds,
              authenticatedUserId,
            )
          : null;
      const matchesByListing = new Map(
        matches.map((match) => [match.listing_id, match] as const),
      );
      const photosByListing = new Map<string, PhotoRow[]>();
      for (const photo of photos) {
        const list = photosByListing.get(photo.listing_id) ?? [];
        list.push(photo);
        photosByListing.set(photo.listing_id, list);
      }
      const unitsByListing = new Map<string, UnitRow[]>();
      for (const unit of units) {
        const units = unitsByListing.get(unit.listing_id) ?? [];
        units.push(unit);
        unitsByListing.set(unit.listing_id, units);
      }
      const listingSummaries = listings.map((listing) =>
        toListingSummary(
          mapListing(
            listing,
            matchesByListing.get(listing.id),
            photosByListing.get(listing.id) ?? [],
            unitsByListing.get(listing.id) ?? [],
            { includeEnriched: false, roommateGroupContext },
          ),
        ),
      );

      return {
        source: {
          kind: "supabase",
          status: "connected",
          detail: "Reading apartment listings from Supabase.",
        },
        refreshedAt: catalogRefreshedAt,
        refreshStale: isRefreshStale(catalogRefreshedAt),
        market: marketLabel(apartmentMarket),
        listings: withSurfaceFitScores(listingSummaries, activeProfile),
        neighborhoods: [],
        activeProfile,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown apartment search error";
      return {
        source: {
          kind: "supabase",
          status: "error",
          detail: `Supabase apartment search query failed: ${message}`,
        },
        refreshedAt: null,
        refreshStale: false,
        market: marketLabel(apartmentMarket),
        listings: [],
        neighborhoods: [],
        activeProfile: emptyActiveProfile,
      };
    }
  },
);

type ApartmentListingDetailOptions = {
  ensureViewerEdges?: boolean;
};

// Request-cached: a /l/ shortlink hit loads the detail from both
// generateMetadata and the page body — for anonymous visitors (link previews,
// crawlers: the shortlink hot path) both calls share one load.
export const getApartmentListingDetail = cache(getApartmentListingDetailUncached);

async function getApartmentListingDetailUncached(
  listingId: string,
  activeUserId?: string | null,
  options: ApartmentListingDetailOptions = {},
): Promise<ApartmentListing | null> {
  if (!hasServerSupabaseConfig()) {
    return null;
  }

  const trimmedListingId = listingId.trim();
  if (!trimmedListingId) {
    return null;
  }

  try {
    const supabase = createSupabaseServiceClient();
    const apartmentMarket = apartmentSearchMarket();
    // Real authenticated viewer — the only id allowed to unlock other users'
    // forming-group member PII (see loadPersistedRoommateGroupContext). The
    // KINFOLK_APARTMENT_USER_ID demo fallback personalizes only the viewer's
    // own match score below, never others' PII.
    const authenticatedUserId = activeUserId?.trim() || null;
    const effectiveUserId =
      authenticatedUserId ||
      process.env.KINFOLK_APARTMENT_USER_ID?.trim() ||
      null;
    const listingResult = await supabase
      .from("apartment_listings")
      .select(listingDetailSelect)
      .eq("id", trimmedListingId)
      .eq("listing_status", "active")
      .eq("provider_market", apartmentMarket)
      .maybeSingle();

    if (listingResult.error) throw listingResult.error;
    if (!listingResult.data) return null;
    const listing = listingResult.data as unknown as ListingMapRow;

    const [photos, units, matchResult, roommateGroupContext] =
      await Promise.all([
        fetchPhotoRows(supabase, [trimmedListingId]),
        fetchAvailableUnitRows(supabase, [trimmedListingId]),
        effectiveUserId
          ? supabase
              .from("apartment_listing_matches")
              .select("*")
              .eq("user_id", effectiveUserId)
              .eq("listing_id", trimmedListingId)
              .in("status", VISIBLE_APARTMENT_MATCH_STATUSES)
              .order("fit_score", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        authenticatedUserId
          ? loadPersistedRoommateGroupContext(
              supabase,
              [trimmedListingId],
              authenticatedUserId,
              { ensureViewerEdges: options.ensureViewerEdges === true },
            )
          : Promise.resolve(null),
      ]);

    if (matchResult.error) throw matchResult.error;

    return mapListing(listing, matchResult.data ?? undefined, photos, units, {
      includeEnriched: true,
      roommateGroupContext,
    });
  } catch (error) {
    // Fail-soft to "not found" for the page, but never silently: a transient
    // DB error here 404s live /l/ shortlinks texted to users.
    console.error("[apartments] listing detail load failed", {
      error: error instanceof Error ? error.message : String(error),
      listingId: trimmedListingId,
    });
    return null;
  }
}

/**
 * A logo is shown beside a label only when it was resolved for that label, or
 * when the source it came from names the same organization. Otherwise the
 * label stands alone — "Anthropic" wearing Meta's mark is worse than no mark.
 */
function pairedLogoUrl(
  label: string | null | undefined,
  ownLogoUrl: string | null | undefined,
  enrichmentLogoUrl: string | null,
  enrichmentLabel: string | null,
): string | null {
  const trimmed = label?.trim();
  if (!trimmed) return null;
  if (ownLogoUrl) return ownLogoUrl;
  if (!enrichmentLogoUrl || !enrichmentLabel) return null;
  return brandNameMatches(trimmed, enrichmentLabel) ? enrichmentLogoUrl : null;
}
