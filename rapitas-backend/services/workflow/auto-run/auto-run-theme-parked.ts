/**
 * auto-run-theme-parked
 *
 * Answers one question about a theme: does it have any work the runner could
 * dispatch right now, or is everything it has left parked by an operator or
 * waiting on a human?
 *
 * Why this exists. auto-run-no-selection-watch asked "is there a dispatchable
 * item in the QUEUE?" and reported "the advance is not completing" when there
 * was not. But a theme whose entire remaining backlog is held has no
 * dispatchable item BY DESIGN, and such a theme owns no queue item at all, so
 * the queue-side scan sees nothing and the watch blames the scheduler.
 *
 * Measured 2026-10-13: `theme.no_selection_progress` was the single most
 * frequent cycle event of the day — 40 occurrences between 19:35 and 22:46, all
 * for theme 34 — while that theme's six non-terminal tasks were #1214/#1216/
 * #1223/#1224/#1225 with `autoRunExcluded` and #1215 at
 * `workflowStatus: 'awaiting_question'`. Not one was dispatchable. The loudest
 * signal in the log was a false alarm, which is exactly where a real stall
 * hides.
 *
 * NOT responsible for deciding what to do about a parked theme, for reading the
 * database, or for any notification cadence — the watch owns all three.
 */

import { isDispatchableWaiter } from '../queue-starvation-waiters';
import { classifyAutoRunHold } from './auto-run-hold-check';

/** The task fields this classification needs, as read from a Task row. */
export interface ThemeTaskState {
  status: string;
  workflowStatus: string | null;
  haltReason?: string | null;
  autoRunExcluded?: boolean | null;
  workflowDisabled?: boolean | null;
}

/** What a theme's remaining backlog amounts to. */
export interface ThemeWorkVerdict {
  /**
   * True when the theme HAS work left and none of it is dispatchable — the
   * state a human has to clear, not one the scheduler can.
   */
  parked: boolean;
  /** Tasks the runner could dispatch right now. / いま発行できる件数 */
  runnable: number;
  /** Non-terminal tasks counted, dispatchable or not. / 数えた非終端タスク数 */
  pending: number;
}

/**
 * Classify a theme's remaining backlog.
 *
 * Dispatchability is decided by {@link isDispatchableWaiter} and
 * {@link classifyAutoRunHold} rather than by a local copy of either rule, so
 * this cannot drift from what the runner actually refuses or from what an
 * operator's hold actually means.
 *
 * An EMPTY backlog is deliberately not `parked`: having nothing left is a
 * finished theme, and reporting it as "waiting for a human" would send an
 * operator to look at work that does not exist.
 *
 * @param tasks - The theme's tasks, terminal ones included / テーマのタスク一覧
 * @returns Whether the theme is parked, with the counts behind it / 判定と内訳
 */
export function classifyThemeWork(tasks: readonly ThemeTaskState[]): ThemeWorkVerdict {
  let runnable = 0;
  let counted = 0;
  for (const task of tasks) {
    const waiter = {
      status: task.status,
      workflowStatus: task.workflowStatus,
      haltReason: task.haltReason ?? null,
    };
    // isDispatchableWaiter also screens out done/completed/cancelled, so a
    // terminal task is neither runnable nor counted as parked.
    if (!isDispatchableWaiter(waiter)) {
      if (!isTerminalStatus(task.status)) counted++;
      continue;
    }
    counted++;
    if (classifyAutoRunHold(task).held) continue;
    runnable++;
  }
  return { parked: counted > 0 && runnable === 0, runnable, pending: counted };
}

/** Statuses isDispatchableWaiter rejects as finished rather than as held. */
function isTerminalStatus(status: string): boolean {
  return status === 'done' || status === 'completed' || status === 'cancelled';
}
