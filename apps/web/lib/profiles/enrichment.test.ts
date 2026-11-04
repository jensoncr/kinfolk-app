import { describe, expect, it, vi } from "vitest";
import {
  assistantAutoApproveConfidenceThresholdForFact,
  consolidateProfileFactsForProjection,
  detectProfileFactConflicts,
  extractProfileFacts,
  extractProfileImportMetadata,
  filterFactsForImportProvider,
  isHedgedStructuredProfileFact,
  isFullyApprovedProfileImport,
  isInformativeProfileFact,
  mapFactForScoring,
  parseProfileImportText,
  profileImportStatusForFactReviewStates,
  reconcileProfileFactImport,
  shouldAutoApproveCrossProviderCorroboration,
  type ExtractedProfileFact,
  type ProfileFactForScoring,
} from "./enrichment";
import {
  assistantProfileFactKeys,
  isCanonicalAssistantProfileFactKey,
} from "./canonical-facts";
import { scoreCompatibility } from "../matching/compatibility-scoring";

vi.mock("server-only", () => ({}));

describe("parseProfileImportText", () => {
  const assistantPayload = {
    profile_facts: [
      {
        assertion_type: "explicit",
        confidence: 0.92,
        dimension: "communication",
        evidence: "I prefer direct, practical answers.",
        fact_key: "communication_style",
        sensitivity_level: "standard",
        value: "Prefers direct, practical answers",
      },
    ],
    schema_version: "kinfolk_assistant_profile_v9",
    source_assistant: "claude",
  };

  function expectImportPayload(text: string) {
    expect(parseProfileImportText(text).payload).toEqual(assistantPayload);
  }

  it("parses Claude whole-message copies wrapped in a JSON code fence", () => {
    expectImportPayload(`\`\`\`json
${JSON.stringify(assistantPayload, null, 2)}
\`\`\``);
  });

  it("parses selected code block text that keeps the language signifier", () => {
    expectImportPayload(`json
${JSON.stringify(assistantPayload, null, 2)}`);
  });

  it("parses longer markdown and tilde fences around assistant JSON", () => {
    expectImportPayload(`\`\`\`\`json
${JSON.stringify(assistantPayload, null, 2)}
\`\`\`\``);
    expectImportPayload(`~~~json
${JSON.stringify(assistantPayload, null, 2)}
~~~`);
  });

  it("extracts fenced JSON from surrounding assistant prose", () => {
    expectImportPayload(`Here is the import payload:

\`\`\`json
${JSON.stringify(assistantPayload, null, 2)}
\`\`\`

Paste this into Kinfolk.`);
  });

  it("repairs unescaped quoted source language in v9 assistant exports", () => {
    const imported = parseProfileImportText(
      `{"schema_version":"kinfolk_assistant_profile_v9","source_assistant":"chatgpt","profile_facts":[{"dimension":"trust_context","fact_key":"hometown","value":"Indianapolis","evidence":"He said he is "from Indianapolis.""},{"dimension":"daily_rhythm","fact_key":"routine_regularity","value":"regular","evidence":"He said he "lifts daily.""}],"contradictions_or_uncertainties":["The evidence supports "mostly away," but not exact days."]}`,
    );

    expect(imported.payload).toMatchObject({
      profile_facts: [
        { evidence: 'He said he is "from Indianapolis."' },
        { evidence: 'He said he "lifts daily."' },
      ],
      contradictions_or_uncertainties: [
        'The evidence supports "mostly away," but not exact days.',
      ],
    });
  });

  it("does not repair unrelated malformed JSON", () => {
    expect(() => parseProfileImportText(`{"note":"He said "hello.""}`)).toThrow(
      "Invalid JSON",
    );
  });
});

describe("extractProfileImportMetadata", () => {
  it("parses snake_case assistant import metadata", () => {
    const metadata = extractProfileImportMetadata({
      profile_summary: {
        short_self_summary: "Product-minded engineer who values quiet evenings.",
        living_with_me_is_like: "Calm, tidy, and direct about shared-space resets.",
        known_uncertainties: ["Exact guest cadence"],
      },
      recommended_follow_up_questions: [
        "How often do you host overnight guests?",
      ],
      contradictions_or_uncertainties: ["Sleep schedule varies on weekends"],
    });

    expect(metadata).toEqual({
      profileSummary: {
        shortSelfSummary: "Product-minded engineer who values quiet evenings.",
        livingWithMeIsLike: "Calm, tidy, and direct about shared-space resets.",
        knownUncertainties: ["Exact guest cadence"],
      },
      recommendedFollowUpQuestions: [
        "How often do you host overnight guests?",
      ],
      contradictionsOrUncertainties: ["Sleep schedule varies on weekends"],
    });
  });

  it("accepts camelCase metadata keys", () => {
    const metadata = extractProfileImportMetadata({
      profileSummary: {
        shortSelfSummary: "Early riser and home cook.",
        livingWithMeIsLike: "Low-key weekday routine.",
      },
      recommendedFollowUpQuestions: ["Do you work from home?"],
      contradictionsOrUncertainties: [],
    });

    expect(metadata.profileSummary?.shortSelfSummary).toBe(
      "Early riser and home cook.",
    );
    expect(metadata.profileSummary?.livingWithMeIsLike).toBe(
      "Low-key weekday routine.",
    );
    expect(metadata.recommendedFollowUpQuestions).toEqual([
      "Do you work from home?",
    ]);
    expect(metadata.contradictionsOrUncertainties).toBeUndefined();
  });

  it("returns an empty object when metadata is missing", () => {
    expect(extractProfileImportMetadata({ profile_facts: [] })).toEqual({});
    expect(extractProfileImportMetadata(null)).toEqual({});
  });
});

