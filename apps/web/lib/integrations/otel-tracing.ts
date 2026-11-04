import "server-only";

import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

const TRACER_NAME = "kinfolk-text-agent";

export type AgentSpanConfig = {
  attributes?: Record<string, string | number | boolean | null | undefined>;
  name: string;
};

/**
 * Runs fn inside an OpenTelemetry span. When no tracer provider is registered
 * (local dev without keys, unit tests) the API returns a no-op span, so this
 * is always safe to call. Model-call spans come from the AI SDK's telemetry;
 * this wrapper exists for the run/tool boundaries the SDK can't see.
 */
export async function runWithAgentSpan<Result>(
  config: AgentSpanConfig,
  fn: () => Promise<Result>,
): Promise<Result> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    config.name,
    { attributes: normalizeAttributes(config.attributes) },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function setActiveSpanAttributes(
  attributes: Record<string, string | number | boolean | null | undefined>,
) {
  trace.getActiveSpan()?.setAttributes(normalizeAttributes(attributes));
}

function normalizeAttributes(
  attributes?: Record<string, string | number | boolean | null | undefined>,
): Attributes {
  const normalized: Attributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}
