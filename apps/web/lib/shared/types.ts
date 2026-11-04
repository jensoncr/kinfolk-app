export type EvidencePoint = {
  label: string;
  detail: string;
};

export type ProfilePhoto = {
  id: string;
  url: string;
  position: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  source?: "linkedin" | "upload";
};

type KinfolkUser = {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  phoneVerified: boolean;
  externalAuthConnected: boolean;
  linkedinUrl: string;
  linkedinConnected: boolean;
  avatarUrl: string;
  launchMarket: string;
  dateOfBirth: string | null;
  birthYear: number | null;
  age: number | null;
  aboutText: string | null;
  interests: string[];
  occupationTitle: string | null;
  occupationCompany: string | null;
  occupationCompanyDomain: string | null;
  occupationCompanyLogoUrl: string | null;
  educationSchool: string | null;
  educationSchoolDomain: string | null;
  educationSchoolLogoUrl: string | null;
  educationDegree: string | null;
  educationMajor: string | null;
  educationYear: string | null;
  hometown: string | null;
  photos: ProfilePhoto[];
};

type MatchingProfile = {
  id: string;
  status: string;
  targetMarkets: string[];
  budgetMin: number;
  budgetMax: number;
  moveInStart: string;
  moveInEnd: string;
  householdSizeMin: number;
  householdSizeMax: number;
  visibilityMode: string;
  completenessScore: number;
};

type HousingPreferences = {
  neighborhoods: string[];
  commuteNotes: string;
  pets: string;
  mustHaves: string[];
  dealbreakers: string[];
  flexibilityNotes: string;
};

type RoommatePreferences = {
  lifestyleNotes: string;
  cleanliness: string;
  sleepSchedule: string;
  socialEnergy: string;
  hostingExpectations: string;
  conflictStyle: string;
  dealbreakers: string[];
  preferredAgeMin: number | null;
  preferredAgeMax: number | null;
  preferredAgeStrict: boolean;
};

export type LinkedInTimelineItem = {
  id: string;
  title: string;
  organization: string;
  subtitle: string;
  dateRange: string;
  logoUrl: string | null;
};

export type LinkedInEnrichmentStatus =
  | "not_started"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "skipped"
  | "source_not_configured";

type LinkedInProfile = {
  headline: string;
  resumeStatus: "missing" | "uploaded";
  salaryTarget: number | null;
  workMode: string;
  startDate: string;
  startupGrind: "no" | "not_sure" | "yes";
  workExperience: LinkedInTimelineItem[];
  education: LinkedInTimelineItem[];
  recentInteractions: string[];
  enrichmentStatus: LinkedInEnrichmentStatus;
  reviewStatus: "pending" | "needs_review" | "reviewed";
  sourceProvider: string | null;
  sourceConfidence: number | null;
  enrichedAt: string | null;
  lastError: string | null;
};

type MatchingInterview = {
  status: string;
  channel: string;
  completedAt: string;
  summary: string;
  extractionStatus: string;
};

export type MatchQueueItem = {
  id: string;
  candidateType: string;
  title: string;
  subtitle: string;
  status: string;
  fitScore: number;
  monthlyRent: number | null;
  evidence: EvidencePoint[];
  tradeoffs: EvidencePoint[];
  nextAction: string;
  expiresAt: string;
};

export type ProfileImportSummary = {
  id: string;
  provider: string;
  method: string;
  sourceLabel: string;
  status: string;
  schemaVersion: string;
  factCount: number;
  pendingFactCount: number;
  approvedFactCount: number;
  sensitiveFactCount: number;
  createdAt: string;
  processedAt: string | null;
  errorMessage: string | null;
};

export type ProfileFactSummary = {
  id: string;
  importId: string;
  dimension: string;
  factKey: string;
  value: string;
  confidence: number;
  importance: number;
  sensitivityLevel: string;
  matchingEligible: boolean;
  evidenceExcerpt: string;
  reviewState: string;
  createdAt: string;
};

type ProfileFactConflictSummary = {
  id: string;
  importId: string | null;
  conflictType: string;
  resolutionState: string;
};

export type CompatibilityEdgeSummary = {
  id: string;
  otherUserId: string;
  otherDisplayName: string;
  score: number;
  components: Record<string, number>;
  evidence: EvidencePoint[];
  risks: EvidencePoint[];
  computedAt: string;
};

export type ProfileEnrichmentSnapshot = {
  source: DashboardSource;
  imports: ProfileImportSummary[];
  facts: ProfileFactSummary[];
  conflicts: ProfileFactConflictSummary[];
  compatibility: CompatibilityEdgeSummary[];
  gaps: string[];
};

type AgentAccess = {
  activeConnections: number;
  recentTool: string;
  scopes: string[];
  lastSummary: string;
};

type DashboardSource = {
  kind: "supabase";
  status: "connected" | "unavailable" | "error";
  detail: string;
};

export type DashboardSnapshot = {
  source: DashboardSource;
  user: KinfolkUser;
  profile: MatchingProfile;
  housing: HousingPreferences;
  roommate: RoommatePreferences;
  linkedinProfile: LinkedInProfile;
  interview: MatchingInterview;
  queue: MatchQueueItem[];
  agentAccess: AgentAccess;
};
