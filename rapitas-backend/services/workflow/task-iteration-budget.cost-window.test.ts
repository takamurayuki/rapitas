/**
 * task-iteration-budget cost-window テスト
 *
 * resolveIterationBudgetForTask の budget_cost_exceeded 判定が、タスクの生涯コスト
 * ではなく現在の反復窓(直近の task_retried / question_resolved 以降)のコストで
 * 行われることを検証する。生涯合計で判定すると、一度予算を超えたタスクは
 * 再試行・回答後も選定のたびに再停止する(2026-09-20 #996)。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const WINDOW_START_MS = 1_000_000;
const NOW_MS = WINDOW_START_MS + 60_000;

const mockTaskFindUnique = mock(() =>
  Promise.resolve({ workflowStatus: 'plan_approved', createdAt: new Date(0) }),
);
const mockTransitionFindFirst = mock(() =>
  Promise.resolve({ createdAt: new Date(WINDOW_START_MS) }),
);
const mockTransitionFindMany = mock(() => Promise.resolve([]));
const mockExecCount = mock(() => Promise.resolve(1));
/** Captures the findMany `where` so the test can assert the window filter is applied. */
const mockExecFindMany = mock((_args: { where: unknown }) =>
  Promise.resolve([] as Array<{ costUsd: number }>),
);

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mockTaskFindUnique },
    agentExecution: { count: mockExecCount, findMany: mockExecFindMany },
    workflowTransition: { findFirst: mockTransitionFindFirst, findMany: mockTransitionFindMany },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: mock(() => Promise.resolve({ id: 1, outcome: 'created' })),
}));

const { resolveIterationBudgetForTask } = await import('./task-iteration-budget');

describe('resolveIterationBudgetForTask — cost is windowed', () => {
  beforeEach(() => {
    delete process.env.RAPITAS_TASK_BUDGET_USD;
    mockExecFindMany.mockClear();
  });

  test('queries execution costs restricted to the current iteration window', async () => {
    await resolveIterationBudgetForTask(996, {}, NOW_MS);
    const call = mockExecFindMany.mock.calls.find((c) =>
      JSON.stringify(c[0]?.where ?? {}).includes('startedAt'),
    );
    expect(call).toBeDefined();
    expect(call?.[0].where).toMatchObject({
      session: { config: { taskId: 996 } },
      OR: [{ startedAt: null }, { startedAt: { gte: new Date(WINDOW_START_MS) } }],
    });
  });

  test('does not halt when the window spend is under budget (lifetime spend is irrelevant)', async () => {
    // What the DB returns for the windowed query: only the post-reset executions.
    mockExecFindMany.mockResolvedValue([{ costUsd: 0.5 }]);
    const state = await resolveIterationBudgetForTask(996, {}, NOW_MS);
    expect(state.shouldHalt).toBe(false);
  });

  test('still halts when the window spend itself exceeds the budget', async () => {
    mockExecFindMany.mockResolvedValue([{ costUsd: 20 }, { costUsd: 6 }]);
    const state = await resolveIterationBudgetForTask(996, {}, NOW_MS);
    expect(state).toMatchObject({ shouldHalt: true, haltReason: 'budget_cost_exceeded' });
  });
});
