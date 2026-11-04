import { describe, expect, it } from "vitest";
import { textAgentIntakeAckCopy } from "./copy";
import {
  buildProfileImportPayloadFromText,
  buildTextAgentIntakeProgressReply,
  buildTextAgentInterviewStartMessage,
  buildTextAgentProfileEnrichmentHandoffReply,
  buildTextAgentProfileQuestion,
  buildTextAgentScopeDeclineReply,
  buildVerificationMessage,
  classifyTextAgentIntent,
  factKeysForTextAgentActiveExtractionStep,
  factKeysForTextAgentExtractionStep,
  factKeysForTextAgentIntakeStep,
  generateScopedVerificationCode,
  hashVerificationCode,
  isTextAgentOptOutKeyword,
  isTextAgentRevocationMessage,
  normalizeHousingPreferenceListFacts,
  parseVerificationCode,
  riskLevelForTextFacts,
  summarizeTextProfileFacts,
  isTextAgentFoundationIntakeStep,
  textAgentAllowedFactKeys,
  textAgentFoundationIntakeComplete,
  textAgentFoundationIntakeSteps,
  textAgentIntakeSteps,
  textProfileImportSourceForTransport,
  type TextProfileFact,
} from "./index";
import {
  isDirectApartmentListingRequest,
  isOffTopicTextAgentMessage,
  looksLikeFreshProfileIntakeMessage,
  restrictedTextAgentRefusal,
} from "./tools";

