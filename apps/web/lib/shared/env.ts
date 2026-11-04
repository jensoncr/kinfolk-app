/** First non-blank value, trimmed — for env vars with legacy fallback names. */
export function firstConfiguredEnvValue(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return "";
}
