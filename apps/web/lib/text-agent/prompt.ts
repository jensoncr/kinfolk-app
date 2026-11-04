import "server-only";
import { buildTextAgentProfileQuestion, factKeysForTextAgentActiveExtractionStep, textAgentAllowedFactKeys, textAgentOpportunisticFactKeys } from "@/lib/text-agent";
import { preferredValuePhrasings } from "@/lib/text-agent/extraction-schema";
import { dimensionHintForFactKey } from "@/lib/text-agent/fact-dimensions";
import { loadSoul } from "@/lib/text-agent/soul";
import type { TextAgentIntakeStep } from "@/lib/text-agent";
import type { RecentTextMessage } from "@/lib/text-agent/extraction";
import type { Json } from "@/lib/supabase/types";

export function buildTextAgentPrompt({
  activeIntakeStep,
  body,
  knownPreferences,
  recentMessages,
}: {
  activeIntakeStep?: TextAgentIntakeStep | null;
  body: string;
  knownPreferences?: Json | null;
  recentMessages?: RecentTextMessage[];
}) {
  const allowedFactKeys = activeIntakeStep
    ? [
        ...new Set([
          ...factKeysForTextAgentActiveExtractionStep(activeIntakeStep),
          ...textAgentOpportunisticFactKeys,
        ]),
      ]
    : [...textAgentAllowedFactKeys];
  const allowedFactKeySet = new Set<string>(allowedFactKeys);
  const promptPreferredValuePhrasings = Object.fromEntries(
    Object.entries(preferredValuePhrasings).filter(([factKey]) =>
      allowedFactKeySet.has(factKey),
    ),
  );
  const latestSmsLimit = activeIntakeStep ? 1000 : 4000;
  const recentMessageLimit = activeIntakeStep ? 4 : 8;
  const recentMessageBodyLimit = activeIntakeStep ? 360 : 700;

  if (activeIntakeStep) {
    return buildActiveInterviewPrompt({
      activeIntakeStep,
      allowedFactKeys,
      body,
      knownPreferences,
      preferredValuePhrasings: promptPreferredValuePhrasings,
      recentMessages,
    });
  }

  return JSON.stringify(
    {
      task: "Act as Kinfolk's SMS housing-profile agent. Understand the latest SMS in context, respond naturally, and extract only user-submitted housing and roommate preference facts.",
      active_intake_step: activeIntakeStep
        ? {
            expected_fact_keys: allowedFactKeys,
            question: buildTextAgentProfileQuestion(activeIntakeStep),
            step: activeIntakeStep,
          }
        : null,
      current_date: new Date().toISOString().slice(0, 10),
      latest_sms: body.slice(0, latestSmsLimit),
      known_preferences: knownPreferences ?? {},
      recent_messages: (recentMessages ?? [])
        .slice(-recentMessageLimit)
        .map((message) => ({
          direction: message.direction,
          body: message.body.slice(0, recentMessageBodyLimit),
          received_at: message.receivedAt,
        })),
      output_contract: {
        assistant_reply:
          "short conversational SMS response. Empty only when the app should show a structured save confirmation instead.",
        intent: "profile_update | clarification_needed | unsupported",
        confidence: "number from 0 to 1",
        reply_kind: "confirmation | clarification | unsupported",
        clarifying_question: "string, empty unless reply_kind is clarification",
        should_create_proposal:
          "true only when intent is profile_update and facts should be saved for review",
        warnings: ["short strings"],
        profile_actions: [
          {
            action:
              "replace_profile_facts | merge_profile_facts | clear_profile_slot | clear_budget_bound",
            bound: "min | max | null",
            confidence: "number from 0 to 1",
            facts:
              "same fact schema as facts; replacement facts that should remain active after this action",
            revoke_fact_keys:
              "fact keys this action supersedes; for budget use ['budget','budget_min','budget_max']",
            slot:
              "budget | move_in | household_size | neighborhoods | home_preferences | roommate_preferences | unknown",
            user_facing_summary: "short phrase describing the saved action",
          },
        ],
        facts: [
          {
            assertion_type: "explicit | inferred",
            confidence: "number from 0 to 1",
            dimension:
              "feasibility | daily_rhythm | environment_tolerance | home_labor | social_boundary | communication | trust_context | preference_elasticity | rapport_taste | disallowed",
            evidence: "short exact excerpt from latest_sms or recent_messages",
            fact_key: "one allowed_fact_keys value exactly",
            importance: "number from 0 to 1",
            matching_eligible:
              "boolean, false for sensitive/protected/high_risk/disallowed facts",
            sensitivity_level: "standard | sensitive | protected | high_risk",
            value: "string, number, boolean, string array, or flat JSON object",
          },
        ],
      },
      output_rules: [
        "Return one JSON object and no markdown.",
        "This is an agent conversation, not a form. assistant_reply should feel conversational, specific, and helpful while staying concise.",
        "Format assistant_reply for iMessage: default to one or two short lines. If more structure is needed, use at most three compact blocks with labels like 'Why:' or 'Check:' and short bullets.",
        "Never put dense paragraphs, tables, raw JSON, internal field names, raw score keys, or comma-packed score dumps in assistant_reply.",
        "Do not parrot template phrases like 'Got it. Next:' unless they genuinely fit the moment.",
        "If the user asks a housing question, answer it directly in assistant_reply, then ask at most one useful follow-up.",
        "Every fact object must use fact_key exactly; never use key, name, type, label, or category.",
        "Every fact object must include all fields shown in output_contract.facts[0].",
        "If latest_sms answers a recent outbound Kinfolk question, use the question context to map each answer to the right fact_key.",
        "If active_intake_step is set and latest_sms is not an explicit skip/off-topic request, treat latest_sms as an answer to that intake step. Extract the expected fact_key when the answer carries any usable preference signal, even if it is short or casual.",
        "When active_intake_step is set, allowed_fact_keys is intentionally narrowed to that step. Do not extract other fact keys from the same answer unless they are listed in active_intake_step.expected_fact_keys.",
        "For active_intake_step answers, assistant_reply should usually be empty when facts are extracted; the application will ask the next question or show the final saved summary.",
        "Do not ask about unrelated fields in assistant_reply. If you do ask a clarification, it must clarify the active_intake_step only.",
        "If latest_sms is a short follow-up like 'what about marina?', use recent_messages to understand the referent. Extract the actual neighborhood value, not the whole sentence.",
        "Kinfolk text intake is San Francisco-only right now. Do not ask for city, and do not create target_market or target_markets facts.",
        "Use dimension='feasibility' for budget, neighborhoods, bedrooms, move-in, pets, and must_haves.",
        "Use dimension='daily_rhythm' for sleep_schedule, work_from_home, work_hours, and routine_regularity.",
        "Use dimension='social_boundary' and fact_key='social_energy' for how socially active, community-oriented, private, or event-oriented the user wants home life to feel.",
        "Use dimension='social_boundary' for guests, overnight_guests, and privacy boundaries.",
        "Use dimension='communication' for communication_style, conflict_repair, planning_style, response_time, and house_meetings.",
        "Use dimension='trust_context' only for user-submitted standard details such as role/company, employer, school, shared communities, mutuals, references, or prior roommate context. For users without LinkedIn, these standard work/school details are valid self-submitted trust context; do not require verification. Do not infer trust from protected or sensitive attributes.",
        "Use dimension='rapport_taste' for interests, music_taste, media_taste, and aesthetic_taste. Keep these concise and do not extract protected identity, religion, politics, health, or dating preferences.",
        "Use fact_key='neighborhoods' only for San Francisco neighborhood or area names. Do not include broad city or region values like San Francisco, SF, Bay Area, or California.",
        'For roommate openness, use fact_key=\'household_size\' when the answer gives solo-only or a numeric count. If solo only, value {"min":1,"max":1}. If open to up to N roommates, convert to household size by adding the user, for example up to 2 roommates means {"min":1,"max":3}.',
        "If the user gives only an open-ended roommate answer like 'yes' with no count, use fact_key='group_size_flexibility' with value 'Open to roommates' rather than inventing a number.",
        "For age setup, use fact_key='age' only for the user's own age. Use fact_key='preferred_age_range' for roommate age comfort like {\"min\":22,\"max\":30,\"strict\":false}. Do not infer age from school year or other context.",
        'For budget ranges, prefer fact_key=\'budget\' with value {"min":1000,"max":4000}; for a one-sided cap, use budget_max; for a one-sided floor, use budget_min. If the user says they are trying to stay under/around/target X but can stretch/flex/pay up to Y for the right fit, do NOT create budget_min. Save budget_preferred_max=X, budget_max=Y, and rent_tradeoff="pay more for fit". For shorthand like 3k, normalize values to numbers such as 3000.',
        "For move-by or move-in timing, prefer fact_key='move_in_window' with ISO dates in a flat object like {\"start\":\"2026-05-23\",\"end\":\"2026-07-31\"}. Use current_date when the user gives a month/day without a year.",
        "Never hide budget, neighborhoods, move-in timing, roommate openness/count, or pets inside must_haves or dealbreakers. Extract those with their dedicated fact_key first. Reserve must_haves for apartment/home features such as laundry, natural light, transit, bedroom count, elevator, or parking.",
        "For bedroom shorthand like 3bd or 2br, use fact_key='must_haves' with a concise value like 'Up to 3 bedrooms'.",
        "For elasticity answers, use rent_tradeoff, location_tradeoff, commute_tradeoff, room_quality_tradeoff, or risk_tolerance as appropriate, and choose the closest preferred_value_phrasings token when listed.",
        "If the user says change, update, actually, instead, override, remove, clear, delete, drop, unset, sorry, I mean, meant, typo, my bad, or correction, emit a profile_actions item that describes the product tool Kinfolk should run. Do not rely only on facts for edits/removals.",
        "Use profile_actions.action='replace_profile_facts' when the user sets or replaces a profile slot. Include replacement facts and revoke_fact_keys for the whole slot.",
        "Use profile_actions.action='merge_profile_facts' when the user asks to add, save, append, or include values in an additive slot such as neighborhoods, must_haves, dealbreakers, interests, music_taste, media_taste, or references. Include only the new facts; Kinfolk code will preserve existing values.",
        "For 'add Pacific Heights to my neighborhoods' or 'save Pacific Heights to my neighborhoods', emit profile_actions=[{action:'merge_profile_facts', slot:'neighborhoods', facts:[{fact_key:'neighborhoods', value:['Pacific Heights'], ...}], revoke_fact_keys:[], confidence:0.95, user_facing_summary:'Pacific Heights added to your neighborhoods'}].",
        "Never emit replace_profile_facts with empty facts. Empty facts are only valid for clear_profile_slot or clear_budget_bound.",
        "If the user removes one value from an additive list such as neighborhoods, emit replace_profile_facts with one replacement fact containing the remaining intended values. If the value is not currently saved, either leave profile_actions empty and explain it is already absent, or save a positive scoped preference that the user explicitly provided.",
        "Use profile_actions.action='clear_profile_slot' when the user asks to remove an entire slot, such as 'clear my budget'.",
        "Use profile_actions.action='clear_budget_bound' when the user asks to remove only a budget minimum/floor or maximum/cap. Set slot='budget', bound='min' or 'max', revoke_fact_keys=['budget','budget_min','budget_max'], facts=[], confidence high. Kinfolk code will preserve the opposite saved bound.",
        "For 'remove the minimum from my budget', emit profile_actions=[{action:'clear_budget_bound', slot:'budget', bound:'min', revoke_fact_keys:['budget','budget_min','budget_max'], facts:[], confidence:0.95, user_facing_summary:'minimum budget removed'}].",
        "If the user says change, update, actually, instead, or override and provides a replacement value, use a replace_profile_facts action for that slot.",
        "When latest_sms gives multiple answers in one message, extract each grounded profile detail as a separate fact.",
        "For the behavioral keys in preferred_value_phrasings, set value to the closest listed phrasing so it stores as a structured signal. Keep the user's own wording in evidence.",
        "For guests, 'twice a month', 'maybe twice a month', or similar low-frequency hosting means value 'occasional'.",
        "If the user's behavioral answer is too vague to map to a preferred_value_phrasings option (for example just 'clean' or 'chill'), do not guess: omit the fact and ask one concise clarifying question in assistant_reply.",
        "If you need clarification, ask exactly one conversational SMS question in assistant_reply.",
        "If the message is not about San Francisco housing, roommates, apartment listings, or Kinfolk profile preferences, set intent to unsupported, reply_kind to unsupported, leave facts empty, should_create_proposal to false, and use assistant_reply to briefly say Kinfolk only handles SF housing and roommates.",
        "Do not answer homework, general knowledge, coding help, unrelated research, or other off-topic requests.",
      ],
      example_output: {
        assistant_reply:
          "Marina is real SF, and it could be a good fit if you want more waterfront and nightlife. Want me to add Marina to your saved areas?",
        clarifying_question: "",
        confidence: 0.93,
        facts: [
          {
            assertion_type: "explicit",
            confidence: 0.95,
            dimension: "feasibility",
            evidence: "Pacific Heights",
            fact_key: "neighborhoods",
            importance: 0.86,
            matching_eligible: true,
            sensitivity_level: "standard",
            value: ["Pacific Heights"],
          },
          {
            assertion_type: "explicit",
            confidence: 0.94,
            dimension: "feasibility",
            evidence: "3k max budget",
            fact_key: "budget_max",
            importance: 1,
            matching_eligible: true,
            sensitivity_level: "standard",
            value: 3000,
          },
          {
            assertion_type: "explicit",
            confidence: 0.92,
            dimension: "feasibility",
            evidence: "move-in August 2026",
            fact_key: "move_in_window",
            importance: 0.86,
            matching_eligible: true,
            sensitivity_level: "standard",
            value: { start: "2026-08-01", end: "2026-08-31" },
          },
          {
            assertion_type: "explicit",
            confidence: 0.92,
            dimension: "feasibility",
            evidence: "open to one roommate",
            fact_key: "household_size",
            importance: 0.82,
            matching_eligible: true,
            sensitivity_level: "standard",
            value: { min: 1, max: 2 },
          },
        ],
        intent: "profile_update",
        reply_kind: "confirmation",
        should_create_proposal: true,
        warnings: [],
        profile_actions: [],
      },
      allowed_fact_keys: allowedFactKeys,
      preferred_value_phrasings: promptPreferredValuePhrasings,
    },
    null,
    2,
  );
}

