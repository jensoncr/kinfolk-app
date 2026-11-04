import {
  parseFactList,
  summarizeEnrichmentForProfile,
} from "./summary";
import { looksLikeEducationInstitution } from "./education";
import { normalizeMapboxLocationLabel } from "../shared/location-suggestions";
import {
  readProfileSetupState,
  type ProfileSetupState,
} from "./completion";
import type {
  DashboardSnapshot,
  LinkedInTimelineItem,
  ProfileEnrichmentSnapshot,
  ProfileFactSummary,
} from "@/lib/shared/types";

type ProfileEditField<T> = {
  value: T;
  isUserEdited: boolean;
  suggestion: T;
};

/** A resolved organization behind a work/school label. */
export type ProfileOrgRef = {
  domain: string | null;
  logoUrl: string | null;
};

type EducationView = {
  school: ProfileEditField<string>;
  degree: ProfileEditField<string>;
  major: ProfileEditField<string>;
  year: ProfileEditField<string>;
  isUserEdited: boolean;
  hasAny: boolean;
};

export type ProfileViewModel = {
  displayName: string;
  age: number | null;
  launchMarket: string;
  avatarUrl: string;
  setup: ProfileSetupState;
  matchingPreferences: MatchingPreferencesView;
  about: ProfileEditField<string>;
  occupationTitle: ProfileEditField<string>;
  occupationCompany: ProfileEditField<string>;
  /** Org-picker identity for the company: stable key + re-hosted logo. */
  occupationCompanyOrg: ProfileOrgRef;
  education: EducationView;
  /** Org-picker identity for the school. */
  educationSchoolOrg: ProfileOrgRef;
  hometown: ProfileEditField<string>;
  interests: ProfileEditField<string[]>;
  photos: DashboardSnapshot["user"]["photos"];
  importedWorkExperience: LinkedInTimelineItem[];
  importedEducation: LinkedInTimelineItem[];
};

export type MatchingPreferencesView = {
  locations: string[];
  neighborhoods: string[];
  pets: string;
  mustHaves: string[];
  dealbreakers: string[];
  cleanliness: string;
  noiseTolerance: string;
  sleepSchedule: string;
  workFromHome: string;
  socialEnergy: string;
  hostingExpectations: string;
  communicationStyle: string;
  conflictRepair: string;
  flexibilityNotes: string;
  roommateOpenness: string;
};

const APPROVED_STATES = new Set(["approved", "edited"]);
const LINKEDIN_STATUS_HEADLINES = new Set([
  "LinkedIn connected. Work and education history will appear after enrichment runs.",
  "Connect LinkedIn to import professional context.",
]);

export function buildProfileViewModel(
  snapshot: DashboardSnapshot,
  enrichment: ProfileEnrichmentSnapshot,
): ProfileViewModel {
  const aboutSuggestion = buildAboutSuggestion(snapshot, enrichment);
  const occupation = buildOccupationSuggestion(snapshot, enrichment);
  const educationSuggestion = buildEducationSuggestion(snapshot);
  const hometownSuggestion = buildHometownSuggestion(enrichment);
  const interestSuggestion = buildInterestSuggestion(enrichment);

  const educationFields = {
    school: makeField(
      snapshot.user.educationSchool,
      educationSuggestion.school,
    ),
    degree: makeField(
      snapshot.user.educationDegree,
      educationSuggestion.degree,
    ),
    major: makeField(snapshot.user.educationMajor, educationSuggestion.major),
    year: makeField(snapshot.user.educationYear, educationSuggestion.year),
  };
  const educationView: EducationView = {
    ...educationFields,
    isUserEdited:
      educationFields.school.isUserEdited ||
      educationFields.degree.isUserEdited ||
      educationFields.major.isUserEdited ||
      educationFields.year.isUserEdited,
    hasAny:
      educationFields.school.value.length > 0 ||
      educationFields.degree.value.length > 0 ||
      educationFields.major.value.length > 0 ||
      educationFields.year.value.length > 0,
  };

  return {
    displayName: formatDisplayName(snapshot.user.displayName),
    age: snapshot.user.age,
    launchMarket: formatLocationPreference(snapshot.user.launchMarket),
    avatarUrl: snapshot.user.avatarUrl,
    setup: readProfileSetupState(snapshot),
    matchingPreferences: buildMatchingPreferencesView(snapshot, enrichment),
    about: makeField(snapshot.user.aboutText, aboutSuggestion),
    occupationTitle: makeField(snapshot.user.occupationTitle, occupation.title),
    occupationCompany: makeField(
      snapshot.user.occupationCompany,
      occupation.company,
    ),
    occupationCompanyOrg: {
      domain: snapshot.user.occupationCompanyDomain,
      logoUrl: snapshot.user.occupationCompanyLogoUrl,
    },
    education: educationView,
    educationSchoolOrg: {
      domain: snapshot.user.educationSchoolDomain,
      logoUrl: snapshot.user.educationSchoolLogoUrl,
    },
    hometown: makeHometownField(snapshot.user.hometown, hometownSuggestion),
    interests: makeArrayField(snapshot.user.interests, interestSuggestion),
    photos: snapshot.user.photos,
    importedWorkExperience: snapshot.linkedinProfile.workExperience,
    importedEducation: snapshot.linkedinProfile.education,
  };
}

