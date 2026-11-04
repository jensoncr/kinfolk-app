/**
 * Error whose message is safe to show to the requesting user.
 *
 * Lib code throws `ApiError` for expected, user-correctable failures (bad
 * input, missing auth, full group). Route handlers pass any caught error to
 * `apiFailureResponse`, which maps ApiError to `{ error }` with the carried
 * status and everything else to a logged, generic 500 — so unexpected errors
 * never leak internals to the client.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiFailureResponse({
  error,
  fallback,
  logMessage,
  context,
}: {
  error: unknown;
  /** Generic client-facing message for unexpected errors. */
  fallback: string;
  /** Log prefix for unexpected errors, e.g. "[plan] saved-place update failed". */
  logMessage: string;
  /** Extra fields logged alongside the error, e.g. { roomId }. */
  context?: Record<string, unknown>;
}) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error(logMessage, { error, ...context });
  return Response.json({ error: fallback }, { status: 500 });
}
