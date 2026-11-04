import type { Json } from "@/lib/supabase/types";
import type { CompatibilityScore } from "./fact-similarity";

/**
 * The score_components ride-along contract.
 *
 * compatibility_edges has no dedicated columns for confidence metadata, so
 * coverage / score_low / score_high travel inside the score_components jsonb
 * next to the real dimension scores. This module is the single owner of that
 * contract: enrichment-store writes through `foldScoreMetaIntoComponents`,
 * readers recover the metadata through `parseScoreMeta`, and anything that
 * renders components filters `SCORE_META_KEYS` out first.
 */
export const SCORE_META_KEYS = ["coverage", "score_low", "score_high"] as const;

/** Writer side: dimension components plus the ride-along confidence meta. */
export function foldScoreMetaIntoComponents(score: CompatibilityScore) {
  return {
    ...score.components,
    coverage: score.coverage,
    score_low: score.scoreLow,
    score_high: score.scoreHigh,
  };
}

export type ScoreMeta = {
  scoreLow: number | null;
  scoreHigh: number | null;
  coverage: number | null;
};

/**
 * Reader side: recover the confidence metadata from a persisted
 * score_components value. All-null for edges computed before coverage existed.
 */
export function parseScoreMeta(value: Json): ScoreMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { scoreLow: null, scoreHigh: null, coverage: null };
  }
  const source = value as Record<string, unknown>;
  const num = (key: string) => {
    const raw = source[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  };
  const scoreLow = num("score_low");
  const scoreHigh = num("score_high");
  return {
    scoreLow: scoreLow == null ? null : Math.round(scoreLow),
    scoreHigh: scoreHigh == null ? null : Math.round(scoreHigh),
    coverage: num("coverage"),
  };
}
