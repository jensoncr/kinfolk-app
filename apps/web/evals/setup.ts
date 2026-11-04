import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll } from "vitest";

// Vitest does not load Next's env files; evals need the same OpenRouter and
// Supabase configuration the dev server uses. Real environment variables win
// over file values so CI can inject secrets normally.
for (const file of [".env.local", ".env"]) {
  const path = resolve(import.meta.dirname, "..", file);
  if (!existsSync(path)) {
    continue;
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
  }
}

// Next's instrumentation.ts doesn't run under vitest, so eval turns register
// (and flush) the trace/analytics exporters themselves. Both are env-gated —
// without keys this is a no-op and evals still run.
const { flushAgentTelemetry, registerAgentTelemetry } = await import(
  "../lib/observability/register-node"
);
registerAgentTelemetry();

afterAll(async () => {
  await flushAgentTelemetry();
  const { getPostHogServerClient } = await import(
    "../lib/integrations/posthog-server"
  );
  await getPostHogServerClient()?.shutdown();
});
