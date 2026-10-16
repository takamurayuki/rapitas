/**
 * transition-recorder.test
 *
 * Fault-injection coverage for recordTransition()'s durability. Many bounded
 * loop guards across the codebase (plan-replan cap, ci_repair cap,
 * auto_merge_blocked window, phase-critic bounce cap, reconciler requeue caps)
 * enforce their limit by COUNTING the rows this function writes. A dropped
 * write under-counts every one of those caps at once, so a transient DB
 * failure here must be retried before being given up on (never thrown).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const create = mock(() => Promise.resolve({})) as any;
const mockPrisma = { workflowTransition: { create } };

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { recordTransition } = await import('./transition-recorder');

beforeEach(() => {
  create.mockReset();
});

const INPUT = {
  taskId: 1,
  fromStatus: 'plan_created',
  toStatus: 'draft',
  actor: 'system' as const,
  cause: 'plan_invalid_replan',
};

describe('recordTransition — fault injection', () => {
  test('writes the row on the first attempt when it succeeds', async () => {
    create.mockResolvedValue({});

    await recordTransition(INPUT);

    expect(create).toHaveBeenCalledTimes(1);
  });

  test('retries once on a transient failure and succeeds on the retry', async () => {
    create
      .mockImplementationOnce(() => Promise.reject(new Error('transient DB error')))
      .mockImplementationOnce(() => Promise.resolve({}));

    await recordTransition(INPUT);

    expect(create).toHaveBeenCalledTimes(2);
  });

  test('never throws even when both attempts fail (caller must not be blocked)', async () => {
    create.mockImplementation(() => Promise.reject(new Error('DB down')));

    // The whole point of this being fire-and-forget: a caller mid-status-update
    // must never be blown up by a logging-row failure.
    await expect(recordTransition(INPUT)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
