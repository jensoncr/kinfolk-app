import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JUDGE_DIMENSIONS, type JudgeVerdict } from "./judge";

// One suite run = one Braintrust experiment (diffable run-over-run in the UI)
// + one local dossier in evals/reports/. The dossier is what drives the next
// iteration: worst dimensions first, each failure with the judge's suspected
// cause and surgical fix. Metadata pins the run to a git SHA + model so score
// deltas are attributable to a specific change.

export type ScenarioRecord = {
  gatePassed: boolean;
  gateReasoning: string;
  scenario: string;
  tags: string[];
  transcript: string;
  verdict: JudgeVerdict;
};

const records: ScenarioRecord[] = [];

export function recordScenario(record: ScenarioRecord) {
  records.push(record);
}

export async function finalizeRun() {
  if (records.length === 0) {
    return;
  }
  const runMeta = buildRunMetadata();
  await logToBraintrust(runMeta).catch((error) => {
    console.error("[reporter] Braintrust experiment logging failed", error);
  });
  writeDossier(runMeta);
  records.length = 0;
}

function buildRunMetadata() {
  const sha = safeExec("git rev-parse --short HEAD") || "unknown";
  const dirty = safeExec("git status --porcelain") ? "-dirty" : "";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    experimentName: `loop-${timestamp}-${sha}${dirty}`,
    model:
      process.env.KINFOLK_TEXT_AGENT_LOOP_MODEL?.trim() ||
      process.env.KINFOLK_TEXT_AGENT_MODEL?.trim() ||
      "google/gemini-3.1-flash-lite",
    sha: `${sha}${dirty}`,
    timestamp,
  };
}

async function logToBraintrust(runMeta: ReturnType<typeof buildRunMetadata>) {
  if (!process.env.BRAINTRUST_API_KEY?.trim()) {
    return;
  }
  const { init } = await import("braintrust");
  const experiment = init(
    process.env.BRAINTRUST_PROJECT?.trim() || "kinfolk-imessage-agent",
    {
      experiment: runMeta.experimentName,
      metadata: { agent_model: runMeta.model, git_sha: runMeta.sha },
    },
  );
  for (const record of records) {
    const scores: Record<string, number> = {
      gate: record.gatePassed ? 1 : 0,
    };
    for (const dimension of JUDGE_DIMENSIONS) {
      const score = record.verdict.dimensions[dimension].score;
      if (score !== null) {
        scores[dimension] = score;
      }
    }
    experiment.log({
      input: record.scenario,
      metadata: {
        gate_reasoning: record.gateReasoning,
        judge_reasoning: record.verdict.dimensions,
        one_line_fix: record.verdict.one_line_fix,
        suspected_cause: record.verdict.suspected_cause,
        tags: record.tags,
        top_issue: record.verdict.top_issue,
      },
      output: record.transcript,
      scores,
    });
  }
  const summary = await experiment.summarize();
  console.log(
    `[reporter] Braintrust experiment: ${summary.experimentUrl ?? runMeta.experimentName}`,
  );
}

function writeDossier(runMeta: ReturnType<typeof buildRunMetadata>) {
  const dir = resolve(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });

  const means: Record<string, { count: number; total: number }> = {};
  for (const record of records) {
    for (const dimension of JUDGE_DIMENSIONS) {
      const score = record.verdict.dimensions[dimension].score;
      if (score !== null) {
        means[dimension] ??= { count: 0, total: 0 };
        means[dimension].count += 1;
        means[dimension].total += score;
      }
    }
  }
  const scorecard = Object.fromEntries(
    Object.entries(means).map(([dimension, { count, total }]) => [
      dimension,
      Number((total / count).toFixed(3)),
    ]),
  );
  const gatesPassed = records.filter((record) => record.gatePassed).length;

  const json = {
    gates: `${gatesPassed}/${records.length}`,
    meta: runMeta,
    scenarios: records.map((record) => ({
      dimensions: record.verdict.dimensions,
      gatePassed: record.gatePassed,
      gateReasoning: record.gateReasoning,
      one_line_fix: record.verdict.one_line_fix,
      scenario: record.scenario,
      suspected_cause: record.verdict.suspected_cause,
      top_issue: record.verdict.top_issue,
      transcript: record.transcript,
    })),
    scorecard,
  };
  writeFileSync(resolve(dir, "latest.json"), JSON.stringify(json, null, 2));
  writeFileSync(
    resolve(dir, `${runMeta.timestamp}-${runMeta.sha}.json`),
    JSON.stringify(json, null, 2),
  );

  const worstFirst = [...records].sort(
    (a, b) => lowestScore(a.verdict) - lowestScore(b.verdict),
  );
  console.log("\n══ Agent quality scorecard ══");
  console.log(`run ${runMeta.experimentName} · model ${runMeta.model}`);
  console.log(`hard gates: ${gatesPassed}/${records.length}`);
  for (const [dimension, mean] of Object.entries(scorecard).sort(
    (a, b) => a[1] - b[1],
  )) {
    console.log(`  ${dimension.padEnd(12)} ${mean.toFixed(2)}`);
  }
  console.log("\n══ Improvement dossier (worst first) ══");
  for (const record of worstFirst.slice(0, 5)) {
    console.log(
      `\n▸ ${record.scenario} ${record.gatePassed ? "" : "[GATE FAILED]"}`,
    );
    console.log(`  issue: ${record.verdict.top_issue}`);
    console.log(`  cause: ${record.verdict.suspected_cause}`);
    console.log(`  fix:   ${record.verdict.one_line_fix}`);
  }
  console.log("");
}

function lowestScore(verdict: JudgeVerdict): number {
  let lowest = 1;
  for (const dimension of JUDGE_DIMENSIONS) {
    const score = verdict.dimensions[dimension].score;
    if (score !== null && score < lowest) {
      lowest = score;
    }
  }
  return lowest;
}

function safeExec(command: string): string {
  try {
    return execSync(command, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
