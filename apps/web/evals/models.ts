import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Simulator and judge run through the same OpenRouter account as the agent.
// The simulator can be cheap; the judge should be a stronger model than the
// agent under test or it will grade its own blind spots as passes.
// Must be a real OpenRouter id — the non-lite "gemini-3.1-flash" is not one.
const DEFAULT_SIMULATOR_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-5";

function openrouter() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required to run agent evals.");
  }
  return createOpenRouter({ apiKey });
}

export function simulatorModel() {
  return openrouter().chat(
    process.env.KINFOLK_EVAL_SIMULATOR_MODEL?.trim() || DEFAULT_SIMULATOR_MODEL,
  );
}

export function judgeModel() {
  return openrouter().chat(
    process.env.KINFOLK_EVAL_JUDGE_MODEL?.trim() || DEFAULT_JUDGE_MODEL,
  );
}
