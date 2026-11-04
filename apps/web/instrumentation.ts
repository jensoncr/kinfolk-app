export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerAgentTelemetry } = await import(
      "./lib/observability/register-node"
    );
    registerAgentTelemetry();
  }
}
