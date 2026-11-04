#!/usr/bin/env node
import { loadDotEnv, parseArgs } from "./lib/cli.mjs";
import { resolveProfileEmbeddingJobOptions } from "./lib/profile-embedding-job-options.mjs";

loadDotEnv();

const args = parseArgs();
const { baseUrl, dryRun, force, jobSecret, limit, userId } =
  resolveProfileEmbeddingJobOptions(args);

if (!jobSecret && process.env.NODE_ENV === "production") {
  throw new Error("Missing KINFOLK_JOBS_SECRET for production backfill.");
}

const response = await fetch(`${baseUrl}/api/jobs/profile-embeddings`, {
  body: JSON.stringify({
    ...(dryRun ? { dryRun } : {}),
    force,
    limit,
    ...(userId ? { userId } : {}),
  }),
  headers: {
    "content-type": "application/json",
    ...(jobSecret ? { "x-kinfolk-job-secret": jobSecret } : {}),
  },
  method: "POST",
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(
    `Profile embedding job failed with ${response.status}: ${JSON.stringify(body)}`,
  );
}

console.log(JSON.stringify(body, null, 2));