function buildMatchingPreferencesView(
  snapshot: DashboardSnapshot,
  enrichment: ProfileEnrichmentSnapshot,
): MatchingPreferencesView {
  return {
    locations: uniqueStrings(
      [
        ...snapshot.profile.targetMarkets,
        ...snapshot.housing.neighborhoods,
      ].map(formatLocationPreference),
    ),
    neighborhoods: uniqueStrings(
      snapshot.housing.neighborhoods.map(formatLocationPreference),
    ),
    pets: firstNonEmpty(snapshot.housing.pets, pickApprovedFact(enrichment.facts, ["pets"])),
    mustHaves: snapshot.housing.mustHaves,
    dealbreakers: uniqueStrings([
      ...snapshot.housing.dealbreakers,
      ...snapshot.roommate.dealbreakers,
    ]),
    cleanliness: firstNonEmpty(
      snapshot.roommate.cleanliness,
      pickApprovedFact(enrichment.facts, ["cleanliness"]),
    ),
    noiseTolerance: pickApprovedFact(enrichment.facts, ["noise_tolerance"]) ?? "",
    sleepSchedule: firstNonEmpty(
      snapshot.roommate.sleepSchedule,
      pickApprovedFact(enrichment.facts, ["sleep_schedule"]),
    ),
    workFromHome: pickApprovedFact(enrichment.facts, ["work_from_home"]) ?? "",
    socialEnergy: firstNonEmpty(
      snapshot.roommate.socialEnergy,
      pickApprovedFact(enrichment.facts, ["social_energy"]),
    ),
    hostingExpectations: firstNonEmpty(
      snapshot.roommate.hostingExpectations,
      pickApprovedFact(enrichment.facts, ["guests"]),
    ),
    communicationStyle:
      pickApprovedFact(enrichment.facts, ["communication_style"]) ?? "",
    conflictRepair: pickApprovedFact(enrichment.facts, ["conflict_repair"]) ?? "",
    flexibilityNotes:
      pickApprovedFact(enrichment.facts, ["rent_tradeoff"]) ??
      snapshot.housing.flexibilityNotes,
    roommateOpenness: normalizeRoommateOpennessFact(
      pickApprovedFact(enrichment.facts, [
        "household_size",
        "group_size_flexibility",
      ]),
    ),
  };
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed) {
      return trimmed;
    }
  }

  return "";
}

function formatDisplayName(value: string) {
  return value.replace(/\s+/g, " ").trim() || "Kinfolk member";
}

function formatLocationPreference(value: string) {
  if (value === "san-francisco-ca") {
    return "San Francisco";
  }

  return value;
}

function makeField(
  stored: string | null,
  suggestion: string,
): ProfileEditField<string> {
  const trimmed = stored?.trim() ?? "";
  if (trimmed.length > 0) {
    return { value: trimmed, isUserEdited: true, suggestion };
  }
  return { value: suggestion, isUserEdited: false, suggestion };
}

function makeHometownField(
  stored: string | null,
  suggestion: string,
): ProfileEditField<string> {
  const normalizedStored = normalizeMapboxLocationLabel(stored);
  if (normalizedStored.length > 0) {
    return {
      value: normalizedStored,
      isUserEdited: true,
      suggestion,
    };
  }
  return { value: suggestion, isUserEdited: false, suggestion };
}

