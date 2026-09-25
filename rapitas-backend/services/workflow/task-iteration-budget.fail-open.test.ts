/**
 * task-iteration-budget fail-open テスト
 *
 * resolveIterationBudgetForTask のDB参照失敗時fail-open挙動と、
 * 3回連続失敗時の懸念バックログ自動起票（重複排除込み）を検証する。
 */
import { describe, test, expect, mock } from 'bun:test';

const mockFindUnique = mock(() => Promise.reject(new Error('db unreachable')));
const mockCount = mock(() => Promise.reject(new Error('db unreachable')));
const mockFindMany = mock(() => Promise.reject(new Error('db unreachable')));
const mockTransitionFindFirst = mock(() => Promise.reject(new Error('db unreachable')));

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mockFindUnique },
    agentExecution: { count: mockCount, findMany: mockFindMany },
    workflowTransition: { findFirst: mockTransitionFindFirst, findMany: mockFindMany },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  // task-iteration-budget-status.ts (task 994) pulls in modules that import the
  // bare `logger` export — the mock must mirror every export of the real module.
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const mockSubmitConcern = mock(() => Promise.resolve({ id: 1, outcome: 'created' as const }));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: mockSubmitConcern,
}));

const { resolveIterationBudgetForTask } = await import('./task-iteration-budget');

describe('resolveIterationBudgetForTask — fail-open', () => {
  test('DB参照失敗時は shouldHalt:false を返す', async () => {
    const result = await resolveIterationBudgetForTask(60001, {});
    expect(result).toEqual({ shouldHalt: false });
  });

  test('3回連続失敗で懸念バックログへ自動起票される', async () => {
    mockSubmitConcern.mockClear();
    const taskId = 60002;

    await resolveIterationBudgetForTask(taskId, {});
    expect(mockSubmitConcern).not.toHaveBeenCalled();
    await resolveIterationBudgetForTask(taskId, {});
    expect(mockSubmitConcern).not.toHaveBeenCalled();
    await resolveIterationBudgetForTask(taskId, {});

    expect(mockSubmitConcern).toHaveBeenCalledTimes(1);
    expect(mockSubmitConcern.mock.calls[0][0]).toMatchObject({
      originTaskId: taskId,
      dedupKey: `task-iteration-budget:read-failure-escalation:${taskId}`,
    });
  });

  test('4回目以降も同一dedupKeyで起票され続ける（重複はsubmitConcern側の責務）', async () => {
    mockSubmitConcern.mockClear();
    const taskId = 60003;

    for (let i = 0; i < 4; i++) {
      await resolveIterationBudgetForTask(taskId, {});
    }

    expect(mockSubmitConcern).toHaveBeenCalledTimes(2);
    expect(mockSubmitConcern.mock.calls[0][0]).toMatchObject({
      dedupKey: `task-iteration-budget:read-failure-escalation:${taskId}`,
    });
    expect(mockSubmitConcern.mock.calls[1][0]).toMatchObject({
      dedupKey: `task-iteration-budget:read-failure-escalation:${taskId}`,
    });
  });
});
