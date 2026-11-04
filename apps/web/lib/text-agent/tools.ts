import type { Database } from "@/lib/supabase/types";

export type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

export type TextAgentRecentMessage = {
  body: string;
  direction: string;
  receivedAt: string;
};

export type NeighborhoodRecommendationIntent = {
  excludeKnownNeighborhoods: boolean;
  kind: "neighborhood_recommendation";
  source: "direct_request" | "contextual_followup";
  tags: RecommendationTag[];
};

export type RecommendationTag =
  | "budget"
  | "commute"
  | "nightlife"
  | "parks"
  | "quiet"
  | "restaurants"
  | "walkable";

export type NeighborhoodSearchContext = {
  budgetMax: number | null;
  market: string;
  preferredNeighborhoods: string[];
};

export type ScoredNeighborhood = {
  caution: NeighborhoodRecommendationCaution | null;
  displayName: string;
  listingCount: number;
  medianRent: number | null;
  reasons: string[];
  rentMax: number | null;
  rentMin: number | null;
  score: number;
};

export type NeighborhoodRecommendationCaution = "high_public_safety_screening";

export type NeighborhoodPoiPoint = { distance: number; name: string };

export type NeighborhoodPoiSummary = {
  grocery: NeighborhoodPoiPoint[];
  parks: NeighborhoodPoiPoint[];
  restaurant: NeighborhoodPoiPoint[];
  transit: NeighborhoodPoiPoint[];
};

export type NeighborhoodValidationCandidate = {
  aliases?: string[];
  displayName: string;
};

export type ListingLocationContext = {
  address: string;
  amenities: string[];
  bathrooms: number | null;
  bedrooms: number | null;
  description: string | null;
  effectiveMonthlyRent: number | null;
  id: string;
  lat: number;
  lng: number;
  monthlyRent: number | null;
  neighborhood: string | null;
  rentMax: number | null;
  rentMin: number | null;
  source: string | null;
  sourceUrl: string | null;
};

export type NeighborhoodValidationResult = {
  accepted: string[];
  rejected: string[];
};

const offTopicTextAgentPatterns = [
  /\b(?:homework|calculus|algebra|geometry|trigonometry|derivative|integral|equation)\b/i,
  /\b(?:essay|thesis|dissertation|midterm|final exam|study for)\b/i,
  /\b(?:weather forecast|sports score|recipe for|who won the game)\b/i,
  /\b(?:write (?:me )?(?:a )?(?:python|javascript|typescript|code|script|program))\b/i,
  /\b(?:debug this|fix this bug|stack overflow)\b/i,
  /\b(?:who (?:was|is|invented|discovered)|what year did|history of the)\b/i,
  /\b(?:explain (?:quantum|relativity|photosynthesis|mitosis))\b/i,
  /\b(?:translate .{5,80} (?:to|into) (?:spanish|french|german|chinese|japanese))\b/i,
];

// Tasks the agent must never perform even when the message mentions housing nouns
// (e.g. "write me a python script to scrape apartment listings"). These override the
// product-scope bypass below so housing keywords can't smuggle an off-topic task in.
const hardOffTopicTextAgentPatterns = [
  /\b(?:write|generate|create|build|code|debug|fix)\b[^?]{0,40}\b(?:script|program|code|function|app|website|web ?app|bot|scraper|crawler|regex|sql(?:\s+query)?|query)\b/i,
  /\b(?:python|javascript|typescript|golang|rust|bash)\b[^?]{0,30}\b(?:script|program|code|function)\b/i,
  /\b(?:scrape|scraping|crawl|crawler|spider)\b/i,
  /\b(?:homework|calculus|algebra|geometry|trigonometry|derivative|integral)\b/i,
  /\b(?:essay|thesis|dissertation|midterm|final exam)\b/i,
  /\btranslate\b[^?]{3,80}\b(?:to|into)\b/i,
  /\b(?:tell|make|write|give)\b[^?]{0,40}\bjoke\b|\bjoke about\b/i,
];

