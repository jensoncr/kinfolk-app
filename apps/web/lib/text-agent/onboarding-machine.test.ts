import { describe, expect, it } from "vitest";
import type { ActiveIntakeGate } from "./intake-gate";
import type { InboundIntent, InboundIntentKind } from "./interpretation";
import {
  composeOnboardingClose,
  decideOnboardingTurn,
} from "./onboarding-machine";

// These tests ARE the truth table from
// docs/research/onboarding-gate/01-pr31-failure-corpus.md §1 (Table 1 for
// decideOnboardingTurn, Table 2's closing invariants for
// composeOnboardingClose). Rows are semantic classes — phrasing lives in the
// classifier's eval fixtures, never here.

function intent(
  kind: InboundIntentKind,
  overrides: Partial<InboundIntent> = {},
): InboundIntent {
  return {
    area: null,
    bedrooms: null,
    kind,
    maxRent: null,
    personName: null,
    source: "classifier",
    wantsMediaCards: false,
    ...overrides,
  };
}

function gate(overrides: Partial<ActiveIntakeGate> = {}): ActiveIntakeGate {
  return {
    foundationStep: "roommates",
    nextQuestion: "How many roommates are you open to?",
    step: "roommates",
    ...overrides,
  };
}

describe("decideOnboardingTurn — Table 1", () => {
  it("keeps both fetch tools closed for an intake answer while a foundation step is open", () => {
    const decision = decideOnboardingTurn(gate(), intent("intake_answer"));

    expect(decision.allowGetMatches).toBe(false);
    expect(decision.allowSearchListings).toBe(false);
    expect(decision.forceListingSearch).toBe(false);
    expect(decision.directive).toContain("Do not search for, show, or promise");
    expect(decision.directive).toContain(
      "do not narrate anyone's compatibility score",
    );
  });

  it("opens and forces listing search on an explicit listing request", () => {
    const decision = decideOnboardingTurn(gate(), intent("listing_request"));

    expect(decision.allowSearchListings).toBe(true);
    expect(decision.forceListingSearch).toBe(true);
    expect(decision.allowGetMatches).toBe(false);
    expect(decision.directive).toContain("explicitly asked for listings");
    expect(decision.directive).not.toContain(
      "Do not search for, show, or promise",
    );
  });

  it("treats a listing refinement like an explicit listing request", () => {
    const decision = decideOnboardingTurn(gate(), intent("listing_refinement"));

    expect(decision.allowSearchListings).toBe(true);
    expect(decision.forceListingSearch).toBe(true);
    expect(decision.allowGetMatches).toBe(false);
  });

  it("opens matches on an explicit match request without opening listings", () => {
    const decision = decideOnboardingTurn(gate(), intent("match_request"));

    expect(decision.allowGetMatches).toBe(true);
    expect(decision.allowSearchListings).toBe(false);
    expect(decision.directive).toContain("explicitly asked about roommate");
  });

  it("opens matches for a grounded roommate-detail follow-up", () => {
    const decision = decideOnboardingTurn(
      gate(),
      intent("roommate_detail", { personName: "Jack" }),
    );

    expect(decision.allowGetMatches).toBe(true);
    expect(decision.allowSearchListings).toBe(false);
  });

  it("keeps everything closed on a negated request and tells the model to respect the no", () => {
    const decision = decideOnboardingTurn(gate(), intent("negated_request"));

    expect(decision.allowGetMatches).toBe(false);
    expect(decision.allowSearchListings).toBe(false);
    expect(decision.directive).toContain("Respect the no");
  });

  it("answers a housing tangent without opening any fetch tool", () => {
    const decision = decideOnboardingTurn(gate(), intent("housing_tangent"));

    expect(decision.allowGetMatches).toBe(false);
    expect(decision.allowSearchListings).toBe(false);
    expect(decision.directive).toContain("answer it honestly");
  });

  it("keeps fetch tools closed for a non-housing tangent", () => {
    const decision = decideOnboardingTurn(gate(), intent("other_tangent"));

    expect(decision.allowGetMatches).toBe(false);
    expect(decision.allowSearchListings).toBe(false);
  });

  it("opens listings but not matches once the foundation is complete", () => {
    const decision = decideOnboardingTurn(
      gate({ foundationStep: null }),
      intent("intake_answer"),
    );

    expect(decision.allowSearchListings).toBe(true);
    expect(decision.forceListingSearch).toBe(false);
    expect(decision.allowGetMatches).toBe(false);
  });

  it("pins the canonical question verbatim into every directive", () => {
    const decision = decideOnboardingTurn(gate(), intent("intake_answer"));

    expect(decision.directive).toContain(
      'finish with exactly this one question: "How many roommates are you open to?"',
    );
  });
});