describe("profile enrichment fact reconciliation", () => {
  it("drops non-informative assistant facts instead of turning missing data into memories", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "inferred",
          confidence: 0.2,
          dimension: "home_labor",
          evidence: "No direct evidence of cleanliness, chore-sharing, or kitchen habits",
          fact_key: "chores",
          sensitivity_level: "standard",
          value: "No direct evidence of cleanliness, chore-sharing, or kitchen habits",
        },
        {
          assertion_type: "explicit",
          confidence: 0.92,
          dimension: "communication",
          evidence: "prefers direct, practical answers",
          fact_key: "communication_style",
          sensitivity_level: "standard",
          value: "Prefers direct, practical answers",
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKey).toBe("communication_style");
  });

  it("rejects hedged midpoint cleanliness facts during extraction", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "inferred",
          confidence: 0.25,
          dimension: "home_labor",
          evidence: "No direct preference, defaulting to midpoint",
          fact_key: "cleanliness",
          sensitivity_level: "standard",
          value: "moderate",
        },
      ],
    });

    expect(facts).toHaveLength(0);
  });

  it("flags hedged structured facts explicitly", () => {
    expect(
      isHedgedStructuredProfileFact({
        assertionType: "inferred",
        confidence: 0.25,
        evidenceExcerpt: "No direct preference, defaulting to midpoint",
        factKey: "cleanliness",
        normalizedValue: "moderate",
        value: "moderate",
      }),
    ).toBe(true);
    expect(
      isInformativeProfileFact({
        assertionType: "inferred",
        confidence: 0.25,
        evidenceExcerpt: "No direct preference, defaulting to midpoint",
        factKey: "cleanliness",
        normalizedValue: "moderate",
        value: "moderate",
      }),
    ).toBe(false);
    expect(
      isInformativeProfileFact({
        assertionType: "explicit",
        confidence: 0.9,
        evidenceExcerpt: "Prefers quiet evenings",
        normalizedValue: "quiet evenings",
        value: "quiet evenings",
      }),
    ).toBe(false);
  });

  it("uses tiered auto-approve thresholds by fact type", () => {
    expect(
      assistantAutoApproveConfidenceThresholdForFact({
        dimension: "trust_context",
        factKey: "verified_work_or_school",
      }),
    ).toBe(0.72);
    expect(
      assistantAutoApproveConfidenceThresholdForFact({
        dimension: "communication",
        factKey: "communication_style",
      }),
    ).toBe(0.75);
    expect(
      assistantAutoApproveConfidenceThresholdForFact({
        dimension: "home_labor",
        factKey: "cleanliness",
      }),
    ).toBe(0.8);
  });

  it("auto-approves low-risk corroboration at the lower threshold", () => {
    const existing = scoringFact({
      confidence: 0.78,
      dimension: "communication",
      id: "existing-chatgpt",
      reviewState: "pending",
      sourceImportProvider: "chatgpt",
      value: "Direct communicator",
    });
    const incoming = extractedFact({
      confidence: 0.78,
      dimension: "communication",
      value: "Direct communicator",
      normalizedValue: "direct communicator",
    });

    expect(
      shouldAutoApproveCrossProviderCorroboration(
        existing,
        incoming,
        "claude",
      ),
    ).toBe(true);
  });

  it("treats matching facts from another assistant as corroboration", () => {
    const existing = scoringFact({
      id: "existing-chatgpt",
      sourceImportProvider: "chatgpt",
      value: "Direct, concise communicator",
    });
    const incoming = extractedFact({
      value: "Direct and clear communication style",
      normalizedValue: "direct and clear communication style",
      confidence: 0.91,
    });

    const result = reconcileProfileFactImport([incoming], [existing]);

    expect(result.factsToInsert).toHaveLength(0);
    expect(result.duplicateMatches).toHaveLength(1);
    expect(result.duplicateMatches[0]?.existingFact.id).toBe("existing-chatgpt");
  });

  it("auto-approves pending assistant facts corroborated across providers", () => {
    const existing = scoringFact({
      confidence: 0.82,
      id: "existing-chatgpt",
      reviewState: "pending",
      sourceImportProvider: "chatgpt",
      value: "Direct, concise communicator",
    });
    const incoming = extractedFact({
      confidence: 0.91,
      value: "Direct and clear communication style",
      normalizedValue: "direct and clear communication style",
    });

    expect(
      shouldAutoApproveCrossProviderCorroboration(
        existing,
        incoming,
        "claude",
      ),
    ).toBe(true);
  });

  it("auto-approves corroborated canonical structured facts from both assistants", () => {
    const existing = scoringFact({
      confidence: 0.7,
      dimension: "environment_tolerance",
      factKey: "noise_tolerance",
      id: "existing-chatgpt-noise",
      normalizedValue: "quiet",
      reviewState: "pending",
      sourceImportProvider: "chatgpt",
      value: "quiet",
    });
    const incoming = extractedFact({
      confidence: 0.7,
      dimension: "environment_tolerance",
      factKey: "noise_tolerance",
      normalizedValue: "quiet",
      value: "quiet",
    });

    expect(
      shouldAutoApproveCrossProviderCorroboration(
        existing,
        incoming,
        "claude",
      ),
    ).toBe(true);
  });

  it("does not auto-approve corroboration below the confidence threshold", () => {
    const existing = scoringFact({
      confidence: 0.7,
      id: "existing-chatgpt",
      reviewState: "pending",
      sourceImportProvider: "chatgpt",
      value: "Direct communicator",
    });
    const incoming = extractedFact({
      confidence: 0.72,
      value: "Direct communicator",
      normalizedValue: "direct communicator",
    });

    expect(
      shouldAutoApproveCrossProviderCorroboration(
        existing,
        incoming,
        "claude",
      ),
    ).toBe(false);
  });

  it("does not auto-approve already reviewed facts", () => {
    const existing = scoringFact({
      confidence: 0.82,
      id: "existing-chatgpt",
      reviewState: "approved",
      sourceImportProvider: "chatgpt",
      value: "Direct communicator",
    });
    const incoming = extractedFact({
      confidence: 0.91,
      value: "Direct communicator",
      normalizedValue: "direct communicator",
    });

    expect(
      shouldAutoApproveCrossProviderCorroboration(
        existing,
        incoming,
        "claude",
      ),
    ).toBe(false);
  });

  it("keeps additive facts when assistant sources contribute distinct values", () => {
    const existing = scoringFact({
      factKey: "interests",
      dimension: "rapport_taste",
      id: "existing-interests",
      value: "jazz",
    });
    const incoming = extractedFact({
      factKey: "interests",
      dimension: "rapport_taste",
      value: "architecture",
      normalizedValue: "architecture",
    });

    const result = reconcileProfileFactImport([incoming], [existing]);

    expect(result.duplicateMatches).toHaveLength(0);
    expect(result.factsToInsert).toHaveLength(1);
    expect(result.factsToInsert[0]?.conflictingExistingFacts).toHaveLength(0);
  });

  it("deduplicates semantic aliases for additive trust facts", () => {
    const existing = scoringFact({
      dimension: "trust_context",
      factKey: "verified_work_or_school",
      id: "existing-stanford",
      value: "Stanford University",
    });
    const incoming = extractedFact({
      dimension: "trust_context",
      factKey: "verified_work_or_school",
      normalizedValue: "stanford",
      value: "Stanford",
    });

    const result = reconcileProfileFactImport([incoming], [existing]);

    expect(result.factsToInsert).toHaveLength(0);
    expect(result.duplicateMatches).toHaveLength(1);
    expect(result.duplicateMatches[0]?.existingFact.id).toBe(
      "existing-stanford",
    );
  });

  it("does not flag additive assistant facts as contradictions", () => {
    const conflicts = detectProfileFactConflicts([
      extractedFact({
        dimension: "rapport_taste",
        factKey: "interests",
        value: "proptech and AI agents",
      }),
      extractedFact({
        dimension: "rapport_taste",
        factKey: "interests",
        value: "music production and fitness",
      }),
      extractedFact({
        dimension: "trust_context",
        factKey: "verified_work_or_school",
        value: "Fifth Wall",
      }),
      extractedFact({
        dimension: "trust_context",
        factKey: "verified_work_or_school",
        value: "University of Notre Dame",
      }),
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it("does not treat different free-form work-hour summaries as contradictions", () => {
    const existing = scoringFact({
      dimension: "daily_rhythm",
      factKey: "work_hours",
      id: "existing-work-hours",
      value:
        "likely intense and project-driven, with work extending into independent product research and AI tooling",
    });
    const incoming = extractedFact({
      dimension: "daily_rhythm",
      factKey: "work_hours",
      value:
        "weekday operations role plus regular evening and weekend technical side projects",
    });

    const result = reconcileProfileFactImport([incoming], [existing]);

    expect(result.factsToInsert).toHaveLength(1);
    expect(result.factsToInsert[0]?.conflictingExistingFacts).toHaveLength(0);
  });

  it("inserts expanded neighborhood lists instead of treating an old subset as duplicate", () => {
    const existing = scoringFact({
      dimension: "feasibility",
      factKey: "neighborhoods",
      id: "existing-neighborhoods",
      value: ["North Beach", "Telegraph Hill"],
    });
    const incoming = extractedFact({
      dimension: "feasibility",
      factKey: "neighborhoods",
      normalizedValue:
        "north beach telegraph hill pacific heights marina",
      value: "North Beach, Telegraph Hill, Pacific Heights, Marina",
    });

    const result = reconcileProfileFactImport([incoming], [existing]);

    expect(result.duplicateMatches).toHaveLength(0);
    expect(result.factsToInsert).toHaveLength(1);
  });

  it("keeps a one-neighborhood expansion of an otherwise long saved list", () => {
    const existing = scoringFact({
      dimension: "feasibility",
      factKey: "neighborhoods",
      id: "existing-neighborhoods",
      value: ["Mission District", "Hayes Valley", "Lower Haight"],
    });
    const incoming = extractedFact({
      dimension: "feasibility",
      factKey: "neighborhoods",
      normalizedValue:
        "hayes valley, lower haight, mission district, noe valley",
      value: "Mission District, Hayes Valley, Lower Haight, Noe Valley",
    });

    const result = reconcileProfileFactImport([incoming], [existing]);

    expect(result.duplicateMatches).toHaveLength(0);
    expect(result.factsToInsert).toHaveLength(1);
  });

  it("re-saves a historical neighborhood list instead of corroborating the stale fact", () => {
    const historical = scoringFact({
      createdAt: "2026-07-06T02:20:34.037Z",
      dimension: "feasibility",
      factKey: "neighborhoods",
      id: "historical-three-neighborhoods",
      sourceImportProvider: "sendblue",
      value: ["Mission District", "Hayes Valley", "Lower Haight"],
    });
    const current = scoringFact({
      createdAt: "2026-07-11T16:48:27.845Z",
      dimension: "feasibility",
      factKey: "neighborhoods",
      id: "current-four-neighborhoods",
      sourceImportProvider: "sendblue",
      value: [
        "Mission District",
        "Hayes Valley",
        "Lower Haight",
        "Noe Valley",
      ],
    });
    const replacement = extractedFact({
      dimension: "feasibility",
      factKey: "neighborhoods",
      normalizedValue: "hayes valley, lower haight, mission district",
      value: "Mission District, Hayes Valley, Lower Haight",
    });

    const result = reconcileProfileFactImport(
      [replacement],
      [historical, current],
    );

    expect(result.duplicateMatches).toHaveLength(0);
    expect(result.factsToInsert).toHaveLength(1);

    const projected = consolidateProfileFactsForProjection([
      historical,
      current,
      scoringFact({
        createdAt: "2026-07-11T17:17:39.855Z",
        dimension: "feasibility",
        factKey: "neighborhoods",
        id: "replacement-three-neighborhoods",
        sourceImportProvider: "sendblue",
        value: ["Mission District", "Hayes Valley", "Lower Haight"],
      }),
    ]);

    expect(projected.map((fact) => fact.id)).toEqual([
      "replacement-three-neighborhoods",
    ]);
  });

  it("flags strong same-slot disagreements without duplicating projection state", () => {
    const existing = scoringFact({
      dimension: "daily_rhythm",
      factKey: "sleep_schedule",
      id: "existing-sleep",
      value: "late night schedule",
    });
    const incoming = extractedFact({
      dimension: "daily_rhythm",
      factKey: "sleep_schedule",
      value: "early morning schedule",
      normalizedValue: "early morning schedule",
    });

    const result = reconcileProfileFactImport([incoming], [existing]);

    expect(result.factsToInsert).toHaveLength(1);
    expect(result.factsToInsert[0]?.conflictingExistingFacts[0]?.id).toBe(
      "existing-sleep",
    );

    const unified = consolidateProfileFactsForProjection([
      existing,
      scoringFact({
        dimension: "daily_rhythm",
        factKey: "sleep_schedule",
        id: "incoming-sleep",
        value: "early morning schedule",
        confidence: 0.7,
      }),
    ]);

    expect(unified).toHaveLength(1);
    expect(unified[0]?.id).toBe("existing-sleep");
  });

  it("lets newer iMessage facts override older same-slot profile facts", () => {
    const existing = scoringFact({
      confidence: 0.99,
      createdAt: "2026-05-20T00:00:00.000Z",
      dimension: "home_labor",
      factKey: "cleanliness",
      id: "older-assistant-cleanliness",
      sourceImportProvider: "claude",
      value: "Relaxed about shared-space cleanliness",
    });
    const incoming = scoringFact({
      confidence: 0.7,
      createdAt: "2026-05-23T00:00:00.000Z",
      dimension: "home_labor",
      factKey: "cleanliness",
      id: "newer-text-cleanliness",
      sourceImportProvider: "sendblue",
      value: "Needs shared spaces to be very clean",
    });

    const unified = consolidateProfileFactsForProjection([existing, incoming]);

    expect(unified).toHaveLength(1);
    expect(unified[0]?.id).toBe("newer-text-cleanliness");
  });

  it("uses the latest iMessage list as the canonical additive preference", () => {
    const existing = scoringFact({
      createdAt: "2026-05-20T00:00:00.000Z",
      dimension: "feasibility",
      factKey: "neighborhoods",
      id: "older-neighborhoods",
      sourceImportProvider: "chatgpt",
      value: ["Richmond", "Dogpatch"],
    });
    const incoming = scoringFact({
      createdAt: "2026-05-23T00:00:00.000Z",
      dimension: "feasibility",
      factKey: "neighborhoods",
      id: "newer-text-neighborhoods",
      sourceImportProvider: "linq",
      value: ["Pacific Heights", "North Beach"],
    });

    const unified = consolidateProfileFactsForProjection([existing, incoming]);

    expect(unified).toHaveLength(1);
    expect(unified[0]?.id).toBe("newer-text-neighborhoods");
  });

  it("treats budget aliases as one override slot", () => {
    const existingMin = scoringFact({
      createdAt: "2026-05-20T00:00:00.000Z",
      dimension: "feasibility",
      factKey: "budget_min",
      id: "older-budget-min",
      sourceImportProvider: "manual",
      value: 500,
    });
    const existingMax = scoringFact({
      createdAt: "2026-05-20T00:00:00.000Z",
      dimension: "feasibility",
      factKey: "budget_max",
      id: "older-budget-max",
      sourceImportProvider: "manual",
      value: 6000,
    });
    const incoming = scoringFact({
      createdAt: "2026-05-23T00:00:00.000Z",
      dimension: "feasibility",
      factKey: "budget",
      id: "newer-text-budget",
      normalizedValue: '{"max":4000,"min":1000}',
      sourceImportProvider: "linq",
      value: { max: 4000, min: 1000 },
    });

    const unified = consolidateProfileFactsForProjection([
      existingMin,
      existingMax,
      incoming,
    ]);

    expect(unified).toHaveLength(1);
    expect(unified[0]?.id).toBe("newer-text-budget");
  });

  it("does not extract profile facts from text import metadata", () => {
    const facts = extractProfileFacts({
      extraction: {
        extractor: "kinfolk_tool",
        model: "deterministic-budget-override",
        warnings: ["explicit_budget_override"],
      },
      raw_message: "Actually make the rent cap 4000, not a minimum",
      source: "linq_text",
      structured_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "feasibility",
          evidence: "Actually make the rent cap 4000, not a minimum",
          fact_key: "budget_max",
          importance: 0.98,
          sensitivity_level: "standard",
          value: 4000,
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKey).toBe("budget_max");
    expect(facts[0]?.value).toBe(4000);
  });
});

describe("enrichment alias mapping", () => {
  it("maps nighttime_bass_sensitivity to noise_tolerance", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "environment_tolerance",
          evidence: "Very sensitive to bass through walls after midnight",
          fact_key: "nighttime_bass_sensitivity",
          sensitivity_level: "standard",
          value: "Very sensitive to bass through walls after midnight",
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKey).toBe("noise_tolerance");
    expect(facts[0]?.dimension).toBe("environment_tolerance");
  });

  it("maps work_from_home_pattern to work_from_home", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "daily_rhythm",
          evidence: "Works from home three days a week",
          fact_key: "work_from_home_pattern",
          sensitivity_level: "standard",
          value: "Works from home three days a week",
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKey).toBe("work_from_home");
    expect(facts[0]?.dimension).toBe("daily_rhythm");
  });

  it("maps conflict_discussion_fit to conflict_repair", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "communication",
          evidence: "Prefers to talk things through the same day",
          fact_key: "conflict_discussion_fit",
          sensitivity_level: "standard",
          value: "Prefers to talk things through the same day",
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKey).toBe("conflict_repair");
    expect(facts[0]?.dimension).toBe("communication");
  });

  it("maps interest_* prefix keys to interests when not explicitly listed", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "rapport_taste",
          evidence: "Enjoys hiking on weekends",
          fact_key: "interest_hiking",
          sensitivity_level: "standard",
          value: "Enjoys hiking on weekends",
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKey).toBe("interests");
    expect(facts[0]?.dimension).toBe("rapport_taste");
  });

  it("maps assistant hometown facts for profile display", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.86,
          dimension: "trust_context",
          evidence: "Grew up in Palo Alto, CA",
          fact_key: "hometown",
          sensitivity_level: "standard",
          value: "Palo Alto, CA",
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKey).toBe("hometown");
    expect(facts[0]?.dimension).toBe("trust_context");
  });

});

