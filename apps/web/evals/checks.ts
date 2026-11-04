import type { CompletedTurn } from "./housing-agent-adapter";

// Deterministic transcript checks, codified from the 2026-06 adversarial
// review's failure taxonomy. These run inside scenario scripts so a regression
// fails the eval even when an LLM judge would wave it through.

const MARKDOWN_PATTERN = /(\*\*|__|^#{1,6}\s|```|^\s*[-*•·]\s)/m;

export function assertPlainText(reply: string) {
  if (MARKDOWN_PATTERN.test(reply)) {
    throw new Error(
      `Reply contains markdown/list formatting, which iMessage renders literally: ${reply.slice(0, 200)}`,
    );
  }
}

export function assertNoCompetitorLinks(reply: string) {
  if (/redfin\.com|zillow\.com|apartments\.com/i.test(reply)) {
    throw new Error(
      `Reply hands the user a competitor URL instead of a Kinfolk link: ${reply.slice(0, 200)}`,
    );
  }
}

export function assertHasKinfolkListingLink(reply: string) {
  if (!/\/l\/[A-Za-z0-9]+/.test(reply)) {
    throw new Error(
      `Reply should contain a tappable Kinfolk /l/ shortlink but does not: ${reply.slice(0, 200)}`,
    );
  }
}

// Fabricated match REASONS, not just fabricated names. The live failure this
// gate encodes: a user two facts into onboarding was told "you are both on the
// same page about how you treat your space" — a home-labor compatibility claim
// get_matches never returned evidence for. A claim is only checked when it is
// (a) attached to a returned roommate's name, (b) mutual ("both", "line up",
// "similar"...), and (c) about a scoreable dimension — plain profile facts
// ("Priya is usually asleep by 10:45") are not compatibility claims and pass.
const MUTUALITY_PATTERN =
  /\b(?:both|you two|same page|line[sd]? up|align(?:ed|s)?|match(?:es)? on|share[ds]?|similar|compatible|in sync|overlap(?:s|ping)?)\b/i;

const REASON_DIMENSIONS: Array<{ labels: string[]; pattern: RegExp }> = [
  {
    labels: ["home labor"],
    pattern: /\b(?:tidy|tidiness|tidier|clean|cleanliness|chores|housework|treat your space|keeping things)\b/i,
  },
  {
    labels: ["daily rhythm"],
    pattern: /\b(?:rhythms?|schedules?|sleep|asleep|early bird|night owl|wake|home habits)\b/i,
  },
  { labels: ["guests"], pattern: /\b(?:guests?|overnight|host(?:ing)?)\b/i },
  { labels: ["communication"], pattern: /\bcommunicat\w*\b/i },
  {
    labels: ["environment"],
    pattern: /\b(?:noise|quiet|loud|home environment)\b/i,
  },
  {
    labels: ["location"],
    pattern: /\b(?:neighborhoods?|location|areas?)\b/i,
  },
  { labels: ["age comfort"], pattern: /\bage\b/i },
  {
    labels: ["interests", "music taste", "media taste", "aesthetic taste"],
    pattern: /\b(?:interests?|hobbies|music|taste|aesthetic)\b/i,
  },
  {
    labels: ["work or school", "communities", "trust bridge"],
    pattern: /\b(?:work(?:place)?|school|university|communit\w+|mutuals?)\b/i,
  },
];

export function assertMatchReasonsGrounded(turn: CompletedTurn) {
  const roommates = turn.toolResults
    .filter((result) => result.toolName === "get_matches")
    .flatMap((result) => {
      const data = (result.data as Record<string, unknown>).roommates;
      return Array.isArray(data) ? data : [];
    })
    .map((roommate) => {
      const entry = roommate as {
        evidence?: Array<{ label?: unknown }>;
        name?: unknown;
      };
      return {
        evidenceLabels: new Set(
          (entry.evidence ?? []).map((point) =>
            String(point.label ?? "").toLowerCase(),
          ),
        ),
        firstName: String(entry.name ?? "").split(/\s+/)[0] ?? "",
      };
    })
    .filter((roommate) => roommate.firstName.length > 1);

  if (roommates.length === 0) {
    return;
  }

  const chunks = turn.reply.split(/(?<=[.!?])\s+|\n+/);
  for (const chunk of chunks) {
    if (!MUTUALITY_PATTERN.test(chunk)) {
      continue;
    }
    for (const roommate of roommates) {
      if (!new RegExp(`\\b${roommate.firstName}\\b`, "i").test(chunk)) {
        continue;
      }
      for (const dimension of REASON_DIMENSIONS) {
        if (!dimension.pattern.test(chunk)) {
          continue;
        }
        const grounded = dimension.labels.some((label) =>
          roommate.evidenceLabels.has(label),
        );
        if (!grounded) {
          throw new Error(
            `Reply claims ${roommate.firstName} is compatible on "${dimension.labels[0]}" but get_matches returned no such evidence: ${chunk.slice(0, 160)}`,
          );
        }
      }
    }
  }
}

// The reality guard's contract, asserted from outside: any claim of a saved
// preference must be backed by a successful update_prefs write in that turn.
export function assertNoFakeWriteClaims(turn: CompletedTurn) {
  const claimsSave =
    /\b(?:i(?:'ve| have| just)?\s+(?:saved|noted|recorded|updated|adjusted)|(?:saved|noted|recorded|updated|adjusted)\s+(?:your|that|this|it))\b/i.test(
      turn.reply,
    );
  if (!claimsSave) {
    return;
  }
  const wrote = turn.toolResults.some((result) => {
    if (result.toolName !== "update_prefs" || !result.ok) {
      return false;
    }
    const persisted = (result.data as Record<string, unknown>).persisted;
    return Array.isArray(persisted) && persisted.length > 0;
  });
  if (!wrote) {
    throw new Error(
      `Reply claims a save but no update_prefs write succeeded this turn: ${turn.reply.slice(0, 200)}`,
    );
  }
}
