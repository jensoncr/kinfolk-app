import { afterEach, describe, expect, it, vi } from "vitest";
import { rerankCompatibilityCandidates } from "./profile-compatibility-rerank";
import type {
  CompatibilityScore,
  ProfileFactForScoring,
} from "./fact-similarity";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.doUnmock("./compatibility-scoring");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("rerankCompatibilityCandidates", () => {
  it("lets scoreCompatibility outrank the ANN order", () => {
    const viewer = {
      displayName: "Jenson",
      facts: [
        scoringFact({
          dimension: "trust_context",
          factKey: "verified_work_or_school",
          value: "University of Notre Dame",
        }),
        scoringFact({
          dimension: "communication",
          factKey: "communication_style",
          value: "direct, analytical, iterative",
        }),
        scoringFact({
          dimension: "home_labor",
          factKey: "cleanliness",
          value: "very tidy",
        }),
      ],
      userId: "jenson",
    };
    const weakSemanticFirst = {
      cosineSimilarity: 0.92,
      displayName: "Weak semantic neighbor",
      facts: [
        scoringFact({
          dimension: "trust_context",
          factKey: "verified_work_or_school",
          value: "Different school",
        }),
        scoringFact({
          dimension: "communication",
          factKey: "communication_style",
          value: "indirect and conflict avoidant",
        }),
      ],
      semanticRank: 1,
      userId: "weak",
    };
    const jack = {
      cosineSimilarity: 0.81,
      displayName: "Jack Munhall",
      facts: [
        scoringFact({
          dimension: "trust_context",
          factKey: "verified_work_or_school",
          value: "University of Notre Dame",
        }),
        scoringFact({
          dimension: "communication",
          factKey: "communication_style",
          value: "direct, concise, analytical",
        }),
        scoringFact({
          dimension: "social_boundary",
          factKey: "independence_level",
          value: "values autonomy and coexistence",
        }),
      ],
      semanticRank: 2,
      userId: "jack",
    };

    const ranked = rerankCompatibilityCandidates(
      viewer,
      [weakSemanticFirst, jack],
      2,
    );

    expect(ranked[0]?.userId).toBe("jack");
    expect(ranked[0]?.score.score).toBeGreaterThan(ranked[1]?.score.score ?? 0);
  });

  it("uses deterministic tie-breaks before semantic rank", async () => {
    const { rerankCompatibilityCandidates: rerankWithMockedScores } =
      await loadRerankerWithScores({
        "better-evidence": compatibilityScore({
          evidenceCount: 3,
          feasibilityGate: 0.8,
          score: 82,
          trustBridgeStrength: 0.4,
        }),
        "better-feasibility": compatibilityScore({
          evidenceCount: 1,
          feasibilityGate: 0.9,
          score: 82,
          trustBridgeStrength: 0.4,
        }),
        "semantic-first": compatibilityScore({
          evidenceCount: 1,
          feasibilityGate: 0.8,
          score: 82,
          trustBridgeStrength: 0.4,
        }),
      });

    const ranked = rerankWithMockedScores(
      rerankProfile("viewer"),
      [
        rerankCandidate("semantic-first", { semanticRank: 1 }),
        rerankCandidate("better-evidence", { semanticRank: 9 }),
        rerankCandidate("better-feasibility", { semanticRank: 10 }),
      ],
      3,
    );

    expect(ranked.map((candidate) => candidate.userId)).toEqual([
      "better-feasibility",
      "better-evidence",
      "semantic-first",
    ]);
  });

  it("does not let close cosine similarities change final score order", async () => {
    const { rerankCompatibilityCandidates: rerankWithMockedScores } =
      await loadRerankerWithScores({
        alpha: compatibilityScore({ score: 78 }),
        zulu: compatibilityScore({ score: 78 }),
      });

    const ranked = rerankWithMockedScores(
      rerankProfile("viewer"),
      [
        rerankCandidate("zulu", {
          cosineSimilarity: 0.9241,
          semanticRank: null,
        }),
        rerankCandidate("alpha", {
          cosineSimilarity: 0.924,
          semanticRank: null,
        }),
      ],
      2,
    );

    expect(ranked.map((candidate) => candidate.userId)).toEqual([
      "alpha",
      "zulu",
    ]);
  });
});

async function loadRerankerWithScores(
  scoresByUserId: Record<string, CompatibilityScore>,
) {
  vi.resetModules();
  vi.doMock("./compatibility-scoring", () => ({
    scoreCompatibility: vi.fn(
      (
        _viewer: unknown,
        candidate: {
          userId: string;
        },
      ) => {
        const score = scoresByUserId[candidate.userId];
        if (!score) {
          throw new Error(`Missing mocked compatibility score for ${candidate.userId}`);
        }

        return score;
      },
    ),
  }));

  return import("./profile-compatibility-rerank");
}

function rerankProfile(userId: string) {
  return {
    displayName: userId,
    facts: [],
    userId,
  };
}

function rerankCandidate(
  userId: string,
  metadata: {
    cosineSimilarity?: number | null;
    semanticRank?: number | null;
  } = {},
) {
  return {
    displayName: userId,
    facts: [],
    userId,
    ...metadata,
  };
}

function compatibilityScore({
  evidenceCount = 1,
  feasibilityGate = 0.8,
  riskCount = 0,
  score,
  trustBridgeStrength = 0.5,
}: {
  evidenceCount?: number;
  feasibilityGate?: number;
  riskCount?: number;
  score: number;
  trustBridgeStrength?: number;
}): CompatibilityScore {
  return {
    components: {
      feasibility_gate: feasibilityGate,
      trust_bridge_strength: trustBridgeStrength,
    },
    evidence: Array.from({ length: evidenceCount }, (_, index) => ({
      detail: `Evidence ${index}`,
      label: `Evidence ${index}`,
    })),
    risks: Array.from({ length: riskCount }, (_, index) => ({
      detail: `Risk ${index}`,
      label: `Risk ${index}`,
    })),
    score,
    scoreLow: Math.max(0, score - 10),
    scoreHigh: Math.min(100, score + 10),
    coverage: 0.8,
  };
}

function scoringFact({
  dimension,
  factKey,
  value,
}: {
  dimension: string;
  factKey: string;
  value: string;
}): ProfileFactForScoring {
  return {
    confidence: 0.9,
    createdAt: "2026-05-25T00:00:00.000Z",
    dimension,
    evidenceExcerpt: value,
    factKey,
    id: `${dimension}:${factKey}:${value}`,
    importance: 0.8,
    matchingEligible: true,
    normalizedValue: value.toLowerCase(),
    reviewState: "approved",
    sensitivityLevel: "standard",
    sourceImportProvider: "web",
    userId: "fixture",
    value,
  };
}
