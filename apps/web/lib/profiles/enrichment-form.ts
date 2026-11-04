import type {
  DashboardSnapshot,
  ProfileEnrichmentSnapshot,
  ProfileFactSummary,
} from "@/lib/shared/types";
import type { Json } from "@/lib/supabase/types";
import { normalizeStructuredFactValue } from "./fact-normalization";

const profileEnrichmentFormVersion = "kinfolk_profile_enrichment_form_v1";
export const profileEnrichmentSuccessText =
  "Saved. Looking good! Time to get started.\n\nWant me to show apartment matches that fit this profile? Reply SHOW APARTMENTS and I'll send a few.";

export type ProfileEnrichmentFormValues = {
  fullName: string;
  birthday: string;
  gender: string;
  hometown: string;
  occupationTitle: string;
  occupationCompany: string;
  /** Org-picker domain for the company; empty when typed as free text. */
  occupationCompanyDomain: string;
  educationSchool: string;
  /** Org-picker domain for the school; empty when typed as free text. */
  educationSchoolDomain: string;
  educationMajor: string;
  aboutText: string;
  interests: string[];
  musicTaste: string;
  sleepSchedule: string;
  workFromHome: string;
  cleanliness: string;
  noiseTolerance: string;
  socialEnergy: string;
  guests: string;
  pets: string;
  smoking: string;
  communicationStyle: string;
  conflictRepair: string;
  budgetMin: number;
  budgetMax: number;
  rentFlexibility: string;
  moveInBy: string;
  householdSize: string;
  openToRoommates: boolean;
  neighborhoods: string[];
  mustHaves: string[];
  dealbreakers: string[];
};

type ProfileEnrichmentProfilePatch = {
  aboutText?: string | null;
  interests?: string[] | null;
  occupationTitle?: string | null;
  occupationCompany?: string | null;
  occupationCompanyDomain?: string | null;
  educationSchool?: string | null;
  educationSchoolDomain?: string | null;
  educationMajor?: string | null;
  hometown?: string | null;
  age?: number | null;
  displayName?: string | null;
  dateOfBirth?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  moveInStart?: string | null;
  moveInEnd?: string | null;
  householdSizeMin?: number | null;
  householdSizeMax?: number | null;
};

export type ProfileEnrichmentFormMutation = {
  facts: Array<Record<string, Json>>;
  profilePatch: ProfileEnrichmentProfilePatch;
  revokeKeys: string[];
  summary: string;
  payload: Record<string, Json>;
};

const approvedReviewStates = new Set(["approved", "edited"]);
const draftPrefillProviders = new Set(["chatgpt", "claude", "linq", "sendblue"]);
const draftPrefillMinConfidence = 0.55;

const defaultValues: ProfileEnrichmentFormValues = {
  fullName: "",
  birthday: "",
  gender: "",
  hometown: "",
  occupationTitle: "",
  occupationCompany: "",
  occupationCompanyDomain: "",
  educationSchool: "",
  educationSchoolDomain: "",
  educationMajor: "",
  aboutText: "",
  interests: [],
  musicTaste: "",
  sleepSchedule: "",
  workFromHome: "",
  cleanliness: "",
  noiseTolerance: "",
  socialEnergy: "",
  guests: "",
  pets: "",
  smoking: "",
  communicationStyle: "",
  conflictRepair: "",
  budgetMin: 1400,
  budgetMax: 2600,
  rentFlexibility: "",
  moveInBy: "",
  householdSize: "",
  openToRoommates: true,
  neighborhoods: [],
  mustHaves: [],
  dealbreakers: [],
};

export function emptyProfileEnrichmentFormValues(): ProfileEnrichmentFormValues {
  return {
    ...defaultValues,
    interests: [],
    neighborhoods: [],
    mustHaves: [],
    dealbreakers: [],
  };
}

