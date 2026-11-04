import { describe, expect, it } from "vitest";
import {
  buildProfileEnrichmentFormMutation,
  buildProfileEnrichmentFormValues,
  emptyProfileEnrichmentFormValues,
  profileEnrichmentSuccessText,
} from "./enrichment-form";
import type {
  DashboardSnapshot,
  ProfileEnrichmentSnapshot,
  ProfileFactSummary,
} from "../shared/types";

describe("profile enrichment form", () => {
  it("celebrates the saved profile and offers apartment matches", () => {
    expect(profileEnrichmentSuccessText).toBe(
      "Saved. Looking good! Time to get started.\n\nWant me to show apartment matches that fit this profile? Reply SHOW APARTMENTS and I'll send a few.",
    );
  });

  it("prefills from canonical profile fields and approved facts", () => {
    const values = buildProfileEnrichmentFormValues(
      dashboardSnapshot(),
      enrichmentSnapshot([
        fact("neighborhoods", JSON.stringify(["Mission", "Hayes Valley"]), "feasibility"),
        fact("music_taste", "jazz, soul, indie film scores", "rapport_taste"),
        fact(
          "verified_work_or_school",
          "Portfolio Operations @ Fifth Wall · University of Notre Dame - Mendoza College of Business",
          "trust_context",
        ),
        fact("work_from_home", "hybrid", "daily_rhythm"),
        fact("communication_style", "direct", "communication"),
        fact(
          "rent_tradeoff",
          "I would pay more for the right fit.",
          "preference_elasticity",
        ),
      ]),
    );

    expect(values.fullName).toBe("Jenson Cripps");
    expect(values.birthday).toBe("1996-04-12");
    expect(values.hometown).toBe("San Francisco, CA");
    expect(values.interests).toEqual(["Cooking", "Film"]);
    expect(values.occupationTitle).toBe("Portfolio Operations");
    expect(values.occupationCompany).toBe("Fifth Wall");
    expect(values.educationSchool).toBe(
      "University of Notre Dame - Mendoza College of Business",
    );
    expect(values.neighborhoods).toEqual(["Mission", "Hayes Valley"]);
    expect(values.musicTaste).toBe("jazz, soul, indie film scores");
    expect(values.workFromHome).toBe("hybrid");
    expect(values.communicationStyle).toBe("direct");
    expect(values.rentFlexibility).toBe("pay more for fit");
    expect(values.budgetMin).toBe(1400);
    expect(values.budgetMax).toBe(2600);
    expect(values.householdSize).toBe("me_plus_one");
  });

  it("uses pending ChatGPT and Claude memories as draft prefill values", () => {
    const values = buildProfileEnrichmentFormValues(
      dashboardSnapshot(),
      enrichmentSnapshot(
        [
          fact("sleep_schedule", "early", "daily_rhythm", {
            confidence: 0.8,
            importId: "chatgpt-import",
            reviewState: "pending",
          }),
          fact("interests", JSON.stringify(["Coffee", "Travel"]), "rapport_taste", {
            confidence: 0.75,
            importId: "claude-import",
            reviewState: "pending",
          }),
          fact("noise_tolerance", "quiet", "environment_tolerance", {
            confidence: 0.5,
            importId: "chatgpt-import",
            reviewState: "pending",
          }),
          fact("cleanliness", "tidy", "home_labor", {
            importId: "manual-import",
            reviewState: "pending",
          }),
        ],
        [
          profileImport("chatgpt-import", "chatgpt"),
          profileImport("claude-import", "claude"),
          profileImport("manual-import", "manual"),
        ],
      ),
    );

    expect(values.sleepSchedule).toBe("early");
    expect(values.interests).toEqual(["Cooking", "Film", "Coffee", "Travel"]);
    expect(values.noiseTolerance).toBe("");
    expect(values.cleanliness).toBe("");
  });

  it("uses pending text-agent facts as draft prefill values", () => {
    const values = buildProfileEnrichmentFormValues(
      dashboardSnapshot(),
      enrichmentSnapshot(
        [
          fact("cleanliness", "tidy", "home_labor", {
            confidence: 0.8,
            importId: "sendblue-import",
            reviewState: "pending",
          }),
          fact("guests", "frequent", "social_boundary", {
            confidence: 0.72,
            importId: "linq-import",
            reviewState: "pending",
          }),
          fact("social_energy", "very social", "social_boundary", {
            confidence: 0.45,
            importId: "sendblue-import",
            reviewState: "pending",
          }),
        ],
        [
          profileImport("sendblue-import", "sendblue"),
          profileImport("linq-import", "linq"),
        ],
      ),
    );

    expect(values.cleanliness).toBe("tidy");
    expect(values.guests).toBe("frequent");
    expect(values.socialEnergy).toBe("");
  });

  // The enrichment form is the path people take when LinkedIn returns no work
  // or education, so a picked organization has to survive the round trip.
  it("carries picked organization domains into the profile patch", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      occupationCompany: "Fifth Wall",
      occupationCompanyDomain: "fifthwall.com",
      educationSchool: "University of Notre Dame",
      educationSchoolDomain: "nd.edu",
    });

    expect(mutation.profilePatch.occupationCompanyDomain).toBe("fifthwall.com");
    expect(mutation.profilePatch.educationSchoolDomain).toBe("nd.edu");
  });

  it("sends no domain when the organization was typed as free text", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      occupationCompany: "Some Made Up Company",
      occupationCompanyDomain: "",
    });

    expect(mutation.profilePatch.occupationCompany).toBe("Some Made Up Company");
    expect(mutation.profilePatch.occupationCompanyDomain).toBeNull();
  });

  it("maps submitted values to canonical fields and approved fact slots", () => {
    const values = {
      ...emptyProfileEnrichmentFormValues(),
      fullName: "Jenson Cripps",
      birthday: "1996-04-12",
      hometown: "San Francisco, CA",
      occupationTitle: "Founder",
      occupationCompany: "Kinfolk",
      interests: ["Cooking", "Film"],
      sleepSchedule: "late",
      workFromHome: "hybrid",
      cleanliness: "tidy",
      noiseTolerance: "quiet",
      socialEnergy: "balanced",
      guests: "occasional",
      pets: "pet friendly",
      smoking: "no",
      communicationStyle: "direct",
      conflictRepair: "address now",
      budgetMin: 1500,
      budgetMax: 2800,
      rentFlexibility: "pay more for fit",
      moveInBy: "2026-08-01",
      householdSize: "3",
      neighborhoods: ["Mission", "Hayes Valley"],
      mustHaves: ["Natural light"],
      dealbreakers: ["Smoking indoors"],
    };

    const mutation = buildProfileEnrichmentFormMutation(values);

    expect(mutation.profilePatch).toMatchObject({
      displayName: "Jenson Cripps",
      dateOfBirth: "1996-04-12",
      hometown: "San Francisco, CA",
      budgetMin: 1500,
      budgetMax: 2800,
      moveInStart: "2026-08-01",
      moveInEnd: "2026-08-01",
      householdSizeMin: 1,
      householdSizeMax: 4,
    });
    expect(mutation.revokeKeys).toEqual(
      expect.arrayContaining([
        "sleep_schedule",
        "work_from_home",
        "cleanliness",
        "noise_tolerance",
        "neighborhoods",
        "must_haves",
        "dealbreakers",
        "rent_tradeoff",
      ]),
    );
    expect(mutation.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fact_key: "sleep_schedule", value: "late" }),
        expect.objectContaining({ fact_key: "work_from_home", value: "hybrid" }),
        expect.objectContaining({
          fact_key: "neighborhoods",
          value: ["Mission", "Hayes Valley"],
        }),
        expect.objectContaining({
          fact_key: "verified_work_or_school",
          value: { role: "Founder", company: "Kinfolk" },
        }),
        expect.objectContaining({
          fact_key: "rent_tradeoff",
          value: "pay more for fit",
        }),
        expect.objectContaining({
          fact_key: "household_size",
          value: { min: 1, max: 4 },
        }),
      ]),
    );
    expect(mutation.payload.source).toBe("profile_enrichment_form");
  });

  it("defaults invalid submitted budget values instead of coercing booleans or blanks", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      budgetMax: true as unknown as number,
      budgetMin: "   " as unknown as number,
      fullName: "Jenson Cripps",
    });

    expect(mutation.profilePatch.budgetMin).toBe(1400);
    expect(mutation.profilePatch.budgetMax).toBe(2600);
    expect(mutation.payload.values).toMatchObject({
      budgetMin: 1400,
      budgetMax: 2600,
    });
  });

  it("accepts trimmed numeric budget strings from direct form payloads", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      budgetMax: " 3200 " as unknown as number,
      budgetMin: " 1800 " as unknown as number,
      fullName: "Jenson Cripps",
    });

    expect(mutation.profilePatch.budgetMin).toBe(1800);
    expect(mutation.profilePatch.budgetMax).toBe(3200);
    expect(mutation.payload.values).toMatchObject({
      budgetMin: 1800,
      budgetMax: 3200,
    });
  });

  it("stores one roommate as a household max of two", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      fullName: "Jenson Cripps",
      budgetMin: 1500,
      budgetMax: 2800,
      householdSize: "me_plus_one",
      openToRoommates: true,
    });

    expect(mutation.profilePatch.householdSizeMin).toBe(1);
    expect(mutation.profilePatch.householdSizeMax).toBe(2);
    expect(mutation.facts).toContainEqual(
      expect.objectContaining({
        fact_key: "household_size",
        value: { min: 1, max: 2 },
      }),
    );
  });

  it("defaults roommate openness to one roommate when no max is selected", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      fullName: "Jenson Cripps",
      budgetMin: 1500,
      budgetMax: 2800,
      householdSize: "",
      openToRoommates: true,
    });

    expect(mutation.profilePatch.householdSizeMin).toBe(1);
    expect(mutation.profilePatch.householdSizeMax).toBe(2);
    expect(mutation.facts).toContainEqual(
      expect.objectContaining({
        fact_key: "household_size",
        value: { min: 1, max: 2 },
      }),
    );
  });

  it("stores 5+ roommates as an open-ended household max range", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      fullName: "Jenson Cripps",
      budgetMin: 1500,
      budgetMax: 2800,
      householdSize: "5_plus",
      openToRoommates: true,
    });

    expect(mutation.profilePatch.householdSizeMin).toBe(1);
    expect(mutation.profilePatch.householdSizeMax).toBe(8);
    expect(mutation.facts).toContainEqual(
      expect.objectContaining({
        fact_key: "household_size",
        value: { min: 1, max: 8 },
      }),
    );
  });

  it("keeps the optional rent flexibility pill unset when skipped", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      fullName: "Jenson Cripps",
      budgetMin: 1500,
      budgetMax: 2800,
    });

    expect(mutation.revokeKeys).not.toContain("rent_tradeoff");
    expect(mutation.facts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ fact_key: "rent_tradeoff" })]),
    );
  });

  it("hides household size prefill when the user is solo-only", () => {
    const values = buildProfileEnrichmentFormValues(
      {
        ...dashboardSnapshot(),
        profile: {
          ...dashboardSnapshot().profile,
          householdSizeMin: 1,
          householdSizeMax: 1,
        },
      },
      enrichmentSnapshot([]),
    );

    expect(values.openToRoommates).toBe(false);
    expect(values.householdSize).toBe("");
  });

  it("hides household size prefill when iMessage intake saved solo openness", () => {
    const values = buildProfileEnrichmentFormValues(
      {
        ...dashboardSnapshot(),
        profile: {
          ...dashboardSnapshot().profile,
          householdSizeMin: 0,
          householdSizeMax: 0,
        },
      },
      enrichmentSnapshot([
        fact("group_size_flexibility", "Solo only", "preference_elasticity"),
      ]),
    );

    expect(values.openToRoommates).toBe(false);
    expect(values.householdSize).toBe("");
  });

  it("saves explicit solo household size on submit", () => {
    const mutation = buildProfileEnrichmentFormMutation({
      ...emptyProfileEnrichmentFormValues(),
      fullName: "Jenson Cripps",
      budgetMin: 1500,
      budgetMax: 2800,
      openToRoommates: false,
      householdSize: "",
    });

    expect(mutation.profilePatch.householdSizeMin).toBe(1);
    expect(mutation.profilePatch.householdSizeMax).toBe(1);
    expect(mutation.facts).toContainEqual(
      expect.objectContaining({
        fact_key: "household_size",
        value: { min: 1, max: 1 },
      }),
    );
  });
});

