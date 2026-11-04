import { createHash, createHmac } from "node:crypto";
import {
  textAgentIntakeAckCopy,
  textAgentIntakeIntroCopy,
  textAgentIntakeQuestionCopy,
  textAgentScopeDeclineCopy,
} from "./copy";
import { textProfileFactsCoverAgeComfortStep } from "./corrections";

export { summarizeTextProfileFacts } from "./profile-summary";

export type TextAgentIntent =
  | "verification_code"
  | "opt_out"
  | "opt_in"
  | "interview"
  | "help"
  | "approve"
  | "edit"
  | "review"
  | "profile_update"
  | "unsupported";

export type TextProfileFact = {
  assertion_type: "explicit" | "inferred";
  confidence: number;
  dimension: string;
  evidence: string;
  fact_key: string;
  importance: number;
  matching_eligible?: boolean;
  sensitivity_level: "standard" | "sensitive" | "protected" | "high_risk";
  value:
    | string
    | number
    | boolean
    | string[]
    | Record<string, string | number | boolean | null>;
};

export type TextProfileImportExtractionMetadata = {
  extractor?: "openrouter" | "kinfolk_tool";
  model?: string | null;
  source?: string;
  warnings?: string[];
};

export type TextAgentIntakeStep =
  | "neighborhoods"
  | "budget"
  | "move_in"
  | "roommates"
  | "age_comfort"
  | "commute"
  | "sleep_schedule"
  | "work_from_home"
  | "cleanliness"
  | "noise_tolerance"
  | "guests"
  | "social_energy"
  | "communication_style"
  | "conflict_repair"
  | "trust_context"
  | "interests"
  | "pets"
  | "must_haves"
  | "dealbreakers"
  | "rent_tradeoff"
  | "home_preferences";

export const textAgentAllowedFactKeys = [
  "neighborhoods",
  "commute",
  "budget",
  "budget_preferred_max",
  "budget_min",
  "budget_max",
  "commute_tradeoff",
  "move_in_window",
  "household_size",
  "group_size_flexibility",
  "age",
  "preferred_age_range",
  "work_from_home",
  "work_hours",
  "routine_regularity",
  "noise_tolerance",
  "cleanliness",
  "sleep_schedule",
  "guests",
  "overnight_guests",
  "social_energy",
  "privacy",
  "communication_style",
  "conflict_repair",
  "planning_style",
  "response_time",
  "house_meetings",
  "verified_work_or_school",
  "shared_communities",
  "mutuals",
  "references",
  "prior_roommate_context",
  "interests",
  "music_taste",
  "media_taste",
  "aesthetic_taste",
  "pets",
  "must_haves",
  "dealbreakers",
  "location_tradeoff",
  "rent_tradeoff",
  "risk_tolerance",
  "room_quality_tradeoff",
  "accessibility",
  "smoking",
] as const;

export type TextAgentFactKey = (typeof textAgentAllowedFactKeys)[number];

export const textAgentOpportunisticFactKeys = [
  "work_from_home",
  "work_hours",
  "routine_regularity",
  "verified_work_or_school",
  "shared_communities",
  "mutuals",
  "references",
  "prior_roommate_context",
  "interests",
  "music_taste",
  "media_taste",
  "aesthetic_taste",
] as const satisfies readonly TextAgentFactKey[];

