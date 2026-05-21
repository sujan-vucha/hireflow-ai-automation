export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRateLimiter(delayMs: number) {
  let chain = Promise.resolve();

  return async function waitTurn() {
    chain = chain.then(() => delay(delayMs));
    return chain;
  };
}

