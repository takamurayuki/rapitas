import { mock } from 'bun:test';
import {
  mockStopTaskTreeAgents,
} from './theme-auto-run-scheduler.test-support.collaborator-mocks';
/**
 * theme-auto-run-scheduler.unstarted-backstop.test
 *
 * Task 1007: a task with zero AgentExecutions (queue wait, e.g. #984 behind
 * 881's ci_repair) must not be force-stopped by the wall budget; past the 3x
 * ceiling it is requeued (bounded) rather than blocked.
 * Run alone: bun's mock.module is process-global.
 */
let neverExecuted = true;
let requeueResult = true;
const mockRequeue = mock((_p: unknown, _t: number, _th: number) => Promise.resolve(requeueResult));
mock.module('./auto-run-execution-presence', () => ({
  hasAnyExecution: () => Promise.resolve(!neverExecuted),
  taskNeverExecuted: () => Promise.resolve(neverExecuted),
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
} = support;

let scheduler: InstanceType<typeof ThemeAutoRunScheduler>;
const overWall = (mult: number) =>
  new Date(Date.now() - TEST_MAX_TASK_WALL_MS * mult - 500).toISOString();

beforeEach(() => {
  neverExecuted = true;
  requeueResult = true;
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
  });

  it('still force-stops a task that HAS executed (regression)', async () => {
    neverExecuted = false;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, overWall(1.6));

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
    expect(mockRequeue).not.toHaveBeenCalled();
  });
});
