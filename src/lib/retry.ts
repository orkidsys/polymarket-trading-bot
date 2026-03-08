/**
 * Retry a function with exponential backoff.
 * @param fn Async function to run (no args).
 * @param options maxRetries (default 3), baseMs (default 500), maxMs (default 5000)
 * @returns Result of fn
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseMs?: number; maxMs?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseMs = options?.baseMs ?? 500;
  const maxMs = options?.maxMs ?? 5000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries) break;
      const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/** Return true if error looks retryable (network, 5xx, rate limit). */
export function isRetryableError(e: unknown): boolean {
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("network")) return true;
    if (msg.includes("429") || msg.includes("503") || msg.includes("502") || msg.includes("504")) return true;
  }
  return false;
}