describe("assistant import search-profile filtering", () => {
  it("enforces the exported canonical allowlist after resolving aliases", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          dimension: "environment_tolerance",
          evidence: "Bass through walls makes sleep difficult",
          fact_key: "nighttime_bass_sensitivity",
          value: "very quiet",
        },
        {
          dimension: "rapport_taste",
          evidence: "Likes green bedrooms",
          fact_key: "favorite_room_color",
          value: "green",
        },
      ],
    });

    expect(assistantProfileFactKeys).toContain("noise_tolerance");
    expect(isCanonicalAssistantProfileFactKey("favorite_room_color")).toBe(false);
    expect(filterFactsForImportProvider(facts, "chatgpt").map((fact) => fact.factKey)).toEqual([
      "noise_tolerance",
    ]);
  });

  it("keeps interest_real_estate_investing when evidence mentions market", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "rapport_taste",
          evidence: "Follows real estate market trends and syndication deals",
          fact_key: "interest_real_estate_investing",
          sensitivity_level: "standard",
          value: "Follows real estate market trends and syndication deals",
        },
      ],
    });

    const filtered = filterFactsForImportProvider(facts, "claude");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.factKey).toBe("interests");
  });

  it("keeps assistant pet compatibility while still filtering search-only facts", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "feasibility",
          evidence: "Has a dog and wants pet-friendly roommates",
          fact_key: "pets",
          sensitivity_level: "standard",
          value: "has pet",
        },
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "feasibility",
          evidence: "Looking in North Beach",
          fact_key: "neighborhoods",
          sensitivity_level: "standard",
          value: "North Beach",
        },
      ],
    });

    const filtered = filterFactsForImportProvider(facts, "claude");

    expect(filtered.map((fact) => fact.factKey)).toEqual(["pets"]);
  });
});

