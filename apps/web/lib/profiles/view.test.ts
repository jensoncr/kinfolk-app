import { describe, expect, it } from "vitest";
import { buildProfileViewModel } from "./view";
import type { DashboardSnapshot, ProfileEnrichmentSnapshot } from "../shared/types";

describe("buildProfileViewModel", () => {
  it("uses approved enrichment facts when stored profile fields are blank", () => {
    const view = buildProfileViewModel(
      baseSnapshot(),
      enrichmentSnapshot([
        fact("hometown", "Palo Alto, CA", "trust_context"),
        fact("pets", "pet friendly", "feasibility"),
        fact("cleanliness", "tidy", "home_labor"),
        fact("sleep_schedule", "early", "daily_rhythm"),
        fact("social_energy", "low key", "social_boundary"),
        fact("guests", "occasional", "social_boundary"),
      ]),
    );

    expect(view.hometown.value).toBe("Palo Alto, CA");
    expect(view.hometown.isUserEdited).toBe(false);
    expect(view.matchingPreferences.pets).toBe("pet friendly");
    expect(view.matchingPreferences.cleanliness).toBe("tidy");
    expect(view.matchingPreferences.sleepSchedule).toBe("early");
    expect(view.matchingPreferences.socialEnergy).toBe("low key");
    expect(view.matchingPreferences.hostingExpectations).toBe("occasional");
  });

  it("uses normalized hometown suggestions from assistant imports", () => {
    const view = buildProfileViewModel(
      baseSnapshot(),
      enrichmentSnapshot([fact("hometown", "Indianapolis, IN", "trust_context")]),
    );

    expect(view.hometown.value).toBe("Indianapolis, IN");
  });

  it("keeps stored profile fields ahead of imported suggestions", () => {
    const snapshot = baseSnapshot({
      hometown: "San Jose, CA",
      housingPets: "has pet",
      roommateCleanliness: "very tidy",
    });
    const view = buildProfileViewModel(
      snapshot,
      enrichmentSnapshot([
        fact("hometown", "Palo Alto, CA", "trust_context"),
        fact("pets", "pet friendly", "feasibility"),
        fact("cleanliness", "tidy", "home_labor"),
      ]),
    );

    expect(view.hometown.value).toBe("San Jose, CA");
    expect(view.hometown.isUserEdited).toBe(true);
    expect(view.matchingPreferences.pets).toBe("has pet");
    expect(view.matchingPreferences.cleanliness).toBe("very tidy");
  });

  it("ignores non-normalized stored hometowns", () => {
    const view = buildProfileViewModel(
      baseSnapshot({ hometown: "Indianapolis" }),
      enrichmentSnapshot([]),
    );

    expect(view.hometown.value).toBe("");
    expect(view.hometown.isUserEdited).toBe(false);
  });

  it("formats stored launch-market slugs for the profile header", () => {
    const view = buildProfileViewModel(
      baseSnapshot({ launchMarket: "san-francisco-ca" }),
      enrichmentSnapshot([]),
    );

    expect(view.launchMarket).toBe("San Francisco");
  });

  it("normalizes display names for the profile header", () => {
    expect(
      buildProfileViewModel(
        baseSnapshot({ displayName: "  Ada   Lovelace  " }),
        enrichmentSnapshot([]),
      ).displayName,
    ).toBe("Ada Lovelace");
    expect(
      buildProfileViewModel(
        baseSnapshot({ displayName: "   " }),
        enrichmentSnapshot([]),
      ).displayName,
    ).toBe("Kinfolk member");
  });
});

function baseSnapshot(
  overrides: {
    displayName?: string;
    hometown?: string | null;
    housingPets?: string;
    launchMarket?: string;
    roommateCleanliness?: string;
  } = {},
): DashboardSnapshot {
  return {
    source: { kind: "supabase", status: "connected", detail: "test" },
    user: {
      id: "user-1",
      displayName: overrides.displayName ?? "Jenson",
      email: "jenson@example.com",
      phone: "",
      phoneVerified: false,
      externalAuthConnected: true,
      linkedinUrl: "",
      linkedinConnected: true,
      avatarUrl: "",
      launchMarket: overrides.launchMarket ?? "San Francisco",
      dateOfBirth: null,
      birthYear: null,
      age: null,
      aboutText: null,
      interests: [],
      occupationTitle: null,
      occupationCompany: null,
      occupationCompanyDomain: null,
      occupationCompanyLogoUrl: null,
      educationSchoolDomain: null,
      educationSchoolLogoUrl: null,
      educationSchool: null,
      educationDegree: null,
      educationMajor: null,
      educationYear: null,
      hometown: overrides.hometown ?? null,
      photos: [],
    },
    profile: {
      id: "profile-1",
      status: "draft",
      targetMarkets: [],
      budgetMin: 0,
      budgetMax: 0,
      moveInStart: "",
      moveInEnd: "",
      householdSizeMin: 0,
      householdSizeMax: 0,
      visibilityMode: "anonymous",
      completenessScore: 0,
    },
    housing: {
      neighborhoods: [],
      commuteNotes: "",
      pets: overrides.housingPets ?? "",
      mustHaves: [],
      dealbreakers: [],
      flexibilityNotes: "",
    },
    roommate: {
      lifestyleNotes: "",
      cleanliness: overrides.roommateCleanliness ?? "",
      sleepSchedule: "",
      socialEnergy: "",
      hostingExpectations: "",
      conflictStyle: "",
      dealbreakers: [],
      preferredAgeMin: null,
      preferredAgeMax: null,
      preferredAgeStrict: false,
    },
    linkedinProfile: {
      headline: "",
      resumeStatus: "missing",
      salaryTarget: null,
      workMode: "",
      startDate: "",
      startupGrind: "not_sure",
      workExperience: [],
      education: [],
      recentInteractions: [],
      enrichmentStatus: "ready",
      reviewStatus: "reviewed",
      sourceProvider: null,
      sourceConfidence: null,
      enrichedAt: null,
      lastError: null,
    },
    interview: {
      status: "not_started",
      channel: "",
      completedAt: "",
      summary: "",
      extractionStatus: "",
    },
    queue: [],
    agentAccess: {
      activeConnections: 0,
      recentTool: "",
      scopes: [],
      lastSummary: "",
    },
  };
}

function enrichmentSnapshot(
  facts: ProfileEnrichmentSnapshot["facts"],
): ProfileEnrichmentSnapshot {
  return {
    source: { kind: "supabase", status: "connected", detail: "test" },
    imports: [],
    facts,
    conflicts: [],
    compatibility: [],
    gaps: [],
  };
}

function fact(
  factKey: string,
  value: string,
  dimension: string,
): ProfileEnrichmentSnapshot["facts"][number] {
  return {
    id: `${factKey}-1`,
    importId: "import-1",
    dimension,
    factKey,
    value,
    confidence: 0.9,
    importance: 0.8,
    sensitivityLevel: "standard",
    matchingEligible: true,
    evidenceExcerpt: value,
    reviewState: "approved",
    createdAt: "2026-05-31T00:00:00.000Z",
  };
}
