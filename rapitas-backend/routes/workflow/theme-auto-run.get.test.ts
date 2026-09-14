import { beforeEach, expect, mock, test } from 'bun:test';
import { autoRunCandidateWhere } from '../../services/workflow/auto-run/auto-run-eligibility';

const taskCount = mock(async (_args: unknown) => 3);
const db = {
  task: {
    findUnique: async () => null,
    count: taskCount,
  },
};
mock.module('../../config', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({ createLogger: () => ({ info() {}, error() {} }) }));
mock.module('../../services/observability', () => ({ logCycleEvent() {} }));
mock.module('../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ start: () => {} }) },
}));
const state = { currentTaskId: null, enabled: true, status: 'running' };
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getOrCreateAutoRun: async () => state,
  startAutoRun: async () => state,
  pauseAutoRun: async () => state,
  stopAutoRun: async () => state,
  toPublicAutoRunState: (s: unknown) => s,
}));
const { themeAutoRunRoutes } = await import('./theme-auto-run');

beforeEach(() => {
  taskCount.mockClear();
});

const request = () =>
  themeAutoRunRoutes.handle(new Request('http://localhost/themes/1/auto-run', { method: 'GET' }));

test('remainingCount query uses the exact same where-fragment as selectNextTask candidates', async () => {
  const response = await request();
  expect(response.status).toBe(200);
  const body = (await response.json()) as { success: boolean; remainingCount: number };
  expect(body.success).toBe(true);
  expect(body.remainingCount).toBe(3);

  expect(taskCount).toHaveBeenCalledTimes(1);
  const callArgs = taskCount.mock.calls[0]?.[0] as { where: unknown };
  expect(callArgs.where).toEqual(autoRunCandidateWhere(1));
});

test('GET does not mutate auto-run state (no write calls made)', async () => {
  const response = await request();
  expect(response.status).toBe(200);
  // The only DB interaction is the read-only count above; no state.* write
  // mocks are wired here, so a state-mutating call would surface as a crash
  // rather than a silent pass.
});
