import "server-only";

import { scoreCompatibility } from "./compatibility-scoring";
import type { CompatibilityScore, ProfileFactForScoring } from "./fact-similarity";

export type CompatibilityRerankProfile = {
  displayName: string;
  facts: ProfileFactForScoring[];
  userId: string;
};

export type CompatibilityRerankCandidate = CompatibilityRerankProfile & {
  cosineSimilarity?: number | null;
  semanticRank?: number | null;
};

export type RankedCompatibilityCandidate = CompatibilityRerankCandidate & {
  score: CompatibilityScore;
};

export function rerankCompatibilityCandidates(
  viewer: CompatibilityRerankProfile,
  candidates: CompatibilityRerankCandidate[],
  limit: number,
  savedOverlapByUserId?: Map<string, { sharedAreaCount: number; sharedListingCount: number }>,
): RankedCompatibilityCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCompatibility(
        viewer,
        candidate,
        savedOverlapByUserId?.get(candidate.userId),
      ),
    }))
    .sort(compareRankedCandidates)
    .slice(0, limit);
}

function compareRankedCandidates(
  a: RankedCompatibilityCandidate,
  b: RankedCompatibilityCandidate,
) {
  const scoreDelta = b.score.score - a.score.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return (
    compareDescendingComponent(a, b, "feasibility_gate") ||
    b.score.evidence.length - a.score.evidence.length ||
    compareDescendingComponent(a, b, "trust_bridge_strength") ||
    a.score.risks.length - b.score.risks.length ||
    compareNullableAscending(a.semanticRank, b.semanticRank) ||
    compareUserId(a.userId, b.userId)
  );
}

function compareDescendingComponent(
  a: RankedCompatibilityCandidate,
  b: RankedCompatibilityCandidate,
  component: string,
) {
  return (b.score.components[component] ?? 0) - (a.score.components[component] ?? 0);
}

function compareNullableAscending(
  a: number | null | undefined,
  b: number | null | undefined,
) {
  return (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY);
}

function compareUserId(a: string, b: string) {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}