function makeArrayField(
  stored: string[] | null,
  suggestion: string[],
): ProfileEditField<string[]> {
  const cleaned: string[] = [];
  for (const item of stored ?? []) {
    const trimmed = item.trim();
    if (trimmed) {
      cleaned.push(trimmed);
    }
  }

  if (cleaned.length > 0) {
    return { value: cleaned, isUserEdited: true, suggestion };
  }
  return { value: suggestion, isUserEdited: false, suggestion };
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cleaned);
  }

  return out;
}

function normalizeRoommateOpennessFact(value: string | null) {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!cleaned) {
    return "";
  }

  if (
    /\b(solo|alone|no roommates?|not open|without roommates?)\b/i.test(cleaned)
  ) {
    return "Solo only";
  }

  if (/\b(open|yes|roommates?)\b/i.test(cleaned)) {
    return cleaned;
  }

  return "";
}

function buildAboutSuggestion(
  snapshot: DashboardSnapshot,
  enrichment: ProfileEnrichmentSnapshot,
): string {
  const summary = summarizeEnrichmentForProfile(enrichment);
  const aboutText = summary.about.hasMemories
    ? summary.about.text.replace(/\.$/, "")
    : "";
  const headline = linkedInHeadlineForAbout(snapshot);

  if (
    aboutText &&
    headline &&
    !aboutText.toLowerCase().includes(headline.toLowerCase())
  ) {
    return `${aboutText}. ${headline}`.replace(/\s+\./g, ".").trim();
  }

  if (aboutText) {
    return `${aboutText}.`;
  }

  if (summary.quote) {
    return summary.quote.text.trim();
  }

  if (headline) {
    return headline;
  }

  return "";
}

function linkedInHeadlineForAbout(snapshot: DashboardSnapshot) {
  if (snapshot.linkedinProfile.enrichmentStatus !== "ready") {
    return "";
  }

  const headline = snapshot.linkedinProfile.headline?.trim() ?? "";
  return LINKEDIN_STATUS_HEADLINES.has(headline) ? "" : headline;
}

function buildOccupationSuggestion(
  snapshot: DashboardSnapshot,
  enrichment: ProfileEnrichmentSnapshot,
): { title: string; company: string } {
  const latestExperience = pickLatestExperience(
    snapshot.linkedinProfile.workExperience,
  );
  const headlineOccupation = splitHeadlineOccupation(
    linkedInHeadlineForAbout(snapshot),
  );

  if (
    headlineOccupation &&
    isGenericCurrentCompany(latestExperience?.title ?? "")
  ) {
    return headlineOccupation;
  }

  if (latestExperience) {
    return {
      title: isGenericCurrentCompany(latestExperience.title)
        ? ""
        : latestExperience.title.trim(),
      company: latestExperience.organization.trim(),
    };
  }

  if (headlineOccupation) {
    return headlineOccupation;
  }

  const roleFact = pickApprovedFact(enrichment.facts, ["current_role"]);
  if (roleFact) {
    const parts = roleFact.split(/\s+at\s+|\s+@\s+/);
    return {
      title: parts[0]?.trim() ?? roleFact.trim(),
      company: parts[1]?.trim() ?? "",
    };
  }

  return { title: "", company: "" };
}

function splitHeadlineOccupation(
  headline: string,
): { title: string; company: string } | null {
  const cleaned = headline.trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/\s+(?:@|at)\s+/i);
  if (parts.length >= 2) {
    const title = parts[0]?.trim() ?? "";
    const company = parts.slice(1).join(" at ").trim();

    if (title || company) {
      return { title, company };
    }
  }

  return { title: cleaned, company: "" };
}

function isGenericCurrentCompany(title: string): boolean {
  return title.trim().toLowerCase() === "current company";
}

function buildEducationSuggestion(snapshot: DashboardSnapshot): {
  school: string;
  degree: string;
  major: string;
  year: string;
} {
  const top = pickLatestExperience(snapshot.linkedinProfile.education);
  if (!top) {
    return { school: "", degree: "", major: "", year: "" };
  }

  const rawTitle = top.title.trim();
  const rawOrganization = top.organization.trim();
  const school =
    rawOrganization ||
    (looksLikeEducationInstitution(rawTitle) ? rawTitle : "");
  const degreeTitle = school === rawTitle ? "" : rawTitle;
  const { degree, major } = splitDegreeAndMajor(degreeTitle);

  return {
    school,
    degree,
    major,
    year: extractTerminalYear(top.dateRange ?? ""),
  };
}

