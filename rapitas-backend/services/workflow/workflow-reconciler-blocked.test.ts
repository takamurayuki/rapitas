/**
 * workflow-reconciler-blocked.test
 *
 * Proves requeueBlockedTasks re-dispatches a task after the blocked_auto_retry
 * draft reset and records the outcome on that transition (task 1238: the bare
 * reset left #1235 with no execution and no queue item for 32 minutes).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

type Row = { id: number; status: string; workflowStatus: string; themeId: number };
let row: Row;
let theme: { enabled: boolean; status: string; currentTaskId: number | null; order: string };
let retriesRecorded = 0;
let transitionUpdates: Array<{ id: number; metadata: string }> = [];
const taskUpdates: unknown[] = [];
const selectCalls: number[] = [];

const recordTransition = mock(async (input: { cause: string }) => {
  if (input.cause === 'blocked_auto_retry') retriesRecorded++;
});

const fakePrisma = {
  task: {
    findMany: () => Promise.resolve([{ ...row }]),
    findUnique: () => Promise.resolve({ ...row }),
    update: (args: { data: Partial<Row> }) => {
      taskUpdates.push(args);
      row = { ...row, ...args.data };
      return Promise.resolve({});
    },
  },
  themeAutoRun: {
    findMany: () => Promise.resolve([{ themeId: 1 }]),
    findUnique: () => Promise.resolve({ ...theme }),
    count: () => Promise.resolve(0),
  },
  userSettings: { findFirst: () => Promise.resolve(null) },
  activityLog: { findFirst: () => Promise.resolve(null) },
  agentExecution: { findFirst: () => Promise.resolve(null) },
  workflowTransition: {
    count: (args: { where: { cause: string } }) =>
      Promise.resolve(args.where.cause === 'blocked_auto_retry' ? retriesRecorded : 0),
    findFirst: (args: { where: { cause: string } }) =>
      Promise.resolve(
        args.where.cause === 'blocked_auto_retry' && retriesRecorded ? { id: 9 } : null,
      ),
    update: (args: { where: { id: number }; data: { metadata: string } }) => {
      transitionUpdates.push({ id: args.where.id, metadata: args.data.metadata });
      return Promise.resolve({});
    },
  },
};

mock.module('../../config/database', () => ({
  prisma: fakePrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config', () => ({
  prisma: fakePrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('./blocked-unstarted-restore', () => ({
  restoreBlockedUnstartedTask: async () => 'not_applicable',
}));
mock.module('./workflow-reconciler-undispatchable', () => ({
  ACTIVE_EXEC: [],
  healUndispatchableTodo: async () => 0,
  hasLiveExecution: async () => false,
}));
mock.module('./auto-run/auto-run-advance-select', () => ({
  selectAndEnqueueNextTask: async (_p: unknown, themeId: number) => {
    selectCalls.push(themeId);
    theme.currentTaskId = row.id;
  },
}));

const { requeueBlockedTasks } = await import('./workflow-reconciler-requeue');

const NOW = 1_800_000_000_000;

describe('requeueBlockedTasks re-dispatch after draft reset (task 1238)', () => {
  beforeEach(() => {
    row = { id: 1235, status: 'blocked', workflowStatus: 'verify_done', themeId: 1 };
    theme = { enabled: true, status: 'running', currentTaskId: null, order: 'priority' };
    retriesRecorded = 0;
    transitionUpdates = [];
    taskUpdates.length = 0;
    selectCalls.length = 0;
    recordTransition.mockClear();
  });

  test('リセット後にセレクタが当該テーマで1回起動され metadata.dispatch=kicked が記録される', async () => {
    const retried = await requeueBlockedTasks(NOW);

    expect(retried).toBe(1);
    expect(row.status).toBe('todo');
    expect(row.workflowStatus).toBe('draft');
    expect(selectCalls).toEqual([1]);
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'blocked_auto_retry',
        metadata: expect.objectContaining({ attempt: 1 }),
      }),
    );
    expect(JSON.parse(transitionUpdates[0].metadata)).toMatchObject({
      attempt: 1,
      dispatch: 'kicked',
    });
  });

  test('上限(MAX_BLOCKED_RETRY)到達済みならリセットも起動も行わない', async () => {
    retriesRecorded = 99;

    expect(await requeueBlockedTasks(NOW)).toBe(0);
    expect(taskUpdates.length).toBe(0);
    expect(selectCalls.length).toBe(0);
  });

  test('テーマが paused_approval ならセレクタは起動せず theme_not_running を記録する', async () => {
    theme.status = 'paused_approval';

    // NOTE: the scan-time gate (running themes only) is mocked open here to
    // exercise the re-read race: the theme paused between scan and reset.
    await requeueBlockedTasks(NOW);

    expect(selectCalls.length).toBe(0);
    expect(JSON.parse(transitionUpdates[0].metadata).dispatch).toBe('theme_not_running');
  });

  test('workflowStatus が completed の blocked は既存どおり draft リセットも起動もしない', async () => {
    row.workflowStatus = 'completed';

    await requeueBlockedTasks(NOW);

    expect(row.workflowStatus).toBe('completed');
    expect(selectCalls.length).toBe(0);
  });
});
