/**
 * theme-auto-run-scheduler.iteration-halt.test
 *
 * Verifies that an iteration-budget halt exposes its judgement inputs
 * (statusRepeatCount / attempts / repeatLoop) in both the warn log and the
 * iteration_budget_halted transition metadata (task 994).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  mockLogWarn,
  mockRecordTransition,
  mockSetCurrentTask,
  mockResolveIterationBudgetForTask,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

beforeEach(() => {
  resetAllMocks();
  mockLogWarn.mockClear();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
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