// Approximate matching impact per intake dimension ≈ engine dimension weight ×
// fact importance (see scoreCompatibility in profile-enrichment.ts). The text
// agent uses this after the must-have apartment-feasibility fields are covered,
// so a short conversation still closes the gaps that move match quality most.
export const intakeStepMatchingImpact: Record<TextAgentIntakeStep, number> = {
  // The single highest-value unasked question (matching-pipeline research
  // 2026-07-05): one commute anchor transforms apartment ranking (transit
  // distance term) and feeds roommate budget-location synergy.
  commute: 0.3,
  sleep_schedule: 0.27, // lifestyle 0.24 + schedule 0.06, importance 0.9
  work_from_home: 0.23, // daily rhythm + schedule, especially daytime calls/home presence
  noise_tolerance: 0.21, // lifestyle 0.24, importance 0.86
  guests: 0.2, // lifestyle/social 0.24, importance 0.84
  social_energy: 0.18, // lifestyle/social, high matching signal
  communication_style: 0.16, // communication 0.18, importance 0.9
  conflict_repair: 0.16, // communication 0.18, importance 0.88
  trust_context: 0.155, // critical for Google-only users without LinkedIn work/school import
  cleanliness: 0.14, // home_labor 0.16, importance 0.9
  dealbreakers: 0.12, // explicit hard constraints prevent false-positive matches
  home_preferences: 0.12, // combined must-haves and hard no's in one user-facing prompt
  pets: 0.1, // feasibility/home compatibility, common roommate constraint
  interests: 0.09, // rapport/taste, useful for ranking once feasibility is covered
  rent_tradeoff: 0.06, // preference_elasticity 0.08, importance 0.7
  must_haves: 0.055, // feasibility/home constraints, often already web-collected
  neighborhoods: 0.05, // apartment-feasibility foundation
  budget: 0.04, // apartment-feasibility foundation
  move_in: 0.03, // apartment-feasibility foundation
  age_comfort: 0.025, // setup/profile-completion foundation + roommate age comfort
  roommates: 0.02, // apartment/roommate-feasibility foundation
};

export const textAgentFoundationIntakeSteps = [
  "neighborhoods",
  "budget",
  "move_in",
  "roommates",
  "age_comfort",
] as const satisfies readonly TextAgentIntakeStep[];

const textAgentMatchingDetailSteps = (
  [
    "commute",
    "sleep_schedule",
    "work_from_home",
    "noise_tolerance",
    "guests",
    "social_energy",
    "communication_style",
    "conflict_repair",
    "cleanliness",
    "home_preferences",
    "trust_context",
    "pets",
    "interests",
    "rent_tradeoff",
  ] as TextAgentIntakeStep[]
).sort((a, b) => intakeStepMatchingImpact[b] - intakeStepMatchingImpact[a]);

// Start with hard apartment/group feasibility, then ask high-impact roommate
// compatibility gaps. Coverage checks skip fields that are already saved.
export const textAgentIntakeSteps: TextAgentIntakeStep[] = [
  ...textAgentFoundationIntakeSteps,
  ...textAgentMatchingDetailSteps,
];

export function factKeysForTextAgentIntakeStep(
  step: TextAgentIntakeStep,
): TextAgentFactKey[] {
  const keysByStep: Record<TextAgentIntakeStep, TextAgentFactKey[]> = {
    age_comfort: ["age", "preferred_age_range"],
    budget: ["budget", "budget_preferred_max", "budget_min", "budget_max"],
    cleanliness: ["cleanliness"],
    commute: ["commute", "commute_tradeoff"],
    communication_style: [
      "communication_style",
      "planning_style",
      "response_time",
      "house_meetings",
    ],
    conflict_repair: ["conflict_repair"],
    dealbreakers: ["dealbreakers"],
    guests: ["guests", "overnight_guests"],
    home_preferences: ["must_haves", "dealbreakers"],
    interests: ["interests", "music_taste", "media_taste", "aesthetic_taste"],
    move_in: ["move_in_window"],
    must_haves: ["must_haves"],
    neighborhoods: ["neighborhoods"],
    noise_tolerance: ["noise_tolerance"],
    pets: ["pets"],
    rent_tradeoff: [
      "rent_tradeoff",
      "location_tradeoff",
      "commute_tradeoff",
      "room_quality_tradeoff",
      "risk_tolerance",
    ],
    roommates: ["household_size", "group_size_flexibility"],
    sleep_schedule: ["sleep_schedule"],
    social_energy: ["social_energy"],
    trust_context: [
      "verified_work_or_school",
      "shared_communities",
      "mutuals",
      "references",
      "prior_roommate_context",
    ],
    work_from_home: ["work_from_home", "work_hours", "routine_regularity"],
  };

  return keysByStep[step];
}