/**
 * Returns a graceful refusal when the message asks for something Kinfolk must not
 * do — discriminatory roommate/housing filtering (fair-housing protected classes) or
 * help falsifying rental-application materials. Returns null otherwise. Checked before
 * normal routing so these never fall through to a tool that appears to comply.
 */
export function restrictedTextAgentRefusal(body: string): string | null {
  const normalized = body.toLowerCase();

  // First-person self-descriptions are intake facts, not filtering asks:
  // "I'm a 24-year-old woman looking for a roommate in the Mission" is a
  // canonical intro and must not be refused. Strip the self-description
  // clause, then test what remains — a filtering ask about OTHERS survives
  // the strip ("I'm a woman looking for female roommates only" still trips
  // on "female roommates only").
  const selfDescription = new RegExp(
    [
      // "I'm a (24-year-old) (gay) man", "we're two young women"
      String.raw`\b(?:i'?m|i am|we'?re|we are)\s+(?:(?:a|an|both|all|two|2)\s+)+(?:\d{2}[\s-]*(?:years?[\s-]*old|yo|y\/o)[\s-]+)?(?:[a-z]+[\s-]+){0,2}(?:man|men|woman|women|male|female|guys?|girls?|couple|students?|professionals?)\b`,
      // "I'm gay", "we're both muslim"
      String.raw`\b(?:i'?m|i am|we'?re|we are)\s+(?:both\s+|all\s+)?(?:white|black|asian|latino|latina|hispanic|indian|middle[- ]?eastern|christian|catholic|muslim|jewish|hindu|buddhist|straight|gay|lesbian|trans|queer)\b`,
      // "I'm 24", "I'm under 30", "we're both over 25"
      String.raw`\b(?:i'?m|i am|we'?re|we are)\s+(?:both\s+|all\s+)?(?:under|over|almost|nearly)?\s*\d{2}(?:\s*years?\s*old)?\b`,
      // "I'm pregnant", "we have kids"
      String.raw`\b(?:i'?m|i am|we'?re|we are)\s+pregnant\b|\b(?:i|we)\s+have\s+(?:a\s+)?(?:kids?|children|child)\b`,
    ].join("|"),
    "g",
  );
  const scrubbed = normalized.replace(selfDescription, " ");

  const protectedClass =
    /\b(?:white|black|asian|latino|latina|hispanic|indian|middle[- ]?eastern|christian|catholic|muslim|jewish|hindu|buddhist|men|man|male|males|women|woman|female|females|straight|gay|lesbian|trans|queer|young|old|christians|muslims|jews)\b/;
  const familialStatus =
    /\b(?:famil(?:y|ies)|kids?|children|child|parents?|pregnan(?:t|cy)|minors?)\b/;
  const numericalAgeFilter =
    /\b(?:under|younger than|younger|below|over|older than|older|above)\s+\d{2}\b|\b\d{2}\s*(?:and\s*)?(?:under|younger|older|plus)\b/;
  const filterIntent =
    /\b(?:only|just|prefer|preferably|no|not|avoid|exclude|filter(?:\s+out)?|same|find me|match me with|looking for|want|wants?)\b/;
  const housingPeopleContext =
    /\b(?:roommates?|housemates?|flatmates?|match(?:es)?|tenants?|people|person|someone|guys?|girls?)\b/;
  if (
    (protectedClass.test(scrubbed) ||
      numericalAgeFilter.test(scrubbed) ||
      familialStatus.test(scrubbed)) &&
    filterIntent.test(scrubbed) &&
    housingPeopleContext.test(scrubbed)
  ) {
    return "I can't match on race, religion, gender, sexual orientation, age, familial status, or similar — that's against fair-housing law and not how Kinfolk works. I match on lifestyle fit: cleanliness, schedule, noise, budget, and shared interests. Want me to use those instead?";
  }

  const fraud =
    /\b(?:fake|forge|forged|falsify|fabricate|phony|counterfeit|lie (?:on|about)|lying (?:on|about)|cheat on)\b.{0,40}\b(?:reference|references|pay ?stub|pay ?stubs|income|id|ids|document|documents|application|applications|credit|score|verification|landlord)\b/;
  const fraud2 =
    /\b(?:fake|forged|falsified|made[- ]?up)\b.{0,20}\b(?:landlord|employer|reference|references|pay ?stub)\b/;
  if (fraud.test(normalized) || fraud2.test(normalized)) {
    return "I can't help with faking or forging anything on a rental application — that's fraud and can get you blacklisted. I'm happy to help you put together a strong, honest application and budget instead.";
  }

  return null;
}

