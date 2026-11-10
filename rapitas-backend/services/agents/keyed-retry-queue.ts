/**
 * keyed-retry-queue
 *
 * In-process deferred retry, coalesced per key, with capped exponential
 * backoff, that keeps retrying until the job reports it is done. Used where a
 * write must eventually be verified and must not depend on some unrelated
 * later event to trigger it (session-cost-totals). Not responsible for
 * persistence across restarts.
 */

/** A retry job: resolves true when it must run again, false when done. */
export type RetryJob = () => Promise<boolean>;

/** Options of a keyed retry queue. */
export interface KeyedRetryQueueOptions<K> {
  /** First delay; doubles on each retry. */
  baseMs: number;
  /** Upper bound of the delay. */
  maxMs: number;
  /** Called every 10 retries of one key that is still pending. */
  onStillPending?: (key: K, retries: number) => void;
  /** Called when a job throws (it is retried). */
  onError?: (key: K, err: unknown) => void;
}

/** Handle of a keyed retry queue. */
export interface KeyedRetryQueue<K> {
  /** Queue `job` for `key` unless one is already pending (the pending one covers it). */
  schedule(key: K, job: RetryJob): void;
  /** Run every pending job now, repeating until none is left (or `maxRounds`). */
  flush(maxRounds?: number): Promise<void>;
  /** Number of pending keys. */
  size(): number;
}

type Entry = { job: RetryJob; retries: number; timer?: ReturnType<typeof setTimeout> };

/**
 * Create a keyed retry queue.
 *
 * @param opts - Backoff and logging hooks / バックオフとログ用フック
 * @returns The queue handle / キューのハンドル
 */
export function createKeyedRetryQueue<K>(opts: KeyedRetryQueueOptions<K>): KeyedRetryQueue<K> {
  const pending = new Map<K, Entry>();

  const arm = (key: K, entry: Entry) => {
    const delay = Math.min(opts.baseMs * 2 ** entry.retries, opts.maxMs);
    entry.timer = setTimeout(() => void run(key), delay);
    // Never keep the process alive just for a retry.
    (entry.timer as { unref?: () => void }).unref?.();
  };

  const run = async (key: K): Promise<void> => {
    const entry = pending.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    let again: boolean;
    try {
      again = await entry.job();
    } catch (err) {
      opts.onError?.(key, err);
      again = true;
    }
    if (!again) {
      pending.delete(key);
      return;
    }
    entry.retries++;
    if (entry.retries % 10 === 0) opts.onStillPending?.(key, entry.retries);
    arm(key, entry);
  };

  return {
    schedule(key, job) {
      if (pending.has(key)) return;
      const entry: Entry = { job, retries: 0 };
      pending.set(key, entry);
      arm(key, entry);
    },
    async flush(maxRounds = 100) {
      for (let round = 0; round < maxRounds && pending.size > 0; round++) {
        await Promise.all([...pending.keys()].map((k) => run(k)));
      }
    },
    size: () => pending.size,
  };
}
