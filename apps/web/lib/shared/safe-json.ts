/**
 * Parse a provider response body that SHOULD be JSON but may be an HTML error
 * page or truncated text; the fallback keeps a bounded excerpt for logging.
 */
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}