function buildHometownSuggestion(enrichment: ProfileEnrichmentSnapshot): string {
  const hometown = pickApprovedFact(enrichment.facts, ["hometown"]);
  return normalizeMapboxLocationLabel(hometown);
}

function splitDegreeAndMajor(title: string): { degree: string; major: string } {
  const cleaned = title.trim();
  if (!cleaned) return { degree: "", major: "" };

  // Common short degree tokens at the start ("BS", "B.S.", "BA", "MBA", etc.).
  const match = cleaned.match(
    /^(B\.?[ASF]\.?|M\.?[ASBF]\.?|MBA|PhD|Ph\.?D\.?|MS|MA|JD|MD)\s*(?:in\s+|,\s*|-\s*|–\s*|\s+)(.+)$/i,
  );
  if (match) {
    return { degree: match[1].trim(), major: match[2].trim() };
  }

  // "<Major>, <School> ..." — only major-like content here, degree unknown.
  return { degree: "", major: cleaned };
}

function extractTerminalYear(value: string): string {
  if (!value) return "";
  const years = [...value.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]);
  if (years.length === 0) return "";
  return years[years.length - 1];
}

function pickLatestExperience(
  items: LinkedInTimelineItem[],
): LinkedInTimelineItem | null {
  if (items.length === 0) return null;
  return items[0];
}

function pickApprovedFact(
  facts: ProfileFactSummary[],
  keys: string[],
): string | null {
  const keySet = new Set(keys);
  let top: ProfileFactSummary | null = null;

  for (const fact of facts) {
    if (!APPROVED_STATES.has(fact.reviewState) || !keySet.has(fact.factKey)) {
      continue;
    }
    if (!top || fact.importance > top.importance) {
      top = fact;
    }
  }

  return top?.value?.trim() ?? null;
}

const interestKeywords: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "AI & startups",
    pattern: /\b(ai|agent|llm|startup|founder|builder)\b/i,
  },
  {
    label: "Design",
    pattern: /\b(design|visual|aesthetic|brand|typography)\b/i,
  },
  {
    label: "Music",
    pattern: /\b(music|rap|guitar|piano|dj|playlist|vocals)\b/i,
  },
  {
    label: "Fitness",
    pattern:
      /\b(fitness|gym|lifting|run(?:ning)?|cycling|crossfit|ufc|boxing)\b/i,
  },
  { label: "Travel", pattern: /\b(travel|backpack|tokyo|abroad|trip)\b/i },
  {
    label: "Cooking",
    pattern: /\b(cook(?:ing|s)?|chef|kitchen|baking|food)\b/i,
  },
  {
    label: "Outdoors",
    pattern: /\b(hik(?:e|ing)|camp(?:ing)?|trail|mountain|outdoors|nature)\b/i,
  },
  { label: "Reading", pattern: /\b(read(?:ing)?|book|literature|essays?)\b/i },
  { label: "Film", pattern: /\b(film|movie|cinema|director|filmmaking)\b/i },
  {
    label: "Internet culture",
    pattern: /\b(meme|short[- ]?form|tiktok|internet culture|clips?)\b/i,
  },
  { label: "Gaming", pattern: /\b(gaming|game|esports|console|pc gaming)\b/i },
  {
    label: "Photography",
    pattern: /\b(photography|photographer|camera|film camera)\b/i,
  },
];

function buildInterestSuggestion(
  enrichment: ProfileEnrichmentSnapshot,
): string[] {
  const approved = enrichment.facts.filter((fact) =>
    APPROVED_STATES.has(fact.reviewState),
  );
  if (approved.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const { label, pattern } of interestKeywords) {
    for (const fact of approved) {
      const haystack = `${fact.factKey} ${fact.value} ${fact.evidenceExcerpt ?? ""}`;
      if (pattern.test(haystack) && !seen.has(label)) {
        seen.add(label);
        out.push(label);
        break;
      }
    }
    if (out.length >= 6) {
      break;
    }
  }

  if (out.length < 6) {
    for (const fact of approved) {
      if (fact.factKey === "interests" || fact.factKey === "hobbies") {
        for (const value of parseFactList(fact.value)) {
          const cleaned = value.trim();
          const key = cleaned.toLowerCase();
          if (cleaned && !seen.has(key)) {
            seen.add(key);
            out.push(cleaned);
            if (out.length >= 6) {
              break;
            }
          }
        }
      }
    }
  }

  return out.slice(0, 6);
}