export function factKeysForTextAgentExtractionStep(
  step: TextAgentIntakeStep,
): TextAgentFactKey[] {
  const keys = factKeysForTextAgentIntakeStep(step);

  if (step === "dealbreakers") {
    return [...new Set<TextAgentFactKey>([...keys, "must_haves"])];
  }

  if (step === "must_haves") {
    return [...new Set<TextAgentFactKey>([...keys, "dealbreakers"])];
  }

  return keys;
}

export function factKeysForTextAgentActiveExtractionStep(
  step: TextAgentIntakeStep,
): TextAgentFactKey[] {
  if (isTextAgentFoundationIntakeStep(step)) {
    return [
      ...new Set<TextAgentFactKey>(
        [
          ...textAgentFoundationIntakeSteps.flatMap((foundationStep) =>
            factKeysForTextAgentExtractionStep(foundationStep),
          ),
          "dealbreakers",
          "must_haves",
          "location_tradeoff",
          "commute_tradeoff",
          "rent_tradeoff",
          "room_quality_tradeoff",
        ],
      ),
    ];
  }

  return [
    ...new Set<TextAgentFactKey>(
      textAgentMatchingDetailSteps.flatMap((detailStep) =>
        factKeysForTextAgentExtractionStep(detailStep),
      ),
    ),
  ];
}

type HousingPreferenceListFactKey = "must_haves" | "dealbreakers";

export function normalizeHousingPreferenceListFacts(
  facts: TextProfileFact[],
): { facts: TextProfileFact[]; warnings: string[] } {
  const normalizedFacts: TextProfileFact[] = [];
  const warnings: string[] = [];

  for (const fact of facts) {
    const factKey = housingPreferenceListFactKey(fact.fact_key);

    if (!factKey) {
      normalizedFacts.push(fact);
      continue;
    }

    const values = dedupeTextFactStrings(textProfileFactValueToStrings(fact.value));

    for (const value of values) {
      const targetFactKey = inferHousingPreferenceListFactKey(factKey, value);
      appendHousingPreferenceListFact(normalizedFacts, {
        ...fact,
        fact_key: targetFactKey,
        value: [value],
      });

      if (targetFactKey !== factKey) {
        warnings.push(
          `Moved "${value}" from ${factKey} to ${targetFactKey} based on preference polarity.`,
        );
      }
    }
  }

  return removeDuplicateHousingPreferenceListValues(normalizedFacts, warnings);
}

function housingPreferenceListFactKey(
  factKey: string,
): HousingPreferenceListFactKey | null {
  const normalized = factKey.trim().toLowerCase();
  return normalized === "must_haves" || normalized === "dealbreakers"
    ? normalized
    : null;
}

function inferHousingPreferenceListFactKey(
  currentFactKey: HousingPreferenceListFactKey,
  value: string,
): HousingPreferenceListFactKey {
  if (hasHousingExclusionLanguage(value)) {
    return "dealbreakers";
  }

  if (
    currentFactKey === "dealbreakers" &&
    isLikelyPositiveHousingPreference(value)
  ) {
    return "must_haves";
  }

  return currentFactKey;
}

function appendHousingPreferenceListFact(
  facts: TextProfileFact[],
  fact: TextProfileFact,
) {
  const existing = facts.find((entry) => entry.fact_key === fact.fact_key);

  if (!existing) {
    facts.push(fact);
    return;
  }

  existing.value = dedupeTextFactStrings([
    ...textProfileFactValueToStrings(existing.value),
    ...textProfileFactValueToStrings(fact.value),
  ]);
  existing.confidence = Math.max(existing.confidence, fact.confidence);
  existing.importance = Math.max(existing.importance, fact.importance);
  existing.evidence = fact.evidence || existing.evidence;
  existing.matching_eligible = existing.matching_eligible ?? fact.matching_eligible;
}

