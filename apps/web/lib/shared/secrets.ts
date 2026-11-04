/**
 * Fail-closed secret lookup for signing/verification trust boundaries.
 *
 * Each boundary reads exactly one dedicated env var. Production throws at
 * first use when the var is missing or blank — never fall back to another
 * secret (and especially not SUPABASE_SERVICE_ROLE_KEY). Outside production
 * a deterministic, clearly dev-only value keeps local signing working
 * without setup.
 */
export function requireBoundarySecret(envName: string, boundary: string) {
  const secret = process.env[envName]?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${envName} must be set in production.`);
  }

  return `kinfolk-dev-only-${boundary}-secret`;
}