export function buildProfileEnrichmentFormValues(
  snapshot: DashboardSnapshot,
  enrichment: ProfileEnrichmentSnapshot,
): ProfileEnrichmentFormValues {
  const facts = getProfileEnrichmentFormPrefillFacts(enrichment);
  const values = emptyProfileEnrichmentFormValues();

  values.fullName = snapshot.user.displayName;
  values.birthday = snapshot.user.dateOfBirth ?? "";
  values.hometown = snapshot.user.hometown ?? readFactString(facts, "hometown");
  const workSchool = readWorkSchoolFacts(facts);
  values.occupationTitle = firstNonEmpty(
    snapshot.user.occupationTitle,
    workSchool.role,
  );
  values.occupationCompany = firstNonEmpty(
    snapshot.user.occupationCompany,
    workSchool.company,
  );
  values.occupationCompanyDomain = snapshot.user.occupationCompanyDomain ?? "";
  values.educationSchool = firstNonEmpty(
    snapshot.user.educationSchool,
    workSchool.school,
  );
  values.educationSchoolDomain = snapshot.user.educationSchoolDomain ?? "";
  values.educationMajor = firstNonEmpty(snapshot.user.educationMajor, workSchool.major);
  values.aboutText = snapshot.user.aboutText ?? "";
  values.interests = cleanList([
    ...snapshot.user.interests,
    ...readFactList(facts, "interests"),
  ]);
  values.musicTaste = readFactString(facts, "music_taste");
  values.sleepSchedule = normalizeChoice(
    snapshot.roommate.sleepSchedule || readFactString(facts, "sleep_schedule"),
    {
      "early bird": "early",
      early: "early",
      flexible: "flexible",
      "night owl": "late",
      late: "late",
    },
  );
  values.workFromHome = normalizeChoice(readFactString(facts, "work_from_home"), {
    hybrid: "hybrid",
    "mostly away": "mostly away",
    "mostly home": "mostly home",
    "mostly out": "mostly away",
  });
  values.cleanliness = normalizeChoice(
    snapshot.roommate.cleanliness || readFactString(facts, "cleanliness"),
    {
      easygoing: "relaxed",
      middle: "moderate",
      moderate: "moderate",
      relaxed: "relaxed",
      tidy: "tidy",
      "very relaxed": "very relaxed",
      "very tidy": "very tidy",
    },
  );
  values.noiseTolerance = normalizeChoice(readFactString(facts, "noise_tolerance"), {
    lively: "lively",
    moderate: "moderate",
    quiet: "quiet",
    "very lively": "very lively",
    "very quiet": "very quiet",
  });
  values.socialEnergy = normalizeChoice(
    snapshot.roommate.socialEnergy || readFactString(facts, "social_energy"),
    {
      balanced: "balanced",
      homebody: "homebody",
      "low key": "low key",
      social: "social",
      "very social": "very social",
    },
  );
  values.guests = normalizeChoice(
    snapshot.roommate.hostingExpectations || readFactString(facts, "guests"),
    {
      frequent: "frequent",
      often: "frequent",
      occasional: "occasional",
      rarely: "rare",
      rare: "rare",
      sometimes: "occasional",
    },
  );
  values.pets = normalizeChoice(snapshot.housing.pets || readFactString(facts, "pets"), {
    "has pet": "has pet",
    "i have a pet": "has pet",
    "no pets": "no pets",
    "pet friendly": "pet friendly",
  });
  values.smoking = normalizeChoice(readFactString(facts, "smoking"), {
    no: "no",
    "outdoor only": "outdoor only",
    yes: "yes",
  });
  values.communicationStyle = normalizeChoice(
    readFactString(facts, "communication_style"),
    {
      diplomatic: "diplomatic",
      direct: "direct",
      reserved: "reserved",
    },
  );
  values.conflictRepair = normalizeChoice(
    snapshot.roommate.conflictStyle || readFactString(facts, "conflict_repair"),
    {
      "address it now": "address now",
      "address now": "address now",
      avoid: "avoid",
      "cool off, then talk": "cooldown then talk",
      "cooldown then talk": "cooldown then talk",
      "let it slide": "avoid",
    },
  );
  values.budgetMin = boundedNumber(snapshot.profile.budgetMin, 500, 5000, 1400);
  values.budgetMax = boundedNumber(snapshot.profile.budgetMax, 500, 5000, 2600);
  values.rentFlexibility = normalizeRentTradeoff(
    firstNonEmpty(snapshot.housing.flexibilityNotes, readFactString(facts, "rent_tradeoff")),
  );
  values.moveInBy = snapshot.profile.moveInEnd || snapshot.profile.moveInStart || "";
  values.openToRoommates = isOpenToRoommatesFromProfile(snapshot.profile, facts);
  values.householdSize = values.openToRoommates
    ? householdSizeValue(snapshot.profile.householdSizeMin, snapshot.profile.householdSizeMax)
    : "";
  values.neighborhoods = cleanList([
    ...snapshot.housing.neighborhoods,
    ...readFactList(facts, "neighborhoods"),
  ]);
  values.mustHaves = cleanList([
    ...snapshot.housing.mustHaves,
    ...readFactList(facts, "must_haves"),
  ]);
  values.dealbreakers = cleanList([
    ...snapshot.housing.dealbreakers,
    ...snapshot.roommate.dealbreakers,
    ...readFactList(facts, "dealbreakers"),
  ]);

  if (values.budgetMin > values.budgetMax) {
    [values.budgetMin, values.budgetMax] = [values.budgetMax, values.budgetMin];
  }

  return values;
}

