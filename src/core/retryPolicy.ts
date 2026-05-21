export async function withRetry<T>(
  task: () => Promise<T>,
  options: { retries?: number; delayMs?: number; onRetry?: (error: unknown, attempt: number) => void } = {}
): Promise<T> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 750;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= retries) throw error;
      options.onRetry?.(error, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw new Error("Retry policy exhausted unexpectedly.");
}

