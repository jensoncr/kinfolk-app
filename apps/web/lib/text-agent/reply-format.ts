// Pure formatting + SMS-text helpers for the text agent's replies. Extracted
// from text-agent-store.ts: these are leaf functions (no Supabase, no side
// effects) that turn profile facts into the compact strings the SMS agent
// sends. Keeping them here trims the store's orchestration core.

export function readNumberField(
  value: Record<string, string | number | boolean | null>,
  key: string,
) {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}
