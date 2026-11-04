type FormingGroupMember = {
  userId?: string;
  name: string;
  initials: string;
  // Anonymous-mode member seen by a non-member viewer: first name + fit only,
  // no photo/work/school. Unlocks when the viewer is accepted into the group.
  locked?: boolean;
  imageUrl?: string;
  headline?: string;
  matchScore?: number;
  occupationTitle?: string;
  occupationCompany?: string;
  educationSchool?: string;
  educationDegree?: string;
  educationMajor?: string;
  educationYear?: string;
};

export type MembershipStatus = "requested" | "member";

export type LeasingHour = { day: string; open: string; close: string };

export type PetPolicy = {
  type: string;
  allowed: boolean;
};

export type ParkingOption = {
  type: string;
  spaces: number | null;
  note: string | null;
};

export type VideoTour = {
  url: string;
};

export type ListingAgent = {
  name: string;
  email: string | null;
};

export type FloorPlanUnit = {
  name: string;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  rentPrice: number | null;
  effectiveRentPrice?: number | null;
  status: string;
  availableAt: string | null;
  specificAmenities: string[];
};

export type RoommateGroupMemberColor = "forest" | "mint" | "warm" | "rust" | "sage";

// A four-point snapshot of how someone lives day to day — the signals a
// prospective roommate weighs before joining a group.
export type RoommateLifestyle = {
  sleep: string;
  kitchen: string;
  hosting: string;
  tidiness: string;
};

export type RoommateGroupMember = {
  userId?: string;
  name: string;
  initials: string;
  // Anonymous-mode member seen by a non-member viewer: the projection strips
  // identity (photo, work, school, bio, lifestyle, interests) and keeps first
  // name + the viewer's own fit signal. Cleared for public profiles, the
  // viewer themself, and viewers who are accepted members of the same group.
  locked?: boolean;
  color: RoommateGroupMemberColor;
  flex: boolean;
  membershipStatus?: MembershipStatus;
  imageUrl?: string;
  headline?: string;
  matchScore?: number;
  // Top compatibility dimensions behind matchScore (e.g. "Lifestyle", "Schedule"),
  // surfaced so the viewer sees *why* they'd fit this person.
  matchReasons?: string[];
  // Richer profile fields — surfaced when reviewing a group before joining.
  role?: string;
  occupationTitle?: string;
  occupationCompany?: string;
  // Enrichment-sourced company/school logos (from professional_profiles); the
  // profile modal renders them with a monogram fallback when absent.
  occupationCompanyLogoUrl?: string;
  educationSchool?: string;
  educationDegree?: string;
  educationMajor?: string;
  educationYear?: string;
  educationSchoolLogoUrl?: string;
  about?: string;
  lifestyle?: RoommateLifestyle;
  interests?: string[];
};

// How strongly a group filter is enforced when matching candidates.
export type GroupGate = "required" | "preferred";

// A single joinability filter: a value plus how strongly it's enforced.
type GroupFilter<T> = {
  value: T;
  gate: GroupGate;
};

export type GroupGenderPreference = "women" | "men" | "nonbinary";
export type GroupPetPreference = "friendly" | "none";
export type GroupMoveInWindow = "asap" | "1w" | "1m" | "1m-plus";

// Preferences a group's creator sets when starting it. Demographic fields
// (gender, age) are soft signals only — shown to candidates, never a gate —
// per the protected-class quarantine in ROOMMATE_MATCHING_RESEARCH.
export type GroupPreferences = {
  gender: GroupGenderPreference | null;
  ageMin: number | null;
  ageMax: number | null;
  pets: GroupFilter<GroupPetPreference> | null;
  industry: GroupFilter<string> | null;
  moveIn: GroupFilter<GroupMoveInWindow> | null;
};

export type RoommateGroup = {
  id: string;
  members: RoommateGroupMember[];
  targetUnitName: string | null;
  maxSize: number;
  viewerMembershipStatus?: MembershipStatus | null;
  preferences?: GroupPreferences | null;
  matchSummary?: string;
};

export type FloorPlanType = {
  id: string | null;
  name: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqftMin: number | null;
  sqftMax: number | null;
  rentPriceMin: number | null;
  rentPriceMax: number | null;
  effectiveRentPriceMin?: number | null;
  effectiveRentPriceMax?: number | null;
  availableAt: string | null;
  totalUnits: number;
  availableUnits: number;
  units: FloorPlanUnit[];
  specificAmenities: string[];
  leaseTerms: string[];
  imageUrl: string | null;
  groups: RoommateGroup[];
};

