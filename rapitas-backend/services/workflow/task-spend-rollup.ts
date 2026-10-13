/**
 * task-spend-rollup
 *
 * Totals what a task actually spent from the cost rows on its executions.
 * Pure: no database, no clock, no policy about what the total means.
 *
 * Why a roll-up is needed instead of a sum. `AgentExecution.costUsd` stores the
 * Claude CLI's `total_cost_usd` verbatim, and that field is the SESSION's
 * cumulative cost, not this invocation's. Measured against the CLI directly
 * (haiku, same session_id, `num_turns: 1` both times):
 *
 *   fresh    total_cost_usd 0.00257
 *   --resume total_cost_usd 0.00456
 *
 * Summing those two rows reports 0.00713 for a session that cost 0.00456. Every
 * repair cycle that resumes its session is therefore counted again, and the
 * error grows with the number of cycles — so the longest-running tasks, the
 * ones a budget exists to catch, are the ones measured worst. Measured across
 * 4,087 executions: #980 summed to $134.19 against a real $24.02 (5.59x), #1214
 * to $44.95 against $14.83 (3.03x), 46 of 633 tasks overstated by 1.5x or more.
 *
 * Both tasks halted on `budget_cost_exceeded` were false halts: #1160 summed to
 * $25.69 past the $25 budget while really spending $13.13, and #1174 to $27.05
 * while really spending $17.96.
 *
 * Why increments rather than the session's maximum. A session's cost does not
 * only rise: 176 of 331 multi-execution sessions record a DECREASE at some
 * point (4.32 then 1.05), which is a fresh chain reusing the id rather than a
 * refund. Taking the maximum would discard the earlier chain. Walking
 * increments and treating a drop as a new chain handles both shapes, and
 * reduces to a plain sum when every row is its own session.
 */

import { attributeIncrementalCosts, type CostRow } from '../agents/execution-cost-attribution';

/** One execution's cost row, as the budget reads it. */
export type SpendRow = CostRow;

/** Sort key: real time where known, otherwise last (a row with no start is pending). */
function startedMs(row: SpendRow): number {
  return row.startedAt ? row.startedAt.getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * Total USD a task spent, optionally only counting the part inside a window.
 *
 * `since` filters the INCREMENTS, not the rows: a chain that began before the
 * window still has to be walked from its start, or its first in-window row
 * would be counted whole and drag the pre-window spend in with it. That is the
 * shape behind task 996 — a task whose lifetime spend once crossed the budget
 * was re-halted seconds after every resume.
 *
 * Rows with no `startedAt` count as in-window: they are about to run, not old.
 *
 * @param rows - Every cost row of the task, in any order / タスクの全コスト行
 * @param since - Window start, or null for the whole lifetime / 集計開始時刻
 * @returns Total spend in USD / 合計コスト
 */
export function rollUpTaskSpend(rows: readonly SpendRow[], since: Date | null): number {
  const sinceMs = since ? since.getTime() : null;
  const increments = attributeIncrementalCosts(rows);
  let total = 0;
  rows.forEach((row, index) => {
    if (sinceMs === null || startedMs(row) >= sinceMs) total += increments[index];
  });
  return total;
}