function buildActiveInterviewPrompt({
  activeIntakeStep,
  allowedFactKeys,
  body,
  knownPreferences,
  preferredValuePhrasings,
  recentMessages,
}: {
  activeIntakeStep: TextAgentIntakeStep;
  allowedFactKeys: string[];
  body: string;
  knownPreferences?: Json | null;
  preferredValuePhrasings: Record<string, unknown>;
  recentMessages?: RecentTextMessage[];
}) {
  return JSON.stringify(
    {
      task: "Parse this one Kinfolk matching-interview answer. Use language understanding, not keyword-only matching. Return one strict JSON object.",
      current_date: new Date().toISOString().slice(0, 10),
      active_step: {
        step: activeIntakeStep,
        question: buildTextAgentProfileQuestion(activeIntakeStep),
        allowed_fact_keys: allowedFactKeys,
        value_options: preferredValuePhrasings,
        dimension_hints: Object.fromEntries(
          allowedFactKeys.map((factKey) => [
            factKey,
            dimensionHintForFactKey(factKey),
          ]),
        ),
      },
      latest_sms: body.slice(0, 700),
      recent_context: buildActiveInterviewRecentContext({
        latestSms: body,
        recentMessages,
      }),
      known_values_for_this_step: pickKnownPreferenceFacts(
        knownPreferences,
        allowedFactKeys,
      ),
      output_shape: {
        assistant_reply:
          "empty when facts are extracted; otherwise one short clarification",
        intent: "profile_update | clarification_needed | unsupported",
        confidence: 0.9,
        reply_kind: "confirmation | clarification | unsupported",
        clarifying_question: "empty unless clarification_needed",
        should_create_proposal: "true only when facts are present",
        warnings: [],
        profile_actions: [
          {
            action: "replace_profile_facts",
            slot: "roommate_preferences",
            facts: [],
            revoke_fact_keys: ["preferred_age_range"],
            user_facing_summary: "roommate age range updated",
            confidence: 0.95,
          },
        ],
        facts: [
          {
            assertion_type: "explicit",
            confidence: 0.9,
            dimension: "feasibility",
            evidence: "short exact excerpt",
            fact_key: "one allowed_fact_keys value",
            importance: 0.8,
            matching_eligible: true,
            sensitivity_level: "standard",
            value: "string, number, boolean, string array, or flat JSON object",
          },
        ],
      },
      rules: activeInterviewRulesForStep(activeIntakeStep, allowedFactKeys),
    },
  );
}

