import type { ZodTypeAny, z } from "zod";

type ParsedJsonBody<Schema extends ZodTypeAny> =
  | { ok: true; data: z.infer<Schema> }
  | { ok: false; response: Response };

/**
 * Parse and validate a JSON request body in one step.
 *
 * On failure returns a ready-to-return 400 whose message is the schema's
 * first issue — give schema fields custom messages so clients see the same
 * human copy routes used to hand-roll.
 */
export async function parseJsonBody<Schema extends ZodTypeAny>(
  request: Request,
  schema: Schema,
): Promise<ParsedJsonBody<Schema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidBody("Request body must be valid JSON.");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return invalidBody(result.error.issues[0]?.message ?? "Request body must be valid.");
  }

  return { ok: true, data: result.data };
}

function invalidBody(message: string): { ok: false; response: Response } {
  return {
    ok: false,
    response: Response.json({ error: message }, { status: 400 }),
  };
}