export function isOffTopicTextAgentMessage(
  body: string,
  _recentMessages: TextAgentRecentMessage[] = [],
) {
  void _recentMessages;
  const normalized = body.trim();
  if (!normalized) {
    return false;
  }

  if (
    hardOffTopicTextAgentPatterns.some((pattern) => pattern.test(normalized))
  ) {
    return true;
  }

  return offTopicTextAgentPatterns.some((pattern) => pattern.test(normalized));
}

export function isDirectApartmentListingRequest(body: string) {
  const normalized = body.trim();
  if (!normalized) {
    return false;
  }

  const asksForListings =
    /\b(?:show|send|pull|find|search|recommend|suggest|give|surface|list|see)\b.{0,48}\b(?:apartments?|apts?|listings?|places?|rentals?|units?|homes?)\b/i.test(
      normalized,
    ) ||
    /\b(?:apartments?|apts?|listings?|places?|rentals?|units?|homes?)\b.{0,48}\b(?:available|options?|matches?|recommendations?|to\s+see)\b/i.test(
      normalized,
    );

  if (!asksForListings) {
    return false;
  }

  return !/\b(?:roommates?|housemates?|people|profiles?|groups?)\b/i.test(
    normalized,
  );
}

export function looksLikeFreshProfileIntakeMessage(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized || isDirectApartmentListingRequest(normalized)) {
    return false;
  }

  const hasBudgetSignal =
    /\b(?:budget|max|maximum|rent|under|below|up to|around|about|per month|monthly|\/mo)\b/i.test(
      normalized,
    ) ||
    /(?:\$ ?\d{1,3}(?:,\d{3})?|\b\d(?:\.\d)?k\b|\b\d{3,5}\s*(?:ish|max|\/mo|per month|monthly)\b)/i.test(
      normalized,
    );
  const hasMoveTimingSignal =
    /\b(?:move(?:-?in| in)?|moving|lease|start date|available|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      normalized,
    );
  const hasHouseholdSignal =
    /\b(?:roommates?|housemates?|solo|alone|by myself|household|group of|with friends?|open to (?:roommates?|sharing)|no roommates?)\b/i.test(
      normalized,
    );
  const hasLocationSignal =
    /\b(?:sf|san francisco|neighborhoods?|areas?|hayes valley|lower haight|haight|mission|soma|dogpatch|pacific heights|nob hill|russian hill|marina|cow hollow|noe valley|castro|richmond|sunset|potrero|bernal|north beach|mission bay|panhandle|fillmore)\b/i.test(
      normalized,
    );
  const hasPreferenceFrame =
    /\b(?:i|we)\b.{0,32}\b(?:want|need|like|prefer|hope|trying|looking|planning|open)\b/i.test(
      normalized,
    );

  const setupSignalCount = [
    hasBudgetSignal,
    hasMoveTimingSignal,
    hasHouseholdSignal,
    hasLocationSignal,
  ].filter(Boolean).length;

  return setupSignalCount >= 2 || (hasPreferenceFrame && setupSignalCount >= 1);
}
