import type {
  ProfileEnrichmentSnapshot,
  ProfileFactSummary,
  ProfileImportSummary,
} from "@/lib/shared/types";

const APPROVED_STATES = new Set(["approved", "edited"]);

export type AboutSentence = {
  text: string;
  hasMemories: boolean;
  approvedFactCount: number;
};

export type ProfileQuote = {
  text: string;
  factKey: string;
} | null;

export type AssistantConnection =
  | { connected: false }
  | {
      connected: true;
      provider: string;
      providerLabel: string;
      lastSyncedAt: string;
    };

function buildAboutSentence(allFacts: ProfileFactSummary[]): AboutSentence {
  const approved = allFacts.filter((fact) => APPROVED_STATES.has(fact.reviewState));

  if (approved.length === 0) {
    return {
      text: "Connect an assistant in Memories so Kinfolk can learn how you live.",
      hasMemories: false,
      approvedFactCount: 0,
    };
  }

  const traits = buildTraitSummary(approved);
  const interests = buildInterestSummary(approved);
  const profileParts: string[] = [];
  const traitSummary = joinHuman(traits);
  const interestSummary = formatInterestPhrase(interests, traits.length > 0);
  if (traitSummary) profileParts.push(traitSummary);
  if (interestSummary) profileParts.push(interestSummary);
  const text =
    profileParts.length > 0
      ? profileParts.join(", ")
      : "Building a roommate profile from approved assistant memories";

  return {
    text: `${capitalize(text)}.`,
    hasMemories: true,
    approvedFactCount: approved.length,
  };
}

function buildTraitSummary(facts: ProfileFactSummary[]) {
  const traits: string[] = [];

  if (hasFact(facts, "planning_style", /analytical|structured|planning/i)) {
    traits.push("analytical");
  }
  if (
    hasFact(facts, "directness_preference", /direct|practical|concrete/i) ||
    hasFact(facts, "communication_style", /direct/i)
  ) {
    traits.push("direct");
  }
  if (
    hasFact(facts, "career_intensity", /project|workload|intensity|driven/i) ||
    hasAnyFact(facts, ["work_hours", "work_from_home"], /project|intensity|driven|high.?output/i)
  ) {
    traits.push("project-driven");
  }
  if (
    hasFact(facts, "community_orientation", /community|team/i) ||
    hasAnyFact(facts, ["social_energy", "shared_communities"], /community|team/i)
  ) {
    traits.push("community-oriented");
  }

  return dedupeStrings(traits).slice(0, 3);
}

function buildInterestSummary(facts: ProfileFactSummary[]) {
  const interests: string[] = [];

  if (hasFact(facts, "interests", /ai|agent|startup/i)) {
    interests.push("AI/startups");
  }
  if (hasFact(facts, "aesthetic_taste", /design|image|visual|merch/i)) {
    interests.push("design");
  }
  if (hasFact(facts, "music_taste", /./)) {
    interests.push("music");
  }
  if (hasFact(facts, "interests", /meme|internet|discord/i)) {
    interests.push("internet culture");
  }
  if (hasFact(facts, "interests", /fitness|ufc/i)) {
    interests.push("fitness/UFC");
  }
  if (hasFact(facts, "travel_interest", /travel|tokyo/i)) {
    interests.push("travel");
  }

  return dedupeStrings(interests).slice(0, 5);
}

function formatInterestPhrase(interests: string[], hasTraits: boolean) {
  if (interests.length === 0) {
    return "";
  }

  return `${hasTraits ? "with interests" : "interested"} in ${joinHuman(interests)}`;
}

function hasFact(facts: ProfileFactSummary[], key: string, pattern: RegExp) {
  return facts.some((fact) => fact.factKey === key && pattern.test(fact.value));
}

