import { mock } from 'bun:test';
import { mockStopTaskTreeAgents } from './theme-auto-run-scheduler.test-support.collaborator-mocks';
/**
 * theme-auto-run-scheduler.unstarted-backstop.test
 *
 * Task 1007: a task with zero AgentExecutions (queue wait, e.g. #984 behind
 * 881's ci_repair) must not be force-stopped by the wall budget; past the 3x
 * ceiling it is requeued (bounded) rather than blocked.
 * Run alone: bun's mock.module is process-global.
 */
let neverExecuted = true;
// Optional per-call verdicts (consumed first) to model a lookup that changes between calls.
let verdictQueue: boolean[] = [];
let requeueResult = true;
// Task 1166: when set, models an OLD execution at this epoch-ms; honoured only if `since` is passed.
let pastExecutionAt: number | null = null;
let lastSince: Date | undefined;
const mockRequeue = mock((_p: unknown, _t: number, _th: number) => Promise.resolve(requeueResult));
mock.module('./auto-run-execution-presence', () => ({
  hasAnyExecution: () => Promise.resolve(!neverExecuted),
  taskNeverExecuted: (_p: unknown, _t: number, since?: Date) => {
    lastSince = since;
    if (verdictQueue.length > 0) return Promise.resolve(verdictQueue.shift() as boolean);
    if (pastExecutionAt != null) {
      return Promise.resolve(since ? pastExecutionAt < since.getTime() : false);
    }
    return Promise.resolve(neverExecuted);
  },
}));
mock.module('./requeue-unstarted-task', () => ({
  requeueUnstartedTask: mockRequeue,
  UNSTARTED_REQUEUE_CAUSE: 'backstop_unstarted_requeue',
  MAX_UNSTARTED_REQUEUES: 3,
}));

const { describe, it, expect, beforeEach } = await import('bun:test');
const support = await import('./theme-auto-run-scheduler.test-support');
const {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  TEST_MAX_TASK_WALL_MS,
  mockNotifyHangBackstop,
  mockTaskUpdate,
  mockOnTaskFailed,
  mockGetThemeActiveQueueItems,
  mockSetCurrentTask,
  mockHasLiveExecution,
  mockQueueItemFindFirst,
} = support;

let scheduler: InstanceType<typeof ThemeAutoRunScheduler>;
const overWall = (mult: number) =>
  new Date(Date.now() - TEST_MAX_TASK_WALL_MS * mult - 500).toISOString();

beforeEach(() => {
  neverExecuted = true;
  verdictQueue = [];
  requeueResult = true;
  pastExecutionAt = null;
  lastSince = undefined;
  resetAllMocks();
  mockRequeue.mockClear();
  mockStopTaskTreeAgents.mockClear();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  // 984 case: own item queued behind someone else's running item.
  mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 3961, taskId: 984, status: 'queued' }]);
  mockHasLiveExecution.mockResolvedValue(false);
});

describe('advanceTheme — hang backstop on never-executed tasks (task 1007)', () => {
  it('defers a queued task with zero executions past the 45min wall (#984 shape)', async () => {
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(1.6));

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
    expect(mockStopTaskTreeAgents).not.toHaveBeenCalled();
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it('requeues instead of blocking once past the 3x ceiling', async () => {
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(3));

    expect(mockRequeue).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentTask).toHaveBeenCalledWith(1, 984);
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('falls back to blocking when the requeue is refused (cap / haltReason)', async () => {
    requeueResult = false;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(3));

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
    expect(mockRequeue).toHaveBeenCalledTimes(1);
  });

  it('requeues at the last-chance guard when the first lookup said executed but a re-check says never (not blocked)', async () => {
    verdictQueue = [false, true];
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(1.6));

    expect(mockRequeue).toHaveBeenCalledTimes(1);
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('does not requeue when an execution started between the first lookup and the guard re-check', async () => {
    verdictQueue = [true, false];
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(3));

    expect(mockRequeue).not.toHaveBeenCalled();
    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
  });

  it('blocks when the guard re-check still reports executed', async () => {
    verdictQueue = [false, false];
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(1.6));

    expect(mockRequeue).not.toHaveBeenCalled();
    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
  });

  it('defers a follow-up task (985) under the same queue-wait conditions', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 3962, taskId: 985, status: 'queued' }]);
    await internal(scheduler).advanceTheme(1, 985, 'priority', 1, overWall(1.6));

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it('still force-stops a task that HAS executed (regression)', async () => {
    neverExecuted = false;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(1.6));

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it('AC1: does not fire for a task whose only execution predates the current tenure (#1153 shape)', async () => {
    const lastRunAt = overWall(1.6);
    pastExecutionAt = new Date(lastRunAt).getTime() - 60_000;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, lastRunAt);

    expect(lastSince?.toISOString()).toBe(lastRunAt);
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
    expect(mockStopTaskTreeAgents).not.toHaveBeenCalled();
  });

  it('AC2: still fires when the task executed during the current tenure and went quiet', async () => {
    const lastRunAt = overWall(1.6);
    pastExecutionAt = new Date(lastRunAt).getTime() + 60_000;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, lastRunAt);

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it('AC1/AC3: past the 3x ceiling, a slot-starved task (past exec only, queued behind a running item) is not stopped, requeued or blocked', async () => {
    const lastRunAt = overWall(4);
    pastExecutionAt = new Date(lastRunAt).getTime() - 60_000;
    mockQueueItemFindFirst.mockResolvedValue({ id: 1 }); // own queued item + another running item
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, lastRunAt);

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockStopTaskTreeAgents).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it('past the 3x ceiling without queue-wait evidence still goes to the bounded requeue', async () => {
    const lastRunAt = overWall(4);
    pastExecutionAt = new Date(lastRunAt).getTime() - 60_000;
    mockQueueItemFindFirst.mockResolvedValue(null);
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, lastRunAt);

    expect(mockRequeue).toHaveBeenCalledTimes(1);
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });
});
