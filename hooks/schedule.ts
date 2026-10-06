/** The next wait after a failure: double the last one, never below `baseMs` and never above `maxMs`. */
export const backoff = (previousMs: number, baseMs: number, maxMs: number) =>
  Math.min(maxMs, Math.max(baseMs, previousMs * 2))