function removeDuplicateHousingPreferenceListValues(
  facts: TextProfileFact[],
  warnings: string[],
): { facts: TextProfileFact[]; warnings: string[] } {
  const mustHaveFact = facts.find((fact) => fact.fact_key === "must_haves");
  const dealbreakerFact = facts.find((fact) => fact.fact_key === "dealbreakers");

  if (!mustHaveFact || !dealbreakerFact) {
    return { facts, warnings };
  }

  const mustHaveValues = dedupeTextFactStrings(
    textProfileFactValueToStrings(mustHaveFact.value),
  );
  const dealbreakerValues = dedupeTextFactStrings(
    textProfileFactValueToStrings(dealbreakerFact.value),
  );
  const dealbreakerByKey = new Map(
    dealbreakerValues.map((value) => [
      canonicalHousingPreferenceListValue(value),
      value,
    ]),
  );
  const mustHaveByKey = new Map(
    mustHaveValues.map((value) => [
      canonicalHousingPreferenceListValue(value),
      value,
    ]),
  );
  const mustHaveKeysToDrop = new Set<string>();
  const dealbreakerKeysToDrop = new Set<string>();

  for (const [key, mustHaveValue] of mustHaveByKey) {
    const dealbreakerValue = dealbreakerByKey.get(key);

    if (!dealbreakerValue) {
      continue;
    }

    if (
      hasHousingExclusionLanguage(mustHaveValue) ||
      hasHousingExclusionLanguage(dealbreakerValue)
    ) {
      mustHaveKeysToDrop.add(key);
      warnings.push(
        `Removed duplicate "${mustHaveValue}" from must_haves because it reads like an exclusion.`,
      );
      continue;
    }

    if (
      isLikelyPositiveHousingPreference(mustHaveValue) ||
      isLikelyPositiveHousingPreference(dealbreakerValue)
    ) {
      dealbreakerKeysToDrop.add(key);
      warnings.push(
        `Removed duplicate "${dealbreakerValue}" from dealbreakers because it reads like a wanted feature.`,
      );
      continue;
    }

    mustHaveKeysToDrop.add(key);
    warnings.push(
      `Removed duplicate "${mustHaveValue}" from must_haves because it was also listed as a dealbreaker.`,
    );
  }

  const updatedFacts = facts.flatMap((fact) => {
    const factKey = housingPreferenceListFactKey(fact.fact_key);

    if (!factKey) {
      return [fact];
    }

    const dropKeys =
      factKey === "must_haves" ? mustHaveKeysToDrop : dealbreakerKeysToDrop;
    const values = dedupeTextFactStrings(textProfileFactValueToStrings(fact.value))
      .filter((value) => !dropKeys.has(canonicalHousingPreferenceListValue(value)));

    return values.length > 0 ? [{ ...fact, value: values }] : [];
  });

  return { facts: updatedFacts, warnings };
}

function hasHousingExclusionLanguage(value: string) {
  return /\b(?:no|not|without|avoid(?:ing)?|can['’]?t|cant|cannot|won['’]?t|wont|refuse|dealbreaker|hard\s+no|mold|pests?|unsafe|smoking|party\s+house)\b/i.test(
    value,
  );
}

function isLikelyPositiveHousingPreference(value: string) {
  return /\b(?:laundry|washer|dryer|dishwasher|natural\s+light|sunlight|light|parking|garage|elevator|outdoor|balcony|patio|roof|gym|fitness|transit|bart|muni|caltrain|quiet|clean|private|storage|air\s+conditioning|a\/c|ac)\b/i.test(
    value,
  );
}

function canonicalHousingPreferenceListValue(value: string) {
  return value
    .toLowerCase()
    .replace(
      /\b(?:must[-\s]?have|must\s+have|need|needs|want|wants|prefer|prefers|require|requires|required|dealbreaker|hard\s+no|no|not|without|avoid(?:ing)?|can['’]?t|cant|cannot|don['’]?t\s+want|dont\s+want|do\s+not\s+want)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textProfileFactValueToStrings(value: TextProfileFact["value"]): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(textProfileFactValueToStrings);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) =>
      entry === null ? [] : textProfileFactValueToStrings(entry),
    );
  }

  return [String(value)];
}

function dedupeTextFactStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();

    if (!cleaned || seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(cleaned);
  }

  return out;
}

