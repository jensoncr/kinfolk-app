import type { SupabaseServiceClient } from "./store-types";

/**
 * Living-plan context for the agent prompt. The plan is latent FUTURE intent
 * (possibly outside SF) — it must inform conversation, not mutate the current
 * SF-only search profile. Keep this module a leaf: no @/ imports beyond types,
 * so loop.test's module mocks stay untouched.
 */

const MOVE_HORIZON_LABELS: Record<string, string> = {
  now: "now",
  lt_3mo: "within 3 months",
  "3_6mo": "in 3–6 months",
  "6_12mo": "in 6–12 months",
  "1_2yr": "in 1–2 years",
  exploring: "just exploring",
};

const FLEXIBILITY_LABELS: Record<string, string> = {
  locked: "locked to a date",
  some: "some give on timing",
  flexible: "flexible timing",
  ready: "could move fast",
};

export type LivingPlanContextRow = {
  future_cities: string[] | null;
  move_horizon: string | null;
  relocation_flexibility: string | null;
  intent_note: string | null;
  intent_confirmed_at: string | null;
};

/** One prompt-ready sentence fragment, or "" when the plan holds nothing. */
export function summarizeLivingPlanForPrompt(
  row: LivingPlanContextRow | null,
): string {
  if (!row || !row.intent_confirmed_at) return "";

  const parts: string[] = [];
  const cities = (row.future_cities ?? []).map((city) => city.trim()).filter(Boolean);
  if (cities.length > 0) parts.push(`thinking about ${cities.join(", ")}`);

  const horizon = row.move_horizon ? MOVE_HORIZON_LABELS[row.move_horizon] : undefined;
  if (horizon) parts.push(`timing ${horizon}`);

  const flexibility = row.relocation_flexibility
    ? FLEXIBILITY_LABELS[row.relocation_flexibility]
    : undefined;
  if (flexibility) parts.push(flexibility);

  const note = row.intent_note?.trim();
  if (note) parts.push(`their note: "${note.slice(0, 240)}"`);

  return parts.join("; ");
}

export async function loadLivingPlanPromptSummary(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<string> {
  const result = await supabase
    .from("living_plans")
    .select("future_cities, move_horizon, relocation_flexibility, intent_note, intent_confirmed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  return summarizeLivingPlanForPrompt(result.data);
}
