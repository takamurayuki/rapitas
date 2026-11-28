/**
 * theme-auto-run.awaiting-ci.test
 *
 * GET /themes/:id/auto-run lists the tasks that gave their slot back while they
 * wait for CI, with their latest transition cause — also when the theme is idle
 * (task 1570). The lookup runs for real on top of a fake database.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const UPDATED_AT = new Date('2026-11-28T00:00:00.000Z');
const HOLD_CAUSE = 'verify_awaiting_required_merge';

let parked: Array<{ id: number; title: string; updatedAt: Date }> = [];
let causes: Record<number, string> = {};
let failList = false;
const autoRunState: {
  status: string;
  currentTaskId: number | null;
  companionTasksJson: string | null;
} = { status: 'idle', currentTaskId: null, companionTasksJson: null };

const db = {
  task: {
    count: async () => 0,
    findUnique: async ({ where }: { where: { id: number } }) => ({
      id: where.id,
      title: `task ${where.id}`,
      status: 'in-progress',
      workflowStatus: 'verify_done',
      haltReason: null,
    }),
    findMany: async ({ where }: { where: { themeId?: number } }) => {
      if (where.themeId === undefined) return [];
      if (failList) throw new Error('db down');
      return parked;
    },
  },
  workflowTransition: {
    findFirst: async ({ where }: { where: { taskId: number } }) => ({
      cause: causes[where.taskId] ?? 'other',
    }),
  },
};
const noopLog = () => ({ info() {}, warn() {}, error() {}, debug() {} });
mock.module('../../config', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({ createLogger: noopLog }));
mock.module('../../services/observability', () => ({ logCycleEvent() {} }));
mock.module('../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ start() {} }) },
}));
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getOrCreateAutoRun: async () => autoRunState,
  startAutoRun: async () => autoRunState,
  pauseAutoRun: async () => autoRunState,
  stopAutoRun: async () => autoRunState,
  toPublicAutoRunState: (s: unknown) => s,
}));
mock.module('../../services/workflow/auto-run/auto-run-rework-summary', () => ({
  loadReworkSummary: async () => null,
  summarizeRework: () => null,
}));

const { themeAutoRunRoutes } = await import('./theme-auto-run');

async function getAwaitingCi() {
  const response = await themeAutoRunRoutes.handle(
    new Request('http://localhost/themes/18/auto-run', { method: 'GET' }),
  );
  const body = (await response.json()) as {
    success: boolean;
    awaitingCi: Array<{ taskId: number; title: string; cause: string; since: string }>;
  };
  expect(body.success).toBe(true);
  return body.awaitingCi;
}

const task = (id: number) => ({ id, title: `task ${id}`, updatedAt: UPDATED_AT });

beforeEach(() => {
  parked = [task(7), task(8), task(9)];
  causes = { 7: HOLD_CAUSE, 8: HOLD_CAUSE, 9: HOLD_CAUSE };
  failList = false;
  Object.assign(autoRunState, { status: 'idle', currentTaskId: null, companionTasksJson: null });
});

describe('GET /themes/:id/auto-run — awaitingCi', () => {
  test('lists the CI-waiting tasks with their latest cause while the theme is idle', async () => {
    parked = [task(7)];
    // A stale pick on an idle theme holds no slot, so it stays listed.
    autoRunState.currentTaskId = 7;

    expect(await getAwaitingCi()).toEqual([
      { taskId: 7, title: 'task 7', cause: HOLD_CAUSE, since: UPDATED_AT.toISOString() },
    ]);
  });

  test('leaves out the head and companions that still hold a slot while running', async () => {
    Object.assign(autoRunState, {
      status: 'running',
      currentTaskId: 7,
      companionTasksJson: JSON.stringify([{ taskId: 8, since: 1 }]),
    });

    expect((await getAwaitingCi()).map((e) => e.taskId)).toEqual([9]);
  });

  test('leaves out a task whose latest cause moved on to a repair', async () => {
    causes = { 7: 'ci_repair', 8: HOLD_CAUSE, 9: 'ci_repair' };

    expect((await getAwaitingCi()).map((e) => e.taskId)).toEqual([8]);
  });

  test('returns an empty list when nothing waits', async () => {
    parked = [];
    expect(await getAwaitingCi()).toEqual([]);
  });

  test('still answers, with an empty list, when the lookup fails', async () => {
    failList = true;
    expect(await getAwaitingCi()).toEqual([]);
  });
});