describe("assistant import provenance", () => {
  it("preserves provenance and only derives recencyAt from unambiguous ISO dates", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          dimension: "communication",
          evidence: "Prefers direct answers",
          fact_key: "communication_style",
          observed_vs_self_reported: "  self_reported  ",
          recency_hint: "2026-07-01",
          source_type: " saved   memory ",
          value: "direct",
        },
        {
          dimension: "rapport_taste",
          evidence: "Likes jazz",
          fact_key: "music_taste",
          recency_hint: "earlier this year",
          source_type: "chat history",
          value: "jazz",
        },
      ],
    });

    expect(facts[0]).toMatchObject({
      observedVsSelfReported: "self_reported",
      recencyAt: "2026-07-01T00:00:00.000Z",
      recencyHint: "2026-07-01",
      sourceType: "saved memory",
    });
    expect(facts[1]).toMatchObject({
      recencyHint: "earlier this year",
      sourceType: "chat history",
    });
    expect(facts[1]).not.toHaveProperty("recencyAt");
  });
});

describe("profile import review status", () => {
  it.each([
    [[], "processed"],
    [["approved", "pending"], "needs_review"],
    [["approved", "edited"], "approved"],
    [["approved", "rejected"], "processed"],
  ] as const)("derives %s as %s", (states, expectedStatus) => {
    expect(profileImportStatusForFactReviewStates(states)).toBe(expectedStatus);
  });

  it("only treats non-empty all-approved facts as fully approved", () => {
    expect(isFullyApprovedProfileImport(["approved", "edited"])).toBe(true);
    expect(isFullyApprovedProfileImport(["approved", "rejected"])).toBe(false);
    expect(isFullyApprovedProfileImport([])).toBe(false);
  });
});

describe("profile fact scoring timestamps", () => {
  it("uses recency_at for weighting and falls back to created_at", () => {
    const row = {
      assertion_type: "explicit",
      confidence: 0.9,
      created_at: "2026-07-11T12:00:00.000Z",
      dimension: "communication",
      evidence_excerpt: "Prefers direct answers",
      fact_key: "communication_style",
      id: "fact-1",
      importance: 0.8,
      matching_eligible: true,
      normalized_value: "direct",
      observed_vs_self_reported: "self_reported",
      recency_at: "2026-06-01T00:00:00.000Z",
      recency_hint: "2026-06-01",
      review_note: null,
      sensitivity_level: "standard",
      source_import_id: "import-1",
      source_type: "saved memory",
      updated_at: "2026-07-11T12:00:00.000Z",
      user_id: "user-1",
      user_review_state: "approved",
      value_json: "direct",
    } satisfies Parameters<typeof mapFactForScoring>[0];

    expect(mapFactForScoring(row).createdAt).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(mapFactForScoring({ ...row, recency_at: null }).createdAt).toBe(
      "2026-07-11T12:00:00.000Z",
    );
  });
});

