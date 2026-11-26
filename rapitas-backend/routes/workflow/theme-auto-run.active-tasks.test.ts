/**
 * theme-auto-run.active-tasks.test
 *
 * Task 1552: GET /themes/:id/auto-run lists every running task of the theme in
 * `activeTasks` (head first, then companions) while `currentTask` stays the
 * head, so the home strip can show "並列で N 件実行中". Read-only.
 */
import { expect, mock, test } from 'bun:test';

const tasks: Record<number, { id: number; title: string; status: string; workflowStatus: string }> =
  {
    10: { id: 10, title: 'head task', status: 'in-progress', workflowStatus: 'in_progress' },
    11: { id: 11, title: 'companion task', status: 'in-progress', workflowStatus: 'plan_approved' },
  };
const db = {
  task: {
    count: async () => 3,
    findUnique: async (args: { where: { id: number } }) => ({
      ...tasks[args.where.id],
      workflowMode: 'standard',
    }),
    findMany: async (args: { where: { id: { in: number[] } } }) =>
      args.where.id.in.map((id) => tasks[id]).filter(Boolean),
  },
};
mock.module('../../config', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({ createLogger: () => ({ info() {}, error() {} }) }));
mock.module('../../services/observability', () => ({ logCycleEvent() {} }));
mock.module('../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ start: mock(() => {}) }) },
}));
let autoRunState: Record<string, unknown> = {};
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getOrCreateAutoRun: async () => autoRunState,
  startAutoRun: async () => autoRunState,
  pauseAutoRun: async () => autoRunState,
  stopAutoRun: async () => autoRunState,
  toPublicAutoRunState: (s: unknown) => s,
}));
mock.module('../../services/agents/stop-task-agents', () => ({ stopThemeAgents: mock() }));
mock.module('../../services/agents/settle-stopped-tasks', () => ({ settleStoppedTasks: mock() }));
mock.module('../../services/workflow/auto-run/auto-run-rework-summary', () => ({
  loadReworkSummary: async () => null,
  summarizeRework: () => null,
}));

const { themeAutoRunRoutes } = await import('./theme-auto-run');

async function getState() {
  const response = await themeAutoRunRoutes.handle(
    new Request('http://localhost/themes/1/auto-run', { method: 'GET' }),
  );
  return (await response.json()) as {
    currentTask: { id: number } | null;
    activeTasks: Array<{ id: number; title: string; role: string }>;
  };
}

test('head and companion are both listed; currentTask stays the head', async () => {
  autoRunState = {
    currentTaskId: 10,
    status: 'running',
    companionTasksJson: '[{"taskId":11,"since":1000}]',
  };
  const body = await getState();
  expect(body.currentTask?.id).toBe(10);
  expect(body.activeTasks).toEqual([
    { id: 10, title: 'head task', role: 'head' },
    { id: 11, title: 'companion task', role: 'companion' },
  ]);
});

test('one running task → activeTasks has only the head (the pre-task display)', async () => {
  autoRunState = { currentTaskId: 10, status: 'running', companionTasksJson: null };
  const body = await getState();
  expect(body.activeTasks).toEqual([{ id: 10, title: 'head task', role: 'head' }]);
});
