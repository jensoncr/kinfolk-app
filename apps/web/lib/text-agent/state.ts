import type {
  TextAgentIntakeStep,
  TextProfileFact,
} from "@/lib/text-agent";

export type TextAgentActiveMode =
  | "intake"
  | "apartment_search"
  | "roommate_search"
  | "monitor_setup"
  | "group_join"
  | "paused";

export type TextAgentLastSentCard = {
  id: string;
  reactionState?: string | null;
  score?: number | null;
  sendReason: string;
  type: "apartment" | "profile" | "roommate";
};

export type TextAgentConversationState = {
  active_intake_step: TextAgentIntakeStep | null;
  active_mode: TextAgentActiveMode;
  foundation_readiness: {
    budget: boolean;
    move_in: boolean;
    neighborhoods: boolean;
    roommate_openness: boolean;
  };
  last_sent_cards: TextAgentLastSentCard[];
  paused_until: string | null;
  pending_action: string | null;
  roommate_readiness: {
    compatibility_answer_count: number;
    open_to_roommates: boolean | null;
    ready_for_roommate_cards: boolean;
  };
};

const roommateCompatibilityFactKeys = new Set([
  "cleanliness",
  "communication_style",
  "conflict_repair",
  "guests",
  "interests",
  "noise_tolerance",
  "overnight_guests",
  "pets",
  "planning_style",
  "privacy",
  "rent_tradeoff",
  "response_time",
  "routine_regularity",
  "sleep_schedule",
  "social_energy",
  "trust_context",
  "work_from_home",
  "work_hours",
]);

export function buildTextAgentConversationState({
  activeMode,
  facts,
  lastIntent,
  lastSentCards = [],
  nextIntakeStep,
  pausedUntil = null,
  pendingAction = null,
}: {
  activeMode?: TextAgentActiveMode;
  facts: TextProfileFact[];
  lastIntent?: string | null;
  lastReplyKind?: string | null;
  lastSentCards?: TextAgentLastSentCard[];
  nextIntakeStep: TextAgentIntakeStep | null;
  pausedUntil?: string | null;
  pendingAction?: string | null;
}): TextAgentConversationState {
  const foundationReadiness = {
    budget: hasAnyFact(facts, [
      "budget",
      "budget_preferred_max",
      "budget_max",
      "budget_min",
    ]),
    move_in: hasAnyFact(facts, ["move_in_window"]),
    neighborhoods: hasAnyFact(facts, ["neighborhoods"]),
    roommate_openness: hasAnyFact(facts, [
      "group_size_flexibility",
      "household_size",
    ]),
  };
  const openToRoommates = readOpenToRoommates(facts);
  const compatibilityAnswerCount = countCompatibilityAnswers(facts);
  const conversationState: TextAgentConversationState = {
    active_intake_step: nextIntakeStep,
    active_mode:
      activeMode ??
      inferActiveMode({
        lastIntent,
        pausedUntil,
        pendingAction,
      }),
    foundation_readiness: foundationReadiness,
    last_sent_cards: lastSentCards.slice(0, 10),
    paused_until: pausedUntil,
    pending_action: pendingAction,
    roommate_readiness: {
      compatibility_answer_count: compatibilityAnswerCount,
      open_to_roommates: openToRoommates,
      ready_for_roommate_cards:
        openToRoommates === true && compatibilityAnswerCount >= 3,
    },
  };

  return conversationState;
}

function inferActiveMode({
  lastIntent,
  pausedUntil,
  pendingAction,
}: {
  lastIntent?: string | null;
  pausedUntil?: string | null;
  pendingAction?: string | null;
}): TextAgentActiveMode {
  if (pausedUntil && Date.parse(pausedUntil) > Date.now()) {
    return "paused";
  }
  if (pendingAction?.includes("group")) {
    return "group_join";
  }
  if (lastIntent?.includes("monitor")) {
    return "monitor_setup";
  }
  if (lastIntent?.includes("roommate")) {
    return "roommate_search";
  }
  if (
    lastIntent?.includes("listing") ||
    lastIntent?.includes("apartment") ||
    lastIntent?.includes("living_query_apartment")
  ) {
    return "apartment_search";
  }

  return "intake";
}

function hasAnyFact(facts: TextProfileFact[], keys: string[]) {
  const keySet = new Set(keys);
  return facts.some((fact) => keySet.has(fact.fact_key));
}

function countCompatibilityAnswers(facts: TextProfileFact[]) {
  const answered = new Set<string>();
  for (const fact of facts) {
    if (roommateCompatibilityFactKeys.has(fact.fact_key)) {
      answered.add(fact.fact_key);
    }
  }
  return answered.size;
}

function readOpenToRoommates(facts: TextProfileFact[]) {
  const householdFact = [...facts]
    .reverse()
    .find((fact) => fact.fact_key === "household_size");
  const householdValue = householdFact?.value;
  if (householdValue && typeof householdValue === "object" && !Array.isArray(householdValue)) {
    const max = readNumber(householdValue.max);
    if (max !== null) {
      return max > 1;
    }
  }

  const flexibilityFact = [...facts]
    .reverse()
    .find((fact) => fact.fact_key === "group_size_flexibility");
  const flexibility = stringifyFactValue(flexibilityFact?.value).toLowerCase();
  if (!flexibility) {
    return null;
  }
  if (/\b(?:solo|alone|no roommate|without roommate|not open)\b/.test(flexibility)) {
    return false;
  }
  if (/\b(?:open|yes|roommate|shared|flexible)\b/.test(flexibility)) {
    return true;
  }

  return null;
}

function stringifyFactValue(value: TextProfileFact["value"] | undefined) {
  if (value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).join(" ");
  }
  return String(value);
}

function readNumber(value: string | number | boolean | null | undefined) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}
