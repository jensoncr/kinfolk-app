import {
  readBooleanOption,
  readFiniteNumberOption,
  readNonEmptyStringOption,
} from "./options.mjs";

const defaultBaseUrl = "http://localhost:3000";

export function resolveProfileEmbeddingJobOptions(args, env = process.env) {
  return {
    baseUrl: stripTrailingSlash(
      readNonEmptyStringOption(
        args.get("base-url") ??
          env.KINFOLK_BACKFILL_BASE_URL ??
          env.NEXT_PUBLIC_KINFOLK_BASE_URL,
        defaultBaseUrl,
      ),
    ),
    dryRun: readBooleanOption(args.get("dry-run"), false),
    force: readBooleanOption(args.get("force"), false),
    jobSecret: readNonEmptyStringOption(
      args.get("job-secret") ?? env.KINFOLK_JOBS_SECRET,
      "",
    ),
    limit: readFiniteNumberOption(args.get("limit"), 50, {
      integer: true,
      max: 200,
      min: 1,
    }),
    userId: readNonEmptyStringOption(args.get("user-id"), null),
  };
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
