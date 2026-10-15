/**
 * task-work-time.test
 *
 * Covers measuring how long a task took to DO. Before this, the column every
 * duration estimator reads held `completedAt - createdAt` — filing to done —
 * which in an autonomous system is mostly backlog queueing (7 minutes to 8.5
 * days across the rows sampled 2026-08-26).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const findMany = mock((): Promise<{ executionTimeMs: number | null }[]> => Promise.resolve([]));

mock.module('../../../config', () => ({
  prisma: { agentExecution: { findMany } },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { sumTaskWorkMinutes } = await import('./task-work-time');

describe('sumTaskWorkMinutes', () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  test('sums every execution rather than measuring wall clock', async () => {
    findMany.mockResolvedValue([
      { executionTimeMs: 5 * 60_000 },
      { executionTimeMs: 3 * 60_000 },
      { executionTimeMs: 60_000 },
    ]);
    expect(await sumTaskWorkMinutes(667)).toBe(9);
  });

  test('scopes to the task, not the whole table', async () => {
    findMany.mockResolvedValue([{ executionTimeMs: 60_000 }]);

    await sumTaskWorkMinutes(667);

    const arg = findMany.mock.calls[0]?.[0] as {
      where: { session: { config: { taskId: number } } };
    };
    expect(arg.where.session.config.taskId).toBe(667);
  });

  test('a task that never ran has no duration, not a duration of zero', async () => {
    // Zero would read as a real measurement to every consumer that null-checks.
    expect(await sumTaskWorkMinutes(667)).toBeNull();
  });

  test('a sub-minute task records one minute, never zero', async () => {
    findMany.mockResolvedValue([{ executionTimeMs: 4_000 }]);
    expect(await sumTaskWorkMinutes(667)).toBe(1);
  });

  test('ignores executions that never reported a time', async () => {
    findMany.mockResolvedValue([{ executionTimeMs: null }, { executionTimeMs: 2 * 60_000 }]);
    expect(await sumTaskWorkMinutes(667)).toBe(2);
  });

  test('never throws into the completion path', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    expect(await sumTaskWorkMinutes(667)).toBeNull();
  });
});
