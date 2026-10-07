export type FetchFn = typeof fetch;

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON with a timeout and retries on network errors, 429 and 5xx (exponential backoff,
 * honouring Retry-After up to 30s).
 */
export async function getJson<T = unknown>(
  url: string,
  opts: { fetchFn?: FetchFn; timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const { fetchFn = fetch, timeoutMs = 10_000, retries = 2, headers = {} } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, {
        headers: { "User-Agent": "Mozilla/5.0 (box3balans)", Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new HttpRequestError(`${new URL(url).host} responded ${res.status}`, res.status);
      if (!retryable) throw lastErr;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt < retries) await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 500 * 2 ** attempt);
    } catch (err) {
      if (err instanceof HttpRequestError && err.status && err.status < 500 && err.status !== 429) throw err;
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
