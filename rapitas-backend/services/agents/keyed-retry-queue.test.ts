/**
 * keyed-retry-queue.test
 *
 * The deferred retry behind session-cost-totals must keep retrying a key
 * until its job reports done (even through errors), coalesce per key, and
 * fire on its own timer without anyone calling flush.
 */
import { describe, expect, mock, test } from 'bun:test';
import { createKeyedRetryQueue } from './keyed-retry-queue';

describe('createKeyedRetryQueue', () => {
  test('retries until the job reports done, through thrown errors', async () => {
    const onError = mock(() => {});
    const q = createKeyedRetryQueue<number>({ baseMs: 1, maxMs: 2, onError });
    let calls = 0;
    q.schedule(1, async () => {
      calls++;
      if (calls === 2) throw new Error('db down');
      return calls < 4;
    });
    await q.flush();
    expect(calls).toBe(4);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  test('coalesces: a key already pending keeps its first job', async () => {
    const q = createKeyedRetryQueue<number>({ baseMs: 1, maxMs: 1 });
    const first = mock(async () => false);
    const second = mock(async () => false);
    q.schedule(7, first);
    q.schedule(7, second);
    expect(q.size()).toBe(1);
    await q.flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  test('runs on its own timer without flush', async () => {
    const q = createKeyedRetryQueue<string>({ baseMs: 5, maxMs: 5 });
    const job = mock(async () => false);
    q.schedule('s', job);
    await Bun.sleep(30);
    expect(job).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });
});