export function buildProfileEnrichmentFormMutation(
  values: ProfileEnrichmentFormValues,
): ProfileEnrichmentFormMutation {
  const cleaned = cleanFormValues(values);
  const age = ageFromIsoDate(cleaned.birthday);
  const profilePatch: ProfileEnrichmentProfilePatch = {
    aboutText: nullableText(cleaned.aboutText),
    interests: cleaned.interests,
    occupationTitle: nullableText(cleaned.occupationTitle),
    occupationCompany: nullableText(cleaned.occupationCompany),
    occupationCompanyDomain: nullableText(cleaned.occupationCompanyDomain),
    educationSchool: nullableText(cleaned.educationSchool),
    educationSchoolDomain: nullableText(cleaned.educationSchoolDomain),
    educationMajor: nullableText(cleaned.educationMajor),
    hometown: nullableText(cleaned.hometown),
    budgetMin: cleaned.budgetMin,
    budgetMax: cleaned.budgetMax,
    moveInStart: cleaned.moveInBy || null,
    moveInEnd: cleaned.moveInBy || null,
  };

  const household = cleaned.openToRoommates
    ? householdSizePatch(cleaned.householdSize || "me_plus_one")
    : { min: 1, max: 1 };
  profilePatch.householdSizeMin = household.min;
  profilePatch.householdSizeMax = household.max;

  if (cleaned.fullName) {
    profilePatch.displayName = cleaned.fullName;
  }
  if (cleaned.birthday) {
    profilePatch.dateOfBirth = cleaned.birthday;
    if (age !== null) {
      profilePatch.age = age;
    }
  }

  const facts: Array<Record<string, Json>> = [];
  const revokeKeys: string[] = [];
  const addFact = (factKey: string, value: Json) => {
    revokeKeys.push(factKey);
    if (isEmptyFactValue(value)) {
      return;
    }
    facts.push(webFormFact(factKey, value));
  };

  addFact("hometown", cleaned.hometown);
  addFact(
    "verified_work_or_school",
    cleanObject({
      role: cleaned.occupationTitle,
      company: cleaned.occupationCompany,
      school: cleaned.educationSchool,
      major: cleaned.educationMajor,
    }),
  );
  addFact("interests", cleaned.interests);
  addFact("music_taste", cleaned.musicTaste);
  addFact("sleep_schedule", cleaned.sleepSchedule);
  addFact("work_from_home", cleaned.workFromHome);
  addFact("cleanliness", cleaned.cleanliness);
  addFact("noise_tolerance", cleaned.noiseTolerance);
  addFact("social_energy", cleaned.socialEnergy);
  addFact("guests", cleaned.guests);
  addFact("pets", cleaned.pets);
  addFact("smoking", cleaned.smoking);
  addFact("communication_style", cleaned.communicationStyle);
  addFact("conflict_repair", cleaned.conflictRepair);
  if (cleaned.rentFlexibility) {
    addFact("rent_tradeoff", cleaned.rentFlexibility);
  }
  addFact("household_size", household);
  addFact("neighborhoods", cleaned.neighborhoods);
  addFact("must_haves", cleaned.mustHaves);
  addFact("dealbreakers", cleaned.dealbreakers);

  return {
    facts,
    profilePatch,
    revokeKeys: [...new Set(revokeKeys)],
    summary: buildFormSummary(cleaned),
    payload: {
      source: "profile_enrichment_form",
      schema_version: profileEnrichmentFormVersion,
      recorded_at: new Date().toISOString(),
      values: cleaned as unknown as Json,
      profile_facts: facts as unknown as Json,
    },
  };
}

