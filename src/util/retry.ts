import { ProviderError } from './errors.js';

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** Override sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying on retryable ProviderErrors with exponential backoff + jitter.
 * Non-retryable errors are thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 200;
  const max = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? defaultSleep;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof ProviderError && err.retryable;
      if (!retryable || attempt >= retries) throw err;
      const backoff = Math.min(max, base * 2 ** attempt);
      const jitter = Math.random() * backoff * 0.25;
      await sleep(backoff + jitter);
      attempt++;
      if (opts.signal?.aborted) throw new ProviderError('Aborted during retry', false);
    }
  }
}

/** Map an HTTP status to a ProviderError, marking transient ones retryable. */
export function httpStatusToError(status: number, body: string): ProviderError {
  const retryable = status === 408 || status === 429 || status >= 500;
  return new ProviderError(`HTTP ${status}: ${body.slice(0, 500)}`, retryable);
}

/**
 * Perform a fetch with retry on transient errors (429/5xx/408 and network failures).
 * Returns the ok Response, or throws the last error. Network errors are treated as retryable.
 */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  opts: { retries?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetchImpl(url, init);
      } catch (err) {
        throw new ProviderError(`network error: ${(err as Error).message}`, true);
      }
      if (!res.ok) throw httpStatusToError(res.status, await res.text().catch(() => ''));
      return res;
    },
    { retries: opts.retries ?? 2, signal: opts.signal },
  );
}
