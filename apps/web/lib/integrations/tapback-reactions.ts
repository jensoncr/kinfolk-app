// Shared tapback semantics for the text transports. Sendblue and Linq each
// carried a byte-identical copy of this map, which let reaction meaning drift
// per provider — one source of truth keeps a ❤️ meaning "love" everywhere.

const TAPBACK_REACTION_ALIASES: Record<string, string> = {
  "!!": "emphasize",
  "?": "question",
  emphasized: "emphasize",
  exclamation: "emphasize",
  ha_ha: "laugh",
  haha: "laugh",
  heart: "love",
  liked: "like",
  loved: "love",
  question_mark: "question",
  thumbs_down: "dislike",
  thumbs_up: "like",
};

const SUPPORTED_TAPBACK_REACTIONS = new Set([
  "dislike",
  "emphasize",
  "laugh",
  "like",
  "love",
  "question",
]);

/** Canonical reaction for a provider's raw tapback value, or null. */
export function normalizeTapbackReaction(raw: string): string | null {
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const value = TAPBACK_REACTION_ALIASES[normalized] ?? normalized;
  return SUPPORTED_TAPBACK_REACTIONS.has(value) ? value : null;
}
