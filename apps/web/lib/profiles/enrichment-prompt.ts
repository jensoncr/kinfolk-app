import { buildCanonicalFactKeyPromptSection } from "./canonical-facts";

export type AssistantProfileProvider = "chatgpt" | "claude";

const assistantProfilePromptVersion = "kinfolk_assistant_profile_v9";

const providerLabels: Record<AssistantProfileProvider, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
};

const CHATGPT_BASE_URL = "https://chatgpt.com/";
const CHATGPT_PREFILL_URL_MAX_LENGTH = 3500;

function providerLabel(provider: AssistantProfileProvider) {
  return providerLabels[provider];
}

export function buildClaudeProfileImportUrl(prompt: string) {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

export function buildChatGptProfileImportUrl(prompt: string) {
  const prefilledUrl = `${CHATGPT_BASE_URL}?${new URLSearchParams({
    prompt,
  }).toString()}`;

  // ChatGPT returns HTTP 431 for long prefilled URLs once cookies are included.
  return prefilledUrl.length <= CHATGPT_PREFILL_URL_MAX_LENGTH
    ? prefilledUrl
    : CHATGPT_BASE_URL;
}

export function buildAssistantProfilePrompt(provider: AssistantProfileProvider) {
  const providerName = providerLabel(provider);

  return `Use ${providerName} memories/profile/chat. No interview. Return exactly one strictly valid JSON object and no commentary.
JSON encoding: use double-quoted keys and strings. Escape every double quote inside a string as \\"; for example, "evidence":"They said \\"very quiet\\" at night." Escape backslashes and control characters, and never put literal line breaks inside strings. Before responding, verify the complete output parses as JSON.
Facts: work/school/network, rhythm/WFH, home labor, tolerance, guests/privacy/social, comms/conflict, trust/mutuals, roommate history, interests/taste.
Exclude apt filters: market/area/city/budget/commute/work/move/lease/household/must-haves/access/pets/smoking.
Output: schema_version="${assistantProfilePromptVersion}",source_assistant="${provider}",generated_by="${providerName}",generated_at:null,profile_summary{short_self_summary,living_with_me_is_like,known_uncertainties[]},profile_facts[{dimension,fact_key,value,confidence,assertion_type,evidence,sensitivity_level,source_type,observed_vs_self_reported,recency_hint}],raw_relevant_notes[],contradictions_or_uncertainties[],recommended_follow_up_questions[].
Dims: daily_rhythm, environment_tolerance, home_labor, social_boundary, communication, trust_context, rapport_taste, disallowed.
Rules: atomic; confidence 0-1 and >=0.6; assertion_type=explicit/inferred/imported/user_confirmed; sensitivity_level=standard/sensitive/protected/high_risk. Facts only for known signals; gaps -> follow-up questions. Omit unknown/no data/no evidence/not stated/defaulting to midpoint/not known. Do not invent or infer protected traits; explicit protected/high-risk -> disallowed + protected/high_risk. fact_key MUST be from keys, no aliases. Structured values MUST use exact tokens; evidence keeps user's wording but all quoted wording MUST remain valid JSON by escaping embedded double quotes. No structured midpoint guesses (moderate,balanced,flexible,occasional) unless explicit. Maps: bass/subwoofer/low-frequency vibration -> noise_tolerance very quiet/quiet; conflict prefs -> conflict_repair; cohab/overnights -> overnight_guests with no partner names; hobbies -> interests.
${buildCanonicalFactKeyPromptSection()}`;
}
