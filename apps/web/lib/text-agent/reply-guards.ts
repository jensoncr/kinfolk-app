import type { HousingAgentToolResult } from "./tool-belt";

// ---------------------------------------------------------------------------
// Reply guards — pure classifiers over the AGENT'S outbound reply, plus the
// corrective-reround guard table the loop runs after each turn. Every guard
// exists because a flash-tier model narrated something that did not happen;
// each one is deterministic, testable, and independent of the model loop.
// ---------------------------------------------------------------------------

/**
 * A reality guard: the reply claims an action no tool performed this turn.
 * The loop gives the model one corrective round with `directive`, then falls
 * back to a grounded reply, then to `fallbackReply` — never to silence.
 */
export type ReplyRealityGuard = {
  detect: (reply: string, toolResults: HousingAgentToolResult[]) => boolean;
  directive: string;
  fallbackReply: string;
};

/**
 * Run in order; a later guard re-checks the corrected reply of an earlier one
 * (a save-guard rewrite can still fabricate a send claim).
 */
export const replyRealityGuards: ReplyRealityGuard[] = [
  // Save-claim guard: "I saved your criteria" without a successful
  // update_prefs write. A claimed-but-unmade write is the exact trust-killer
  // this agent cannot afford.
  {
    detect: claimsSaveWithoutWrite,
    directive:
      "Reality check: that reply tells the user something was saved, but no update_prefs call succeeded this turn. If the user asked you to remember, save, or change their preferences, you MUST call update_prefs with those exact facts now, then restate the reply. If the user is asking you to RECALL something they told you, answer with the value from this conversation or the context block and phrase it as recall ('you told me $2,600') — do not claim a save happened and do not say it failed to save. Only if there is genuinely nothing to save or recall, rewrite the reply without claiming a write.",
    fallbackReply:
      "real talk — I didn't get that saved properly on my end. tell me once more and I'll lock it in.",
  },
  // Send-claim guard: "I've sent that intro to Jack" when nothing was
  // delivered — one corrective round to make the send for real
  // (message_roommate_match / send_chat_message) or restate honestly what
  // actually happened (intent recorded, chat pending).
  {
    detect: claimsSendWithoutDelivery,
    directive:
      "Reality check: that reply tells the user a message or intro was sent, but no send succeeded this turn. If the user asked you to message a roommate match, call message_roommate_match with their userId from get_matches and the message body now, then restate the reply based on the result: delivered=true → it was sent; delivered=false → say their interest is recorded and the chat opens when the match accepts. Never claim a send that did not happen.",
    fallbackReply:
      "heads up — I wasn't able to get that message sent on my end. want me to try again?",
  },
];

