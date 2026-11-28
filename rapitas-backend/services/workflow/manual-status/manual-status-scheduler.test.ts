/**
 * manual-status-scheduler.test
 *
 * What the auto-run scheduler does after a hand-made status change: the queue
 * sync keeps the current task's slot, and auto-run-recovery-history's
 * userActedAfter reads the `user` transition as a revival of a blocked task.
 */
import {
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  expectTaskSlotRelease,
  ThemeAutoRunScheduler,
  mockGetThemeActiveQueueItems,
  mockQueueItemFindFirst,
  mockQueueItemFindMany,
  mockResolveTaskWorkflowState,
  mockTaskFindUnique,
  mockTaskFindMany,
  mockThemeAutoRunUpdateMany,
  mockSelectNextTask,
  mockTransitionCount,
  mockEnqueue,
} from '../auto-run/theme-auto-run-scheduler.test-support';
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const { prisma } = await import('../../../config');
const { syncQueueAfterManualStatusChange } = await import('./manual-status-queue-sync');
const { userActedAfter } = await import('../auto-run/auto-run-recovery-history');

type QueueRow = { id: number; taskId: number; status: string; currentPhase: string };
type Transition = { taskId: number; actor: string; cause: string; createdAt: Date };

const FAILED_AT = new Date('2026-01-01T00:00:00Z');
const AFTER = new Date('2026-01-01T00:05:00Z');
const BEFORE = new Date('2025-12-31T23:00:00Z');

// The shared harness has no themeAutoRun.findFirst; the sync reads the slot through it.
const themeRow = {
  themeId: 1,
  currentTaskId: 100,
  companionTasksJson: null,
  status: 'running',
  updatedAt: new Date(0),
};
Object.assign((prisma as unknown as { themeAutoRun: object }).themeAutoRun, {
  findFirst: mock(async () => ({ ...themeRow })),
});

let queue: QueueRow[];
let transitions: Transition[];
let scheduler: InstanceType<typeof ThemeAutoRunScheduler>;

const taskState = (status: string, workflowStatus: string) => ({
  id: 100,
  status,
  workflowStatus,
  workflowMode: null,
  parentId: null,
  themeId: 1,
});

const useTask = (status: string, workflowStatus: string) => {
  mockTaskFindUnique.mockResolvedValue(taskState(status, workflowStatus));
  mockResolveTaskWorkflowState.mockResolvedValue(taskState(status, workflowStatus));
  // loadThemeActiveSet releases slot members it cannot find.
  mockTaskFindMany.mockResolvedValue([{ id: 100, status }] as never);
};

const terminal = (status: string) =>
  mockQueueItemFindFirst.mockResolvedValue({
    id: 5,
    status,
    errorMessage: null,
    completedAt: FAILED_AT,
  } as never);

const manualChange = (createdAt: Date, actor = 'user'): Transition => ({
  taskId: 100,
  actor,
  cause: 'manual_status_change',
  createdAt,
});

const tick = () =>
  internal(scheduler).advanceTheme(1, 100, 'priority', 0, new Date().toISOString());

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  queue = [];
  transitions = [];
  mockQueueItemFindMany.mockImplementation(async () => queue as never);
  mockGetThemeActiveQueueItems.mockImplementation(async () => queue as never);
  mockThemeAutoRunUpdateMany.mockResolvedValue({ count: 1 });
  // Mirrors enqueue(): currentPhase is the task's workflowStatus at creation.
  mockEnqueue.mockImplementation(async () => {
    const state = await mockResolveTaskWorkflowState();
    queue.push({
      id: 9,
      taskId: 100,
      status: 'queued',
      currentPhase: state?.workflowStatus ?? 'draft',
    });
    return {};
  });
  // Evaluates userActedAfter's own where clause against the recorded transitions.
  mockTransitionCount.mockImplementation(
    (async (args: { where: { taskId: number; actor: string; createdAt: { gt: Date } } }) =>
      transitions.filter(
        (t) =>
          t.taskId === args.where.taskId &&
          t.actor === args.where.actor &&
          t.createdAt > args.where.createdAt.gt,
      ).length) as never,
  );
});

describe('tick after the queue sync', () => {
  it.each(['completed', 'failed', 'cancelled'])(
    'keeps the slot and the new phase despite an old %s item',
    async (status) => {
      terminal(status);
      useTask('todo', 'plan_approved');

      expect(await syncQueueAfterManualStatusChange(100, 'plan_approved')).toEqual({
        outcome: 'enqueued',
      });
      await tick();

      expect(queue.map((i) => i.currentPhase)).toEqual(['plan_approved']);
      expect(mockThemeAutoRunUpdateMany).not.toHaveBeenCalled();
      expect(mockSelectNextTask).not.toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    },
  );

  it('control: without the sync an old completed item releases the slot', async () => {
    terminal('completed');
    useTask('todo', 'plan_approved');

    await tick();

    expectTaskSlotRelease('completed', 100);
  });
});

describe('auto-run-recovery-history: userActedAfter and a manual status change', () => {
  it('detects a manual_status_change by actor user after the failure', async () => {
    transitions = [manualChange(AFTER)];

    expect(await userActedAfter(prisma as never, 100, FAILED_AT)).toBe(true);
  });

  it.each([
    ['made before the failure', manualChange(BEFORE)],
    ['recorded by the system', manualChange(AFTER, 'system')],
    ['made at the same instant', manualChange(FAILED_AT)],
  ])('ignores a transition %s', async (_label, transition) => {
    transitions = [transition];

    expect(await userActedAfter(prisma as never, 100, FAILED_AT)).toBe(false);
  });

  it('re-enqueues a blocked task that was changed by hand', async () => {
    terminal('failed');
    useTask('blocked', 'plan_approved');
    transitions = [manualChange(AFTER)];

    await tick();

    expect(mockEnqueue).toHaveBeenCalledWith({ taskId: 100, themeId: 1, priority: 50 });
    expect(mockThemeAutoRunUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentTaskId: null }) }),
    );
  });

  it('control: the same blocked task without the change is given up', async () => {
    terminal('failed');
    useTask('blocked', 'plan_approved');

    await tick();

    expect(mockEnqueue).not.toHaveBeenCalled();
    expectTaskSlotRelease('failed', 100);
  });
});