export type FloorPlanGroup = {
  bedroomTitle: string;
  availableUnitTypes: FloorPlanType[];
};

export type EnrichedDetail = {
  description: string | null;
  managementCompany: string | null;
  brokerage: string | null;
  agent: ListingAgent | null;
  mlsId: string | null;
  hasApplication: boolean;
  leasingOfficeSchedules: LeasingHour[];
  unitAmenities: string[];
  communityAmenities: string[];
  otherAmenities: string[];
  standardizedAmenities: string[];
  floorPlans: FloorPlanGroup[];
  totalUnits: number | null;
  totalUnitTypes: number | null;
  petPolicies: PetPolicy[];
  parking: ParkingOption[];
  videoTours: VideoTour[];
  applicationFee: number | null;
  phone: string | null;
  email: string | null;
  streetViewUrl: string | null;
  poiSummary: {
    transit: PoiItem[];
    restaurant: PoiItem[];
    parks: PoiItem[];
    grocery: PoiItem[];
  } | null;
};

type FormingGroup = {
  id: string;
  name: string;
  status: "forming" | "ready" | "touring";
  spotsTotal: number;
  spotsFilled: number;
  perPersonRent: number;
  fitScore: number;
  members: FormingGroupMember[];
  summary: string;
  viewerMembershipStatus?: MembershipStatus | null;
  preferences?: GroupPreferences | null;
};

export type ApartmentListing = {
  id: string;
  source: string;
  sourceUrl: string | null;
  listingStatus: string;
  providerMarket: string;
  address: string;
  unit: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  monthlyRent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  availableAt: string | null;
  description: string;
  amenities: string[];
  leaseTerms: string[];
  noFee: boolean;
  concessionMonths: number;
  concessionLeaseMonths: number;
  concessionNote: string | null;
  effectiveMonthlyRent: number | null;
  availableUnitCount: number;
  unitRentMin: number | null;
  unitRentMax: number | null;
  unitEffectiveRentMin: number | null;
  unitEffectiveRentMax: number | null;
  photoUrl: string | null;
  floorPlanMonthlyRent: number | null;
  floorPlanTypeCount: number;
  floorPlanBedroomMin: number | null;
  floorPlanBedroomMax: number | null;
  fitScore: number;
  roommateSplitLimit: number;
  householdSize: number;
  perPersonRent: number | null;
  effectivePerPersonRent: number | null;
  splitBreakdown: { name: string; amount: number }[];
  evidence: { label: string; detail: string }[];
  tradeoffs: { label: string; detail: string }[];
  formingGroups: FormingGroup[];
  photoUrls: string[];
  enriched: EnrichedDetail | null;
  surfaceFitScore?: number;
  /** When the pipeline first ingested this listing — drives "Newest first". */
  firstSeenAt?: string | null;
};

type PoiItem = {
  name: string;
  distance: number;
};

type NeighborhoodProfile = {
  id: string;
  market: string;
  name: string;
  displayName: string;
  latitude: number | null;
  longitude: number | null;
  listingCount: number;
  medianRent: number | null;
  rentMin: number | null;
  rentMax: number | null;
  bedroomDistribution: Record<string, number>;
  commonAmenities: string[];
  poiSummary: {
    transit: PoiItem[];
    restaurant: PoiItem[];
    parks: PoiItem[];
    grocery: PoiItem[];
  } | null;
};

export type ApartmentSearchSnapshot = {
  source: {
    kind: "supabase";
    status: "connected" | "unavailable" | "error";
    detail: string;
  };
  /**
   * ISO timestamp of the median last_seen_at across the returned listings —
   * i.e. when the typical displayed listing was last scraped from the source
   * (conservative under partially-failed imports). Null when Supabase is
   * unavailable or errored, no listings loaded, or none carry a timestamp.
   */
  refreshedAt: string | null;
  /** True when refreshedAt is old enough that listings may no longer be live. */
  refreshStale: boolean;
  market: string;
  listings: ApartmentListing[];
  neighborhoods: NeighborhoodProfile[];
  activeProfile: {
    budgetMin: number;
    budgetMax: number;
    dealbreakers: string[];
    householdSizeMin: number;
    householdSizeMax: number;
    moveInEnd: string;
    moveInStart: string;
    mustHaves: string[];
    neighborhoods: string[];
    pets: string;
  };
};
