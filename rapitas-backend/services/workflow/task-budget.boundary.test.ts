/**
 * task-budget.boundary.test
 *
 * Hand-written boundary tests for resolveTaskBudgetCap. The generated
 * null-contract template does not apply: this resolver always HAS an answer —
 * a task with no spend is a valid state, not a missing row — so it returns a
 * state object rather than null (source carries the `boundary-tests: manual`
 * opt-out marker).
 *
 * What the edge cases must guarantee instead: no edge task id throws, and an
 * unknown task is reported as no spend and no ceiling rather than as a cap
 * conjured from nothing.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ID_EDGES } from '../../tests/helpers/boundary-values';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const findMany = mock((): Promise<Array<{ costUsd: unknown }>> => Promise.resolve([]));

mock.module('../../config/database', () => ({
  prisma: { agentExecution: { findMany } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { resolveTaskBudgetCap, getTaskSpendUsd } = await import('./task-budget');

describe('resolveTaskBudgetCap 境界値', () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  for (const id of ID_EDGES) {
    test(`${id} でも throw せず状態を返すこと`, async () => {
      const state = await resolveTaskBudgetCap(id);
      expect(state.spentUsd).toBe(0);
      // No spend means no ceiling — never a cap invented for an unknown task.
      expect(state.capTier).toBeUndefined();
      expect(state.reason).toBeUndefined();
    });
  }

  test('prisma が reject しても throw せず、上限なしとして返すこと', async () => {
    findMany.mockRejectedValue(new Error('db down'));

    const state = await resolveTaskBudgetCap(1);

    // Fail open by design: a DB blip must not throttle every task. The
    // implementation logs a warning so the missing ceiling is not silent.
    expect(state.capTier).toBeUndefined();
    expect(state.spentUsd).toBe(0);
  });

  test('getTaskSpendUsd も境界IDで throw しないこと', async () => {
    for (const id of ID_EDGES) {
      expect(await getTaskSpendUsd(id)).toBe(0);
    }
  });
});
