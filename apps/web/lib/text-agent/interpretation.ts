import { z } from "zod";
import { normalizeOpenRouterModelId, readOpenRouterApiKey } from "../integrations/openrouter-client";
import { captureProductEvent } from "../integrations/posthog-server";
import { firstConfiguredEnvValue } from "../shared/env";
import { completeAgentChat } from "./model-client";
import {
  isExplicitListingAsk,
  isExplicitMediaRequest,
  isExplicitRoommateMatchAsk,
} from "./message-intent";

// ---------------------------------------------------------------------------
// Structured interpretation of the user's inbound message.
//
// This is the semantic boundary the onboarding gate and media policy sit on:
// one classification per turn, produced by a model call, consumed as data.
// The gate asks speech-act questions (is this a directive to fetch inventory,
// an assertion of a preference, a negation, a tangent?) that depend on clause
// scope, anaphora, and context — regexes over surface forms cannot answer
// them, and trying is what produced the 73-commit patch loop this module
// replaces (docs/research/onboarding-gate/01-pr31-failure-corpus.md).
//
// A phrase the classifier gets wrong becomes an eval fixture
// (evals/intent-fixtures.ts), never a new pattern. The legacy regexes in
// message-intent.ts survive only as the degraded-mode fallback when the
// classifier call fails. Degraded mode is conservative, not identical to any
// prior system: asks the regexes miss read as intake answers, which keeps
// fetch tools closed mid-interview (withholding a search is recoverable; a
// fabricated result is not). Fallback turns emit a product event so a
// sustained classifier outage is visible in PostHog, not just server logs.
// ---------------------------------------------------------------------------

export const inboundIntentKinds = [
  "intake_answer",
  "listing_request",
  "listing_refinement",
  "match_request",
  "roommate_detail",
  "negated_request",
  "housing_tangent",
  "other_tangent",
  "skip",
] as const;

export type InboundIntentKind = (typeof inboundIntentKinds)[number];

export type InboundIntent = {
  kind: InboundIntentKind;
  /** Neighborhood/area named in an explicit listing ask, from this message only. */
  area: string | null;
  /** Monthly budget ceiling named in an explicit listing ask ("under 3k" → 3000). */
  maxRent: number | null;
  bedrooms: number | null;
  /** Person the user is asking about; only set for roommate_detail. */
  personName: string | null;
  /** True only when the user asked to SEE cards/photos/profiles this turn. */
  wantsMediaCards: boolean;
  source: "classifier" | "fallback";
};

/** Directive to fetch apartment inventory (explicitly asked, this turn). */
export function asksForListings(intent: InboundIntent) {
  return intent.kind === "listing_request" || intent.kind === "listing_refinement";
}

/** Directive to fetch roommate matches or detail on a surfaced person. */
export function asksAboutRoommates(intent: InboundIntent) {
  return intent.kind === "match_request" || intent.kind === "roommate_detail";
}

const intentSchema = z.object({
  area: z.string().trim().min(1).nullish(),
  bedrooms: z.number().int().positive().max(10).nullish(),
  kind: z.enum(inboundIntentKinds),
  maxRent: z.number().positive().max(100_000).nullish(),
  personName: z.string().trim().min(1).nullish(),
  wantsMediaCards: z.boolean().nullish(),
});

const DEFAULT_INTENT_MODEL = "google/gemini-3.1-flash-lite";

// Deliberately NOT chained to the reply-model env vars: a future reply-model
// upgrade (e.g. to a reasoning model whose thinking would eat the 200-token
// output cap and produce empty JSON) must never silently repoint a JSON-only
// classifier. The classifier changes model only when someone changes it.
function resolveInterpretationModel() {
  return normalizeOpenRouterModelId(
    firstConfiguredEnvValue(
      process.env.KINFOLK_TEXT_AGENT_INTENT_MODEL,
      DEFAULT_INTENT_MODEL,
    ),
  );
}