function dashboardSnapshot(): DashboardSnapshot {
  return {
    source: { kind: "supabase", status: "connected", detail: "test" },
    user: {
      id: "user-1",
      displayName: "Jenson Cripps",
      email: "jenson@example.com",
      phone: "",
      phoneVerified: false,
      externalAuthConnected: true,
      linkedinUrl: "",
      linkedinConnected: true,
      avatarUrl: "",
      launchMarket: "San Francisco",
      dateOfBirth: "1996-04-12",
      birthYear: 1996,
      age: 30,
      aboutText: null,
      interests: ["Cooking", "Film"],
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
      hometown: "San Francisco, CA",
      photos: [],
    },
    profile: {
      id: "profile-1",
      status: "draft",
      targetMarkets: ["San Francisco"],
      budgetMin: 1400,
      budgetMax: 2600,
      moveInStart: "2026-08-01",
      moveInEnd: "2026-08-01",
      householdSizeMin: 2,
      householdSizeMax: 2,
      visibilityMode: "anonymous",
      completenessScore: 0,
    },
    housing: {
      neighborhoods: [],
      commuteNotes: "",
      pets: "",
      mustHaves: [],
      dealbreakers: [],
      flexibilityNotes: "",
    },
    roommate: {
      lifestyleNotes: "",
      cleanliness: "",
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
      status: "",
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
  facts: ProfileFactSummary[],
  imports: ProfileEnrichmentSnapshot["imports"] = [],
): ProfileEnrichmentSnapshot {
  return {
    source: { kind: "supabase", status: "connected", detail: "test" },
    imports,
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
  overrides: Partial<ProfileFactSummary> = {},
): ProfileFactSummary {
  return {
    id: `fact-${factKey}`,
    importId: "import-1",
    dimension,
    factKey,
    value,
    confidence: 0.97,
    importance: 0.8,
    sensitivityLevel: "standard",
    matchingEligible: true,
    evidenceExcerpt: "test",
    reviewState: "approved",
    createdAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function profileImport(id: string, provider: string): ProfileEnrichmentSnapshot["imports"][number] {
  return {
    id,
    provider,
    method: "paste",
    sourceLabel: `${provider} import`,
    status: "needs_review",
    schemaVersion: "test",
    factCount: 1,
    pendingFactCount: 1,
    approvedFactCount: 0,
    sensitiveFactCount: 0,
    createdAt: "2026-06-02T00:00:00.000Z",
    processedAt: "2026-06-02T00:00:00.000Z",
    errorMessage: null,
  };
}
