/**
 * semaphore
 *
 * Minimal async concurrency limiter. Used to keep CPU-heavy work (e.g. local
 * LLM inference) from running many-at-once and starving the HTTP event loop,
 * so foreground requests stay responsive while background work proceeds.
 */

/**
 * Bounds how many async operations run concurrently. Excess `run` calls queue
 * FIFO and resume as slots free up.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  /**
   * @param max - Maximum concurrent operations / 同時実行の最大数
   */
  constructor(private readonly max: number) {}

  /**
   * Runs `fn` once a slot is free, releasing the slot when it settles.
   *
   * @param fn - Work to run under the limit / 制限下で実行する処理
   * @returns The result of `fn` / fnの結果
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Re-check after each wake so only one waiter claims a freed slot.
    while (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
