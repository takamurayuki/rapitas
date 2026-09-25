/**
 * task-iteration-budget-active-clock
 *
 * Start point of the iteration budget's TIME axis: the beginning of the task's
 * latest stretch of active work, not the window start. Wall-clock time a task
 * spends unselected (held, theme stopped, halted, waiting in the backlog) is
 * not "iterating", so it must not consume the time budget. Not responsible for
 * the other axes (task-iteration-budget.ts).
 */

/**
 * Compute where the time clock starts for a task's current iteration window.
 *
 * Executions are grouped into stretches: a gap of `budgetMs` or more between
 * two execution starts ends one stretch and begins the next, and the clock
 * starts at the latest stretch. With no execution in the window, or none
 * within the last `budgetMs`, nothing is being iterated on right now and the
 * clock starts at `nowMs` (elapsed 0). #911 (2026-09-25): re-selected after a
 * 15-day hold, it halted on budget_time_exceeded three seconds later because
 * the clock ran from its last reset on 2026-09-10.
 *
 * @param executionStartsMs - startedAt (ms) of the executions in the window; nulls ignored / 窓内の実行開始時刻
 * @param windowStartMs - Iteration window start (ms) / 反復窓の起点
 * @param nowMs - Current time (ms) / 現在時刻
 * @param budgetMs - Time budget (ms); also the idle gap that splits stretches / 時間予算
 * @returns Clock start (ms) for the time axis / 時間軸の起点
 */
export function activeClockStartMs(
  executionStartsMs: ReadonlyArray<number | null | undefined>,
  windowStartMs: number,
  nowMs: number,
  budgetMs: number,
): number {
  const starts = executionStartsMs
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (starts.length === 0) return nowMs;
  const last = starts[starts.length - 1]!;
  if (nowMs - last >= budgetMs) return nowMs;
  let clock = Math.max(windowStartMs, starts[0]!);
  for (let i = 1; i < starts.length; i++) {
    if (starts[i]! - starts[i - 1]! >= budgetMs) clock = starts[i]!;
  }
  return clock;
}