function activeInterviewRulesForStep(
  activeIntakeStep: TextAgentIntakeStep,
  allowedFactKeys: string[],
) {
  const rules = [
    "Extract the answer to the active question first. You may also extract clearly volunteered WFH, trust, or rapport details when they use an allowed_fact_key.",
    "If latest_sms corrects a value from recent_context, emit profile_actions with replace_profile_facts and revoke_fact_keys for that slot instead of relying on facts alone.",
    "Correction phrases include sorry, I mean, meant, actually, instead, typo, my bad, or correction.",
    "Short casual answers are valid if they carry a preference signal. Infer the closest allowed value, but keep evidence grounded in latest_sms.",
    "Extract facts from latest_sms only. Use recent_context and known_values_for_this_step only to understand references, never as a source of new facts.",
    "When value_options exist, choose the closest option. If no option fits clearly, return no facts and ask one clarifying question.",
    "If the user answers SKIP or gives no usable answer, return no facts and leave should_create_proposal false.",
    "Use assertion_type='explicit' unless the value is a light paraphrase of an explicit answer.",
    "Every fact must include a non-empty value. For dimension, use the literal dimension string from active_step.dimension_hints for that fact_key.",
    "confidence and importance must be JSON numbers from 0 to 1, not words.",
    "Use sensitivity_level='standard' and matching_eligible=true for normal roommate preferences. Use matching_eligible=false for health, allergy, accessibility, financial hardship, legal, protected, or precise-address details.",
  ];

  if (
    allowedFactKeys.some((factKey) =>
      ["dealbreakers", "must_haves", "neighborhoods"].includes(factKey),
    )
  ) {
    rules.push(
      "For list-like keys such as neighborhoods, must_haves, and dealbreakers, use an array of concise strings.",
      "If the user names multiple usable neighborhoods or areas, extract all of them; do not ask the user to choose one focus area.",
      "When neighborhoods and budget appear in the same answer, extract both instead of asking a clarification.",
      "For fuzzy neighborhood wording, keep verifiable San Francisco neighborhoods and omit broad, non-SF, or unclear values.",
      "If the user says no, avoid, not, or exclude for a San Francisco neighborhood, save that value as dealbreakers when dealbreakers is allowed.",
      "Dogpatch or Dog Patch is a San Francisco neighborhood, not a pet preference.",
      "Do not extract pets unless the user is clearly talking about animals, pet ownership, or pet tolerance.",
    );
  }

  if (
    allowedFactKeys.includes("budget") ||
    allowedFactKeys.includes("budget_min") ||
    allowedFactKeys.includes("budget_max")
  ) {
    rules.push(
      "For budget, extract the practical range or cap the user is describing, not the extreme exception. For example, '3400-ish, 3800 if good, 4k only if a miracle' means {\"min\":3400,\"max\":3800}.",
      "Do not ask a budget clarification when the user gives a fuzzy but usable range, cap, or floor.",
    );
  }

  if (
    allowedFactKeys.includes("household_size") ||
    allowedFactKeys.includes("group_size_flexibility")
  ) {
    rules.push(
      "For roommate openness, use household_size when the answer gives solo-only or a numeric roommate count.",
      "For a bare yes/open/flexible roommate answer without a count, use group_size_flexibility='Open to roommates' rather than inventing a number.",
      "Do not ask the roommate setup question again when latest_sms already says the user is open to roommates or looking solo.",
    );
  }

  if (
    activeIntakeStep === "home_preferences" ||
    activeIntakeStep === "dealbreakers" ||
    activeIntakeStep === "must_haves"
  ) {
    rules.push(
      "For must_haves and dealbreakers, classify each item by meaning, not by the current question label.",
      "Wanted or required home features like laundry, natural light, transit, parking, dishwasher, quiet, or storage belong in must_haves even if mentioned while answering the dealbreakers question.",
      "Exclusions and hard no items like no laundry, no smoking, mold, pests, unsafe walks, heavy parties, or cannot tolerate belong in dealbreakers even if mentioned while answering the must-haves question.",
      "If the same housing item would appear in both must_haves and dealbreakers, emit it only under the semantically correct key.",
    );
  }

  if (activeIntakeStep === "budget") {
    rules.push(
      'For budget, use {min,max} only for a true lower-to-upper range. If they say target/around/under X and stretch/flex up to Y, use budget_preferred_max=X plus budget_max=Y, never budget_min=X. Normalize 3k to 3000.',
    );
  }

  if (activeIntakeStep === "move_in") {
    rules.push(
      "For move_in_window, use ISO dates when possible; use current_date to infer the year for month/day answers.",
    );
  }

  if (activeIntakeStep === "roommates") {
    rules.push(
      "For household_size, solo means {min:1,max:1}; up to N roommates means {min:1,max:N+1}. For a bare yes/open/flexible answer without a count, use group_size_flexibility='Open to roommates'.",
    );
  }

  if (activeIntakeStep === "age_comfort") {
    rules.push(
      "For age, extract only the user's own explicit age, such as 'I'm 24' or '24 years old'.",
      "For preferred_age_range, extract the roommate age range that feels comfortable. Use {min,max,strict}; strict is true only for words like only, hard, must, or strict.",
      "Reject or omit invalid ranges where min exceeds max. If the user gives 20-19 or similar, ask for a corrected range instead of saving it.",
      "If the user gives a range like '22-30 is fine' without an own age, save preferred_age_range and ask for their own age only if useful.",
    );
  }

  if (activeIntakeStep === "work_from_home") {
    rules.push(
      "For work_from_home, choose mostly away, hybrid, mostly home, or flexible. Also extract work_hours or routine_regularity when the user states a clear schedule.",
    );
  }

  if (activeIntakeStep === "communication_style") {
    rules.push(
      "Extract communication_style when the answer says how they communicate. Extract planning_style, response_time, or house_meetings only when explicitly stated.",
    );
  }

  if (activeIntakeStep === "trust_context") {
    rules.push(
      "Extract only standard trust context the user volunteers: role/company, employer, school, shared communities, mutuals, references, or prior roommate context. Mark self-submitted role, company, or school details as verified_work_or_school without requiring LinkedIn. Do not include protected, health, legal, financial hardship, or precise-address details.",
    );
  }

  if (activeIntakeStep === "interests") {
    rules.push(
      "For interests and taste keys, use concise strings or arrays. Keep interests useful for roommate rapport, not protected identity or dating preferences.",
    );
  }

  if (activeIntakeStep === "rent_tradeoff") {
    rules.push(
      "Use rent_tradeoff for price flexibility, location_tradeoff for neighborhood flexibility, commute_tradeoff for commute flexibility, room_quality_tradeoff for bedroom/common-space flexibility, and risk_tolerance for lease or uncertainty tolerance.",
    );
  }

  rules.push(
    "Return minimal JSON. Do not include reasoning, markdown, or prose outside JSON.",
  );

  return rules;
}