describe("structured fact normalization end to end", () => {
  it("stores canonical tokens as normalized_value for behavioral keys", () => {
    const facts = extractProfileFacts({
      profile_facts: [
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "daily_rhythm",
          evidence: "I'm a night owl, usually up past 2am",
          fact_key: "sleep_schedule",
          sensitivity_level: "standard",
          value: "I'm a night owl, usually up past 2am",
        },
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "home_labor",
          evidence: "I keep the kitchen clean and reset every night",
          fact_key: "cleanliness",
          sensitivity_level: "standard",
          value: "I keep the kitchen clean and reset every night",
        },
      ],
    });

    const sleep = facts.find((fact) => fact.factKey === "sleep_schedule");
    const cleanliness = facts.find((fact) => fact.factKey === "cleanliness");
    expect(sleep?.normalizedValue).toBe("late");
    expect(cleanliness?.normalizedValue).toBe("tidy");
  });

  it("scores compatible structured profiles above incompatible ones", () => {
    const base = (id: string, sleep: string, clean: string): ProfileFactForScoring[] => [
      scoringFact({ id: `${id}-market`, dimension: "feasibility", factKey: "target_market", value: "San Francisco" }),
      scoringFact({ id: `${id}-sleep`, dimension: "daily_rhythm", factKey: "sleep_schedule", value: sleep, normalizedValue: sleep }),
      scoringFact({ id: `${id}-clean`, dimension: "home_labor", factKey: "cleanliness", value: clean, normalizedValue: clean }),
    ];

    const anchor = { userId: "a", displayName: "A", facts: base("a", "early", "very tidy") };
    const aligned = { userId: "b", displayName: "B", facts: base("b", "early", "very tidy") };
    const opposed = { userId: "c", displayName: "C", facts: base("c", "late", "very relaxed") };

    const alignedScore = scoreCompatibility(anchor, aligned).score;
    const opposedScore = scoreCompatibility(anchor, opposed).score;

    expect(alignedScore).toBeGreaterThan(opposedScore);
  });

  it("scores legacy prose behavioral facts through the structured vocabulary", () => {
    const anchor = budgetProfile("anchor", [
      scoringFact({
        id: "anchor-sleep",
        dimension: "daily_rhythm",
        factKey: "sleep_schedule",
        value: "early",
        normalizedValue: "early",
      }),
      scoringFact({
        id: "anchor-wfh",
        dimension: "daily_rhythm",
        factKey: "work_from_home",
        value: "Hybrid/in-office professional context; in-office majority of the week.",
      }),
      scoringFact({
        id: "anchor-noise",
        dimension: "environment_tolerance",
        factKey: "noise_tolerance",
        value: "quiet",
        normalizedValue: "quiet",
      }),
      scoringFact({
        id: "anchor-social",
        dimension: "social_boundary",
        factKey: "social_energy",
        value: "low key",
        normalizedValue: "low key",
      }),
      scoringFact({
        id: "anchor-guests",
        dimension: "social_boundary",
        factKey: "guests",
        value: "occasional",
        normalizedValue: "occasional",
      }),
    ]);
    const candidate = budgetProfile("candidate", [
      scoringFact({
        id: "candidate-sleep",
        dimension: "daily_rhythm",
        factKey: "sleep_schedule",
        value: "Usually asleep around 11:30pm and up around 7:30am.",
      }),
      scoringFact({
        id: "candidate-wfh",
        dimension: "daily_rhythm",
        factKey: "work_from_home",
        value: "Hybrid, focused work from home two days a week.",
      }),
      scoringFact({
        id: "candidate-noise",
        dimension: "environment_tolerance",
        factKey: "noise_tolerance",
        value: "Prefers predictable quiet after 11pm on weeknights.",
      }),
      scoringFact({
        id: "candidate-social",
        dimension: "social_boundary",
        factKey: "social_energy",
        value: "Friendly and open to shared meals, but uses home as a recharge space.",
      }),
      scoringFact({
        id: "candidate-guests",
        dimension: "social_boundary",
        factKey: "guests",
        value: "Comfortable with small dinners if planned ahead.",
      }),
    ]);

    const result = scoreCompatibility(anchor, candidate);

    expect(result.components.schedule_collision_fit).toBeGreaterThanOrEqual(0.9);
    expect(result.components.lifestyle_friction_fit).toBeGreaterThanOrEqual(0.8);
  });

  it("scores budget_max caps as compatible with overlapping budget ranges", () => {
    const result = scoreCompatibility(
      budgetProfile("cap", [
        budgetFact("cap-budget", "budget_max", 3000),
      ]),
      budgetProfile("range", [
        budgetFact("range-budget", "budget", { min: 2000, max: 3000 }),
      ]),
    );

    expect(result.components.budget_location_synergy).toBeGreaterThanOrEqual(0.75);
  });

  it("softens near-miss budget caps instead of treating them as pathological", () => {
    const overlapping = scoreCompatibility(
      budgetProfile("cap", [
        budgetFact("cap-budget-overlap", "budget_max", 3000),
      ]),
      budgetProfile("range", [
        budgetFact("range-budget-overlap", "budget", { min: 2000, max: 3000 }),
      ]),
    );
    const nearMiss = scoreCompatibility(
      budgetProfile("cap", [
        budgetFact("cap-budget-near-miss", "budget_max", 3000),
      ]),
      budgetProfile("range", [
        budgetFact("range-budget-near-miss", "budget", { min: 3200, max: 3800 }),
      ]),
    );

    expect(nearMiss.components.budget_location_synergy).toBeLessThan(
      overlapping.components.budget_location_synergy,
    );
    expect(nearMiss.components.budget_location_synergy).toBeGreaterThan(0.55);
  });

  it("keeps missing budgets neutral and out of budget risk", () => {
    const result = scoreCompatibility(
      budgetProfile("cap", [
        budgetFact("cap-budget-missing-other-side", "budget_max", 3000),
      ]),
      budgetProfile("missing", []),
    );

    expect(result.components.budget_location_synergy).toBe(0.5);
    expect(result.risks.some((risk) => risk.label === "Budget and location")).toBe(false);
    expect(result.risks.some((risk) => risk.label === "Feasibility")).toBe(false);
  });

  it("treats budget_min as a lower-bound preference, not a hard rejection", () => {
    const aboveMinimum = scoreCompatibility(
      budgetProfile("min", [
        budgetFact("min-budget-above", "budget_min", 3000),
      ]),
      budgetProfile("range", [
        budgetFact("range-budget-above", "budget", { min: 3200, max: 3800 }),
      ]),
    );
    const cheaperNearMiss = scoreCompatibility(
      budgetProfile("min", [
        budgetFact("min-budget-cheaper", "budget_min", 3000),
      ]),
      budgetProfile("range", [
        budgetFact("range-budget-cheaper", "budget", { min: 2200, max: 2800 }),
      ]),
    );

    expect(aboveMinimum.components.budget_location_synergy).toBeGreaterThan(
      cheaperNearMiss.components.budget_location_synergy,
    );
    expect(cheaperNearMiss.components.budget_location_synergy).toBeGreaterThan(0.55);
    expect(cheaperNearMiss.risks.some((risk) => risk.label === "Budget and location")).toBe(false);
  });

  it("softens rather than hard-fails when move-in windows are a near-miss", () => {
    const result = scoreCompatibility(
      budgetProfile("july", [
        feasibilityFact("july-window", "move_in_window", {
          start: "2026-07-01",
          end: "2026-07-31",
        }),
      ]),
      budgetProfile("september", [
        feasibilityFact("september-window", "move_in_window", {
          start: "2026-09-01",
          end: "2026-09-30",
        }),
      ]),
    );

    // ~32-day gap: people flex move-in by weeks, so this stays viable.
    expect(result.score).toBeGreaterThan(0);
    expect(result.components.feasibility_gate).toBeGreaterThan(0);
    expect(result.risks.some((risk) => risk.label === "Feasibility")).toBe(false);
  });

  it("hard-fails compatibility when move-in windows are a full season apart", () => {
    const result = scoreCompatibility(
      budgetProfile("summer", [
        feasibilityFact("summer-window", "move_in_window", {
          start: "2026-07-01",
          end: "2026-07-31",
        }),
      ]),
      budgetProfile("winter", [
        feasibilityFact("winter-window", "move_in_window", {
          start: "2026-12-01",
          end: "2026-12-31",
        }),
      ]),
    );

    expect(result.score).toBe(0);
    expect(result.components.feasibility_gate).toBe(0);
    expect(result.risks.some((risk) => risk.label === "Feasibility")).toBe(true);
  });

  it("treats household-size facts as up-to roommate capacity, not exact group size", () => {
    const result = scoreCompatibility(
      budgetProfile("small", [
        feasibilityFact("small-household", "household_size", { min: 1, max: 2 }),
      ]),
      budgetProfile("large", [
        feasibilityFact("large-household", "household_size", { min: 4, max: 5 }),
      ]),
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.components.feasibility_gate).toBeGreaterThan(0);
    expect(result.risks.some((risk) => risk.label === "Feasibility")).toBe(false);
  });

  it("hard-fails compatibility when one side is solo-only", () => {
    const result = scoreCompatibility(
      budgetProfile("solo", [
        feasibilityFact("solo-household", "household_size", { min: 1, max: 1 }),
      ]),
      budgetProfile("roommates", [
        feasibilityFact("roommate-household", "household_size", { min: 1, max: 5 }),
      ]),
    );

    expect(result.score).toBe(0);
    expect(result.components.feasibility_gate).toBe(0);
    expect(result.risks.some((risk) => risk.label === "Feasibility")).toBe(true);
  });

  it("keeps overlapping canonical feasibility fields viable", () => {
    const result = scoreCompatibility(
      budgetProfile("first", [
        feasibilityFact("first-market", "target_market", ["san-francisco-ca"]),
        budgetFact("first-budget", "budget_max", 3000),
        feasibilityFact("first-window", "move_in_window", {
          start: "2026-07-15",
          end: "2026-08-15",
        }),
        feasibilityFact("first-household", "household_size", { min: 2, max: 3 }),
      ]),
      budgetProfile("second", [
        feasibilityFact("second-market", "target_market", ["san-francisco-ca"]),
        budgetFact("second-budget", "budget", { min: 2000, max: 2800 }),
        feasibilityFact("second-window", "move_in_window", {
          start: "2026-08-01",
          end: "2026-09-01",
        }),
        feasibilityFact("second-household", "household_size", { min: 3, max: 4 }),
      ]),
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.components.feasibility_gate).toBeGreaterThanOrEqual(0.8);
  });

  it("hard-fails compatibility when strict age comfort ranges do not match", () => {
    const result = scoreCompatibility(
      budgetProfile("anchor", [
        ageFact("anchor-age", 24),
        agePreferenceFact("anchor-age-range", {
          min: 22,
          max: 30,
          strict: true,
        }),
      ]),
      budgetProfile("candidate", [
        ageFact("candidate-age", 60),
        agePreferenceFact("candidate-age-range", {
          min: 22,
          max: 35,
          strict: false,
        }),
      ]),
    );

    expect(result.score).toBe(0);
    expect(result.components.age_comfort_fit).toBe(0);
    expect(result.risks.some((risk) => risk.label === "Age comfort")).toBe(true);
  });

  it("boosts matches when mutual age comfort ranges are compatible", () => {
    const baseFacts = [
      scoringFact({
        id: "shared-communication",
        dimension: "communication",
        factKey: "communication_style",
        value: "direct and thoughtful",
      }),
      scoringFact({
        id: "shared-cleanliness",
        dimension: "home_labor",
        factKey: "cleanliness",
        value: "tidy shared spaces",
      }),
    ];
    const withoutAge = scoreCompatibility(
      budgetProfile("anchor", baseFacts),
      budgetProfile("candidate", baseFacts),
    );
    const withAge = scoreCompatibility(
      budgetProfile("anchor", [
        ...baseFacts,
        ageFact("anchor-age", 24),
        agePreferenceFact("anchor-age-range", { min: 22, max: 30, strict: false }),
      ]),
      budgetProfile("candidate", [
        ...baseFacts,
        ageFact("candidate-age", 25),
        agePreferenceFact("candidate-age-range", { min: 22, max: 30, strict: false }),
      ]),
    );

    expect(withAge.score).toBeGreaterThan(withoutAge.score);
    expect(withAge.components.age_comfort_fit).toBeGreaterThanOrEqual(0.85);
    expect(withAge.evidence.some((item) => item.label === "Age comfort")).toBe(true);
  });

  it("keeps missing age comfort neutral when users did not set ranges", () => {
    const result = scoreCompatibility(
      budgetProfile("anchor", [
        scoringFact({
          id: "anchor-communication",
          dimension: "communication",
          factKey: "communication_style",
          value: "direct",
        }),
      ]),
      budgetProfile("candidate", [
        scoringFact({
          id: "candidate-communication",
          dimension: "communication",
          factKey: "communication_style",
          value: "direct",
        }),
      ]),
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.components.age_comfort_fit).toBe(0.5);
    expect(result.evidence.some((item) => item.label === "Age comfort")).toBe(false);
    expect(result.risks.some((risk) => risk.label === "Age comfort")).toBe(false);
  });

  it("boosts rapport when users share work or school overlap", () => {
    const withOverlap = scoreCompatibility(
      {
        userId: "a",
        displayName: "A",
        facts: [
          scoringFact({
            id: "a-work",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "Stanford University",
            normalizedValue: "stanford university",
          }),
        ],
      },
      {
        userId: "b",
        displayName: "B",
        facts: [
          scoringFact({
            id: "b-work",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "Stanford",
            normalizedValue: "stanford",
          }),
        ],
      },
    );
    const withoutOverlap = scoreCompatibility(
      {
        userId: "a",
        displayName: "A",
        facts: [
          scoringFact({
            id: "a-work",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "Stanford University",
            normalizedValue: "stanford university",
          }),
        ],
      },
      {
        userId: "c",
        displayName: "C",
        facts: [
          scoringFact({
            id: "c-work",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "MIT",
            normalizedValue: "mit",
          }),
        ],
      },
    );

    expect(withOverlap.components.trust_bridge_strength).toBeGreaterThan(
      withoutOverlap.components.trust_bridge_strength,
    );
    expect(withOverlap.evidence.some((item) => item.label === "Work or school")).toBe(
      true,
    );
  });

  it("does not boost trust for Notre Dame vs University of Miami on a generic university token", () => {
    const result = scoreCompatibility(
      {
        userId: "a",
        displayName: "A",
        facts: [
          scoringFact({
            id: "a-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "Notre Dame",
            normalizedValue: "notre dame",
          }),
        ],
      },
      {
        userId: "b",
        displayName: "B",
        facts: [
          scoringFact({
            id: "b-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "University of Miami",
            normalizedValue: "university of miami",
          }),
        ],
      },
    );

    expect(result.components.trust_bridge_strength).toBe(0);
    expect(result.evidence.some((item) => item.label === "Work or school")).toBe(
      false,
    );
  });

  it("does not boost trust when the only shared signal is University", () => {
    const result = scoreCompatibility(
      {
        userId: "a",
        displayName: "A",
        facts: [
          scoringFact({
            id: "a-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "University",
            normalizedValue: "university",
          }),
        ],
      },
      {
        userId: "b",
        displayName: "B",
        facts: [
          scoringFact({
            id: "b-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "University of Notre Dame",
            normalizedValue: "university of notre dame",
          }),
        ],
      },
    );

    expect(result.components.trust_bridge_strength).toBe(0);
    expect(result.evidence.some((item) => item.detail.includes("University"))).toBe(
      false,
    );
  });

  it("does not treat Business as a concrete school overlap", () => {
    const result = scoreCompatibility(
      {
        userId: "a",
        displayName: "A",
        facts: [
          scoringFact({
            id: "a-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "Harvard Business School",
            normalizedValue: "harvard business school",
          }),
        ],
      },
      {
        userId: "b",
        displayName: "B",
        facts: [
          scoringFact({
            id: "b-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "Mendoza College of Business",
            normalizedValue: "mendoza college of business",
          }),
        ],
      },
    );

    expect(result.components.trust_bridge_strength).toBe(0);
    expect(result.evidence.some((item) => item.detail.includes("Business"))).toBe(
      false,
    );
  });

  it("keeps Notre Dame alias-style school matches high and concrete", () => {
    const result = scoreCompatibility(
      {
        userId: "a",
        displayName: "A",
        facts: [
          scoringFact({
            id: "a-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "Notre Dame",
            normalizedValue: "notre dame",
          }),
        ],
      },
      {
        userId: "b",
        displayName: "B",
        facts: [
          scoringFact({
            id: "b-school",
            dimension: "trust_context",
            factKey: "verified_work_or_school",
            value: "University of Notre Dame",
            normalizedValue: "university of notre dame",
          }),
        ],
      },
    );

    const schoolEvidence = result.evidence.find(
      (item) => item.label === "Work or school",
    );
    expect(result.components.trust_bridge_strength).toBeGreaterThanOrEqual(0.95);
    expect(schoolEvidence?.detail).toContain("Notre Dame");
  });

  it("describes shared communities with the concrete entity instead of University", () => {
    const result = scoreCompatibility(
      {
        userId: "a",
        displayName: "A",
        facts: [
          scoringFact({
            id: "a-community",
            dimension: "trust_context",
            factKey: "shared_communities",
            value: "Acme University alumni network",
            normalizedValue: "acme university alumni network",
          }),
        ],
      },
      {
        userId: "b",
        displayName: "B",
        facts: [
          scoringFact({
            id: "b-community",
            dimension: "trust_context",
            factKey: "shared_communities",
            value: "Acme University founders circle",
            normalizedValue: "acme university founders circle",
          }),
        ],
      },
    );

    const communityEvidence = result.evidence.find(
      (item) => item.label === "Communities",
    );
    expect(result.components.trust_bridge_strength).toBeGreaterThanOrEqual(0.9);
    expect(communityEvidence?.detail).toContain("Acme");
    expect(communityEvidence?.detail).not.toContain("University");
  });

  it("treats same-school personality alignment as a strong roommate signal", () => {
    const jensonFacts = [
      scoringFact({
        id: "jenson-school",
        dimension: "trust_context",
        factKey: "verified_work_or_school",
        value: "University of Notre Dame, Mendoza College of Business",
        normalizedValue: "university of notre dame, mendoza college of business",
      }),
      scoringFact({
        id: "jenson-company",
        dimension: "trust_context",
        factKey: "verified_work_or_school",
        value: "Fifth Wall",
        normalizedValue: "fifth wall",
      }),
      scoringFact({
        id: "jenson-communication",
        dimension: "communication",
        factKey: "communication_style",
        value: "direct, analytical, iterative",
      }),
      scoringFact({
        id: "jenson-social",
        dimension: "social_boundary",
        factKey: "social_energy",
        value: "low key and independent",
      }),
      scoringFact({
        id: "jenson-clean",
        dimension: "home_labor",
        factKey: "cleanliness",
        value: "very tidy",
      }),
    ];
    const jackFacts = [
      scoringFact({
        id: "jack-school",
        dimension: "trust_context",
        factKey: "verified_work_or_school",
        value: "University of Notre Dame",
        normalizedValue: "university of notre dame",
      }),
      scoringFact({
        id: "jack-company",
        dimension: "trust_context",
        factKey: "verified_work_or_school",
        value: "Carvana",
        normalizedValue: "carvana",
      }),
      scoringFact({
        id: "jack-communication",
        dimension: "communication",
        factKey: "communication_style",
        value: "direct, concise, analytical",
      }),
      scoringFact({
        id: "jack-social",
        dimension: "social_boundary",
        factKey: "independence_level",
        value: "values autonomy and coexistence",
      }),
      scoringFact({
        id: "jack-humor",
        dimension: "rapport_taste",
        factKey: "media_taste",
        value: "layered internet humor and culturally literate references",
      }),
    ];

    const result = scoreCompatibility(
      { userId: "jenson", displayName: "Jenson", facts: jensonFacts },
      { userId: "jack", displayName: "Jack", facts: jackFacts },
    );

    // Coverage-discounted scoring: with zero feasibility data and several
    // one-sided lifestyle facts, the centered score stays honest (well above
    // the sparse floor, but not a manufactured 68+), while the optimistic end
    // of the confidence range still recognizes the strong alignment.
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.scoreHigh).toBeGreaterThanOrEqual(68);
    expect(result.coverage).toBeLessThan(0.5);
    expect(result.components.trust_bridge_strength).toBeGreaterThanOrEqual(0.8);
    expect(result.evidence.some((item) => item.detail.includes("Notre Dame"))).toBe(
      true,
    );
  });

  it("no longer manufactures mid-40s scores for zero-signal profiles", () => {
    const result = scoreCompatibility(
      { userId: "blank-a", displayName: "A", facts: [] },
      { userId: "blank-b", displayName: "B", facts: [] },
    );

    // Pre-fix arithmetic guaranteed 46-55 from zero information (0.35 gate
    // floor x 0.5 neutral terms / 0.78 amplifier). Honest scoring keeps the
    // center low and the confidence range wide open.
    expect(result.score).toBeLessThan(30);
    expect(result.coverage).toBe(0);
    expect(result.scoreHigh - result.scoreLow).toBeGreaterThan(40);
  });

  it("rewards answering: coverage and score rise as matching facts land", () => {
    const sparseA = budgetProfile("sparse-a", [
      feasibilityFact("sparse-a-market", "target_market", ["san-francisco-ca"]),
    ]);
    const sparseB = budgetProfile("sparse-b", [
      feasibilityFact("sparse-b-market", "target_market", ["san-francisco-ca"]),
    ]);
    const richA = budgetProfile("rich-a", [
      feasibilityFact("rich-a-market", "target_market", ["san-francisco-ca"]),
      budgetFact("rich-a-budget", "budget_max", 3000),
      scoringFact({ id: "rich-a-sleep", dimension: "daily_rhythm", factKey: "sleep_schedule", value: "early", normalizedValue: "early" }),
      scoringFact({ id: "rich-a-clean", dimension: "home_labor", factKey: "cleanliness", value: "tidy", normalizedValue: "tidy" }),
    ]);
    const richB = budgetProfile("rich-b", [
      feasibilityFact("rich-b-market", "target_market", ["san-francisco-ca"]),
      budgetFact("rich-b-budget", "budget", { min: 2200, max: 2900 }),
      scoringFact({ id: "rich-b-sleep", dimension: "daily_rhythm", factKey: "sleep_schedule", value: "early", normalizedValue: "early" }),
      scoringFact({ id: "rich-b-clean", dimension: "home_labor", factKey: "cleanliness", value: "tidy", normalizedValue: "tidy" }),
    ]);

    const sparse = scoreCompatibility(sparseA, sparseB);
    const rich = scoreCompatibility(richA, richB);

    expect(rich.coverage).toBeGreaterThan(sparse.coverage);
    expect(rich.score).toBeGreaterThan(sparse.score);
    // The confidence band narrows as real two-sided signal arrives.
    expect(rich.scoreHigh - rich.scoreLow).toBeLessThan(
      sparse.scoreHigh - sparse.scoreLow,
    );
  });

  it("fails closed: a missing feasibility fact scores below a compatible one", () => {
    const withWindow = scoreCompatibility(
      budgetProfile("known-a", [
        feasibilityFact("known-a-window", "move_in_window", {
          start: "2026-08-01",
          end: "2026-08-31",
        }),
      ]),
      budgetProfile("known-b", [
        feasibilityFact("known-b-window", "move_in_window", {
          start: "2026-08-01",
          end: "2026-08-31",
        }),
      ]),
    );
    const missingWindow = scoreCompatibility(
      budgetProfile("known-a", [
        feasibilityFact("known-a-window-2", "move_in_window", {
          start: "2026-08-01",
          end: "2026-08-31",
        }),
      ]),
      budgetProfile("unknown-b", []),
    );

    expect(missingWindow.components.feasibility_gate).toBeLessThan(
      withWindow.components.feasibility_gate,
    );
  });

  it("compares drifted taste keys cross-key and never penalizes taste non-overlap", () => {
    const withDriftedKeys = scoreCompatibility(
      budgetProfile("taste-a", [
        scoringFact({
          id: "taste-a-media",
          dimension: "rapport_taste",
          factKey: "media_taste",
          value: "discord, memes, and internet-native media",
        }),
      ]),
      budgetProfile("taste-b", [
        scoringFact({
          id: "taste-b-humor",
          dimension: "rapport_taste",
          factKey: "humor_style",
          value: "layered internet humor, memes, and irony",
        }),
      ]),
    );
    // Different key names, clearly overlapping taste → well above neutral.
    expect(withDriftedKeys.components.rapport_taste_fit).toBeGreaterThan(0.55);

    const noOverlap = scoreCompatibility(
      budgetProfile("taste-c", [
        scoringFact({
          id: "taste-c-interests",
          dimension: "rapport_taste",
          factKey: "interests",
          value: "chess and gardening",
        }),
      ]),
      budgetProfile("taste-d", [
        scoringFact({
          id: "taste-d-interests",
          dimension: "rapport_taste",
          factKey: "interests",
          value: "surfing and salsa dancing",
        }),
      ]),
    );
    // Taste difference is not roommate friction — never below neutral.
    expect(noOverlap.components.rapport_taste_fit).toBeGreaterThanOrEqual(0.5);
  });

  it("does not emit the retired novelty term", () => {
    const result = scoreCompatibility(
      budgetProfile("novelty-a", []),
      budgetProfile("novelty-b", []),
    );

    expect(result.components).not.toHaveProperty("novelty_learning_value");
  });
});

