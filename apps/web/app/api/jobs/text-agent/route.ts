import { NextRequest } from "next/server";
import { notifyFounder } from "@/lib/shared/alerts";
import { isAuthorizedJobRequest } from "@/lib/shared/job-auth";
import {
  readBooleanOption,
  readIntegerOption,
  readJobRequestBody,
} from "@/lib/shared/job-body";
import { processTextAgentRuns } from "@/lib/text-agent/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorizedJobRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await readJobRequestBody(request);
  if (!parsedBody.ok) {
    return Response.json({ error: parsedBody.error }, { status: 400 });
  }

  const body = parsedBody.body;
  const limit = readIntegerOption(body.limit, 5, 1, 25);
  const dryRun = readBooleanOption(body.dryRun, false);

  try {
    const result = dryRun
      ? await processTextAgentRuns(limit, { dryRun })
      : await processTextAgentRuns(limit);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Text agent job failed.";
    console.error("[text-agent-job] queue drain failed", error);
    await notifyTextAgentJobFounder(message);
    return Response.json(
      { error: "Text agent job failed.", ok: false },
      { status: 500 },
    );
  }
}

async function notifyTextAgentJobFounder(message: string) {
  try {
    await notifyFounder("text_agent_job_failed", { detail: message });
  } catch (error) {
    console.error("[text-agent-job] founder notification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