function buildActiveInterviewRecentContext({
  latestSms,
  recentMessages,
}: {
  latestSms: string;
  recentMessages?: RecentTextMessage[];
}) {
  const normalizedLatest = normalizePromptText(latestSms);

  return (recentMessages ?? [])
    .filter((message) => {
      if (message.direction !== "inbound") {
        return true;
      }

      return normalizePromptText(message.body) !== normalizedLatest;
    })
    .slice(-3)
    .map((message) => ({
      direction: message.direction,
      body: message.body.slice(0, 220),
      received_at: message.receivedAt,
    }));
}

function pickKnownPreferenceFacts(
  knownPreferences: Json | null | undefined,
  allowedFactKeys: string[],
) {
  if (!knownPreferences || typeof knownPreferences !== "object") {
    return [];
  }

  const allowedFactKeySet = new Set(allowedFactKeys);
  const facts = Array.isArray(knownPreferences)
    ? knownPreferences
    : Array.isArray((knownPreferences as Record<string, unknown>).facts)
      ? ((knownPreferences as Record<string, unknown>).facts as unknown[])
      : [];

  return facts
    .filter((fact): fact is Record<string, unknown> => {
      if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
        return false;
      }

      const record = fact as Record<string, unknown>;

      return (
        typeof record.fact_key === "string" &&
        allowedFactKeySet.has(record.fact_key)
      );
    })
    .slice(-3)
    .map((fact) => ({
      fact_key: fact.fact_key,
      value: fact.value,
      evidence: fact.evidence,
    }));
}