function extractedFact({
  confidence = 0.84,
  dimension = "communication",
  factKey = "communication_style",
  normalizedValue,
  value,
}: {
  confidence?: number;
  dimension?: string;
  factKey?: string;
  normalizedValue?: string;
  value: string;
}): ExtractedProfileFact {
  return {
    assertionType: "explicit",
    confidence,
    dimension,
    evidenceExcerpt: value,
    factKey,
    importance: 0.8,
    matchingEligible: true,
    normalizedValue: normalizedValue ?? value.toLowerCase(),
    sensitivityLevel: "standard",
    value,
  };
}

function budgetProfile(userId: string, facts: ProfileFactForScoring[]) {
  return {
    displayName: userId,
    facts,
    userId,
  };
}

function budgetFact(
  id: string,
  factKey: "budget" | "budget_min" | "budget_max",
  value: ProfileFactForScoring["value"],
) {
  return scoringFact({
    dimension: "feasibility",
    factKey,
    id,
    value,
  });
}

function feasibilityFact(
  id: string,
  factKey: "target_market" | "move_in_window" | "household_size",
  value: ProfileFactForScoring["value"],
) {
  return scoringFact({
    dimension: "feasibility",
    factKey,
    id,
    value,
  });
}

function ageFact(id: string, age: number) {
  return scoringFact({
    dimension: "roommate_safety",
    factKey: "age",
    id,
    normalizedValue: String(age),
    sourceImportProvider: "profile",
    value: age,
  });
}

