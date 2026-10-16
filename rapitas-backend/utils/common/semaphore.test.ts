import { describe, test, expect } from 'bun:test';
import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  test('runs a single task and returns its result', async () => {
    const sem = new Semaphore(1);
    const result = await sem.run(async () => 42);
    expect(result).toBe(42);
  });

  test('limits concurrency to max: only `max` tasks run at once', async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let maxObserved = 0;
    const task = async () => {
      concurrent++;
      maxObserved = Math.max(maxObserved, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
    };

    await Promise.all([sem.run(task), sem.run(task), sem.run(task), sem.run(task)]);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  test('queued tasks run in FIFO order once a slot frees up', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const makeTask = (id: number) => async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(id);
    };

    await Promise.all([sem.run(makeTask(1)), sem.run(makeTask(2)), sem.run(makeTask(3))]);
    expect(order).toEqual([1, 2, 3]);
  });

  test('releases the slot even when the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // If the slot were not released, this second call would hang forever.
    const result = await sem.run(async () => 'ok');
    expect(result).toBe('ok');
  });

  test('allows unlimited concurrency when max is large relative to task count', async () => {
    const sem = new Semaphore(10);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => sem.run(async () => i)));
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });
});
