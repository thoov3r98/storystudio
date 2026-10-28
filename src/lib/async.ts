/** Maps with bounded concurrency. Results keep input order; failures are returned, not thrown. */
export async function mapSettled<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s.`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(label: string, ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(label, ms));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Bounded retries with exponential backoff. `shouldRetry` can stop early on permanent errors. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts: number; baseDelayMs?: number; shouldRetry?: (err: unknown) => boolean; onRetry?: (err: unknown, attempt: number) => void },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === opts.attempts || (opts.shouldRetry && !opts.shouldRetry(err))) break;
      opts.onRetry?.(err, attempt);
      await new Promise((r) => setTimeout(r, (opts.baseDelayMs ?? 1000) * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
