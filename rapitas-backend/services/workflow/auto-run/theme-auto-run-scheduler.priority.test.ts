/**
 * theme-auto-run-scheduler.priority.test
 *
 * Covers the tick-level ordering added in task 1543: running themes are
 * advanced in descending autoRunPriority (ties: ascending themeId), the
 * global active count is re-counted per theme so one tick cannot overshoot
 * the limit, and the resolved limit is pushed to the WorkflowQueueService so
 * the runner's cap follows the setting.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  makeState,
  mockFindByStatuses,
  mockGetGlobalAutoRunActiveCount,
  mockSelectNextTask,
  mockEnqueue,
  mockUserSettingsFindFirst,
  mockThemeFindMany,
  mockSetAutoRunConcurrency,
} from './theme-auto-run-scheduler.test-support';
import { __resetConcurrencyWaitersForTests } from './auto-run-concurrency';

let scheduler: ThemeAutoRunScheduler;
const savedEnv = process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY;

/** Enqueued theme ids, in call order. */
function enqueuedThemes(): number[] {
  return mockEnqueue.mock.calls.map((c) => (c[0] as { themeId: number }).themeId);
}

function setPriorities(priorities: Record<number, number>): void {
  mockThemeFindMany.mockImplementation(async (args: { where: { id: { in: number[] } } }) =>
    args.where.id.in.map((id) => ({ id, autoRunPriority: priorities[id] ?? 0 })),
  );
}

beforeEach(() => {
  delete process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY;
  resetAllMocks();
  resetSchedulerSingleton();
  __resetConcurrencyWaitersForTests();
  scheduler = ThemeAutoRunScheduler.getInstance();
  internal(scheduler).running = true;
  // The active count follows the enqueues made so far in this tick.
  mockGetGlobalAutoRunActiveCount.mockImplementation(async () => mockEnqueue.mock.calls.length);
  mockSelectNextTask.mockImplementation(async (_prisma: unknown, themeId: number) => ({
    found: true,
    taskId: themeId * 100,
  }));
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY;
  else process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY = savedEnv;
});

describe('tick — theme priority (task 1543)', () => {
  it('枠が 1 つなら、autoRunPriority の高いテーマ 35 のタスクだけが選定される', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoRunMaxConcurrency: 1 } as never);
    setPriorities({ 1: 0, 35: 10 });
    mockFindByStatuses.mockResolvedValue([
      makeState({ id: 1, themeId: 1, status: 'running', currentTaskId: null }),
      makeState({ id: 2, themeId: 35, status: 'running', currentTaskId: null }),
    ]);

    await internal(scheduler).tick();

    expect(enqueuedThemes()).toEqual([35]);
  });

  it('優先度が同じなら、DB の返却順ではなく themeId の昇順で処理する', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoRunMaxConcurrency: 2 } as never);
    setPriorities({ 1: 0, 35: 0 });
    mockFindByStatuses.mockResolvedValue([
      makeState({ id: 2, themeId: 35, status: 'running', currentTaskId: null }),
      makeState({ id: 1, themeId: 1, status: 'running', currentTaskId: null }),
    ]);

    await internal(scheduler).tick();

    expect(enqueuedThemes()).toEqual([1, 35]);
  });

  it('同時実行数 2 なら 2 テーマとも選定され、実行キューの上限も 2 に同期される', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoRunMaxConcurrency: 2 } as never);
    setPriorities({ 1: 0, 35: 10, 40: 0 });
    mockFindByStatuses.mockResolvedValue([
      makeState({ id: 1, themeId: 1, status: 'running', currentTaskId: null }),
      makeState({ id: 2, themeId: 35, status: 'running', currentTaskId: null }),
      makeState({ id: 3, themeId: 40, status: 'running', currentTaskId: null }),
    ]);

    await internal(scheduler).tick();

    // Re-counted per theme: the 3rd theme sees 2 active and is refused.
    expect(enqueuedThemes()).toEqual([35, 1]);
    expect(mockSetAutoRunConcurrency).toHaveBeenCalledWith(2);
  });

  it('同時実行数 1 では、優先度が同じでも 1 つだけ選定される', async () => {
    setPriorities({});
    mockFindByStatuses.mockResolvedValue([
      makeState({ id: 1, themeId: 1, status: 'running', currentTaskId: null }),
      makeState({ id: 2, themeId: 35, status: 'running', currentTaskId: null }),
    ]);

    await internal(scheduler).tick();

    expect(enqueuedThemes()).toEqual([1]);
    expect(mockSetAutoRunConcurrency).toHaveBeenCalledWith(1);
  });

  it('running のテーマがなくても実行キューの上限は同期する', async () => {
    mockUserSettingsFindFirst.mockResolvedValue({ autoRunMaxConcurrency: 3 } as never);
    mockFindByStatuses.mockResolvedValue([]);

    await internal(scheduler).tick();

    expect(mockSetAutoRunConcurrency).toHaveBeenCalledWith(3);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