describe("composeOnboardingClose — Table 2", () => {
  const question = "How many roommates are you open to?";

  it("replaces a model-authored trailing question with the canonical question", () => {
    const reply = composeOnboardingClose(
      "Got it — cats are welcome in plenty of places. What kind of home setup are you hoping for?",
      question,
    );

    expect(reply).toBe(
      `Got it — cats are welcome in plenty of places.\n\n${question}`,
    );
  });

  it("strips a whole trailing question block, not just the last sentence", () => {
    const reply = composeOnboardingClose(
      "Found 2 places in the Marina. Want more like these? Or should I widen the search?",
      question,
    );

    expect(reply).toBe(`Found 2 places in the Marina.\n\n${question}`);
  });

  it("preserves grounded prose paragraphs and bubble boundaries above the close", () => {
    const reply = composeOnboardingClose(
      "1234 Fell St — $2,950, sunny 2br.\n\n77 Dolores St — $3,100, near the park.\n\nWant me to keep looking?",
      question,
    );

    expect(reply).toBe(
      `1234 Fell St — $2,950, sunny 2br.\n\n77 Dolores St — $3,100, near the park.\n\n${question}`,
    );
  });

  it("asks the canonical question alone when the model returned nothing", () => {
    expect(composeOnboardingClose("", question)).toBe(question);
  });

  it("ends with no question at all on the completion turn", () => {
    const reply = composeOnboardingClose(
      "That's everything I needed — your profile is set. Anything else you want to tweak?",
      null,
    );

    expect(reply).toBe("That's everything I needed — your profile is set.");
    expect(reply).not.toContain("?");
  });

  it("falls back to a neutral ack when a completion reply was nothing but questions", () => {
    const reply = composeOnboardingClose("Ready for the next step?", null);

    // Echoing the stale question would contradict the durably completed
    // interview; the neutral acknowledgment replaces it.
    expect(reply).toBe("That's everything I needed — you're all set.");
    expect(reply).not.toContain("?");
  });

  it("prefers grounded tool output over the canned ack on an all-questions completion turn", () => {
    const reply = composeOnboardingClose(
      "Here are 3 in the Marina under $3,200 — want details on any?",
      null,
      { completionFallback: "Found 3 listings in the Marina under $3,200." },
    );

    expect(reply).toBe("Found 3 listings in the Marina under $3,200.");
  });

  it("strips an interior model question so the composed reply asks exactly one thing", () => {
    const reply = composeOnboardingClose(
      "Nob Hill's a great pick. Are you set on it, or open to Russian Hill? Either way I'll keep it in mind.",
      question,
    );

    expect(reply).toBe(
      `Nob Hill's a great pick. Either way I'll keep it in mind.\n\n${question}`,
    );
    expect(reply.match(/\?/g)).toHaveLength(1);
  });

  it("keeps single newlines and spacing byte-identical when nothing is stripped", () => {
    const grounded =
      "Found 2 places.\n1234 Fell St — $2,950.\n77 Dolores St — $3,100.";

    expect(composeOnboardingClose(grounded, question)).toBe(
      `${grounded}\n\n${question}`,
    );
  });

  it("passes the reply through when an explicitly requested task failed and needs clarification", () => {
    const clarification =
      "I couldn't find anything under $900 in the Marina — should I widen the budget or the area?";

    expect(
      composeOnboardingClose(clarification, question, {
        allowModelQuestion: true,
      }),
    ).toBe(clarification);
  });

  it("does not duplicate the canonical question when the model already asked it", () => {
    const reply = composeOnboardingClose(
      `Noted — no pets. ${question}`,
      question,
    );

    expect(reply).toBe(`Noted — no pets.\n\n${question}`);
    expect(reply.match(/\?/g)).toHaveLength(1);
  });
});
