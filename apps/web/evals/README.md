# Housing agent simulation evals — the self-improvement loop

**The loop:** run → read the dossier → change ONE thing → rerun → diff → commit.

1. `npm run eval:agent` — every scenario in `scenarios.ts` runs against the real
   agent. Each conversation gets a hard pass/fail gate plus seven judge scores
   (accuracy, formatting, usefulness, tone, proactivity, media, safety — rubric
   in `judge.ts`, tuned to the Poke standard for iMessage agents).
2. Read the **improvement dossier**: printed at the end of the run and written
   to `evals/reports/latest.json`. Worst scenarios first, each with the judge's
   `top_issue`, a `suspected_cause` (prompt_or_soul | tool_gap | data_gap |
   model_capability), and a `one_line_fix`. Full transcripts + per-dimension
   reasoning live in the **Braintrust experiment** the run creates
   (`loop-<timestamp>-<sha>`), diffable against every previous run.
3. Intervene where the cause points: `lib/text-agent/soul.md` / the system
   prompt in `loop.ts` (behavior), `lib/text-agent/tool-belt/` (capability),
   listings enrichment scripts (data), or `KINFOLK_TEXT_AGENT_LOOP_MODEL`
   (model — set the env var and rerun to A/B models as two experiments).
4. Rerun. The experiment metadata pins git SHA + model, so score deltas are
   attributable. Commit the change together with its scorecard delta.

Production closes the same loop from the other side: live turns trace to the
same Braintrust project (Logs), a bad prod conversation becomes a new scenario
in `scenarios.ts` (seed the first user message verbatim), and the regression
stays caught forever.

Simulated-renter conversations against the **real** iMessage agent loop (real
model, real tools, real listings data), graded by deterministic checks plus an
LLM judge. Built on [`@langwatch/scenario`](https://github.com/langwatch/scenario);
scenarios codify the failure taxonomy from an earlier adversarial review of the
agent.

```bash
npm run eval:agent                 # whole suite
npm run eval:agent -- -t "link"    # one scenario
```

## Required environment

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Agent under test + simulator + judge models |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Real tools (search, prefs) hit the real database |
| `NEXT_PUBLIC_KINFOLK_BASE_URL` | Shortlinks/cards in replies |
| `KINFOLK_EVAL_USER_ID` | **Dedicated eval user** — `update_prefs` writes real facts to this profile |
| `KINFOLK_EVAL_THREAD_ID` | Dedicated eval thread for the same user |

Optional: `KINFOLK_EVAL_SIMULATOR_MODEL` (default `google/gemini-3.1-flash`),
`KINFOLK_EVAL_JUDGE_MODEL` (default `anthropic/claude-sonnet-5`),
`LANGWATCH_API_KEY` (uploads runs to LangWatch's simulation UI — optional),
`BRAINTRUST_API_KEY` (eval turns trace to Braintrust like prod turns do).

`.env.local` is loaded automatically (`evals/setup.ts`); real env vars win.

## Why a dedicated eval identity

`runHousingAgentTurn` runs with writes enabled — exactly like production — so
preference saves are real rows. Pointing the harness at a throwaway user keeps
simulations honest (the reality-guard scenario asserts an actual persisted
write) without touching a real person's profile. Conversation history itself
stays in memory per scenario, so runs don't pollute the thread's messages.

## Cost & cadence

A full run is ~25–40 model calls (agent turns + simulator + judge). With the
default models that's a few cents per run. Wired for: local runs before prompt
changes, and the manual `agent-evals` GitHub workflow (see
`.github/workflows/agent-evals.yml`).

## Adding a scenario

1. Start from a production failure (Braintrust trace or `text_agent_runs` row).
2. Add a scenario to `housing-agent.eval.ts`: seed the first user message
   verbatim from the real conversation, let the simulator improvise the rest.
3. Grade with a deterministic check in `evals/checks.ts` when the failure is
   mechanical (links, markdown, fake writes); reserve judge criteria for
   judgment calls (tone, grounding, resolution).