function agePreferenceFact(
  id: string,
  value: { min?: number; max?: number; strict: boolean },
) {
  return scoringFact({
    dimension: "roommate_safety",
    factKey: "preferred_age_range",
    id,
    normalizedValue: JSON.stringify(value),
    sourceImportProvider: "profile",
    value,
  });
}

function scoringFact({
  confidence = 0.86,
  createdAt = "2026-05-22T00:00:00.000Z",
  dimension = "communication",
  factKey = "communication_style",
  id,
  normalizedValue,
  reviewState = "approved",
  sourceImportProvider = "claude",
  value,
}: {
  confidence?: number;
  createdAt?: string;
  dimension?: string;
  factKey?: string;
  id: string;
  normalizedValue?: string;
  reviewState?: string;
  sourceImportProvider?: string;
  value: ProfileFactForScoring["value"];
}): ProfileFactForScoring {
  const displayValue =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.join(", ")
        : JSON.stringify(value);

  return {
    confidence,
    createdAt,
    dimension,
    evidenceExcerpt: displayValue,
    factKey,
    id,
    importance: 0.8,
    matchingEligible: true,
    normalizedValue:
      normalizedValue ?? displayValue.toLowerCase(),
    reviewState,
    sensitivityLevel: "standard",
    sourceImportProvider,
    userId: "user-1",
    value,
  };
}