function cleanFormValues(values: ProfileEnrichmentFormValues): ProfileEnrichmentFormValues {
  const budgetMin = boundedNumber(values.budgetMin, 500, 5000, 1400);
  const budgetMax = boundedNumber(values.budgetMax, 500, 5000, 2600);

  return {
    fullName: cleanText(values.fullName, 120),
    birthday: cleanIsoDate(values.birthday),
    gender: cleanText(values.gender, 40),
    hometown: cleanText(values.hometown, 120),
    occupationTitle: cleanText(values.occupationTitle, 120),
    occupationCompany: cleanText(values.occupationCompany, 120),
    occupationCompanyDomain: cleanText(values.occupationCompanyDomain, 253),
    educationSchool: cleanText(values.educationSchool, 120),
    educationSchoolDomain: cleanText(values.educationSchoolDomain, 253),
    educationMajor: cleanText(values.educationMajor, 120),
    aboutText: cleanText(values.aboutText, 800),
    interests: cleanList(values.interests).slice(0, 18),
    musicTaste: cleanText(values.musicTaste, 240),
    sleepSchedule: cleanText(values.sleepSchedule, 80),
    workFromHome: cleanText(values.workFromHome, 80),
    cleanliness: cleanText(values.cleanliness, 80),
    noiseTolerance: cleanText(values.noiseTolerance, 80),
    socialEnergy: cleanText(values.socialEnergy, 80),
    guests: cleanText(values.guests, 80),
    pets: cleanText(values.pets, 80),
    smoking: cleanText(values.smoking, 80),
    communicationStyle: cleanText(values.communicationStyle, 80),
    conflictRepair: cleanText(values.conflictRepair, 80),
    budgetMin: Math.min(budgetMin, budgetMax),
    budgetMax: Math.max(budgetMin, budgetMax),
    rentFlexibility: normalizeRentTradeoff(values.rentFlexibility),
    moveInBy: cleanIsoDate(values.moveInBy),
    householdSize: cleanText(values.householdSize, 40),
    openToRoommates: values.openToRoommates,
    neighborhoods: cleanList(values.neighborhoods).slice(0, 12),
    mustHaves: cleanList(values.mustHaves).slice(0, 12),
    dealbreakers: cleanList(values.dealbreakers).slice(0, 12),
  };
}

// Lean shape mirroring webPreferenceFact: the ingestion path
// (coerceStructuredProfileFact) re-derives dimension + importance from the
// canonical dimensionByKey table, so emitting them here is redundant and only
// risks drift.
function webFormFact(factKey: string, value: Json): Record<string, Json> {
  return {
    fact_key: factKey,
    value,
    assertion_type: "user_confirmed",
    confidence: 0.97,
    sensitivity_level: "standard",
    evidence: "Confirmed in the Kinfolk profile enrichment form",
  };
}