const codeLength = 6;
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeDigits = "23456789";
// Generated codes always contain a digit (see codeDigits injection below), so
// requiring one keeps ordinary words ("PLEASE" after "kinfolk") from parsing
// as verification codes without losing any legitimate code.
const verificationPattern =
  /\bKIN(?:FOLK)?\s*(?:VERIFY|CODE)?\s*[:#-]?\s*((?=[A-Z0-9]*[0-9])[A-Z0-9]{6})\b/i;
const bareCodePattern = /^(?=[A-Z0-9]*[0-9])[A-Z0-9]{6}$/i;
const reservedBareWords = new Set(["REVIEW"]);

export function generateScopedVerificationCode(scope: string, secret: string) {
  if (!secret.trim()) {
    throw new Error("generateScopedVerificationCode requires a secret.");
  }

  const digest = createHmac("sha256", secret)
    .update(`kinfolk-phone-verification:v2:${scope.trim()}`)
    .digest();
  const chars: string[] = [];

  for (let index = 0; index < codeLength; index += 1) {
    chars.push(codeAlphabet[digest[index] % codeAlphabet.length]);
  }

  // Guarantee at least one digit so the code is recognized when replied "bare"
  // (without the KIN JOIN/VERIFY prefix); bareCodePattern requires a digit.
  // Deterministic in `digest`, so a given scope still maps to a stable code.
  if (!chars.some((char) => char >= "0" && char <= "9")) {
    const position = digest[codeLength] % codeLength;
    chars[position] = codeDigits[digest[codeLength + 1] % codeDigits.length];
  }

  return chars.join("");
}

export function hashVerificationCode(code: string) {
  return createHash("sha256")
    .update(normalizeVerificationCode(code))
    .digest("hex");
}

export function buildVerificationMessage(code: string) {
  return `KIN VERIFY ${normalizeVerificationCode(code)}`;
}

export function parseVerificationCode(body: string) {
  const trimmed = body.trim().toUpperCase();
  const bareMatch = trimmed.match(bareCodePattern);
  if (bareMatch && !reservedBareWords.has(trimmed)) {
    return normalizeVerificationCode(trimmed);
  }

  const match = trimmed.match(verificationPattern);
  return match?.[1] ? normalizeVerificationCode(match[1]) : null;
}

function normalizeVerificationCode(code: string) {
  return code
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, codeLength);
}

const optOutKeywordPattern = /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i;

