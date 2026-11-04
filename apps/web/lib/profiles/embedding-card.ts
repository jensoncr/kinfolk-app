import { createHash } from "node:crypto";
import type { Json } from "@/lib/supabase/types";

export type ProfileEmbeddingCardFact = {
  createdAt?: string | null;
  dimension: string;
  factKey: string;
  id?: string | null;
  matchingEligible: boolean;
  normalizedValue?: string | null;
  reviewState: string;
  sensitivityLevel: string;
  value?: Json | null;
};

type ProfileEmbeddingCardUser = {
  aboutText?: string | null;
  educationSchool?: string | null;
  interests?: string[] | null;
  occupationCompany?: string | null;
};

export type ProfileEmbeddingCardInput = {
  facts: ProfileEmbeddingCardFact[];
  user?: ProfileEmbeddingCardUser | null;
};

const lifestyleDimensions = new Set([
  "daily_rhythm",
  "environment_tolerance",
  "home_labor",
  "social_boundary",
  "communication",
  "preference_elasticity",
]);

const housingDimensions = new Set(["feasibility"]);
const socialDimensions = new Set(["rapport_taste", "trust_context"]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildProfileEmbeddingCard({
  facts,
  user,
}: ProfileEmbeddingCardInput): {
  contentHash: string;
  sourceFactIds: string[];
  text: string;
} {
  const eligibleFacts = facts
    .reduce<Array<ProfileEmbeddingCardFact & { text: string }>>((eligible, fact) => {
      if (!isEmbeddingEligibleFact(fact)) {
        return eligible;
      }
      const text = redactedFactValue(fact);
      if (text.length === 0) {
        return eligible;
      }
      eligible.push({
        ...fact,
        dimension: cleanToken(fact.dimension),
        factKey: cleanToken(fact.factKey),
        text,
      });
      return eligible;
    }, [])
    .sort(compareCardFacts);

  const sourceFactIds = eligibleFacts.flatMap((fact) =>
    fact.id && uuidPattern.test(fact.id) ? [fact.id] : [],
  );

  const sections: string[] = ["# Roommate profile"];
  const lifestyleLines = linesForSection(eligibleFacts, (fact) =>
    lifestyleDimensions.has(fact.dimension),
  );
  const housingLines = linesForSection(eligibleFacts, (fact) =>
    housingDimensions.has(fact.dimension),
  );
  const socialLines = [
    ...syntheticUserLines(user),
    ...linesForSection(eligibleFacts, (fact) =>
      socialDimensions.has(fact.dimension),
    ),
  ];
  const otherLines = linesForSection(
    eligibleFacts,
    (fact) =>
      !lifestyleDimensions.has(fact.dimension) &&
      !housingDimensions.has(fact.dimension) &&
      !socialDimensions.has(fact.dimension),
  );
  const bio = redactPii(user?.aboutText ?? "").slice(0, 300).trim();

  appendSection(sections, "Lifestyle", lifestyleLines);
  appendSection(sections, "Housing", housingLines);
  appendSection(sections, "Social / rapport", socialLines);
  appendSection(sections, "Other signals", otherLines);

  if (bio) {
    appendSection(sections, "Bio", [bio]);
  }

  const text = sections.join("\n").trim();
  const normalizedText = normalizeForHash(text);

  return {
    contentHash: createHash("sha256").update(normalizedText).digest("hex"),
    sourceFactIds: [...new Set(sourceFactIds)],
    text,
  };
}

function isEmbeddingEligibleFact(fact: ProfileEmbeddingCardFact) {
  return (
    fact.matchingEligible &&
    ["approved", "edited"].includes(fact.reviewState) &&
    fact.sensitivityLevel === "standard"
  );
}

function linesForSection(
  facts: Array<ProfileEmbeddingCardFact & { text: string }>,
  predicate: (fact: ProfileEmbeddingCardFact) => boolean,
) {
  return facts.flatMap((fact) => (predicate(fact) ? [`${fact.factKey}: ${fact.text}`] : []));
}

function appendSection(sections: string[], title: string, lines: string[]) {
  const uniqueLines = [
    ...new Set(
      lines.flatMap((line) => {
        const trimmed = line.trim();
        return trimmed ? [trimmed] : [];
      }),
    ),
  ];
  if (uniqueLines.length === 0) {
    return;
  }

  sections.push(`## ${title}`, ...uniqueLines);
}

function syntheticUserLines(user?: ProfileEmbeddingCardUser | null) {
  if (!user) {
    return [];
  }

  return [
    lineForValue("education_school", user.educationSchool),
    lineForValue("occupation_company", user.occupationCompany),
    lineForValue("interests", user.interests),
  ].flatMap((line) => (line ? [line] : []));
}

function lineForValue(key: string, value?: string | string[] | null) {
  const text = Array.isArray(value)
    ? value
        .flatMap((entry) => {
          const redacted = redactPii(entry);
          return redacted ? [redacted] : [];
        })
        .join(", ")
    : redactPii(value ?? "");

  return text ? `${key}: ${text}` : null;
}

function redactedFactValue(fact: ProfileEmbeddingCardFact) {
  const value = fact.normalizedValue?.trim() || jsonToText(fact.value);
  return redactPii(value);
}

function jsonToText(value: Json | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => {
        const text = jsonToText(entry);
        return text ? [text] : [];
      })
      .join(", ");
  }

  return Object.entries(value)
    .flatMap(([key, entry]) => {
      const text = jsonToText(entry);
      return text ? [`${key}: ${text}`] : [];
    })
    .join("; ");
}

function redactPii(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(
      /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      "[redacted phone]",
    )
    .replace(
      /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|way|terrace|ter)\b\.?/gi,
      "[redacted address]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanToken(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function compareCardFacts(
  a: ProfileEmbeddingCardFact & { text: string },
  b: ProfileEmbeddingCardFact & { text: string },
) {
  return (
    a.dimension.localeCompare(b.dimension) ||
    a.factKey.localeCompare(b.factKey) ||
    a.text.localeCompare(b.text) ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
}

function normalizeForHash(text: string) {
  return text.trim().replace(/\s+/g, " ");
}
