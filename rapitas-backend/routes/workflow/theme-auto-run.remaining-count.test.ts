import { beforeEach, expect, mock, test } from 'bun:test';

const countMock = mock(async (_args: unknown) => 5);
const findUniqueMock = mock(async (_args: unknown) => null);
const db = {
  theme: { findUnique: async () => ({ id: 1, isDevelopment: true, workingDirectory: '/test' }) },
  task: { count: countMock, findUnique: findUniqueMock },
};
mock.module('../../config', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({ createLogger: () => ({ info() {}, error() {} }) }));
mock.module('../../services/observability', () => ({ logCycleEvent() {} }));
mock.module('../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ start: mock(() => {}) }) },
}));
const autoRunState = { currentTaskId: null, enabled: false, status: 'stopped' };
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getOrCreateAutoRun: async () => autoRunState,
  startAutoRun: async () => autoRunState,
  pauseAutoRun: async () => autoRunState,
  stopAutoRun: async () => autoRunState,
  toPublicAutoRunState: (s: unknown) => s,
}));
mock.module('../../services/agents/stop-task-agents', () => ({ stopThemeAgents: mock() }));
mock.module('../../services/agents/settle-stopped-tasks', () => ({ settleStoppedTasks: mock() }));

const { themeAutoRunRoutes } = await import('./theme-auto-run');

beforeEach(() => {
  countMock.mockClear();
  findUniqueMock.mockClear();
});

const request = () =>
  themeAutoRunRoutes.handle(new Request('http://localhost/themes/1/auto-run', { method: 'GET' }));

test('remainingCount where clause matches selectNextTask eligibility conditions', async () => {
  const response = await request();
  expect(response.status).toBe(200);
  const body = (await response.json()) as { success: boolean; remainingCount: number };
  expect(body.success).toBe(true);
  expect(body.remainingCount).toBe(5);

  expect(countMock).toHaveBeenCalledTimes(1);
  const where = countMock.mock.calls[0][0].where;

  // A NULL workflowStatus (freshly filed todo) must be counted — status:'todo'
  // ignores a stale terminal workflowStatus, and the null branch is required
  // for the awaiting_question exclusion clause (NOT on NULL is UNKNOWN).
  expect(where.AND).toEqual([
    {
      OR: [
        { status: 'todo' },
        { workflowStatus: null },
        { workflowStatus: { notIn: ['completed', 'verify_done'] } },
      ],
    },
    { OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }] },
  ]);

  // Opt-out (autoRunExcluded) and workflow-disabled tasks must not be counted —
  // selectNextTask excludes both, so an omission here over-reports the backlog.
  expect(where.autoRunExcluded).toBe(false);
  expect(where.workflowDisabled).toBe(false);
  expect(where.parentId).toBeNull();
  expect(where.themeId).toBe(1);
  expect(where.status).toEqual({ in: ['todo', 'in-progress'] });
});

test('GET does not mutate task or auto-run state', async () => {
  await request();
  expect(findUniqueMock).not.toHaveBeenCalled();
  // Only read-only prisma calls were made for the state itself; no task
  // update/upsert mocks were registered above, so any accidental mutation
  // call would throw "is not a function" and fail this test.
});