// Natural-language revocation (FCC rule, April 2025: consumers revoke "in any
// reasonable manner", and one revocation stops all non-emergency texts). Each
// inbound clause is tested whole against these anchored phrasings so housing
// asks that merely contain "stop" ("stop showing studios", "stop at 3
// listings") never opt anyone out.
// A topic tail ("stop texting me about X") only counts as revocation when it
// does not pivot into asking for different texts ("…about studios and send
// 1brs instead" must stay a search tweak; the loop's opt_out tool still
// backstops genuine revocations the pre-gate declines).
const revocationClausePatterns: RegExp[] = [
  /^(?:stop|quit)\s+(?:texting|messaging|contacting)(?:\s+me)?(?:\s+(?:about|with)\s+(?!.*\b(?:and|but|instead|except|keep|send|show|only|still|just|unless)\b)\S.*)?$/i,
  /^(?:do\s+not|don'?t|dont|never)\s+(?:text|message|contact)\s+me(?:\s+(?:again|anymore|any\s+more|ever|ever\s+again))?$/i,
  /^(?:stop|quit)\s+sending\s+(?:me\s+)?(?:these\s+|those\s+|the\s+|all\s+)?(?:texts?|messages?|msgs?)$/i,
  /^(?:i\s+)?(?:want|need|would\s+like|wanna)\s+(?:you\s+)?to\s+(?:stop\s+(?:texting|messaging|contacting)(?:\s+me)?|opt\s+out|unsubscribe)$/i,
  /^leave\s+me\s+alone$/i,
  /^unsubscribe(?:\s+me)?(?:\s+from\s+(?!.*\b(?:and|but|instead|except|keep|send|show|only|still|just|unless)\b)\S.*)?$/i,
  /^opt\s+me\s+out(?:\s+of\s+(?!.*\b(?:and|but|instead|except|keep|send|show|only|still|just|unless)\b)\S.*)?$/i,
  /^take\s+me\s+off(?:\s+(?:of\s+)?(?:your|the|this|these|all)?\s*(?:lists?|texts?|messages?|msgs?|threads?|contacts?)?)?$/i,
  /^remove\s+me\s+from\s+(?:your|the|this|these|all)(?:\s+(?:lists?|texts?|messages?|msgs?|threads?|contacts?))?$/i,
  /^remove\s+me\s+from\s+(?:lists?|texts?|messages?|msgs?|contacts?)$/i,
  /^no\s+more\s+(?:texts?|messages?|msgs?)$/i,
];

const revocationLeadFillerPattern =
  /^(?:hey|hi|yo|ok|okay|yeah|yea|nah|no|wow|omg|ugh|seriously|honestly|really|literally|just|please|pls|plz|kindly|dude|man|bro|kinfolk|can you|could you|would you|will you|you need to|you have to|i need you to|i want you to|i said)[\s,-]+/i;

const revocationTrailFillerPattern =
  /[\s,-]+(?:please|pls|plz|now|right now|immediately|asap|already|forever|for good|thanks|thank you|ty|kinfolk|dude|man|bro|seriously|honestly|today)$/i;

function compactTextAgentBody(body: string) {
  return body.trim().toUpperCase().replace(/[.!?]+$/g, "");
}

export function isTextAgentOptOutKeyword(body: string) {
  return optOutKeywordPattern.test(compactTextAgentBody(body));
}

export function isTextAgentRevocationMessage(body: string) {
  if (isTextAgentOptOutKeyword(body)) {
    return true;
  }

  return body
    .split(/[.!?\n;,]+/)
    .some((clause) => clauseExpressesRevocation(clause));
}

function clauseExpressesRevocation(clause: string) {
  let cleaned = clause
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Test before each filler strip so phrases that start with a filler word
  // ("no more texts") still match whole.
  for (let pass = 0; pass < 6; pass += 1) {
    if (!cleaned) {
      return false;
    }

    if (revocationClausePatterns.some((pattern) => pattern.test(cleaned))) {
      return true;
    }

    const next = cleaned
      .replace(revocationLeadFillerPattern, "")
      .replace(revocationTrailFillerPattern, "")
      .trim();

    if (next === cleaned) {
      return false;
    }

    cleaned = next;
  }

  return false;
}

export function classifyTextAgentIntent(body: string): TextAgentIntent {
  const normalized = body.trim();
  const compact = compactTextAgentBody(normalized);

  if (parseVerificationCode(normalized)) {
    return "verification_code";
  }

  if (isTextAgentRevocationMessage(normalized)) {
    return "opt_out";
  }

  if (/^(START|UNSTOP|YES START)$/i.test(compact)) {
    return "opt_in";
  }

  if (
    /^(INTERVIEW|START INTERVIEW|FINISH INTERVIEW|MATCHING INTERVIEW)$/i.test(compact) ||
    /\b(?:start|finish|continue|resume)\b.{0,40}\b(?:kinfolk\s+)?matching interview\b/i.test(
      normalized,
    )
  ) {
    return "interview";
  }

  if (/^(HELP|INFO)$/i.test(compact)) {
    return "help";
  }

  if (/^(YES|Y|APPROVE|SAVE|SAVE IT|CONFIRM)$/i.test(compact)) {
    return "approve";
  }

  if (/^(EDIT|CHANGE|CORRECT)$/i.test(compact)) {
    return "edit";
  }

  if (/^(REVIEW|OPEN|OPEN APP)$/i.test(compact)) {
    return "review";
  }

  return normalized.length > 0 ? "profile_update" : "unsupported";
}

export function buildProfileImportPayloadFromText(
  body: string,
  facts: TextProfileFact[] = [],
  metadata: TextProfileImportExtractionMetadata = {},
) {
  return {
    extraction: {
      extractor: metadata.extractor ?? "openrouter",
      model: metadata.model ?? null,
      warnings: metadata.warnings ?? [],
    },
    source: metadata.source ?? "text_message",
    raw_message: body,
    structured_facts: facts,
  };
}

export function textProfileImportSourceForTransport(
  provider: string | null | undefined,
) {
  const normalized = provider?.trim().toLowerCase();
  if (normalized === "sendblue") {
    return "sendblue_text";
  }
  if (normalized === "linq") {
    return "linq_text";
  }
  return "text_message";
}

export function buildTextAgentInterviewStartMessage() {
  return "I want to finish my Kinfolk matching interview.";
}

export function buildTextAgentScopeDeclineReply() {
  return textAgentScopeDeclineCopy();
}

export function buildTextAgentHelpScopeNote() {
  return "I can't help with homework, general research, or topics outside SF housing and roommates.";
}

export function buildTextAgentProfileQuestion(
  step: TextAgentIntakeStep = "neighborhoods",
  options: { includeIntro?: boolean } = {},
) {
  const question = textAgentIntakeQuestionCopy(step);

  if (!options.includeIntro) {
    return question;
  }

  return textAgentIntakeIntroCopy(question);
}

export function buildTextAgentIntakeProgressReply({
  currentStep,
  facts,
  nextStep,
}: {
  currentStep?: TextAgentIntakeStep | null;
  facts: TextProfileFact[];
  nextStep: TextAgentIntakeStep;
}) {
  const labels = factAcknowledgementLabels(facts);
  const question = buildTextAgentProfileQuestion(nextStep);

  if (labels.length === 0) {
    return `Got it. ${question}`;
  }

  const capturedCurrentStep =
    currentStep === null ||
    currentStep === undefined ||
    textProfileFactsCoverIntakeStep(facts, currentStep);
  const acknowledgement = textAgentIntakeAckCopy(
    formatShortTextList(labels),
    `${nextStep}:${labels.join("|")}`,
  );

  if (capturedCurrentStep) {
    return `${acknowledgement} ${question}`;
  }

  return `${acknowledgement} I still need your ${textAgentIntakeStepLabel(nextStep)}: ${question}`;
}

export function isTextAgentFoundationIntakeStep(
  step: TextAgentIntakeStep,
): boolean {
  return (
    textAgentFoundationIntakeSteps as readonly TextAgentIntakeStep[]
  ).includes(step);
}

export function textAgentFoundationIntakeComplete({
  facts,
  skippedSteps = [],
}: {
  facts: TextProfileFact[];
  skippedSteps?: readonly TextAgentIntakeStep[];
}) {
  const skipped = new Set(skippedSteps);

  return textAgentFoundationIntakeSteps.every(
    (step) => skipped.has(step) || textProfileFactsCoverIntakeStep(facts, step),
  );
}

export function buildTextAgentProfileEnrichmentHandoffReply({
  enrichmentUrl,
}: {
  enrichmentUrl?: string;
}) {
  if (!enrichmentUrl) {
    return [
      "Got the basics — enough to start finding your people.",
      "Reply REVIEW to finish the richer profile: daily rhythm, cleanliness, guests, must-haves, and the hard no's that make a roommate fit feel right.",
    ].join("\n\n");
  }

  // Keep the link alone on the final line so iMessage renders the rich
  // Kinfolk preview card (see app/me/enrich/opengraph-image.tsx) beneath the
  // text instead of inlining a bare URL.
  return [
    "Got the basics — enough to start finding your people.",
    "The richer profile is where matches get sharp: daily rhythm, cleanliness, guests, must-haves, and the hard no's that make a roommate fit feel right.",
    enrichmentUrl,
  ].join("\n\n");
}

function factAcknowledgementLabels(facts: TextProfileFact[]) {
  const labels = facts
    .map((fact) => {
      const key = readTextAgentAllowedFactKey(fact.fact_key);
      return key ? textAgentFactAcknowledgementLabel[key] : null;
    })
    .filter((label): label is string => Boolean(label));
  return [...new Set(labels)].slice(0, 3);
}

function textProfileFactsCoverIntakeStep(
  facts: TextProfileFact[],
  step: TextAgentIntakeStep,
) {
  if (step === "age_comfort") {
    return textProfileFactsCoverAgeComfortStep(facts);
  }

  const keys = new Set(
    factKeysForTextAgentIntakeStep(step).map((key) => key.toLowerCase()),
  );
  return facts.some((fact) => keys.has(fact.fact_key.trim().toLowerCase()));
}

function readTextAgentAllowedFactKey(factKey: string): TextAgentFactKey | null {
  const normalized = factKey.trim().toLowerCase();
  return (textAgentAllowedFactKeys as readonly string[]).includes(normalized)
    ? (normalized as TextAgentFactKey)
    : null;
}

function formatShortTextList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "details";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function textAgentIntakeStepLabel(step: TextAgentIntakeStep) {
  const labels: Record<TextAgentIntakeStep, string> = {
    age_comfort: "roommate age range",
    budget: "budget",
    cleanliness: "cleanliness",
    commute: "commute anchor",
    communication_style: "communication style",
    conflict_repair: "conflict style",
    dealbreakers: "dealbreakers",
    guests: "guest rhythm",
    home_preferences: "home preferences",
    interests: "interests",
    move_in: "move-in timing",
    must_haves: "must-haves",
    neighborhoods: "neighborhoods",
    noise_tolerance: "noise preference",
    pets: "pet preferences",
    rent_tradeoff: "rent tradeoff",
    roommates: "roommate setup",
    sleep_schedule: "sleep schedule",
    social_energy: "social energy",
    trust_context: "trust context",
    work_from_home: "work-from-home rhythm",
  };
  return labels[step];
}

const textAgentFactAcknowledgementLabel: Partial<
  Record<TextAgentFactKey, string>
> = {
  age: "age",
  budget: "budget",
  budget_max: "budget",
  budget_preferred_max: "budget",
  budget_min: "budget",
  commute: "commute preference",
  cleanliness: "cleanliness",
  communication_style: "communication style",
  commute_tradeoff: "commute tradeoff",
  conflict_repair: "conflict style",
  dealbreakers: "dealbreakers",
  group_size_flexibility: "roommate setup",
  guests: "guest rhythm",
  household_size: "roommate setup",
  interests: "interests",
  location_tradeoff: "location tradeoff",
  move_in_window: "move-in timing",
  must_haves: "must-haves",
  neighborhoods: "neighborhoods",
  noise_tolerance: "noise preference",
  overnight_guests: "guest rhythm",
  pets: "pet preferences",
  planning_style: "planning style",
  prior_roommate_context: "roommate context",
  preferred_age_range: "roommate age range",
  privacy: "privacy preference",
  references: "references",
  rent_tradeoff: "rent tradeoff",
  response_time: "communication style",
  room_quality_tradeoff: "room tradeoff",
  routine_regularity: "routine",
  shared_communities: "trust context",
  sleep_schedule: "sleep schedule",
  social_energy: "social energy",
  verified_work_or_school: "work or school",
  work_from_home: "work-from-home rhythm",
  work_hours: "work schedule",
};

export function riskLevelForTextFacts(facts: TextProfileFact[]) {
  if (
    facts.some(
      (fact) =>
        fact.sensitivity_level === "protected" ||
        fact.sensitivity_level === "high_risk",
    )
  ) {
    return "high" as const;
  }

  if (facts.some((fact) => fact.sensitivity_level === "sensitive")) {
    return "medium" as const;
  }

  return "low" as const;
}

export function classifyTextSensitivity(
  text: string,
): TextProfileFact["sensitivity_level"] {
  if (
    /\b(?:race|ethnic|religion|christian|jewish|muslim|gender|sexual orientation|pregnan|children|kids|citizen|immigration)\b/i.test(
      text,
    )
  ) {
    return "protected";
  }

  if (
    /\b(?:diagnos|therapy|medication|mental health|credit score|bankruptcy|eviction|criminal|conviction|ssn|social security)\b/i.test(
      text,
    )
  ) {
    return "high_risk";
  }

  if (
    /\b(?:income|salary|medical|health|allerg(?:y|ic)|precise address)\b/i.test(
      text,
    )
  ) {
    return "sensitive";
  }

  return "standard";
}