describe("text agent helpers", () => {
  it("parses and hashes prefilled verification codes", () => {
    expect(parseVerificationCode("KIN VERIFY AB12CD")).toBe("AB12CD");
    expect(parseVerificationCode("ab12cd")).toBe("AB12CD");
    expect(parseVerificationCode("August")).toBeNull();
    expect(buildVerificationMessage("ab12cd")).toBe("KIN VERIFY AB12CD");
    expect(hashVerificationCode("ab12cd")).toBe(hashVerificationCode("AB12CD"));
  });

  it("derives one-time challenge codes from user and challenge scope", () => {
    const first = generateScopedVerificationCode("user-1:challenge-1", "secret");

    expect(first).toBe(
      generateScopedVerificationCode("user-1:challenge-1", "secret"),
    );
    expect(first).toMatch(/^[A-Z0-9]{6}$/);
    expect(first).not.toBe(
      generateScopedVerificationCode("user-1:challenge-2", "secret"),
    );
    expect(first).not.toBe(
      generateScopedVerificationCode("user-2:challenge-1", "secret"),
    );
  });

  it("refuses to derive challenge codes without a secret", () => {
    expect(() =>
      generateScopedVerificationCode("user-1:challenge-1", ""),
    ).toThrow("generateScopedVerificationCode requires a secret.");
    expect(() =>
      generateScopedVerificationCode("user-1:challenge-1", "  "),
    ).toThrow("generateScopedVerificationCode requires a secret.");
  });

  it("always includes a digit so codes are recognized when replied bare", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = generateScopedVerificationCode(`invite-${index}`, "secret");
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect(code).toMatch(/[0-9]/);
    }
  });

  it("builds concise profile intake questions", () => {
    expect(buildTextAgentProfileQuestion("budget")).toBe(
      "What monthly rent feels comfortable? A ceiling like $3,000 is plenty to go on.",
    );
    expect(buildTextAgentProfileQuestion("move_in")).toBe(
      "When do you want to move? A rough month is fine.",
    );
    expect(buildTextAgentProfileQuestion("roommates")).toBe(
      "Are you open to roommates, or hunting solo?",
    );
    expect(buildTextAgentProfileQuestion("age_comfort")).toContain(
      "roommate age range",
    );
    expect(buildTextAgentProfileQuestion("sleep_schedule")).toContain(
      "sleep schedule",
    );
    expect(buildTextAgentProfileQuestion("work_from_home")).toContain(
      "home working",
    );
    expect(buildTextAgentProfileQuestion("conflict_repair")).toContain(
      "friction",
    );
    expect(buildTextAgentProfileQuestion("trust_context")).toContain(
      "trust the fit",
    );
    expect(buildTextAgentProfileQuestion("trust_context")).toContain(
      "reference",
    );
    expect(buildTextAgentProfileQuestion("interests")).toContain("weekend");
    expect(buildTextAgentProfileQuestion("social_energy")).toContain("energy");
    expect(buildTextAgentProfileQuestion("pets")).toContain("pets");
    expect(buildTextAgentProfileQuestion("home_preferences")).toContain(
      "must-haves",
    );
    expect(buildTextAgentProfileQuestion("home_preferences")).toContain(
      "hard no",
    );
  });

  it("mentions SKIP once in the intake intro and never inside the questions", () => {
    const intro = buildTextAgentProfileQuestion("neighborhoods", {
      includeIntro: true,
    });

    expect(intro.match(/SKIP/g)).toHaveLength(1);
    for (const step of textAgentIntakeSteps) {
      expect(buildTextAgentProfileQuestion(step)).not.toContain("SKIP");
    }
  });

  it("acknowledges out-of-order intake facts before re-asking the missing step", () => {
    const missingStepReply = buildTextAgentIntakeProgressReply({
      currentStep: "sleep_schedule",
      facts: [fact("work_from_home", "hybrid")],
      nextStep: "sleep_schedule",
    });

    expect(missingStepReply).toBe(
      `${textAgentIntakeAckCopy(
        "work-from-home rhythm",
        "sleep_schedule:work-from-home rhythm",
      )} I still need your sleep schedule: What's your sleep schedule like — early bird, night owl, somewhere in between?`,
    );
    expect(
      buildTextAgentIntakeProgressReply({
        currentStep: "sleep_schedule",
        facts: [fact("sleep_schedule", "early")],
        nextStep: "work_from_home",
      }),
    ).toBe(
      `${textAgentIntakeAckCopy(
        "sleep schedule",
        "work_from_home:sleep schedule",
      )} How often are you home working during the day?`,
    );
    // Same trigger, same words: acknowledgements vary across situations but
    // stay deterministic for a given one.
    expect(
      buildTextAgentIntakeProgressReply({
        currentStep: "sleep_schedule",
        facts: [fact("work_from_home", "hybrid")],
        nextStep: "sleep_schedule",
      }),
    ).toBe(missingStepReply);
  });

  it("refuses discriminatory roommate filtering and application fraud", () => {
    expect(restrictedTextAgentRefusal("find me roommates who are only white")).toMatch(
      /fair-housing/i,
    );
    expect(restrictedTextAgentRefusal("I only want christian roommates")).toMatch(
      /fair-housing/i,
    );
    expect(restrictedTextAgentRefusal("Find me roommates under 25 only")).toMatch(
      /fair-housing|age/i,
    );
    expect(
      restrictedTextAgentRefusal("Actually filter out roommates over 30 and families with kids"),
    ).toMatch(/fair-housing|familial/i);
    expect(
      restrictedTextAgentRefusal("how do I get a fake reference for my rental application?"),
    ).toMatch(/fraud|can't help/i);
    expect(
      restrictedTextAgentRefusal("can you forge a pay stub for my application?"),
    ).toMatch(/fraud|can't help/i);
    expect(
      restrictedTextAgentRefusal("Can you help me lie about my income?"),
    ).toMatch(/fraud|can't help/i);
    // Normal requests are not refused.
    expect(restrictedTextAgentRefusal("find me roommates who are clean and quiet")).toBeNull();
    expect(restrictedTextAgentRefusal("any 2 bedrooms under 3000?")).toBeNull();
    expect(restrictedTextAgentRefusal("what documents do I need to rent?")).toBeNull();
  });

  it("treats code/scrape/homework tasks as off-topic even with housing nouns", () => {
    // Regression: housing keywords used to smuggle an off-topic coding task past the
    // scope filter and trigger a degraded "research" answer.
    expect(
      isOffTopicTextAgentMessage(
        "write me a python script to scrape apartment listings off craigslist",
      ),
    ).toBe(true);
    expect(
      isOffTopicTextAgentMessage("can you scrape apartments.com for me?"),
    ).toBe(true);
    expect(
      isOffTopicTextAgentMessage("build me a website to track my apartment search"),
    ).toBe(true);
    expect(isOffTopicTextAgentMessage("Tell me a joke about apartments.")).toBe(
      true,
    );
    // Legit housing requests stay in scope.
    expect(
      isOffTopicTextAgentMessage("find me a 2bd apartment in the Mission"),
    ).toBe(false);
    expect(
      isOffTopicTextAgentMessage(
        "Oakland is not the assignment. Rent is 3400-ish and Dogpatch could work.",
      ),
    ).toBe(false);
  });

  it("detects direct apartment-listing commands without stealing roommate asks", () => {
    expect(isDirectApartmentListingRequest("Show me some apartments")).toBe(
      true,
    );
    expect(
      isDirectApartmentListingRequest("send listings near Dogpatch"),
    ).toBe(true);
    expect(
      isDirectApartmentListingRequest("What apartment options do I have?"),
    ).toBe(true);
    expect(
      isDirectApartmentListingRequest("Show me roommate profiles"),
    ).toBe(false);
    expect(
      isDirectApartmentListingRequest("I am open to paying more"),
    ).toBe(false);
  });

  it("separates fresh intake setup from explicit listing requests", () => {
    expect(
      looksLikeFreshProfileIntakeMessage(
        "Hi, I like Hayes Valley and Lower Haight, budget under 3000, moving in July, open to roommates.",
      ),
    ).toBe(true);
    expect(
      looksLikeFreshProfileIntakeMessage(
        "Hello I want to live in Pacific Heights in SF, 3k max",
      ),
    ).toBe(true);
    expect(
      looksLikeFreshProfileIntakeMessage(
        "Show me apartments under $3000 in Hayes Valley",
      ),
    ).toBe(false);
    expect(looksLikeFreshProfileIntakeMessage("what apartments are best?")).toBe(
      false,
    );
  });

  it("keeps compatibility gaps in the onboarding sequence", () => {
    expect(textAgentIntakeSteps).toEqual(
      expect.arrayContaining([
        "age_comfort",
        "sleep_schedule",
        "work_from_home",
        "cleanliness",
        "noise_tolerance",
        "guests",
        "social_energy",
        "communication_style",
        "conflict_repair",
        "trust_context",
        "interests",
        "pets",
        "home_preferences",
        "rent_tradeoff",
      ]),
    );
    expect(textAgentIntakeSteps).not.toContain("must_haves");
    expect(textAgentIntakeSteps).not.toContain("dealbreakers");
  });

  it("asks the commute anchor first after the foundation questions", () => {
    // The single highest-value unasked question (matching-pipeline research):
    // it powers the apartment transit term and budget-location synergy, so it
    // must outrank every other detail question.
    expect(textAgentIntakeSteps).toContain("commute");
    const foundationCount = 5;
    expect(textAgentIntakeSteps[foundationCount]).toBe("commute");
  });

  it("maps every interview step to allowed profile fact keys", () => {
    const allowedFactKeys = new Set(textAgentAllowedFactKeys);

    for (const step of textAgentIntakeSteps) {
      expect(factKeysForTextAgentIntakeStep(step).length).toBeGreaterThan(0);
      expect(
        factKeysForTextAgentIntakeStep(step).every((key) =>
          allowedFactKeys.has(key),
        ),
      ).toBe(true);
    }
  });

  it("uses one home-preferences intake step for must-haves and hard no's", () => {
    expect(factKeysForTextAgentIntakeStep("home_preferences")).toEqual([
      "must_haves",
      "dealbreakers",
    ]);
    expect(factKeysForTextAgentExtractionStep("home_preferences")).toEqual(
      expect.arrayContaining(["dealbreakers", "must_haves"]),
    );
  });

  it("allows bundled setup facts while answering a foundation intake step", () => {
    expect(factKeysForTextAgentIntakeStep("age_comfort")).toEqual([
      "age",
      "preferred_age_range",
    ]);
    expect(factKeysForTextAgentActiveExtractionStep("neighborhoods")).toEqual(
      expect.arrayContaining([
        "neighborhoods",
        "budget",
        "budget_max",
        "move_in_window",
        "household_size",
        "group_size_flexibility",
        "age",
        "preferred_age_range",
      ]),
    );
  });

  it("allows bundled behavioral facts while answering a detail intake step", () => {
    expect(factKeysForTextAgentIntakeStep("sleep_schedule")).toEqual([
      "sleep_schedule",
    ]);
    expect(factKeysForTextAgentActiveExtractionStep("sleep_schedule")).toEqual(
      expect.arrayContaining([
        "sleep_schedule",
        "work_from_home",
        "noise_tolerance",
        "cleanliness",
        "guests",
        "overnight_guests",
        "social_energy",
        "communication_style",
        "conflict_repair",
      ]),
    );
  });

  it("keeps wanted laundry out of dealbreakers when it is also a must-have", () => {
    const baseFact = {
      assertion_type: "explicit" as const,
      confidence: 0.95,
      dimension: "feasibility",
      importance: 0.85,
      matching_eligible: true,
      sensitivity_level: "standard" as const,
    };
    const result = normalizeHousingPreferenceListFacts([
      {
        ...baseFact,
        evidence:
          "heavy smoking indoors. Also need in-unit or on-site laundry.",
        fact_key: "dealbreakers",
        value: ["heavy smoking indoors", "in-unit or on-site laundry"],
      },
      {
        ...baseFact,
        evidence:
          "in-unit or on-site laundry, and some natural light in the bedroom",
        fact_key: "must_haves",
        value: [
          "in-unit or on-site laundry",
          "some natural light in the bedroom",
        ],
      },
    ]);

    const byKey = new Map(result.facts.map((fact) => [fact.fact_key, fact]));

    expect(byKey.get("dealbreakers")?.value).toEqual([
      "heavy smoking indoors",
    ]);
    expect(byKey.get("must_haves")?.value).toEqual([
      "in-unit or on-site laundry",
      "some natural light in the bedroom",
    ]);
  });

  it("orders intake by feasibility first, then matching impact", () => {
    const indexOf = (step: string) => textAgentIntakeSteps.indexOf(step as never);

    expect(textAgentIntakeSteps.slice(0, 5)).toEqual([
      "neighborhoods",
      "budget",
      "move_in",
      "roommates",
      "age_comfort",
    ]);
    // Higher-weighted behavioral dimensions precede lower-weighted ones.
    expect(indexOf("work_from_home")).toBeLessThan(indexOf("noise_tolerance"));
    expect(indexOf("noise_tolerance")).toBeLessThan(indexOf("cleanliness"));
    expect(indexOf("social_energy")).toBeLessThan(indexOf("communication_style"));
    expect(indexOf("communication_style")).toBeLessThan(indexOf("rent_tradeoff"));
    expect(indexOf("trust_context")).toBeLessThan(indexOf("cleanliness"));
    expect(indexOf("home_preferences")).toBeLessThan(indexOf("rent_tradeoff"));
    expect(indexOf("interests")).toBeLessThan(indexOf("rent_tradeoff"));
    expect(indexOf("budget")).toBeLessThan(indexOf("pets"));
    expect(indexOf("neighborhoods")).toBeLessThan(indexOf("cleanliness"));
  });

  it("treats the five foundation questions as the SMS-to-form handoff line", () => {
    expect(textAgentFoundationIntakeSteps).toEqual([
      "neighborhoods",
      "budget",
      "move_in",
      "roommates",
      "age_comfort",
    ]);
    expect(isTextAgentFoundationIntakeStep("age_comfort")).toBe(true);
    expect(isTextAgentFoundationIntakeStep("sleep_schedule")).toBe(false);
    expect(
      textAgentFoundationIntakeComplete({
        facts: [
          fact("neighborhoods", ["Hayes Valley"]),
          fact("budget_max", 3200),
          fact("move_in_window", { end: "2026-08-31", start: "2026-08-01" }),
          fact("group_size_flexibility", "Open to roommates"),
          fact("preferred_age_range", { max: 19, min: 20 }),
        ],
      }),
    ).toBe(false);
    expect(
      textAgentFoundationIntakeComplete({
        facts: [
          fact("neighborhoods", ["Hayes Valley", "Mission"]),
          fact("budget_max", 3200),
          fact("move_in_window", { end: "2026-08-31", start: "2026-08-01" }),
          fact("group_size_flexibility", "Open to roommates"),
          fact("preferred_age_range", { max: 32, min: 22 }),
        ],
      }),
    ).toBe(true);
    expect(
      textAgentFoundationIntakeComplete({
        facts: [
          fact("neighborhoods", ["Hayes Valley"]),
          fact("budget_max", 3200),
          fact("move_in_window", { end: "2026-08-31", start: "2026-08-01" }),
          fact("group_size_flexibility", "Open to roommates"),
        ],
      }),
    ).toBe(false);
    expect(
      textAgentFoundationIntakeComplete({
        facts: [
          fact("neighborhoods", ["Hayes Valley"]),
          fact("budget_max", 3200),
          fact("move_in_window", { end: "2026-08-31", start: "2026-08-01" }),
          fact("group_size_flexibility", "Open to roommates"),
        ],
        skippedSteps: ["age_comfort"],
      }),
    ).toBe(true);
  });

  it("builds a concise enrichment form handoff reply", () => {
    const url = "https://usekinfolk.com/me/enrich?source=sms_interview";
    const reply = buildTextAgentProfileEnrichmentHandoffReply({
      enrichmentUrl: url,
    });

    expect(reply).toContain("Got the basics");
    expect(reply).toContain(url);
    expect(reply).toContain("daily rhythm");
    expect(reply).toContain("must-haves");
  });

  it("classifies compliance and approval replies before profile extraction", () => {
    expect(classifyTextAgentIntent("STOP")).toBe("opt_out");
    expect(classifyTextAgentIntent("HELP")).toBe("help");
    expect(classifyTextAgentIntent("YES")).toBe("approve");
    expect(classifyTextAgentIntent("REVIEW")).toBe("review");
  });

  it("honors natural-language revocation in the deterministic pre-gate", () => {
    const revocations = [
      "stop texting me",
      "Please stop texting me",
      "don't text me",
      "stop messaging",
      "quit texting",
      "leave me alone",
      "unsubscribe me please",
      "take me off your list",
      "remove me from your texts",
      "Never text me again.",
      "no more texts",
      "I want to opt out",
      "Honestly, stop texting me about apartments.",
      "I need you to stop texting me",
    ];

    for (const message of revocations) {
      expect(classifyTextAgentIntent(message), message).toBe("opt_out");
      expect(isTextAgentRevocationMessage(message), message).toBe(true);
    }
  });

  it("keeps housing-context stop requests out of the opt-out gate", () => {
    const housingStops = [
      "stop showing studios",
      "stop at 3 listings",
      "stop the search in the Mission",
      "can you stop including 1 bedrooms",
      "stop texting me studios, send 2 beds instead",
      "don't text me listings over $3000",
      "remove me from the group with Sam",
      "take me off the Mission search",
      "stop texting me about studios and send 1brs instead",
      "unsubscribe me from the studio alerts and send 1brs",
      "opt me out of studio listings but keep the 1brs coming",
      "stop texting me about anything except 2 bedrooms",
    ];

    for (const message of housingStops) {
      expect(classifyTextAgentIntent(message), message).toBe("profile_update");
      expect(isTextAgentRevocationMessage(message), message).toBe(false);
    }
  });

  it("separates exact opt-out keywords from natural-language revocation", () => {
    expect(isTextAgentOptOutKeyword("STOP")).toBe(true);
    expect(isTextAgentOptOutKeyword("Stop.")).toBe(true);
    expect(isTextAgentOptOutKeyword("unsubscribe")).toBe(true);
    expect(isTextAgentOptOutKeyword("stop texting me")).toBe(false);
    expect(isTextAgentRevocationMessage("stop texting me")).toBe(true);
  });

  it("routes matching interview handoff messages into interview mode", () => {
    expect(classifyTextAgentIntent("INTERVIEW")).toBe("interview");
    expect(classifyTextAgentIntent(buildTextAgentInterviewStartMessage())).toBe(
      "interview",
    );
  });

  it("routes non-command texts to the LLM profile path", () => {
    expect(classifyTextAgentIntent("what apartments are best?")).toBe(
      "profile_update",
    );
    expect(
      classifyTextAgentIntent(
        "Hello I want to live in Pacific Heights in SF, 3k max",
      ),
    ).toBe("profile_update");
    expect(classifyTextAgentIntent("August")).toBe("profile_update");
    expect(classifyTextAgentIntent("   ")).toBe("unsupported");
  });

  it("declines clearly off-topic messages before housing scope signals apply", () => {
    expect(
      isOffTopicTextAgentMessage("Can you help me with my calculus homework?"),
    ).toBe(true);
    expect(
      isOffTopicTextAgentMessage("Write me a python script to scrape websites"),
    ).toBe(true);
    expect(
      isOffTopicTextAgentMessage("Who invented the telephone?"),
    ).toBe(true);
    expect(
      isOffTopicTextAgentMessage("What's the weather forecast for tomorrow?"),
    ).toBe(true);
  });

  it("keeps housing and profile messages in scope for off-topic checks", () => {
    expect(
      isOffTopicTextAgentMessage(
        "Hello I want to live in Pacific Heights in SF, 3k max",
      ),
    ).toBe(false);
    expect(
      isOffTopicTextAgentMessage("Can you find me a 2bd in Inner Richmond?"),
    ).toBe(false);
    expect(
      isOffTopicTextAgentMessage("Who are my roommate matches?"),
    ).toBe(false);
    expect(
      isOffTopicTextAgentMessage("I prefer quiet mornings and clean kitchens"),
    ).toBe(false);
  });

  it("builds a scope decline reply for unsupported requests", () => {
    expect(buildTextAgentScopeDeclineReply()).toContain(
      "SF apartments and roommates",
    );
    expect(buildTextAgentScopeDeclineReply()).not.toMatch(/reply\s+HELP/i);
  });

  it("keeps direct neighborhood recommendation requests in the model/tool path", () => {
    expect(
      classifyTextAgentIntent(
        "Are there any other good neighborhoods I should stay in?",
      ),
    ).toBe("profile_update");
  });

  it("summarizes and risk-ranks model-produced facts", () => {
    const facts: TextProfileFact[] = [
      {
        assertion_type: "explicit",
        confidence: 0.9,
        dimension: "feasibility",
        evidence: "budget is probably 2400-2800",
        fact_key: "budget",
        importance: 1,
        sensitivity_level: "standard",
        value: { min: 2400, max: 2800 },
      },
      {
        assertion_type: "explicit",
        confidence: 0.9,
        dimension: "feasibility",
        evidence: "I am allergic to cats",
        fact_key: "pets",
        importance: 0.9,
        sensitivity_level: "sensitive",
        value: "Has a cat allergy.",
      },
    ];

    expect(riskLevelForTextFacts(facts)).toBe("medium");
    expect(summarizeTextProfileFacts(facts)).toContain("Budget");
    expect(
      summarizeTextProfileFacts([
        {
          assertion_type: "explicit",
          confidence: 0.9,
          dimension: "feasibility",
          evidence: "open to roommates",
          fact_key: "household_size",
          importance: 0.9,
          sensitivity_level: "standard",
          value: "Open to roommates",
        },
      ]),
    ).toContain("Household Size: Open to roommates");
  });

  it("summarizes full profile intake details without money-formatting roommate counts", () => {
    const summary = summarizeTextProfileFacts([
      {
        assertion_type: "explicit",
        confidence: 0.9,
        dimension: "feasibility",
        evidence: "$3,000 max",
        fact_key: "budget_max",
        importance: 0.9,
        sensitivity_level: "standard",
        value: 3000,
      },
      {
        assertion_type: "explicit",
        confidence: 0.9,
        dimension: "feasibility",
        evidence: "Hayes Valley, Mission District, and Inner Richmond",
        fact_key: "neighborhoods",
        importance: 0.8,
        sensitivity_level: "standard",
        value: ["Hayes Valley", "Mission District", "Inner Richmond"],
      },
      {
        assertion_type: "explicit",
        confidence: 0.9,
        dimension: "feasibility",
        evidence: "Early August, flexible by a couple weeks",
        fact_key: "move_in_window",
        importance: 0.8,
        sensitivity_level: "standard",
        value: { earliest: "2026-07-18", latest: "2026-08-15" },
      },
      {
        assertion_type: "explicit",
        confidence: 0.95,
        dimension: "feasibility",
        evidence: "open to 1 roommate",
        fact_key: "household_size",
        importance: 0.8,
        sensitivity_level: "standard",
        value: { max: 2, min: 1 },
      },
      {
        assertion_type: "explicit",
        confidence: 0.9,
        dimension: "environment_tolerance",
        evidence: "Prefer quiet weeknights and low street noise",
        fact_key: "noise_tolerance",
        importance: 0.8,
        sensitivity_level: "standard",
        value: "quiet",
      },
      {
        assertion_type: "explicit",
        confidence: 0.9,
        dimension: "feasibility",
        evidence: "In-unit laundry, good natural light, reliable transit",
        fact_key: "must_haves",
        importance: 0.8,
        sensitivity_level: "standard",
        value: ["In-unit laundry", "good natural light", "reliable transit"],
      },
    ]);

    expect(summary).toContain("Budget: up to $3,000/mo");
    expect(summary).toContain(
      "Household Size: solo or one roommate (1-2 people total)",
    );
    expect(summary).toContain("Move In Window: Jul 18-Aug 15");
    expect(summary).toContain("Must Haves: In-unit laundry");
    expect(summary).not.toContain("$1-$2");
    expect(summary).not.toContain('{"');
  });

  it("summarizes preferred and stretch budgets without inventing a floor", () => {
    const summary = summarizeTextProfileFacts([
      fact("budget_preferred_max", 2800),
      fact("budget_max", 3200),
      fact("rent_tradeoff", "pay more for fit"),
    ]);

    expect(summary).toContain(
      "Budget: target up to $2,800/mo, stretch to $3,200/mo",
    );
    expect(summary).toContain("Rent Tradeoff: pay more for fit");
    expect(summary).not.toContain("$2,800-$3,200/mo");
    expect(summary).not.toContain("Budget Preferred Max");
  });

  it("builds a profile import payload backed by LLM structured facts", () => {
    const facts: TextProfileFact[] = [
      {
        assertion_type: "explicit",
        confidence: 0.92,
        dimension: "feasibility",
        evidence: "I want 3k max budget",
        fact_key: "budget_max",
        importance: 1,
        matching_eligible: true,
        sensitivity_level: "standard",
        value: 3000,
      },
    ];
    const payload = buildProfileImportPayloadFromText(
      "I want 3k max budget.",
      facts,
      {
        extractor: "openrouter",
        model: "deepseek/deepseek-v4-flash",
      },
    );

    expect(payload.source).toBe("text_message");
    expect(payload.extraction.extractor).toBe("openrouter");
    expect(payload.structured_facts).toEqual(facts);
  });

  it("labels text profile imports by transport provider when available", () => {
    expect(textProfileImportSourceForTransport("sendblue")).toBe("sendblue_text");
    expect(textProfileImportSourceForTransport("linq")).toBe("linq_text");
    expect(textProfileImportSourceForTransport(null)).toBe("text_message");
  });
});

function fact(
  factKey: string,
  value: TextProfileFact["value"],
): TextProfileFact {
  return {
    assertion_type: "explicit",
    confidence: 1,
    dimension: "roommate_compatibility",
    evidence: String(value),
    fact_key: factKey,
    importance: 1,
    matching_eligible: true,
    sensitivity_level: "standard",
    value,
  };
}
