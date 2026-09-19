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

  test('prisma が reject しても throw せず、unknownとして返すこと(0扱いにしない)', async () => {
    findMany.mockRejectedValue(new Error('db down'));

    const state = await resolveTaskBudgetCap(1);

    // Fail open on the CEILING (a DB blip must not throttle every task) but
    // NOT on the fact that spend could not be checked: spendUnknown records
    // the failure instead of reporting a measured $0.
    expect(state.capTier).toBeUndefined();
    expect(state.spendUnknown).toBe(true);
    expect(state.unknownReason).toBeTruthy();
  });

  test('getTaskSpendUsd は境界IDでも throw しない(正常読み取り時)', async () => {
    for (const id of ID_EDGES) {
      expect(await getTaskSpendUsd(id)).toBe(0);
    }
  });

  test('getTaskSpendUsd は読み取り失敗時に reject する(0を返さない)', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    expect(getTaskSpendUsd(1)).rejects.toThrow('db down');
  });
});
