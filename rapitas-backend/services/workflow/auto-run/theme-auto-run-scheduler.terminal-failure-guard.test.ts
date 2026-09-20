import { mock } from 'bun:test';
/**
 * theme-auto-run-scheduler.terminal-failure-guard.test
 *
 * Task 1007: the SECOND writeBlockedTask call site in auto-run-active-decision
 * (the queue item reached a failed/cancelled terminal state) must also requeue a
 * task that never executed instead of blocking it. Uses the REAL
 * requeueUnstartedTask; only the execution-presence lookup is mocked.
 * Run alone: bun's mock.module is process-global.
 */
let neverExecuted = true;
let presenceThrows = false;
// Prior backstop_unstarted_requeue count. The user-revival check shares mockTransitionCount, so it is answered separately.
let priorRequeues = 0;
mock.module('./auto-run-execution-presence', () => ({
  hasAnyExecution: () => Promise.resolve(!neverExecuted),
  taskNeverExecuted: () =>
    presenceThrows ? Promise.reject(new Error('presence boom')) : Promise.resolve(neverExecuted),
}));

const { describe, it, expect, beforeEach } = await import('bun:test');
const support = await import('./theme-auto-run-scheduler.test-support');
const {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  mockNotifyTaskSkipped,
  mockTaskUpdate,
  mockOnTaskFailed,
  mockGetThemeActiveQueueItems,
  mockQueueItemFindFirst,
  mockResolveTaskWorkflowState,
  mockTaskFindUnique,
  mockTransitionCount,
  mockEnqueue,
  mockRecordTransition,
  mockSetCurrentTask,
} = support;

let scheduler: InstanceType<typeof ThemeAutoRunScheduler>;
const now = () => new Date().toISOString();
const taskRow = (haltReason: string | null = null) =>
  ({ status: 'todo', workflowStatus: null, haltReason }) as never;

function state(status: string) {
  mockResolveTaskWorkflowState.mockResolvedValue({
    id: 984,
    status,
    workflowStatus: null,
    workflowMode: null,
    parentId: null,
  });
}

beforeEach(() => {
  neverExecuted = true;
  presenceThrows = false;
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([]);
  // Terminal queue item: the dispatch failed before any execution existed.
  mockQueueItemFindFirst.mockResolvedValue({
    id: 3961,
    status: 'failed',
    errorMessage: 'dispatch failed',
    completedAt: new Date(),
  } as never);
  state('in-progress');
  mockTaskFindUnique.mockResolvedValue(taskRow());
  priorRequeues = 0;
  mockTransitionCount.mockImplementation(((args?: { where?: { actor?: string } }) =>
    Promise.resolve(args?.where?.actor === 'user' ? 0 : priorRequeues)) as never);
});

const blocked = () => {
  expect(mockTaskUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'blocked' }) }),
  );
  expect(mockOnTaskFailed).toHaveBeenCalled();
  expect(mockNotifyTaskSkipped).toHaveBeenCalled();
};

describe('terminal-failure branch — never-executed guard (task 1007)', () => {
  it('requeues (todo + enqueue + transition) instead of blocking, without failure notices', async () => {
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, now());

    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 984 }, data: { status: 'todo' } });
    expect(mockTaskUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'blocked' }) }),
    );
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 984, cause: 'backstop_unstarted_requeue' }),
    );
    expect(mockSetCurrentTask).toHaveBeenCalledWith(1, 984);
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
    expect(mockNotifyTaskSkipped).not.toHaveBeenCalled();
  });

  it('blocks when the task carries a haltReason', async () => {
    mockTaskFindUnique.mockResolvedValue(taskRow('repeat_cause_detected'));
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, now());

    blocked();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('blocks once the requeue cap (3) is used up', async () => {
    priorRequeues = 3;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, now());

    blocked();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('blocks when the enqueue fails', async () => {
    mockEnqueue.mockRejectedValue(new Error('queue down'));
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, now());

    blocked();
  });

  it('blocks a task that HAS executed (a real failure stays a failure)', async () => {
    neverExecuted = false;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, now());

    blocked();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('blocks (does not crash) when the execution-presence re-check throws', async () => {
    presenceThrows = true;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, now());

    blocked();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('leaves an already-blocked task alone: no guard, no requeue, no second blocked write', async () => {
    state('blocked');
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, now());

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
  });
});
