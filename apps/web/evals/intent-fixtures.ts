import type { InboundIntentKind } from "@/lib/text-agent/interpretation";

// One representative per semantic CLASS BOUNDARY of the inbound-intent
// classifier — this is the fixture set that replaces PR #31's ~190 phrase
// tests (docs/research/onboarding-gate/01-pr31-failure-corpus.md §2). A
// misclassified phrase in production gets added HERE (and the classifier
// prompt fixed) — never as a regex.
//
// `expectKinds` lists every acceptable class: some boundaries legitimately
// admit two readings, and pinning one would rebuild regex-shaped decision
// boundaries with extra steps. What matters is the reading that is WRONG —
// e.g. an ungrounded lowercase name must never be roommate_detail.

export type IntentFixture = {
  body: string;
  expectKinds: InboundIntentKind[];
  expectMedia?: boolean;
  name: string;
  previousAssistantMessage?: string;
};

const LISTING_CONTEXT =
  "Found 2 places in Nob Hill: 1234 Jones St ($2,950) and 900 Hyde St ($3,100). Want me to keep looking? What's your move-in timing?";

const MATCH_CONTEXT =
  "Two people look promising: Jack (78% fit, quiet, early riser) and Priya (74% fit, loves cooking). What neighborhoods are you drawn to?";

const NEIGHBORHOOD_SCORE_CONTEXT =
  "The Mission scores 82% for you, Hayes Valley 76%, and the Sunset 61%. What's your monthly budget?";

export const INTENT_FIXTURES: IntentFixture[] = [
  // -- declarative preference vs. directive (assertion ≠ command) -----------
  {
    body: "i'm looking for a two bedroom in the mission",
    expectKinds: ["intake_answer"],
    name: "declarative preference is an answer, not a search",
  },
  {
    body: "$3000 max",
    expectKinds: ["intake_answer"],
    name: "bare budget figure is an answer",
  },
  {
    body: "would rather go solo",
    expectKinds: ["intake_answer"],
    name: "auxiliary-led answer is an answer",
  },
  {
    body: "where I work is in SoMa",
    expectKinds: ["intake_answer"],
    name: "workplace statement is an answer",
  },
  // -- explicit listing requests --------------------------------------------
  {
    body: "show me places under 2k",
    expectKinds: ["listing_request"],
    name: "imperative inventory ask",
  },
  {
    body: "any 2brs under 3k?",
    expectKinds: ["listing_request"],
    name: "compact quantified inventory ask",
  },
  {
    body: "recommend me an apartment in nob hill",
    expectKinds: ["listing_request"],
    name: "recommendation language is an ask",
  },
  {
    // PR #31 conflated "not an ask" with "an ask we can't serve": Oakland is
    // out of market, but the speech act is identical to the Nob Hill ask.
    // Serving honestly is the reply layer's job, not the classifier's.
    body: "what can i find in oakland?",
    expectKinds: ["listing_request"],
    name: "unserved market is still an ask",
  },
  {
    body: "roommate friendly apartments in the mission",
    expectKinds: ["listing_request"],
    name: "roommate-friendly apartments asks for listings, not matches",
  },
  // -- refinements require grounded listing context -------------------------
  {
    body: "what about the marina?",
    expectKinds: ["listing_refinement"],
    name: "area pivot after listing results is a refinement",
    previousAssistantMessage: LISTING_CONTEXT,
  },
  {
    body: "anything under 3k",
    expectKinds: ["listing_refinement"],
    name: "price narrowing after listing results is a refinement",
    previousAssistantMessage: LISTING_CONTEXT,
  },
  {
    body: "what about the marina?",
    expectKinds: ["intake_answer", "housing_tangent", "listing_request"],
    name: "area mention without listing context is not a refinement",
  },
  // -- match requests and clause-scoped negation ----------------------------
  {
    body: "who are my best matches?",
    expectKinds: ["match_request"],
    name: "direct match ask",
  },
  {
    body: "I don't want to miss any roommate matches — show me the latest",
    expectKinds: ["match_request"],
    name: "don't-miss is a positive request",
  },
  {
    body: "I don't want a place with stairs. Can you show me roommate matches?",
    expectKinds: ["match_request"],
    name: "negation scoped to listings does not negate the match ask",
  },
  {
    body: "no more roommate matches",
    expectKinds: ["negated_request"],
    name: "pure negation",
  },
  {
    body: "I'd rather not see roommate matches",
    expectKinds: ["negated_request"],
    name: "contrarian negation with ask-shaped verbs",
  },
  // -- roommate detail requires a grounded name -----------------------------
  {
    body: "tell me more about jack",
    expectKinds: ["roommate_detail"],
    name: "lowercase name grounded by the previous turn",
    previousAssistantMessage: MATCH_CONTEXT,
  },
  {
    body: "tell me more about jack",
    expectKinds: ["housing_tangent", "other_tangent", "intake_answer"],
    name: "ungrounded lowercase name is never roommate_detail",
  },
  {
    body: "tell me more",
    expectKinds: ["housing_tangent", "listing_refinement", "other_tangent"],
    name: "scored neighborhoods are not roommate context",
    previousAssistantMessage: NEIGHBORHOOD_SCORE_CONTEXT,
  },
  // -- tangents --------------------------------------------------------------
  {
    body: "tell me more about Hayes Valley",
    expectKinds: ["housing_tangent"],
    name: "neighborhood question is a housing tangent",
  },
  {
    body: "is renters insurance worth it?",
    expectKinds: ["housing_tangent"],
    name: "process question is a housing tangent",
  },
  {
    body: "find me a coffee shop near the mission",
    expectKinds: ["other_tangent"],
    name: "non-housing POI search is not a listing ask",
  },
  {
    body: "look near my dentist",
    expectKinds: ["other_tangent"],
    name: "nounless non-housing POI command is not a listing ask",
  },
  // -- control + media -------------------------------------------------------
  {
    body: "skip",
    expectKinds: ["skip"],
    name: "bare skip",
  },
  {
    body: "no preference",
    expectKinds: ["skip", "intake_answer"],
    name: "no-preference reads as skip or answer, never an ask",
  },
  {
    body: "send me their profiles",
    expectKinds: ["match_request", "roommate_detail"],
    expectMedia: true,
    name: "profile-card ask wants media",
    previousAssistantMessage: MATCH_CONTEXT,
  },
];
