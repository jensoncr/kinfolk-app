// FROZEN — degraded-mode fallback only. The live classification boundary is
// interpretation.ts (structured LLM interpretation); these regexes run only
// when that classifier call fails, so an outage turn behaves exactly like the
// pre-boundary system.
//
// NEVER extend these patterns. Phrase-enumeration of natural-language intent
// is what turned PR #31 into a 73-commit patch loop (see
// docs/research/onboarding-gate/01-pr31-failure-corpus.md). A phrase the
// system gets wrong becomes an eval fixture in evals/intent-fixtures.ts and,
// if needed, a prompt fix in interpretation.ts — never a new regex here.

export function isExplicitMediaRequest(body: string) {
  const normalized = body.toLowerCase();
  return (
    /\b(show|send|share|attach|pull up|open|view|see)\b[\s\S]{0,80}\b(card|cards|photo|photos|picture|pictures|profile|profiles|listing|listings|apartment|apartments|match|matches|roommate|roommates)\b/.test(
      normalized,
    ) ||
    /\b(card|cards|photo|photos|picture|pictures|profile|profiles)\b/.test(
      normalized,
    )
  );
}

export function isRoommateMatchMediaRequest(body: string) {
  const normalized = body.toLowerCase();
  const asksForCompatiblePeople =
    /\b(show|send|share|pull up|view|see|find|who|recommend)\b[\s\S]{0,80}\b(match|matches|roommate|roommates|compatible people|people)\b/.test(
      normalized,
    ) || /\b(roommate matches|compatible roommates|best matches)\b/.test(normalized);
  if (asksForCompatiblePeople) {
    return true;
  }

  const asksForMoreDetail =
    /\b(tell me more|more info(?:rmation)?|give me more info(?:rmation)?|details?|rundown|learn more|what should i know)\b/.test(
      normalized,
    );
  if (!asksForMoreDetail) {
    return false;
  }

  return (
    /\b(person|roommate|roommates|match|matches|candidate|profile|compatibility|compatible|them|him|her)\b/.test(
      normalized,
    ) ||
    /\b(?:about|on|for)\s+(?!the\b|this\b|that\b|my\b|our\b|your\b|a\b|an\b)[a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?/.test(
      normalized,
    )
  );
}

// "Show me my matches" mid-interview is still honored — the intake gate only
// blocks VOLUNTEERED matches. Intake answers that merely contain the word
// "roommate" ("roommates aged 20-29") must not count as an ask, so this
// requires either the media-request verb+noun shape or a direct
// my/any-matches phrase.
export function isExplicitRoommateMatchAsk(body: string) {
  return (
    isRoommateMatchMediaRequest(body) ||
    /\b(?:my|any|got|have any)\s+(?:top\s+)?match(?:es)?\b/i.test(body)
  );
}

// Same escape-hatch shape for places: "show me what's in Nob Hill" mid-intake is
// honored, but an intake ANSWER that merely names areas or a rent number
// ("Nob Hill and the Marina", "$3000 max") is not a request to go searching —
// that read is what produced a studio dump before the roommate question was
// ever asked.
export function isExplicitListingAsk(body: string) {
  const normalized = body.toLowerCase();
  const listingNoun =
    "listing|listings|apartment|apartments|place|places|unit|units|studio|studios|rental|rentals|bedroom|bedrooms|[123]\\s?brs?|spot|spots";
  return (
    // "show me places in Nob Hill", "can you search for 2brs"
    new RegExp(
      `\\b(?:show|send|share|pull up|find|search|look for|see|browse)\\b[\\s\\S]{0,80}\\b(?:${listingNoun})\\b`,
    ).test(normalized) ||
    // "any apartments under 2k?" — quantified, so "I have a place in mind" and
    // "we got a place lined up" stay out.
    new RegExp(
      `\\b(?:any|some|got any|have any)\\s+(?:\\w+\\s+){0,2}(?:${listingNoun})\\b`,
    ).test(normalized) ||
    // "what do you have?", "what can we get in the Mission?", "what's available"
    /\b(?:what'?s|whats|what|anything)\b[\s\S]{0,40}\b(?:available|out there|on the market|do you have|you got|can we get|can i get|can we afford|can i afford)\b/.test(
      normalized,
    )
  );
}
