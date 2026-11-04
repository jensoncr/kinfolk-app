import type { HousingAgentToolContext } from "./types";

// ---------------------------------------------------------------------------
// Score motion — compare the roommate leaderboard around a fact save, so the
// agent can narrate real movement ("that nudged Jack up to 84%") and never
// fabricate it.
// ---------------------------------------------------------------------------

export type TopEdgeScore = { name: string; otherUserId: string; score: number };

export type ScoreMotion = {
  name: string;
  before: number | null;
  after: number;
  becameTopMatch: boolean;
};

export async function loadTopEdgeScores(
  context: Pick<HousingAgentToolContext, "supabase" | "userId">,
): Promise<TopEdgeScore[]> {
  const edgesResult = await context.supabase
    .from("compatibility_edges")
    .select("user_a_id,user_b_id,score")
    .eq("status", "active")
    .or(`user_a_id.eq.${context.userId},user_b_id.eq.${context.userId}`)
    .order("score", { ascending: false })
    .limit(5);
  if (edgesResult.error) throw edgesResult.error;

  const edges = (edgesResult.data ?? []).map((edge) => ({
    otherUserId:
      edge.user_a_id === context.userId ? edge.user_b_id : edge.user_a_id,
    score: Math.round(Number(edge.score)),
  }));
  if (edges.length === 0) return [];

  const usersResult = await context.supabase
    .from("kinfolk_users")
    .select("id,display_name")
    .in(
      "id",
      edges.map((edge) => edge.otherUserId),
    );
  if (usersResult.error) throw usersResult.error;
  const nameById = new Map(
    (usersResult.data ?? []).map((user) => [user.id, user.display_name ?? ""]),
  );

  return edges.map((edge) => ({
    name: (nameById.get(edge.otherUserId) ?? "").split(/\s+/)[0] || "A match",
    otherUserId: edge.otherUserId,
    score: edge.score,
  }));
}

/**
 * The single most narratable movement: the biggest riser of at least 2 points,
 * or a leader change. Returns null when nothing moved enough to mention —
 * the guard against fabricated "that changed things!" filler.
 */
export function describeScoreMotion(
  before: TopEdgeScore[],
  after: TopEdgeScore[],
): ScoreMotion | null {
  if (after.length === 0) return null;
  const beforeByUser = new Map(before.map((edge) => [edge.otherUserId, edge]));

  let best: ScoreMotion | null = null;
  let bestDelta = 0;
  for (const edge of after) {
    const prior = beforeByUser.get(edge.otherUserId);
    if (!prior) continue;
    const delta = edge.score - prior.score;
    if (delta < 2 || delta <= bestDelta) continue;
    bestDelta = delta;
    best = {
      after: edge.score,
      becameTopMatch:
        after[0].otherUserId === edge.otherUserId &&
        before[0]?.otherUserId !== edge.otherUserId,
      before: prior.score,
      name: edge.name,
    };
  }

  return best;
}

export function scoreMotionSummary(motion: ScoreMotion | null) {
  if (!motion) return "";
  const movement =
    motion.before != null
      ? `moved ${motion.before} → ${motion.after}`
      : `landed at ${motion.after}`;
  return `Score motion worth narrating in one natural line: ${motion.name} ${movement}${
    motion.becameTopMatch ? " and is now their top match" : ""
  }.`;
}
