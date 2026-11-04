import type { ActiveIntakeGate } from "./intake-gate";
import { asksAboutRoommates, asksForListings, type InboundIntent } from "./interpretation";

// ---------------------------------------------------------------------------
// Onboarding turn machine.
//
// A pure decision layer: (durable gate state, classified intent) → what this
// turn is allowed to do and how it must close. The truth table it implements
// lives in docs/research/onboarding-gate/01-pr31-failure-corpus.md §1; every
// branch here corresponds to a row there. Nothing in this file inspects the
// raw message text — by the time a turn reaches this machine, the message is
// data, and the machine's output is enforced mechanically (tool gating and
// closing-question composition), not by hoping the model follows prose.
//
// Two gates, two bars, unchanged from the original fix: roommate matches wait
// for the WHOLE interview because a compatibility score off two facts is fake
// confidence; listing search waits only for the FOUNDATION steps because a
// search without a group size prices everything solo and returns studios.
// An explicit ask opens the corresponding tool immediately — the gate blocks
// volunteering, never the user.
// ---------------------------------------------------------------------------

export type OnboardingTurnDecision = {
  allowGetMatches: boolean;
  allowSearchListings: boolean;
  directive: string;
  /**
   * The user explicitly asked for listings this turn: if the model talks
   * instead of searching, the loop runs the search anyway. An explicit ask is
   * served with real inventory or an honest failure, never prose about it.
   */
  forceListingSearch: boolean;
};

export function decideOnboardingTurn(
  gate: ActiveIntakeGate,
  intent: InboundIntent,
): OnboardingTurnDecision {
  const listingsAsked = asksForListings(intent);
  const matchesAsked = asksAboutRoommates(intent);
  return {
    allowGetMatches: matchesAsked,
    allowSearchListings: listingsAsked || !gate.foundationStep,
    directive: buildOnboardingDirective(gate, intent),
    forceListingSearch: listingsAsked,
  };
}

function buildOnboardingDirective(gate: ActiveIntakeGate, intent: InboundIntent): string {
  const askLine = gate.nextQuestion
    ? `then finish with exactly this one question: "${gate.nextQuestion}"`
    : "then finish with the next unanswered intake question";
  const listingsGated = Boolean(gate.foundationStep) && !asksForListings(intent);

  const turnLine = (() => {
    switch (intent.kind) {
      case "listing_request":
      case "listing_refinement":
        return "They explicitly asked for listings: run the search, present what actually came back, ";
      case "match_request":
      case "roommate_detail":
        return "They explicitly asked about roommate matches, so answer that honestly — their profile is still thin, so frame any scores as an early read — ";
      case "negated_request":
        return "They just declined something. Respect the no: do not fetch, re-offer, or argue, acknowledge it in one line, ";
      case "housing_tangent":
        return "They asked a housing question, not for a search: answer it honestly in a line or two without fetching listings or matches, ";
      case "other_tangent":
        return "They said something off-topic: acknowledge it warmly in one short line without pretending Kinfolk can help with it, ";
      case "skip":
        return "They want to skip the current question: let it go gracefully, ";
      default:
        return "This turn: acknowledge what they just shared in one warm line, ";
    }
  })();

  return [
    "Onboarding is mid-flight: the quick intake questions are not finished.",
    `${turnLine}${askLine}.`,
    listingsGated
      ? "Do not search for, show, or promise apartment listings this turn. You do not know their group size yet, so a search would price every place as a solo rental and hand back studios — a guess wearing the clothes of a recommendation."
      : "",
    asksAboutRoommates(intent)
      ? ""
      : "Do not mention, promise, or fetch roommate matches this turn, and do not narrate anyone's compatibility score or say a match moved up — they come after the questions, and pitching them now with a thin profile reads as fake confidence.",
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Closing composition. The reply's final line is GENERATED from the persisted
// canonical question, never recovered from model prose — the model cannot
// advance, stall, or rephrase onboarding by phrasing alone. Model-authored
// trailing questions are dropped (they would either duplicate or replace the
// canonical one); grounded prose above them is preserved untouched.
// ---------------------------------------------------------------------------

// The completion turn's fallback when the model's whole reply was questions:
// stripping them all would leave silence, and re-asking anything contradicts
// the completed interview.
const COMPLETION_ACK = "That's everything I needed — you're all set.";

export function composeOnboardingClose(
  reply: string,
  canonicalQuestion: string | null,
  {
    allowModelQuestion = false,
    completionFallback,
  }: {
    /**
     * An explicitly requested task failed this turn: the model's own
     * clarifying question is the right close, so the reply passes through.
     */
    allowModelQuestion?: boolean;
    /**
     * Grounded text to prefer over the canned acknowledgment when a
     * completion reply was nothing but questions — a final-turn listing
     * delivery must survive the close.
     */
    completionFallback?: string;
  } = {},
): string {
  const trimmed = reply.trim();
  if (allowModelQuestion) {
    return trimmed;
  }

  // ALL model question sentences go, interior ones included — with a
  // canonical question appended (or a completed interview), any surviving
  // "?" would make the reply ask two things (corpus Table 2 row 1). Grounded
  // listing prose is declarative and passes through byte-identical.
  const stripped = removeQuestionSentences(trimmed);
  const question = canonicalQuestion?.trim() ?? "";

  if (!question) {
    return stripped || completionFallback?.trim() || COMPLETION_ACK;
  }

  if (!stripped) {
    return question;
  }
  return `${stripped}\n\n${question}`;
}

/**
 * Remove sentences ending in "?", preserving every byte of what remains —
 * paragraph boundaries, single newlines, and inter-sentence spacing survive
 * because the text is split with captured separators and rejoined verbatim.
 */
function removeQuestionSentences(reply: string): string {
  const paragraphs = reply.split(/(\n{2,})/);
  const kept = paragraphs.map((part, index) => {
    if (index % 2 === 1) {
      return part;
    }
    // Alternating [sentence, separator, sentence, …] — separators captured.
    const tokens = part.split(/((?<=[.!?])\s+)/);
    let rebuilt = "";
    let removedAny = false;
    for (let cursor = 0; cursor < tokens.length; cursor += 2) {
      const sentence = tokens[cursor] ?? "";
      const separator = tokens[cursor + 1] ?? "";
      if (sentence.trimEnd().endsWith("?")) {
        removedAny = true;
        continue;
      }
      rebuilt += sentence + separator;
    }
    // Only a modified paragraph is re-trimmed — untouched text must stay
    // byte-identical, but a dropped final sentence must not leave its
    // separator dangling before the paragraph break.
    return removedAny ? rebuilt.trimEnd() : rebuilt;
  });

  return kept
    .join("")
    .replace(/(\n{2,})(?=\n{2,}|$)/g, "")
    .replace(/^\s+|\s+$/g, "");
}