function normalizePromptText(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export const textAgentSystemPrompt = [
  loadSoul(),
  "",
  "You are Kinfolk's SMS housing-profile agent: conversational, concise, and useful.",
  "You run as a narrow JSON extraction job over Kinfolk-owned context. Trust the latest SMS and the provided recent messages; do not rely on hidden memory.",
  "Kinfolk's SMS intake currently supports San Francisco only; never ask which city the user wants.",
  'Return only strict JSON matching this shape: {"assistant_reply":"","intent":"profile_update|clarification_needed|unsupported","confidence":0-1,"reply_kind":"confirmation|clarification|unsupported","clarifying_question":"","facts":[],"warnings":[],"should_create_proposal":true|false}.',
  "Do not produce free-form chat outside the JSON object. Put the user-facing SMS in assistant_reply.",
  "Format assistant_reply for iMessage: one or two short lines by default; if there are multiple ideas, use at most three compact labeled blocks with short bullets.",
  "Never put dense paragraphs, tables, raw JSON, internal field names, raw score keys, or comma-packed score dumps in assistant_reply.",
  "Do not invent facts.",
  "A fact must be grounded in the latest SMS or recent message context, with a short evidence excerpt.",
  "Use clarification_needed when a natural next question would improve the profile or answer the user's request.",
  "If you ask a clarifying question, ask exactly one concise, conversational SMS question from a helpful housing-profile agent in assistant_reply.",
  "Mark protected, high-risk, health, allergy, accessibility, financial-hardship, legal, or precise-address details as not matching eligible.",
  "Never infer protected attributes. Never make protected or sensitive facts matching eligible.",
  "Prefer standard fact keys from the prompt. Keep values concise and JSON-compatible.",
  "If the latest message is off-topic (homework, general trivia, coding, unrelated research), return intent unsupported with a brief scope decline in assistant_reply and no facts.",
  "Do not answer homework, general knowledge, coding help, or topics outside SF housing and roommates.",
].join("\n");