function getProfileEnrichmentFormPrefillFacts(enrichment: ProfileEnrichmentSnapshot) {
  const providerByImportId = new Map(
    enrichment.imports.map((item) => [item.id, item.provider.toLowerCase()]),
  );

  return enrichment.facts
    .filter((fact) => {
      if (approvedReviewStates.has(fact.reviewState)) {
        return true;
      }

      const provider = providerByImportId.get(fact.importId);
      return (
        fact.reviewState === "pending" &&
        fact.sensitivityLevel === "standard" &&
        fact.confidence >= draftPrefillMinConfidence &&
        Boolean(provider && draftPrefillProviders.has(provider))
      );
    })
    .sort(comparePrefillFacts);
}

function comparePrefillFacts(a: ProfileFactSummary, b: ProfileFactSummary) {
  const reviewDelta = prefillReviewPriority(a.reviewState) - prefillReviewPriority(b.reviewState);
  if (reviewDelta !== 0) {
    return reviewDelta;
  }

  const scoreA = a.confidence * 2 + a.importance;
  const scoreB = b.confidence * 2 + b.importance;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }

  return b.createdAt.localeCompare(a.createdAt);
}

function prefillReviewPriority(reviewState: string) {
  return approvedReviewStates.has(reviewState) ? 0 : 1;
}

function readFactString(facts: ProfileFactSummary[], factKey: string) {
  const value = factValue(facts, factKey);
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function readFactList(facts: ProfileFactSummary[], factKey: string) {
  const values: string[] = [];
  for (const fact of facts) {
    if (fact.factKey !== factKey) {
      continue;
    }

    const value = parseFactValue(fact.value);
    if (Array.isArray(value)) {
      values.push(...value.filter((entry): entry is string => typeof entry === "string"));
    } else if (typeof value === "string") {
      values.push(...value.split(/[,;\n]/));
    }
  }
  return cleanList(values);
}

function readWorkSchoolFacts(facts: ProfileFactSummary[]) {
  const structured = factValue(facts, "verified_work_or_school");
  const result = {
    company: "",
    major: "",
    role: "",
    school: "",
  };

  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    const record = structured as Record<string, Json>;
    result.role = cleanText(record.role ?? record.title, 120);
    result.company = cleanText(record.company ?? record.employer, 120);
    result.school = cleanText(record.school ?? record.education, 120);
    result.major = cleanText(record.major ?? record.fieldOfStudy, 120);
  } else if (typeof structured === "string") {
    const [work, school] = structured.split(/\s+·\s+/, 2);
    if (work) {
      const [role, company] = work.split(/\s+@\s+/, 2);
      result.role = cleanText(role, 120);
      result.company = cleanText(company, 120);
    }
    result.school = cleanText(school, 120);
  }

  const communities = readFactList(facts, "shared_communities");
  if (!result.company) {
    result.company = communities.find((community) => !looksLikeSchool(community)) ?? "";
  }
  if (!result.school) {
    result.school = communities.find(looksLikeSchool) ?? "";
  }

  return result;
}

function looksLikeSchool(value: string) {
  return /\b(university|college|school|institute|academy)\b/i.test(value);
}

function factValue(facts: ProfileFactSummary[], factKey: string): Json | null {
  const fact = facts.find((candidate) => candidate.factKey === factKey);
  if (!fact) {
    return null;
  }
  return parseFactValue(fact.value);
}

function parseFactValue(value: string): Json {
  try {
    return JSON.parse(value) as Json;
  } catch {
    return value;
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = cleanText(value, 160);
    if (cleaned) {
      return cleaned;
    }
  }
  return "";
}

function normalizeChoice(value: string, aliases: Record<string, string>) {
  const key = value.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return aliases[key] ?? key;
}

function normalizeRentTradeoff(value: string) {
  const cleaned = cleanText(value, 240).toLowerCase();
  if (!cleaned) {
    return "";
  }
  return normalizeStructuredFactValue("rent_tradeoff", cleaned) ?? "";
}

