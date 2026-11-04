import { after } from "next/server";
import {
  handleLinqWebhook,
  processTextAgentRuns,
} from "@/lib/text-agent/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await handleLinqWebhook({
    headers: request.headers,
    rawBody,
  });

  if ("queuedAgentRun" in result.body && result.body.queuedAgentRun) {
    after(async () => {
      await processTextAgentRuns(1).catch((error) => {
        console.error("Queued Kinfolk text agent run failed", error);
      });
    });
  }

  return Response.json(result.body, { status: result.status });
}
