// Canonical structured vocabulary for matching-relevant profile facts.
//
// Both intake paths (the SMS chat extractor and the Claude/ChatGPT enrichment
// imports) converge on `coerceStructuredProfileFact` / `extractProfileFacts`,
// which previously stored a free-text lowercased copy as `normalized_value`.
// The matching engine then re-derived coarse buckets from that text with
// regexes — so match quality depended on the user happening to use our
// keywords. This module makes the stored value deterministic: free text is
// mapped to a fixed token vocabulary per fact key, which the scorer can compare
// precisely and the UI can render as a control.
//
// Values that don't map (legacy facts, unrecognized phrasing, or non-structured
// keys like budget/move_in) fall back to the free-text comparable form, and the
// scorer falls back to its existing heuristics — nothing regresses.

type StructuredFactKind = "scale" | "enum";

type StructuredFactDefinition = {
  kind: StructuredFactKind;
  // Ordered for `scale` keys (used for ordinal distance); order is cosmetic for
  // `enum` keys.
  tokens: string[];
  // Token treated as compatible-with-everything (e.g. "flexible"). Optional.
  neutralToken?: string;
  // First matching rule wins, so order rules most-specific first.
  rules: Array<[RegExp, string]>;
};

// Shared 5-point tidiness scale (cleanliness).
const tidinessTokens = ["very relaxed", "relaxed", "moderate", "tidy", "very tidy"];