describe("scoreCompatibility saved-place taste overlap bonus", () => {
  // Two profiles with enough overlapping facts to produce a stable baseline score.
  const baseFactsA = (): ProfileFactForScoring[] => [
    scoringFact({ id: "a-market", dimension: "feasibility", factKey: "target_market", value: "San Francisco" }),
    scoringFact({ id: "a-sleep", dimension: "daily_rhythm", factKey: "sleep_schedule", value: "early", normalizedValue: "early" }),
    scoringFact({ id: "a-clean", dimension: "home_labor", factKey: "cleanliness", value: "tidy", normalizedValue: "tidy" }),
  ];

  const baseFactsB = (): ProfileFactForScoring[] => [
    scoringFact({ id: "b-market", dimension: "feasibility", factKey: "target_market", value: "San Francisco" }),
    scoringFact({ id: "b-sleep", dimension: "daily_rhythm", factKey: "sleep_schedule", value: "early", normalizedValue: "early" }),
    scoringFact({ id: "b-clean", dimension: "home_labor", factKey: "cleanliness", value: "tidy", normalizedValue: "tidy" }),
  ];

  it("score is unchanged when no savedOverlap arg is passed (back-compat)", () => {
    const anchor = budgetProfile("anchor", baseFactsA());
    const candidate = budgetProfile("candidate", baseFactsB());
    const withoutArg = scoreCompatibility(anchor, candidate);
    const withZero = scoreCompatibility(anchor, candidate, { sharedAreaCount: 0, sharedListingCount: 0 });
    // Zero-overlap must be byte-identical to the no-arg call.
    expect(withZero.score).toBe(withoutArg.score);
  });

  it("overlap adds a positive bonus to the score", () => {
    const anchor = budgetProfile("anchor", baseFactsA());
    const candidate = budgetProfile("candidate", baseFactsB());
    const withoutOverlap = scoreCompatibility(anchor, candidate);
    const withOverlap = scoreCompatibility(anchor, candidate, { sharedAreaCount: 1, sharedListingCount: 0 });
    expect(withOverlap.score).toBeGreaterThanOrEqual(withoutOverlap.score);
    expect(withOverlap.score).toBeGreaterThan(withoutOverlap.score);
  });

  it("overlap bonus never decreases score (additive, never negative)", () => {
    const anchor = budgetProfile("anchor", baseFactsA());
    const candidate = budgetProfile("candidate", baseFactsB());
    const base = scoreCompatibility(anchor, candidate).score;
    const withAreas = scoreCompatibility(anchor, candidate, { sharedAreaCount: 2, sharedListingCount: 1 }).score;
    expect(withAreas).toBeGreaterThanOrEqual(base);
  });
});
