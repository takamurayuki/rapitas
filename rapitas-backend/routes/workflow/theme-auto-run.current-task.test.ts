/**
 * theme-auto-run.current-task.test
 *
 * The auto-run strip draws the current task's own phases (a lightweight task
 * has no plan phase) and its send-backs, so the GET response carries the
 * task's workflowMode and a rework summary (2026-11-21). Read-only.
 */
import { expect, mock, test } from 'bun:test';

const findUniqueMock = mock(async (_args: unknown) => ({
  id: 1521,
  title: 't',
  status: 'in-progress',
  workflowStatus: 'in_progress',
  workflowMode: 'lightweight',
}));
const db = {
  task: { count: async () => 4, findUnique: findUniqueMock },
};
mock.module('../../config', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({ createLogger: () => ({ info() {}, error() {} }) }));
mock.module('../../services/observability', () => ({ logCycleEvent() {} }));
mock.module('../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ start: mock(() => {}) }) },
}));
const autoRunState = { currentTaskId: 1521, enabled: true, status: 'running' };
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getOrCreateAutoRun: async () => autoRunState,
  startAutoRun: async () => autoRunState,
  pauseAutoRun: async () => autoRunState,
  stopAutoRun: async () => autoRunState,
  toPublicAutoRunState: (s: unknown) => s,
}));
mock.module('../../services/agents/stop-task-agents', () => ({ stopThemeAgents: mock() }));
mock.module('../../services/agents/settle-stopped-tasks', () => ({ settleStoppedTasks: mock() }));
const rework = {
  count: 2,
  lastFromStatus: 'verify_done',
  lastToStatus: 'in_progress',
  lastCause: 'ci_repair',
  lastAt: '2026-11-21T00:00:00.000Z',
};
const loadReworkSummary = mock(async (_id: number) => rework);
mock.module('../../services/workflow/auto-run/auto-run-rework-summary', () => ({
  loadReworkSummary,
  summarizeRework: () => null,
}));

const { themeAutoRunRoutes } = await import('./theme-auto-run');

test('GET returns the current task with its workflow mode and send-backs', async () => {
  const response = await themeAutoRunRoutes.handle(
    new Request('http://localhost/themes/18/auto-run', { method: 'GET' }),
  );
  const body = (await response.json()) as {
    currentTask: { workflowMode: string; rework: typeof rework | null };
  };
  expect(body.currentTask.workflowMode).toBe('lightweight');
  expect(body.currentTask.rework).toEqual(rework);
  expect(loadReworkSummary).toHaveBeenCalledWith(1521);
  const select = (findUniqueMock.mock.calls[0][0] as { select: Record<string, boolean> }).select;
  expect(select.workflowMode).toBe(true);
});