function hasAnyFact(facts: ProfileFactSummary[], keys: string[], pattern: RegExp) {
  const keySet = new Set(keys);
  return facts.some((fact) => keySet.has(fact.factKey) && pattern.test(fact.value));
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function joinHuman(values: string[]) {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function buildAssistantConnection(
  imports: ProfileImportSummary[],
): AssistantConnection {
  const latest = imports.find((entry) => entry.processedAt && entry.status !== "deleted");

  if (!latest) {
    return { connected: false };
  }

  return {
    connected: true,
    provider: latest.provider,
    providerLabel: providerLabel(latest.provider),
    lastSyncedAt: latest.processedAt ?? latest.createdAt,
  };
}

function buildProfileQuote(allFacts: ProfileFactSummary[]): ProfileQuote {
  const summaryKeys = new Set(["target_market", "budget", "move_in_window"]);

  const pick = allFacts.reduce<(ProfileFactSummary & { cleaned: string }) | null>(
    (best, fact) => {
      if (!APPROVED_STATES.has(fact.reviewState) || summaryKeys.has(fact.factKey)) {
        return best;
      }
      const cleaned = cleanQuoteText(fact.evidenceExcerpt);
      if (!isProseQuote(cleaned)) {
        return best;
      }
      const candidate = { ...fact, cleaned };
      return best === null || candidate.importance > best.importance ? candidate : best;
    },
    null,
  );
  if (!pick) return null;

  return {
    text: pick.cleaned,
    factKey: pick.factKey,
  };
}

function cleanQuoteText(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // If the excerpt is a JSON array/object (the seed `JSON.stringify`s
  // non-string fact values), pull out the first useful sentence-like value.
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = safeJsonParse(trimmed);
    if (Array.isArray(parsed)) {
      const first = parsed.find((item) => typeof item === "string" && item.trim().length > 0);
      return typeof first === "string" ? first.trim() : "";
    }
    if (parsed && typeof parsed === "object") {
      const first = Object.values(parsed).find(
        (item) => typeof item === "string" && item.trim().length > 0,
      );
      return typeof first === "string" ? first.trim() : "";
    }
    return "";
  }

  return trimmed;
}

function isProseQuote(value: string): boolean {
  if (!value) return false;
  if (value.length < 20) return false;
  // Heuristic: real prose has at least a couple of words and isn't just
  // a comma list or a single capitalized phrase.
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  return wordCount >= 4;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function summarizeEnrichmentForProfile(snapshot: ProfileEnrichmentSnapshot) {
  return {
    about: buildAboutSentence(snapshot.facts),
    quote: buildProfileQuote(snapshot.facts),
    assistant: buildAssistantConnection(snapshot.imports),
  };
}

// Parses a fact value into a list of strings. Handles JSON-stringified
// arrays (the seed `JSON.stringify`s non-string values), comma/pipe/
// "or"-separated text, and bare strings.
function splitMulti(value: string) {
  if (!value) return [];

  const trimmed = value.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = safeJsonParse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => {
        if (typeof item !== "string") return [];
        const cleanItem = item.trim();
        return cleanItem ? [cleanItem] : [];
      });
    }
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed).flatMap((item) => {
        if (typeof item !== "string") return [];
        const cleanItem = item.trim();
        return cleanItem ? [cleanItem] : [];
      });
    }
  }

  return trimmed
    .split(/[,;|]| or |\u00b7/i)
    .flatMap((part) => {
      const cleanPart = part.trim();
      return cleanPart ? [cleanPart] : [];
    });
}

// Strips wrapping brackets/quotes from a single fact value so users never see
// JSON syntax leak through. Also collapses internal whitespace.
function sanitizeListItem(raw: string): string {
  if (!raw) return "";
  let value = raw.trim();
  // Unwrap a JSON-encoded string (e.g. `"\"Hayes Valley\""`).
  if (value.startsWith('"') && value.endsWith('"')) {
    const parsed = safeJsonParse(value);
    if (typeof parsed === "string") value = parsed.trim();
  }
  value = value.replace(/^[\[\{"'`]+|[\]\}"'`]+$/g, "").trim();
  return value.replace(/\s+/g, " ");
}

function providerLabel(provider: string) {
  switch (provider.toLowerCase()) {
    case "claude":
      return "Claude";
    case "chatgpt":
      return "ChatGPT";
    case "mcp":
      return "MCP";
    case "manual":
      return "Manual paste";
    case "mock":
      return "Mock import";
    case "web":
      return "Profile editor";
    case "linq":
    case "sendblue":
      return "Text message";
    default:
      return provider;
  }
}

function capitalize(value: string) {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}

// Parses a raw fact-style value (JSON array or comma list) into a clean
// array of strings, with each item sanitized. Used by the profile page so
// markets/neighborhoods render as readable chips, not raw JSON.
export function parseFactList(raw: string | string[]): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      const value = sanitizeListItem(item);
      return value.length > 0 ? [value] : [];
    });
  }
  return splitMulti(raw).flatMap((item) => {
    const value = sanitizeListItem(item);
    return value.length > 0 ? [value] : [];
  });
}