// True when the prose asserts a completed (or promised) write that no
// successful update_prefs call backs. Possessive/recall mentions ("the spot
// you saved", "your saved filters") are not claims of a new write.
export function claimsSaveWithoutWrite(
  reply: string,
  toolResults: HousingAgentToolResult[],
): boolean {
  const wrote = toolResults.some((result) => {
    if (result.toolName !== "update_prefs" || !result.ok) {
      return false;
    }
    const persisted = (result.data as Record<string, unknown>).persisted;
    return Array.isArray(persisted) && persisted.length > 0;
  });
  if (wrote) {
    return false;
  }
  const text = reply.toLowerCase();
  // Recall answers ("you told me $2,600 — it's saved") restate history; they
  // are not fresh-write claims, and firing the guard on them makes the agent
  // deny knowledge it visibly has.
  if (/\byou (?:told me|said|mentioned|gave me|asked for)\b/.test(text)) {
    return false;
  }
  if (
    !/\b(?:saved|noted|recorded|updated|adjusted|i'?ll\s+(?:save|note|record|update|adjust))\b/.test(
      text,
    )
  ) {
    return false;
  }
  return /\b(?:i(?:'ve| have| just)?\s+(?:saved|noted|recorded|updated|adjusted)|(?:saved|noted|recorded|updated|adjusted)\s+(?:your|that|this|it|those|these)|i'?ll\s+(?:save|note|record|update|adjust))\b/.test(
    text,
  );
}

/**
 * Send-claim reality guard predicate: the reply tells the user a message /
 * intro was sent to someone, but no tool actually delivered one this turn.
 * This is the "I've sent that intro over to Jack" fabrication — the agent had
 * no way to send anything, and claimed it did.
 */
export function claimsSendWithoutDelivery(
  reply: string,
  toolResults: HousingAgentToolResult[],
): boolean {
  const delivered = toolResults.some((result) => {
    if (!result.ok) {
      return false;
    }
    if (result.toolName === "send_chat_message") {
      return (result.data as Record<string, unknown>).previewOnly !== true;
    }
    if (result.toolName === "message_roommate_match") {
      return (result.data as Record<string, unknown>).delivered === true;
    }
    return false;
  });
  if (delivered) {
    return false;
  }
  const text = reply.toLowerCase();
  return /\b(?:i(?:'ve| have| just)?\s+(?:sent|messaged|texted|forwarded|passed(?: that| it)? along|reached out)|(?:sent|delivered)\s+(?:that|the|your|it|him|her|them)\b[\s\S]{0,40}\b(?:message|intro|note|hello)|intro\s+(?:is\s+)?(?:sent|over|delivered))\b/.test(
    text,
  );
}

// ---------------------------------------------------------------------------
// One-question guard predicates
// ---------------------------------------------------------------------------

const BUNDLED_QUESTION_CONJUNCTION =
  /,?\s+(?:and|or also|plus)\s+(?:do|does|did|are|is|was|will|would|could|should|can|what|when|where|which|how|who)\b/i;

// True when the reply asks more than one thing: multiple question marks, or a
// single question sentence that conjoins a second interrogative clause with
// "and" ("a month in mind, and are you looking to…?"). An "or" between
// alternatives stays one question ("Mission Bay, or should we stretch?").
export function isMultiQuestionReply(reply: string): boolean {
  const marks = (reply.match(/\?/g) ?? []).length;
  if (marks > 1) {
    return true;
  }
  if (marks === 0) {
    return false;
  }
  return reply
    .split(/(?<=[.!?])/)
    .filter((sentence) => sentence.trim().endsWith("?"))
    .some((sentence) => BUNDLED_QUESTION_CONJUNCTION.test(sentence));
}

/**
 * Deterministic fallback for the one-question guard: cut an and-conjoined
 * second question off the offending sentence ("where are you looking, and are
 * you moving solo?" → "where are you looking?"). Returns null when the reply
 * has no bundle this trim can safely fix (e.g. two separate ?-sentences).
 */
export function trimBundledQuestion(reply: string): string | null {
  const sentences = reply.split(/(?<=[.!?])/);
  let trimmedAny = false;
  const rebuilt = sentences.map((sentence) => {
    if (!sentence.trim().endsWith("?")) return sentence;
    const match = BUNDLED_QUESTION_CONJUNCTION.exec(sentence);
    if (!match || match.index === 0) return sentence;
    trimmedAny = true;
    const leadingWhitespace = sentence.match(/^\s*/)?.[0] ?? "";
    const firstClause = sentence.slice(0, match.index).replace(/[\s,;]+$/, "");
    return `${leadingWhitespace}${firstClause.trimStart()}?`;
  });
  return trimmedAny ? rebuilt.join("") : null;
}

// ---------------------------------------------------------------------------
// Offered-profile withhold predicates
// ---------------------------------------------------------------------------

/**
 * True when the reply's FINAL sentence is an offer-question about showing
 * someone's profile or card ("Want me to pull up any of their full
 * profiles?"). Tail-anchored on purpose: an offer mid-reply followed by other
 * content is not the closing question this guard exists for.
 */
export function offersRoommateProfilesInsteadOfSending(reply: string): boolean {
  const tail = reply.trim().slice(-180);
  return /\b(?:want me to|would you like(?: me)?(?: to)?|should i|shall i|say the word)\b[^.?!\n]{0,60}\b(?:pull up|see|show|send|share|open)\b[^.?!\n]{0,50}\b(?:profiles?|cards?)\b[^.?!\n]{0,30}\?\s*$/i.test(
    tail,
  );
}

// Person cards only (roommate + group-join profile cards) — listing cards
// (/api/listing-card/) are a different speech act and never suppressed here.
export function isPersonProfileCardUrl(url: string): boolean {
  return /(?:roommate|profile)-card/.test(url);
}

// ---------------------------------------------------------------------------
// Rolling-summary commitment guard
// ---------------------------------------------------------------------------

/**
 * True when the freshly-written thread memory asserts a strong user
 * commitment (a rejection, an "only wants") that neither the user's message
 * nor the previous memory supports — the summarizer inferring intent from the
 * AGENT'S words. The caller keeps the previous memory instead.
 */
export function hasUnsupportedStrongUserCommitment(
  summary: string,
  {
    body,
    previousSummary,
  }: {
    body: string;
    previousSummary: string;
  },
) {
  const sourceText = `${previousSummary}\n${body}`;
  return strongUserCommitmentGuards.some(
    ({ sourcePattern, summaryPattern }) =>
      summaryPattern.test(summary) && !sourcePattern.test(sourceText),
  );
}

const strongUserCommitmentGuards = [
  {
    sourcePattern:
      /\b(?:reject(?:ed|s|ing)?|dislik(?:e|ed|es|ing)|hat(?:e|ed|es|ing)|passed?\s+on|ruled?\s+out|not\s+interested\s+in|skip(?:ped|s|ping)?\s+(?:that|this|the\s+)?(?:listing|place|apartment|unit|option|spot|home|first|second|third|one))\b/i,
    summaryPattern:
      /\b(?:reject(?:ed|s|ing)?|dislik(?:e|ed|es|ing)|hat(?:e|ed|es|ing)|passed?\s+on|ruled?\s+out|not\s+interested\s+in)\b/i,
  },
  {
    sourcePattern:
      /\b(?:exclusive(?:ly)?|solely|only\s+(?:want|wants|wanted|looking|look|show|send|solo|one-bedrooms?|1-bedrooms?|1bds?)|focus(?:ed|es|ing)?\s+(?:only|exclusively)|nothing\s+but|no\s+shared)\b/i,
    summaryPattern:
      /\b(?:exclusive(?:ly)?|solely|only\s+wants?|focus(?:ed|es|ing)?\s+(?:only|exclusively)|decided\s+to\s+focus)\b/i,
  },
];

// ---------------------------------------------------------------------------
// Grounded fallback reply
// ---------------------------------------------------------------------------

// A grounded stand-in for the model's missing prose: speak only from what the
// tools actually returned, name listings and roommates plainly so their cards
// still attach, and say nothing for tools we can't phrase honestly.
export function buildGroundedReplyFromToolResults(
  toolResults: HousingAgentToolResult[],
): string {
  for (const result of [...toolResults].reverse()) {
    if (!result.ok) {
      continue;
    }
    const built = buildGroundedReplyFromToolResult(result);
    if (built) {
      return built;
    }
  }
  return "";
}

function buildGroundedReplyFromToolResult(
  result: HousingAgentToolResult,
): string {
  if (result.toolName === "search_listings") {
    const listings = Array.isArray(result.data.listings)
      ? result.data.listings
      : [];
    const lines = listings.slice(0, 3).flatMap((listing) => {
      if (!listing || typeof listing !== "object") {
        return [];
      }
      const { address, neighborhood, perPersonRent, rent } = listing as Record<
        string,
        unknown
      >;
      if (typeof address !== "string" || !address.trim()) {
        return [];
      }
      const where =
        typeof neighborhood === "string" && neighborhood.trim()
          ? ` in ${neighborhood.trim()}`
          : "";
      const price =
        typeof perPersonRent === "number" && Number.isFinite(perPersonRent)
          ? ` at $${Math.round(perPersonRent).toLocaleString()} each`
          : typeof rent === "number" && Number.isFinite(rent)
            ? ` at $${Math.round(rent).toLocaleString()}/mo`
            : "";
      return [`${address.trim()}${where}${price}.`];
    });
    if (lines.length === 0) {
      // An empty search is an answer too — a silent turn here left renters
      // asking follow-ups about listings that were never presented.
      return "nothing active matches that search right now. want me to widen the area or nudge the budget?";
    }
    return [
      "here's what i found:",
      ...lines,
      "want the full rundown on any of them?",
    ].join("\n\n");
  }

  if (result.toolName === "get_matches") {
    const roommates = Array.isArray(result.data.roommates)
      ? result.data.roommates
      : [];
    const names = roommates.slice(0, 3).flatMap((roommate) => {
      if (!roommate || typeof roommate !== "object") {
        return [];
      }
      const { name, score } = roommate as Record<string, unknown>;
      if (typeof name !== "string" || !name.trim()) {
        return [];
      }
      return [
        typeof score === "number" && Number.isFinite(score)
          ? `${name.trim()} (${Math.round(score)}%)`
          : name.trim(),
      ];
    });
    if (names.length === 0) {
      return "";
    }
    return `your strongest matches right now: ${names.join(", ")}. want a closer look at any of them?`;
  }

  if (result.toolName === "update_prefs") {
    // ok=true also covers all-facts-sensitive-skipped turns where nothing was
    // written — only claim a save when something actually persisted.
    const persisted = (result.data as Record<string, unknown>).persisted;
    return Array.isArray(persisted) && persisted.length > 0
      ? "got it — that's saved to your profile."
      : "";
  }

  if (result.toolName === "get_profile_summary") {
    // Recall turns: the model fetched the profile then produced no prose (the
    // reality guard's corrective round often ends here). Answering with the
    // summary keeps the reply honest — never "I didn't save that" when the
    // profile plainly holds the answer.
    const summary = (result.data as Record<string, unknown>).summary;
    return typeof summary === "string" && summary.trim()
      ? `here's what I have saved for you: ${summary.trim()}`
      : "";
  }

  if (result.toolName === "send_chat_message") {
    return "sent.";
  }

  // The remaining read tools get a minimal honest acknowledgement: without
  // one, a turn whose only work was a successful lookup falls through to the
  // "Kinfolk is unavailable" bubble and pages the founder for an outage that
  // never happened.
  if (result.toolName === "get_listing_details") {
    const address = (result.data as Record<string, unknown>).address;
    return typeof address === "string" && address.trim()
      ? `pulled up the details for ${address.trim()} — what do you want to know about it? rent, availability, or the area?`
      : "";
  }

  if (result.toolName === "get_area_signals") {
    const neighborhood = (result.data as Record<string, unknown>).neighborhood;
    return typeof neighborhood === "string" && neighborhood.trim()
      ? `i pulled the latest on ${neighborhood.trim()} — want the noise, safety, food, or commute picture first?`
      : "";
  }

  if (result.toolName === "read_chat") {
    return "caught up on that chat — want a recap or should i draft a reply?";
  }

  return "";
}
