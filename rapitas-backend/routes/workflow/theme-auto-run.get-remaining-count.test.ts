import { beforeEach, expect, mock, test } from 'bun:test';

type TaskCountWhere = {
  themeId: number;
  status: { in: string[] };
  OR: Array<{ workflowStatus: null } | { workflowStatus: { notIn: string[] } }>;
  workflowDisabled: boolean;
  parentId: null;
};

// Fixture models the Task rows that must / must not be counted toward remainingCount.
const TASKS = [
  {
    id: 1,
    themeId: 1,
    status: 'todo',
    workflowStatus: null,
    workflowDisabled: false,
    parentId: null,
  }, // not started -> included
  {
    id: 2,
    themeId: 1,
    status: 'todo',
    workflowStatus: 'research_done',
    workflowDisabled: false,
    parentId: null,
  }, // in-flight -> included
  {
    id: 3,
    themeId: 1,
    status: 'todo',
    workflowStatus: 'awaiting_question',
    workflowDisabled: false,
    parentId: null,
  }, // awaiting answer -> excluded
  {
    id: 4,
    themeId: 1,
    status: 'todo',
    workflowStatus: 'plan_created',
    workflowDisabled: true,
    parentId: null,
  }, // disabled -> excluded
  {
    id: 5,
    themeId: 1,
    status: 'todo',
    workflowStatus: 'completed',
    workflowDisabled: false,
    parentId: null,
  }, // terminal -> excluded
  {
    id: 6,
    themeId: 1,
    status: 'todo',
    workflowStatus: 'verify_done',
    workflowDisabled: false,
    parentId: null,
  }, // terminal -> excluded
  { id: 7, themeId: 1, status: 'todo', workflowStatus: null, workflowDisabled: false, parentId: 1 }, // subtask -> excluded
  {
    id: 8,
    themeId: 1,
    status: 'done',
    workflowStatus: null,
    workflowDisabled: false,
    parentId: null,
  }, // done status -> excluded
  {
    id: 9,
    themeId: 2,
    status: 'todo',
    workflowStatus: null,
    workflowDisabled: false,
    parentId: null,
  }, // other theme -> excluded
];

function countMatching(where: TaskCountWhere): number {
  return TASKS.filter((task) => {
    if (task.themeId !== where.themeId) return false;
    if (!where.status.in.includes(task.status)) return false;
    if (task.workflowDisabled !== where.workflowDisabled) return false;
    if (task.parentId !== where.parentId) return false;
    const orMatch = where.OR.some((clause) => {
      if ('workflowStatus' in clause && clause.workflowStatus === null) {
        return task.workflowStatus === null;
      }
      const notIn = (clause as { workflowStatus: { notIn: string[] } }).workflowStatus.notIn;
      return task.workflowStatus !== null && !notIn.includes(task.workflowStatus);
    });
    return orMatch;
  }).length;
}

let workflowDisabledGlobally = false;
const db = {
  theme: { findUnique: async () => ({ id: 1, isDevelopment: true, workingDirectory: '/test' }) },
  task: {
    findUnique: async () => null,
    count: mock(async (args: { where: TaskCountWhere }) => countMatching(args.where)),
  },
  userSettings: {
    findFirst: mock(async () => ({ workflowDisabledGlobally })),
  },
};
mock.module('../../config', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({ createLogger: () => ({ info() {}, error() {} }) }));
mock.module('../../services/observability', () => ({ logCycleEvent() {} }));
mock.module('../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ start: () => {} }) },
}));
const state = { currentTaskId: null, enabled: false, status: 'stopped' };
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getOrCreateAutoRun: async () => state,
  startAutoRun: async () => state,
  pauseAutoRun: async () => state,
  stopAutoRun: async () => state,
  toPublicAutoRunState: (s: unknown) => s,
}));
mock.module('../../services/agents/stop-task-agents', () => ({
  stopThemeAgents: async () => ({}),
}));
mock.module('../../services/agents/settle-stopped-tasks', () => ({
  settleStoppedTasks: async () => [],
}));
const { themeAutoRunRoutes } = await import('./theme-auto-run');

beforeEach(() => {
  db.task.count.mockClear();
  db.userSettings.findFirst.mockClear();
  workflowDisabledGlobally = false;
});

const request = () =>
  themeAutoRunRoutes.handle(new Request('http://localhost/themes/1/auto-run', { method: 'GET' }));

test('remainingCount includes not-started tasks (workflowStatus=null)', async () => {
  const response = await request();
  const body = (await response.json()) as { remainingCount: number };
  // Only ids 1 and 2 satisfy every clause for theme 1.
  expect(body.remainingCount).toBe(2);
});

test('remainingCount excludes awaiting_question, workflowDisabled, and terminal statuses', async () => {
  const response = await request();
  await response.json();
  // ids 3 (awaiting_question), 4 (disabled), 5/6 (terminal), 7 (subtask), 8 (done), 9 (other theme)
  // must never contribute to the count returned to the caller.
  const includedIds = TASKS.filter((task) => {
    if (task.themeId !== 1) return false;
    if (!['todo', 'in-progress'].includes(task.status)) return false;
    if (task.workflowDisabled) return false;
    if (task.parentId !== null) return false;
    if (task.workflowStatus === 'awaiting_question') return false;
    if (task.workflowStatus === 'completed' || task.workflowStatus === 'verify_done') return false;
    return true;
  }).map((task) => task.id);
  expect(includedIds).toEqual([1, 2]);
});

test('remainingCount query scopes to the requested theme only', async () => {
  await request();
  const where = db.task.count.mock.calls[0]?.[0]?.where as TaskCountWhere;
  expect(where.themeId).toBe(1);
});

test('remainingCount is 0 when auto-run is disabled globally, without querying tasks', async () => {
  workflowDisabledGlobally = true;
  const response = await request();
  const body = (await response.json()) as { remainingCount: number };
  expect(body.remainingCount).toBe(0);
  expect(db.task.count).not.toHaveBeenCalled();
});