const structuredFactDefinitions: Record<string, StructuredFactDefinition> = {
  cleanliness: {
    kind: "scale",
    tokens: tidinessTokens,
    rules: [
      [/spotless|immaculate|very clean|very tidy|super clean|extremely (clean|tidy)|always (clean|spotless)/, "very tidy"],
      [/messy|don'?t care|whatever works|chaotic|not tidy|very relaxed about clean/, "very relaxed"],
      [/relaxed|easygoing|easy going|laid.?back|lived.?in|loose|busy schedule|flexible about/, "relaxed"],
      [/clean|tidy|neat|organized|reset|dishes|kitchen|pick up|put away/, "tidy"],
      [/moderate|average|in between|reasonable|normal/, "moderate"],
    ],
  },
  noise_tolerance: {
    kind: "scale",
    tokens: ["very quiet", "quiet", "moderate", "lively", "very lively"],
    rules: [
      [/\bbass\b|subwoofer|low.?freq|vibrat|thin walls|sleep.?protect/, "very quiet"],
      [/sensitive to (noise|sound|bass)|noise.?sensitive|sound.?sensitive/, "quiet"],
      [/sleep.?protect|minimal disruptive|disruptive.*night/, "very quiet"],
      [/silent|need quiet|library|extremely quiet|no noise|very quiet/, "very quiet"],
      [/very (loud|lively)|parties|loud music|lots of noise|always music/, "very lively"],
      [/quiet|calm|low.?key|peaceful|low noise|decompress|chill at home/, "quiet"],
      [/lively|music|loud|noise (is )?ok|don'?t mind noise|busy household/, "lively"],
      [/moderate|some noise|average noise|in between/, "moderate"],
    ],
  },
  social_energy: {
    kind: "scale",
    tokens: ["homebody", "low key", "balanced", "social", "very social"],
    rules: [
      [/very social|host often|social hub|always (people|guests)|love hosting|extrovert/, "very social"],
      [/homebody|keep to myself|to myself|introvert|recharge alone|need alone time|private person/, "homebody"],
      [/low.?key|small gatherings|quiet social|occasional hang/, "low key"],
      [/social|friendly|outgoing|hang out|community|like company/, "social"],
      [/balanced|a mix|depends|moderate|sometimes social/, "balanced"],
    ],
  },
  guests: {
    kind: "scale",
    tokens: ["rare", "occasional", "frequent"],
    rules: [
      [/rare|hardly|seldom|almost never|no guests|prefer none|not into guests/, "rare"],
      [/frequent|often|regular|all the time|lots of guests|always have (people|guests)/, "frequent"],
      [/occasional|sometimes|now and then|once in a while|heads.?up|advance notice|planned/, "occasional"],
    ],
  },
  overnight_guests: {
    kind: "scale",
    tokens: ["none", "occasional", "frequent"],
    rules: [
      [/no overnight|never overnight|prefer no overnight|no sleepovers/, "none"],
      [/frequent|often|partner (stays|over)|regular overnight|most (nights|weekends)/, "frequent"],
      [/occasional|sometimes|now and then|once in a while|with notice/, "occasional"],
    ],
  },
  sleep_schedule: {
    kind: "enum",
    tokens: ["early", "flexible", "late"],
    neutralToken: "flexible",
    rules: [
      [/late|night owl|midnight|1am|2am|3am|stay up|up late|nocturnal/, "late"],
      [/\b(?:1|2|3)(?::[0-5]\d)?\s*a\.?m\.?\b|stay up|up late|nocturnal/, "late"],
      [/early|morning person|sunrise|early bird|wake up early|up early/, "early"],
      [/\b(?:5|6|7|8)(?::[0-5]\d)?\s*a\.?m\.?\b/, "early"],
      [/flexible|variable|varies|depends|irregular|mixed|no set/, "flexible"],
    ],
  },
  work_from_home: {
    // Scale, not nominal: mostly-away ↔ hybrid ↔ mostly-home are adjacent
    // work patterns (an away-person and a hybrid-person overlap plenty), so
    // distance-based similarity beats the flat 0.2 distinct-enum score.
    // "flexible" stays the neutral token (checked before scale distance).
    kind: "scale",
    tokens: ["mostly away", "hybrid", "mostly home", "flexible"],
    neutralToken: "flexible",
    rules: [
      [/hybrid|(?:two|three|[1-4])\s*days|some days|part[- ]?time/, "hybrid"],
      [/mostly (away|out)|in[- ]?office|onsite|office majority|out of the apartment/, "mostly away"],
      [/remote|wfh|work from home|home office|desk setup|mostly home/, "mostly home"],
      [/flexible|varies|depends|irregular|changes week to week/, "flexible"],
    ],
  },
  communication_style: {
    kind: "enum",
    tokens: ["direct", "diplomatic", "reserved"],
    rules: [
      [/direct|blunt|straightforward|upfront|explicit|say it|tell you|honest/, "direct"],
      [/diplomatic|gentle|tactful|considerate|soft|kind|polite|sensitive/, "diplomatic"],
      [/reserved|keep to myself|not (much|big) on|indirect|quiet about|private/, "reserved"],
    ],
  },
  conflict_repair: {
    kind: "enum",
    tokens: ["address now", "cooldown then talk", "avoid"],
    rules: [
      [/explicit|concrete|direct.*discuss|discuss.*explicit|without.*ambiguity/, "address now"],
      [/right away|immediately|address (it|things)|talk it out|hash it|head.?on|asap|sooner|nip/, "address now"],
      [/cool ?down|cool off|space first|take a break|calm down|step away|after.*(cool|space)/, "cooldown then talk"],
      [/avoid|let it go|ignore|don'?t like conflict|drop it|brush/, "avoid"],
    ],
  },
  pets: {
    kind: "enum",
    tokens: ["no pets", "pet friendly", "has pet"],
    rules: [
      [/have a (dog|cat|pet)|i own|my (dog|cat)|bringing (my|a)|pet owner/, "has pet"],
      [/no pets|allergic|don'?t want pets|pet.?free|prefer no pets|not? pet/, "no pets"],
      [/pet friendly|pets ok|love (dogs|cats|pets)|fine with pets|open to pets|dog ?friendly|cat ?friendly/, "pet friendly"],
    ],
  },
  smoking: {
    kind: "enum",
    tokens: ["no", "outdoor only", "yes"],
    rules: [
      [/non.?smok|no smoking|don'?t smoke|smoke.?free|prefer no smok/, "no"],
      [/outdoor|outside|balcony|patio only|out back/, "outdoor only"],
      [/smoke|smoker|420|cannabis|weed/, "yes"],
    ],
  },
  rent_tradeoff: {
    kind: "enum",
    tokens: ["lower rent first", "balanced", "pay more for fit", "smaller room for price"],
    neutralToken: "balanced",
    rules: [
      [/lowest rent|lower rent|save money|price first|budget first|cheap/, "lower rent first"],
      [/balanced|mix|middle|depends|trade.?off/, "balanced"],
      [/pay more|higher rent|stretch.*rent|premium.*fit|fit.*location|location.*fit/, "pay more for fit"],
      [/smaller room|small room|less space|room size.*price|price.*room size/, "smaller room for price"],
    ],
  },
  location_tradeoff: {
    kind: "enum",
    tokens: ["location first", "balanced", "open to more areas", "space over location"],
    neutralToken: "balanced",
    rules: [
      [/location first|neighborhood first|area first|must be in|only.*neighborhood/, "location first"],
      [/balanced|mix|middle|depends|trade.?off/, "balanced"],
      [/open to.*areas|flexible.*location|more areas|broader search|neighborhood flexible/, "open to more areas"],
      [/space over location|bigger.*farther|room.*over.*location|location.*for.*space/, "space over location"],
    ],
  },
  commute_tradeoff: {
    kind: "enum",
    tokens: ["short commute first", "balanced", "longer commute ok", "transit flexible"],
    neutralToken: "balanced",
    rules: [
      [/short commute|commute first|near work|close to (work|office)|walk to work/, "short commute first"],
      [/balanced|mix|middle|depends|trade.?off/, "balanced"],
      [/longer commute|commute.*ok|farther.*ok|can commute|willing.*commute/, "longer commute ok"],
      [/transit flexible|bus.*ok|bart.*ok|muni.*ok|bike.*ok|drive.*ok/, "transit flexible"],
    ],
  },
  room_quality_tradeoff: {
    kind: "enum",
    tokens: ["room quality first", "balanced", "shared space first", "price over room"],
    neutralToken: "balanced",
    rules: [
      [/room quality first|bedroom first|natural light|private bath|own bathroom|large room/, "room quality first"],
      [/balanced|mix|middle|depends|trade.?off/, "balanced"],
      [/shared space first|living room|kitchen.*matters|common space/, "shared space first"],
      [/price over room|small room.*ok|room.*less important|cheap.*room/, "price over room"],
    ],
  },
  risk_tolerance: {
    kind: "enum",
    tokens: ["low risk", "balanced", "open to tradeoffs"],
    neutralToken: "balanced",
    rules: [
      [/low risk|stable|predictable|safe choice|avoid risk|need certainty/, "low risk"],
      [/balanced|mix|middle|depends|trade.?off/, "balanced"],
      [/open to risk|open to tradeoffs|flexible.*risk|could take.*chance/, "open to tradeoffs"],
    ],
  },
};

export const STRUCTURED_FACT_KEYS = Object.keys(structuredFactDefinitions);

// Structured behavioral keys surfaced as editable controls in the web profile
// editor. Each has a canonical vocabulary above and a display slot in the
// profile view (cleanliness, sleep, WFH rhythm, noise, social, guests→hosting,
// communication, conflict repair, pets, and flexibility).
export const WEB_EDITABLE_PREFERENCE_KEYS = [
  "cleanliness",
  "sleep_schedule",
  "work_from_home",
  "noise_tolerance",
  "social_energy",
  "guests",
  "communication_style",
  "conflict_repair",
  "pets",
  "rent_tradeoff",
] as const;

export type WebEditablePreferenceKey =
  (typeof WEB_EDITABLE_PREFERENCE_KEYS)[number];

export function isWebEditablePreferenceKey(
  factKey: string,
): factKey is WebEditablePreferenceKey {
  return (WEB_EDITABLE_PREFERENCE_KEYS as readonly string[]).includes(factKey);
}

// Additive free-text list keys editable as tag controls in the web profile
// editor. These mirror what the SMS agent writes: the editor sends the full
// current list as one fact, so web and conversation edits stay symmetric (the
// most recent override fact for the slot wins).
export const WEB_EDITABLE_LIST_KEYS = [
  "neighborhoods",
  "must_haves",
  "dealbreakers",
] as const;

export const WEB_EDITABLE_LIST_MAX_ITEMS = 12;
export const WEB_EDITABLE_LIST_VALUE_MAX_LENGTH = 40;

export type WebEditableListKey = (typeof WEB_EDITABLE_LIST_KEYS)[number];

export function isWebEditableListKey(
  factKey: string,
): factKey is WebEditableListKey {
  return (WEB_EDITABLE_LIST_KEYS as readonly string[]).includes(factKey);
}

export function normalizeEditablePreferenceList(values: unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of values) {
    if (typeof raw !== "string") {
      continue;
    }

    const value = raw
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, WEB_EDITABLE_LIST_VALUE_MAX_LENGTH);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(value);
    if (normalized.length >= WEB_EDITABLE_LIST_MAX_ITEMS) {
      break;
    }
  }

  return normalized;
}

export function isStructuredFactKey(factKey: string): boolean {
  return factKey in structuredFactDefinitions;
}

/** The canonical option vocabulary for a fact key (for prompts / UI controls). */
export function structuredFactOptions(factKey: string): string[] | null {
  return structuredFactDefinitions[factKey]?.tokens ?? null;
}

/**
 * Map a free-text comparable value to a canonical token, or null when the key
 * is not structured or the text doesn't match any rule. Input is expected to be
 * the lowercased comparable form (as produced by `normalizeComparableValue`).
 */
export function normalizeStructuredFactValue(
  factKey: string,
  comparableValue: string,
): string | null {
  const def = structuredFactDefinitions[factKey];
  if (!def) {
    return null;
  }

  // Already canonical (re-normalizing a stored token).
  if (def.tokens.includes(comparableValue)) {
    return comparableValue;
  }

  for (const [pattern, token] of def.rules) {
    if (pattern.test(comparableValue)) {
      return token;
    }
  }

  return null;
}

/** Human-friendly label for a canonical token (sentence case). */
export function structuredFactValueLabel(factKey: string, token: string): string {
  if (!isStructuredFactKey(factKey)) {
    return token;
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Precise similarity between two canonical tokens for the same fact key.
 * Returns null when the key isn't structured or either value isn't a recognized
 * token, so the scorer can fall back to its existing heuristics.
 */
export function structuredValueSimilarity(
  factKey: string,
  a: string,
  b: string,
): number | null {
  const def = structuredFactDefinitions[factKey];
  if (!def) {
    return null;
  }

  const indexA = def.tokens.indexOf(a);
  const indexB = def.tokens.indexOf(b);
  if (indexA === -1 || indexB === -1) {
    return null;
  }

  if (indexA === indexB) {
    return 1;
  }

  if (def.neutralToken && (a === def.neutralToken || b === def.neutralToken)) {
    return 0.6;
  }

  if (def.kind === "scale") {
    const span = def.tokens.length - 1;
    const distance = Math.abs(indexA - indexB);
    return clamp01(Math.max(0.1, 1 - distance / span));
  }

  // Nominal enum: distinct options are weakly compatible.
  return 0.2;
}
