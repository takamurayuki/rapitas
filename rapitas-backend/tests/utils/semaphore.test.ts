/**
 * Semaphore テスト
 * 同時実行数の上限と FIFO キューイングのユニットテスト。
 */
import { describe, test, expect } from 'bun:test';
import { Semaphore } from '../../utils/common/semaphore';

describe('Semaphore', () => {
  test('never exceeds the concurrency limit', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;

    const task = () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      });

    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBeLessThanOrEqual(2);
    expect(active).toBe(0);
  });

  test('serializes with limit 1 and preserves results', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        sem.run(async () => {
          order.push(n);
          await new Promise((r) => setTimeout(r, 5));
          return n * 2;
        }),
      ),
    );
    expect(results).toEqual([2, 4, 6]);
    expect(order).toEqual([1, 2, 3]);
  });

  test('releases the slot even when the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // A subsequent task must still acquire the freed slot.
    const ok = await sem.run(async () => 'ok');
    expect(ok).toBe('ok');
  });
});
