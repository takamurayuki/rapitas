/**
 * execution-linker.test
 *
 * Covers claiming a task's unlinked decisions for the execution they produced.
 * The routing decision is recorded before the execution row exists, so without
 * this the consistency checker had nothing to join on and discarded every trace
 * (measured 2026-08-25: 479/479 skipped as 「実行IDが未記録のため評価対象外」).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const updateMany = mock(() => Promise.resolve({ count: 0 }));

mock.module('../../../config/database', () => ({
  prisma: { agentDecisionTrace: { updateMany } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { linkPendingDecisions } = await import('./execution-linker');

describe('linkPendingDecisions', () => {
  beforeEach(() => updateMany.mockReset().mockResolvedValue({ count: 1 }));

  test('claims only the unlinked, unjudged decisions of that task', async () => {
    expect(await linkPendingDecisions(662, 2801)).toBe(1);

    const call = updateMany.mock.calls[0]?.[0] as {
      where: { taskId: number; executionId: null; consistency: string; createdAt: { gte: Date } };
      data: { executionId: number };
    };
    expect(call.where.taskId).toBe(662);
    expect(call.where.executionId).toBeNull();
    // Never re-open a decision the checker already judged.
    expect(call.where.consistency).toBe('pending');
    expect(call.data.executionId).toBe(2801);
  });

  test('bounds the claim by age so a crashed dispatch cannot be mis-attributed', async () => {
    const before = Date.now();
    await linkPendingDecisions(662, 2801);
    const call = updateMany.mock.calls[0]?.[0] as { where: { createdAt: { gte: Date } } };
    const windowMs = before - call.where.createdAt.gte.getTime();
    expect(windowMs).toBeGreaterThan(0);
    expect(windowMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
  });

  test('no-ops without a task id rather than claiming across tasks', async () => {
    expect(await linkPendingDecisions(null, 2801)).toBe(0);
    expect(await linkPendingDecisions(undefined, 2801)).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('a write failure never propagates into the dispatch', async () => {
    updateMany.mockImplementation(() => Promise.reject(new Error('db down')));
    expect(await linkPendingDecisions(662, 2801)).toBe(0);
  });
});