function householdSizeValue(min: number, max: number) {
  const size = Math.max(0, Math.round(max || min));
  const roommateMax = Math.max(0, size - 1);
  if (roommateMax >= 5) {
    return "5_plus";
  }
  if (roommateMax === 1) {
    return "me_plus_one";
  }
  return roommateMax > 0 ? String(roommateMax) : "";
}

function householdSizePatch(value: string) {
  if (value === "5_plus") {
    return { min: 1, max: 8 };
  }
  if (value === "me_plus_one") {
    return { min: 1, max: 2 };
  }
  const number = Number(value);
  if (Number.isFinite(number) && number >= 1) {
    const rounded = Math.round(number);
    return { min: 1, max: rounded + 1 };
  }
  return { min: null, max: null };
}

function isOpenToRoommatesFromProfile(
  profile: Pick<DashboardSnapshot["profile"], "householdSizeMin" | "householdSizeMax">,
  facts: ProfileFactSummary[],
): boolean {
  const profileMax = Math.max(0, Math.round(profile.householdSizeMax));
  if (profileMax > 0) {
    return profileMax > 1;
  }

  const householdValue = factValue(facts, "household_size");
  if (householdValue && typeof householdValue === "object" && !Array.isArray(householdValue)) {
    const max = readHouseholdSizeBound(
      (householdValue as Record<string, Json>).max ??
        (householdValue as Record<string, Json>).maximum,
    );
    if (max !== null) {
      return max > 1;
    }
  }

  const flexibility = readFactString(facts, "group_size_flexibility");
  if (flexibility) {
    if (
      /\b(solo|alone|no roommates?|not open|without roommates?)\b/i.test(flexibility)
    ) {
      return false;
    }
    if (/\b(open|yes|roommates?|shared|flexible)\b/i.test(flexibility)) {
      return true;
    }
  }

  return true;
}

function readHouseholdSizeBound(value: Json | undefined) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 8) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.match(/\b([1-8])\b/)?.[1] ?? value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 8 ? parsed : null;
  }
  return null;
}

function ageFromIsoDate(value: string) {
  if (!value) {
    return null;
  }
  const birthDate = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }
  const today = new Date();
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayThisYear = Date.UTC(
    today.getUTCFullYear(),
    birthDate.getUTCMonth(),
    birthDate.getUTCDate(),
  );
  if (Date.now() < birthdayThisYear) {
    age -= 1;
  }
  return age >= 18 && age <= 100 ? age : null;
}

function buildFormSummary(values: ProfileEnrichmentFormValues) {
  const pieces = [
    values.neighborhoods.length > 0
      ? `${values.neighborhoods.length} neighborhood${values.neighborhoods.length === 1 ? "" : "s"}`
      : null,
    values.interests.length > 0
      ? `${values.interests.length} interest${values.interests.length === 1 ? "" : "s"}`
      : null,
    values.sleepSchedule ? `sleep: ${values.sleepSchedule}` : null,
    values.cleanliness ? `cleanliness: ${values.cleanliness}` : null,
    values.openToRoommates ? "open to roommates" : "solo only",
  ].filter(Boolean);

  return pieces.length > 0
    ? `Profile enrichment form submitted (${pieces.join(", ")}).`
    : "Profile enrichment form submitted.";
}

function cleanList(values: unknown[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") {
      continue;
    }
    const value = cleanText(raw, 80);
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      cleaned.push(value);
    }
  }
  return cleaned;
}

function cleanObject(record: Record<string, string>): Json {
  const entries = Object.entries(record).flatMap(([key, value]) => {
    const cleaned = cleanText(value, 160);
    return cleaned.length > 0 ? [[key, cleaned] as const] : [];
  });
  return Object.fromEntries(entries) as Json;
}

function nullableText(value: string) {
  const cleaned = cleanText(value, 800);
  return cleaned || null;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function cleanIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = readFiniteNumber(value);
  if (number === null) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function readFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function isEmptyFactValue(value: Json) {
  if (value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}
