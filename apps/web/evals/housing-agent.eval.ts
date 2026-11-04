import { afterAll, describe, expect, it } from "vitest";
import scenario from "@langwatch/scenario";
import {
  createHousingAgentHarness,
  resetEvalIdentity,
} from "./housing-agent-adapter";
import { judgeConversationSafely } from "./judge";
import { judgeModel, simulatorModel } from "./models";
import { finalizeRun, recordScenario } from "./reporter";
import { SCENARIOS } from "./scenarios";
import { renderTranscript } from "./transcript";

// The improvement loop's measurement half. Every scenario in evals/scenarios.ts
// runs against the REAL agent (real model, tools, data), then gets graded twice:
// a hard pass/fail gate (scenario criteria + deterministic checks) and the
// seven-dimension judge (evals/judge.ts). Results log to a Braintrust
// experiment and evals/reports/latest.json — see evals/README.md for the
// protocol that turns a red run into the next prompt/tool/data change.
//
// Run: npm run eval:agent            (all scenarios)
//      npm run eval:agent -- -t link (one scenario)

const SET_ID = "kinfolk-housing-agent";

describe("housing agent simulations", () => {
  afterAll(async () => {
    await finalizeRun();
  });

  for (const spec of SCENARIOS) {
    it(spec.name, async () => {
      await resetEvalIdentity();
      const harness = createHousingAgentHarness();
      const gateFailures: string[] = [];

      // Scenarios whose gate is fully deterministic end with succeed() — an
      // LLM pass/fail gate would only add flake on top of the checks.
      const hasJudgeGate = spec.criteria.length > 0;
      const result = await scenario.run({
        agents: [
          harness.adapter,
          // maxTokens matters beyond cost: OpenRouter reserves the full
          // requested headroom against the credit balance, and the judge's
          // 65k default made low-balance runs die mid-suite.
          scenario.userSimulatorAgent({ maxTokens: 800, model: simulatorModel() }),
          ...(hasJudgeGate
            ? [
                scenario.judgeAgent({
                  criteria: spec.criteria,
                  maxTokens: 2_000,
                  model: judgeModel(),
                }),
              ]
            : []),
        ],
        description: spec.description,
        maxTurns: spec.maxTurns,
        name: spec.name,
        script: [
          ...spec.script({ gateFailures, harness }),
          hasJudgeGate
            ? scenario.judge()
            : scenario.succeed("deterministic gates hold"),
        ],
        setId: SET_ID,
      });

      const transcript = renderTranscript(result.messages, harness.turns);
      const verdict = await judgeConversationSafely({
        scenarioDescription: spec.description,
        transcript,
      });
      const gatePassed = result.success && gateFailures.length === 0;
      recordScenario({
        gatePassed,
        gateReasoning: [result.reasoning ?? "", ...gateFailures]
          .filter(Boolean)
          .join(" | "),
        scenario: spec.name,
        tags: spec.tags,
        transcript,
        verdict,
      });

      expect(
        gatePassed,
        [result.reasoning ?? "", ...gateFailures].filter(Boolean).join("\n"),
      ).toBe(true);
    });
  }
});
