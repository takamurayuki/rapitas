import { mock } from 'bun:test';
/**
 * theme-auto-run-scheduler.unstarted-refusal.test
 *
 * Task 1007: scheduler-level behaviour of the backstop's requeue guard with the
 * REAL requeueUnstartedTask (only the execution-presence lookup is mocked), so
 * each refusal reason (haltReason / cap / enqueue failure) is observed as a
 * blocked task + notification, and a success as todo + enqueue without either.
 * Run alone: bun's mock.module is process-global.
 */
let neverExecuted = true;
// When set, the FIRST lookup answers `neverExecuted` and every later one (the guard's re-check) throws.
let presenceThrows = false;
let presenceCalls = 0;
mock.module('./auto-run-execution-presence', () => ({
  hasAnyExecution: () => Promise.resolve(!neverExecuted),
  taskNeverExecuted: () => {
    presenceCalls += 1;
    return presenceThrows && presenceCalls > 1
      ? Promise.reject(new Error('presence boom'))
      : Promise.resolve(neverExecuted);
  },
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
  mockHasLiveExecution,
  mockTaskFindUnique,
  mockTransitionCount,
  mockEnqueue,
  mockRecordTransition,
} = support;

let scheduler: InstanceType<typeof ThemeAutoRunScheduler>;
const pastCeiling = () => new Date(Date.now() - TEST_MAX_TASK_WALL_MS * 3 - 500).toISOString();
const row = (haltReason: string | null = null) =>
  ({ status: 'todo', workflowStatus: null, haltReason }) as never;

beforeEach(() => {
  neverExecuted = true;
  presenceThrows = false;
  presenceCalls = 0;
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 3961, taskId: 984, status: 'queued' }]);
  mockHasLiveExecution.mockResolvedValue(false);
  mockTaskFindUnique.mockResolvedValue(row());
  mockTransitionCount.mockResolvedValue(0);
});

const blocked = () => {
  expect(mockNotifyHangBackstop).toHaveBeenCalled();
  expect(mockOnTaskFailed).toHaveBeenCalled();
  expect(mockTaskUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'blocked' }) }),
  );
};

describe('backstop requeue guard — real requeueUnstartedTask (task 1007)', () => {
  it('requeues (todo + enqueue + transition), without blocking or notifying', async () => {
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, pastCeiling());

    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 984 }, data: { status: 'todo' } });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 984, cause: 'backstop_unstarted_requeue' }),
    );
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('blocks when the task carries a haltReason (no re-injection)', async () => {
    mockTaskFindUnique.mockResolvedValue(row('repeat_cause_detected'));
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, pastCeiling());

    blocked();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('blocks once the requeue cap (3) is used up', async () => {
    mockTransitionCount.mockResolvedValue(3);
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, pastCeiling());

    blocked();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('blocks when the enqueue fails', async () => {
    mockEnqueue.mockRejectedValue(new Error('queue down'));
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, pastCeiling());

    blocked();
  });

  it('blocks (does not crash) when the execution-presence guard itself throws', async () => {
    neverExecuted = false;
    presenceThrows = true;
    await internal(scheduler).advanceTheme(1, 984, 'priority', 1, pastCeiling());

    blocked();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
