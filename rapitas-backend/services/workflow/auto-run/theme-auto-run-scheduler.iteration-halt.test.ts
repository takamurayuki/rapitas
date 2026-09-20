import {
  mockStopTaskTreeAgents,
  mockResumeTransition,
} from './theme-auto-run-scheduler.test-support.collaborator-mocks';
/**
 * theme-auto-run-scheduler.iteration-halt.test
 *
 * Regression for task 995: an iteration-budget halt must release the theme's
 * currentTaskId so the next tick reaches selection instead of re-halting the
 * same task every 12s.
 *
 * Also verifies that an iteration-budget halt exposes its judgement inputs
 * (statusRepeatCount / attempts / repeatLoop) in both the warn log and the
 * iteration_budget_halted transition metadata (task 994).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  mockResolveIterationBudgetForTask,
  mockGetThemeActiveQueueItems,
  mockSetCurrentTask,
  mockBroadcast,
  mockRecordTransition,
  mockEnqueue,
  mockLogWarn,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

beforeEach(() => {
  resetAllMocks();
  mockResumeTransition.mockReset().mockResolvedValue(null);
  mockStopTaskTreeAgents.mockClear();
  mockLogWarn.mockClear();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([]);
});

describe('advanceTheme — iteration budget halt releases the theme (task 995)', () => {
  it('halt 時に currentTaskId を解放し、halt 遷移を1回だけ記録して broadcast する', async () => {
    mockResolveIterationBudgetForTask.mockResolvedValueOnce({
      shouldHalt: true,
      haltReason: 'repeat_cause_detected',
    } as never);

    await internal(scheduler).advanceTheme(1, 984, 'priority', 0, new Date().toISOString());

    expect(mockSetCurrentTask).toHaveBeenCalledWith(1, null);
    expect(mockBroadcast.mock.calls.some((c) => c[1] === 'auto_run_update')).toBe(true);
    const haltRecords = mockRecordTransition.mock.calls.filter(
      (c) => (c[0] as { cause?: string }).cause === 'iteration_budget_halted',
    );
    expect(haltRecords).toHaveLength(1);
  });

  it('解放後の次 tick(currentTaskId=null)は halt 判定を再実行せず選定へ進む', async () => {
    mockResolveIterationBudgetForTask.mockResolvedValueOnce({
      shouldHalt: true,
      haltReason: 'repeat_cause_detected',
    } as never);
    await internal(scheduler).advanceTheme(1, 984, 'priority', 0, new Date().toISOString());
    mockRecordTransition.mockClear();
    mockResolveIterationBudgetForTask.mockClear();

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockResolveIterationBudgetForTask).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockEnqueue.mock.calls.every((c) => (c[1] as unknown) !== 984)).toBe(true);
  });

  it('予算内(shouldHalt=false)なら解放しない', async () => {
    await internal(scheduler).advanceTheme(1, 984, 'priority', 0, new Date().toISOString());
    expect(mockSetCurrentTask).not.toHaveBeenCalledWith(1, null);
  });
});

describe('advanceTheme — iteration budget halt diagnostics', () => {
  it('halt 時にログと遷移 metadata へ判定値を出力する', async () => {
    const diagnostics = {
      statusRepeatCount: 2,
      attempts: 3,
      repeatLoop: { cause: 'verify_repair', count: 4 },
    };
    mockResolveIterationBudgetForTask.mockResolvedValue({
      shouldHalt: true,
      haltReason: 'repeat_cause_detected',
      diagnostics,
    } as never);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, new Date().toISOString());

    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 100,
        cause: 'iteration_budget_halted',
        metadata: { reason: 'repeat_cause_detected', ...diagnostics },
      }),
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 100,
        themeId: 1,
        haltReason: 'repeat_cause_detected',
        ...diagnostics,
      }),
      expect.stringContaining('halted by iteration budget'),
    );
    expect(mockSetCurrentTask).toHaveBeenCalledWith(1, null);
  });
});
