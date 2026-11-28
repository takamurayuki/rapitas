/**
 * manual-status-queue-sync.test
 *
 * Which queue write (if any) follows a hand-made status change, and the values written.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

type Item = { id: number; status: string };

let task: Record<string, unknown> | null;
let items: Item[];
let executions: { id: number }[];
let themeRow: Record<string, unknown> | null;
let themeStatus: string | null;
let updateCount: number;

const taskUpdateMany = mock(async (_args: unknown) => ({ count: 1 }));
const itemUpdateMany = mock(async (_args: unknown) => ({ count: updateCount }));
const enqueue = mock(async (_options: unknown) => ({}));
const onPlanApproved = mock(async (_taskId: number) => {});

const prisma = {
  task: { findUnique: async () => task, updateMany: taskUpdateMany },
  agentExecution: { findMany: async () => executions },
  workflowQueueItem: { findMany: async () => items, updateMany: itemUpdateMany },
  themeAutoRun: { findFirst: async () => themeRow },
};
const silentLog = () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} });
mock.module('../../../config', () => ({ prisma }));
mock.module('../../../config/database', () => ({
  prisma,
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../../config/logger', () => ({ createLogger: silentLog }));
mock.module('../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue }) },
}));
mock.module('../auto-run/theme-auto-run-queries', () => ({
  getAutoRunState: async () => (themeStatus ? { status: themeStatus } : null),
}));
mock.module('../auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ onPlanApproved }) },
}));

const { syncQueueAfterManualStatusChange } = await import('./manual-status-queue-sync');

const TARGETS = [
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
] as const;

beforeEach(() => {
  task = { status: 'todo', workflowStatus: 'draft', themeId: 7 };
  items = [];
  executions = [];
  themeRow = { currentTaskId: 1, companionTasksJson: null };
  themeStatus = 'running';
  updateCount = 1;
  taskUpdateMany.mockClear();
  itemUpdateMany.mockClear();
  enqueue.mockClear();
  enqueue.mockImplementation(async () => ({}));
  onPlanApproved.mockClear();
});

const expectNoQueueWrite = () => {
  expect(itemUpdateMany).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
};

describe('existing queue items', () => {
  test.each(TARGETS)('a queued item takes currentPhase %s verbatim', async (status) => {
    items = [{ id: 11, status: 'queued' }];

    expect(await syncQueueAfterManualStatusChange(1, status)).toEqual({ outcome: 'updated' });
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [11] }, status: 'queued' },
      data: { currentPhase: status },
    });
    expect(onPlanApproved).toHaveBeenCalledTimes(status === 'plan_created' ? 0 : 1);
  });

  test.each(TARGETS.filter((s) => s !== 'plan_created'))(
    'a waiting_approval item is released for %s',
    async (status) => {
      items = [{ id: 12, status: 'waiting_approval' }];

      expect(await syncQueueAfterManualStatusChange(1, status)).toEqual({ outcome: 'released' });
      expect(itemUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: [12] }, status: 'waiting_approval' },
        data: { status: 'queued', currentPhase: status },
      });
    },
  );

  test('a waiting_approval item stays when the target is plan_created', async () => {
    items = [{ id: 12, status: 'waiting_approval' }];

    expect(await syncQueueAfterManualStatusChange(1, 'plan_created')).toEqual({
      outcome: 'unchanged',
    });
    expectNoQueueWrite();
  });

  test('losing the compare-and-set reports unchanged and does not resume the theme', async () => {
    items = [{ id: 11, status: 'queued' }];
    updateCount = 0;

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'unchanged' });
    expect(onPlanApproved).not.toHaveBeenCalled();
  });
});

describe('cases that leave the queue alone', () => {
  test('a running item', async () => {
    items = [
      { id: 1, status: 'queued' },
      { id: 2, status: 'running' },
    ];

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'running' });
    expectNoQueueWrite();
  });

  test('a live agent execution, even on a blocked task', async () => {
    task = { status: 'blocked', workflowStatus: 'draft', themeId: 7 };
    executions = [{ id: 3 }];

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'in_flight' });
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expectNoQueueWrite();
  });

  test.each([
    ['autoRunExcluded', { autoRunExcluded: true }],
    ['workflowDisabled', { workflowDisabled: true }],
    ['haltReason', { haltReason: 'budget' }],
  ])('a task held by %s', async (_label, hold) => {
    task = { status: 'todo', workflowStatus: 'draft', themeId: 7, ...hold };

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'held' });
    expectNoQueueWrite();
  });

  test.each(['done', 'cancelled'])('a %s task', async (status) => {
    task = { status, workflowStatus: 'draft', themeId: 7 };

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'terminal' });
    expectNoQueueWrite();
  });

  test('a missing task', async () => {
    task = null;

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'terminal' });
    expectNoQueueWrite();
  });

  test.each(['awaiting_question', 'completed'] as const)('target %s', async (status) => {
    items = [{ id: 11, status: 'queued' }];
    task = { status: 'blocked', workflowStatus: status, themeId: 7 };

    await syncQueueAfterManualStatusChange(1, status);

    expect(taskUpdateMany).not.toHaveBeenCalled();
    expectNoQueueWrite();
  });
});

describe('revival and re-enqueue', () => {
  test('a database failure is reported as error, not thrown', async () => {
    itemUpdateMany.mockImplementationOnce(async () => {
      throw new Error('database is locked');
    });
    items = [{ id: 11, status: 'queued' }];

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'error' });
    expect(onPlanApproved).not.toHaveBeenCalled();
  });

  test.each(['blocked', 'failed'])(
    'a %s task returns to todo under its old status',
    async (from) => {
      task = { status: from, workflowStatus: 'draft', themeId: 7 };

      await syncQueueAfterManualStatusChange(1, 'draft');

      expect(taskUpdateMany).toHaveBeenCalledWith({
        where: { id: 1, status: from },
        data: { status: 'todo' },
      });
    },
  );

  test.each([
    ['head', { currentTaskId: 1, companionTasksJson: null }],
    ['companion', { currentTaskId: 99, companionTasksJson: '[{"taskId":1,"since":1}]' }],
  ])('the theme %s with no item is enqueued once', async (_label, row) => {
    themeRow = row;

    expect(await syncQueueAfterManualStatusChange(1, 'plan_approved')).toEqual({
      outcome: 'enqueued',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({ taskId: 1, themeId: 7, priority: 50 });
  });

  test.each(['paused', 'paused_user', 'paused_approval'])(
    'a %s theme still gets its current task enqueued',
    async (status) => {
      themeStatus = status;

      expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'enqueued' });
    },
  );

  test.each(['idle', 'stopping', null])('theme status %s does not enqueue', async (status) => {
    themeStatus = status;

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'not_current' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('a task that is not the theme current task is not enqueued', async () => {
    themeRow = { currentTaskId: 99, companionTasksJson: null };

    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'not_current' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('a duplicate enqueue is unchanged, any other failure is error', async () => {
    enqueue.mockImplementation(async () => {
      throw new Error('Task 1 is already in the queue (status: queued)');
    });
    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'unchanged' });

    enqueue.mockImplementation(async () => {
      throw new Error('database is locked');
    });
    expect(await syncQueueAfterManualStatusChange(1, 'draft')).toEqual({ outcome: 'error' });
  });
});
