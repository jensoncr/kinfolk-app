import { setTimeout as delay } from "node:timers/promises";

function shouldRetryStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function createFetchWithRetry({ retries = 3, retryDelayMs = 500, errorPrefix = "Provider request failed" } = {}) {
  return async function fetchWithRetry(url, options = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, options);
        if (response.ok || !shouldRetryStatus(response.status) || attempt === retries) {
          return response;
        }
        lastError = new Error(`${errorPrefix}: ${response.status} ${response.statusText}`);
      } catch (error) {
        lastError = error;
        if (attempt === retries) throw error;
      }

      const backoff = retryDelayMs * 2 ** attempt;
      if (backoff > 0) await delay(backoff);
    }

    throw lastError;
  };
}