const CLASSIFIER_SYSTEM_PROMPT = `You classify one inbound text message to Kinfolk, an SF housing agent that helps people find roommates and apartments. Mid-conversation the user may be answering an onboarding question, asking for something, or chatting. Output STRICT JSON only — no prose, no code fences:
{"kind":"...","area":string|null,"maxRent":number|null,"bedrooms":number|null,"personName":string|null,"wantsMediaCards":boolean}

kind — exactly one of:
- "intake_answer": states a preference or answers the question they were asked, even declaratively ("i'm looking for a two bedroom in the mission", "$3000 max", "would rather go solo", "where I work is in SoMa"). Stating what they want is NOT a command to search.
- "listing_request": directs Kinfolk to fetch or show apartment inventory ("show me places under 2k", "recommend me an apartment in nob hill", "any 2brs under 3k?", "what can I find in Oakland?"). Classify by speech act — a directive/question about available inventory — NOT by whether Kinfolk serves the named area.
- "listing_refinement": narrows or redirects listing work from the immediately preceding assistant turn ("what about the marina?", "anything under 3k", "any cheaper ones?"). Requires that previous assistant message to contain listing results or a listing offer; otherwise it is not a refinement.
- "match_request": asks for roommate matches or compatible people ("who are my best matches?"). A positive request inside a negated clause still counts ("I don't want to miss any roommate matches — show me the latest").
- "roommate_detail": asks about a specific person Kinfolk already surfaced. If the name (even lowercase) does not appear in the previous assistant message, it is NOT roommate_detail.
- "negated_request": declines or negates fetching, with no positive ask anywhere in the message ("no more roommate matches", "I'd rather not see roommate matches").
- "housing_tangent": housing question that is not a fetch directive ("tell me more about Hayes Valley", "is renters insurance worth it?").
- "other_tangent": not about housing inventory or roommates, including non-housing place searches ("find me a coffee shop near the mission", "look near my dentist").
- "skip": asks to skip the current question ("skip", "pass", "no preference").

Negation is clause-scoped: "I don't want a place with stairs. Can you show me roommate matches?" → match_request.
area/maxRent/bedrooms: fill only for listing_request/listing_refinement. For listing_request, from THIS message only ("under 3k" → maxRent 3000). For listing_refinement, start from the constraints visible in the previous assistant message's listing work and override with what THIS message changes — "anything cheaper?" after a Marina search keeps area "Marina" and lowers maxRent. Otherwise null.
personName: only for roommate_detail, otherwise null.
wantsMediaCards: true only when they ask to SEE cards, photos, pictures, or profiles this turn.`;

/**
 * Degraded mode: the pre-classifier regex heuristics, mapped onto the intent
 * shape. Conservative by design — an unrecognized message reads as an intake
 * answer, which keeps fetch tools closed mid-interview (withholding a search
 * is recoverable; a studio dump built on a guess is not).
 */
export function fallbackInterpretation(body: string): InboundIntent {
  const matchAsk = isExplicitRoommateMatchAsk(body);
  const listingAsk = isExplicitListingAsk(body);
  return {
    area: null,
    bedrooms: null,
    kind: matchAsk ? "match_request" : listingAsk ? "listing_request" : "intake_answer",
    maxRent: null,
    personName: null,
    source: "fallback",
    wantsMediaCards: isExplicitMediaRequest(body),
  };
}

export async function interpretInboundMessage({
  body,
  metadata,
  previousAssistantMessage,
}: {
  body: string;
  metadata?: { runId?: string; threadId?: string; userId?: string };
  previousAssistantMessage?: string | null;
}): Promise<InboundIntent> {
  if (!readOpenRouterApiKey()) {
    return fallbackInterpretation(body);
  }

  const degrade = (reason: string) => {
    try {
      captureProductEvent({
        distinctId: metadata?.userId ?? "text-agent",
        event: "text_agent_intent_fallback",
        properties: { reason, runId: metadata?.runId, threadId: metadata?.threadId },
      });
    } catch {
      // Observability must never take down interpretation.
    }
    return fallbackInterpretation(body);
  };

  try {
    const response = await completeAgentChat({
      maxOutputTokens: 200,
      messages: [
        { content: CLASSIFIER_SYSTEM_PROMPT, role: "system" },
        {
          // Head-biased clamp: the grounding value of the previous turn is
          // the listing/name prose at its START; the tail is usually just
          // the canonical intake question.
          content: JSON.stringify({
            previous_assistant_message: (previousAssistantMessage ?? "").slice(0, 1600) || null,
            user_message: body.slice(0, 1600),
          }),
          role: "user",
        },
      ],
      metadata,
      model: resolveInterpretationModel(),
      operation: "message_interpretation",
      temperature: 0,
      timeoutMs: 8_000,
    });

    const raw = response.data.choices?.[0]?.message?.content ?? "";
    const jsonText = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = intentSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      console.warn("[text-agent-interpretation] classifier output rejected", {
        issues: parsed.error.issues.slice(0, 3),
      });
      return degrade("schema_rejected");
    }

    const explicitListingKind =
      parsed.data.kind === "listing_request" || parsed.data.kind === "listing_refinement";
    // A declined or skipped turn never pulls media, whatever the classifier
    // read into ask-shaped verbs ("I'd rather not SEE roommate matches") —
    // negation never triggers media recovery (corpus Table 1).
    const declineKind =
      parsed.data.kind === "negated_request" || parsed.data.kind === "skip";
    return {
      area: explicitListingKind ? (parsed.data.area ?? null) : null,
      bedrooms: explicitListingKind ? (parsed.data.bedrooms ?? null) : null,
      kind: parsed.data.kind,
      maxRent: explicitListingKind ? (parsed.data.maxRent ?? null) : null,
      personName: parsed.data.kind === "roommate_detail" ? (parsed.data.personName ?? null) : null,
      source: "classifier",
      wantsMediaCards: declineKind ? false : (parsed.data.wantsMediaCards ?? false),
    };
  } catch (error) {
    console.warn("[text-agent-interpretation] classifier unavailable, using fallback", {
      error,
    });
    return degrade("call_failed");
  }
}
