import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { Context } from "@opentelemetry/api";

// Braintrust ingests OTLP directly; the parent header routes spans into a
// project. Swap BRAINTRUST_* for any OTLP backend (Langfuse, collector) later
// without touching instrumentation call sites.
const DEFAULT_BRAINTRUST_OTEL_URL = "https://api.braintrust.dev/otel/v1/traces";

let registered = false;
let activeProvider: NodeTracerProvider | null = null;

/** Flushes buffered spans; used by short-lived processes (evals, scripts). */
export async function flushAgentTelemetry() {
  await activeProvider?.forceFlush();
}

export function registerAgentTelemetry() {
  if (registered) {
    return;
  }
  registered = true;

  // provider.register() replaces the global OTel context manager, which under
  // `next dev` (Turbopack) clobbers Next's request AsyncLocalStorage — every
  // route handler calling headers()/auth() then 500s with "headers was called
  // outside a request scope". Production (next start) is unaffected, so trace
  // export stays prod-only unless explicitly forced for local debugging.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.KINFOLK_FORCE_DEV_OTEL !== "1"
  ) {
    console.log(
      "[otel] dev server detected — agent trace export disabled (set KINFOLK_FORCE_DEV_OTEL=1 to override)",
    );
    return;
  }

  const braintrustApiKey = process.env.BRAINTRUST_API_KEY?.trim();
  if (!braintrustApiKey) {
    console.log(
      "[otel] BRAINTRUST_API_KEY not set — agent trace export disabled",
    );
    return;
  }

  const exporter = new OTLPTraceExporter({
    headers: {
      Authorization: `Bearer ${braintrustApiKey}`,
      "x-bt-parent": `project_name:${
        process.env.BRAINTRUST_PROJECT?.trim() || "kinfolk-imessage-agent"
      }`,
    },
    url: process.env.BRAINTRUST_OTEL_URL?.trim() || DEFAULT_BRAINTRUST_OTEL_URL,
  });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "kinfolk-text-agent",
    }),
    spanProcessors: [
      new AgentSpanFilterProcessor(new BatchSpanProcessor(exporter)),
    ],
  });
  provider.register();
  activeProvider = provider;
  console.log("[otel] agent trace export → Braintrust enabled");
}

/**
 * Exports only agent-relevant spans (the AI SDK's ai.* spans and our
 * housing_agent* run/tool spans), not Next.js framework noise — keeps the
 * trace store readable and the ingest bill at zero.
 */
class AgentSpanFilterProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Parameters<SpanProcessor["onStart"]>[0], context: Context) {
    this.inner.onStart(span, context);
  }

  onEnd(span: ReadableSpan) {
    if (isAgentSpan(span)) {
      this.inner.onEnd(span);
    }
  }

  forceFlush() {
    return this.inner.forceFlush();
  }

  shutdown() {
    return this.inner.shutdown();
  }
}

function isAgentSpan(span: ReadableSpan) {
  return (
    span.name.startsWith("ai.") ||
    span.name.startsWith("housing_agent") ||
    "gen_ai.system" in span.attributes ||
    "ai.operationId" in span.attributes
  );
}
