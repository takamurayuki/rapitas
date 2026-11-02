/**
 * First-Pass Completion Query
 *
 * Task-level completion quality for the metrics overview: of the tasks that
 * first completed inside the window, how many got there without a
 * verify_repair. Not an execution-level metric — `overallSuccessRate` in
 * queries.ts counts CLI processes that exited cleanly, which says the harness
 * stayed alive, not that the work was right (#1300).
 */
import { prisma } from '../../../../../config/database';
import type { DateRange, FirstPassCompletion } from '../../types';

/** One status change of one task, as this module reads it. */
export interface FirstPassTransitionRow {
  taskId: number;
  toStatus: string | null;
  cause: string | null;
  createdAt: Date;
}

/** Date bounds, either end optional; both ends inclusive. */
export interface RangeBounds {
  gte?: Date;
  lte?: Date;
}

// NOTE: Literal rather than an import of retro-kpi-metrics' VERIFY_REPAIR_CAUSE,
// which reaches auto-merge-exhaustion and its transition-recorder graph — a unit
// test of this file would have to mock all of it. Ten other call sites pin the
// same literal locally (e.g. repair-convergence-query.ts:19). Writer:
// routes/workflow/handlers/file-save/verify-commit-pr-gate-blocked.ts:48.
//
// `ci_repair` is deliberately NOT counted: retro-kpi-metrics' repairRate counts
// verify_repair alone, and being comparable with that number is the whole point
// of this one.
const VERIFY_REPAIR_CAUSE = 'verify_repair';
const COMPLETED_STATUS = 'completed';

/**
 * Resolves a date range into Date bounds.
 *
 * NOTE: Must stay equivalent to `buildDateWhereClause`'s `createdAt` filter.
 * The two select the rows behind the two halves of one KPI card, so any drift
 * would have them describe different periods; the equality is pinned in
 * first-pass-completion.test.ts.
 *
 * @param dateRange - Optional date filter / 日付フィルター（任意）
 * @returns Bounds, with an unset end omitted / 範囲（未指定の端は省略）
 */
export function resolveRangeBounds(dateRange?: DateRange): RangeBounds {
  const bounds: RangeBounds = {};
  if (dateRange?.startDate) bounds.gte = new Date(dateRange.startDate);
  if (dateRange?.endDate) bounds.lte = new Date(dateRange.endDate);
  return bounds;
}

/**
 * Counts first-pass completions from raw transition rows. Pure — the testable
 * core.
 *
 * @param rows - Full transition history of the candidate tasks / 対象タスクの全遷移
 * @param bounds - Window a task's FIRST completion must fall in / 初完了が入るべき範囲
 * @returns Denominator, numerator and rate / 分母・分子・率
 */
export function countFirstPassCompletions(
  rows: FirstPassTransitionRow[],
  bounds: RangeBounds,
): FirstPassCompletion {
  const firstCompletedAt = new Map<number, Date>();
  const repaired = new Set<number>();

  for (const row of rows) {
    if (row.cause === VERIFY_REPAIR_CAUSE) repaired.add(row.taskId);
    if (row.toStatus !== COMPLETED_STATUS) continue;
    const seen = firstCompletedAt.get(row.taskId);
    // First completion wins, so a re-opened and re-completed task stays in the
    // window it first finished in and is never counted in two (same convention
    // as retro-kpi-metrics.ts groupRetroKpiTaskEvents).
    if (!seen || row.createdAt < seen) firstCompletedAt.set(row.taskId, row.createdAt);
  }

  let completedTasks = 0;
  let repairFreeTasks = 0;
  for (const [taskId, at] of firstCompletedAt) {
    if (bounds.gte && at < bounds.gte) continue;
    if (bounds.lte && at > bounds.lte) continue;
    completedTasks++;
    if (!repaired.has(taskId)) repairFreeTasks++;
  }

  return {
    completedTasks,
    repairFreeTasks,
    // null, never 0: an empty denominator means "no data", while 0 would read
    // as "every task needed a repair".
    rate: completedTasks > 0 ? repairFreeTasks / completedTasks : null,
  };
}

/**
 * Loads the rows and delegates to the pure core. Read-only — two queries.
 *
 * @param dateRange - Optional date filter / 日付フィルター（任意）
 * @returns First-pass completion for the window / 窓の初回完了率
 */
export async function getFirstPassCompletion(dateRange?: DateRange): Promise<FirstPassCompletion> {
  const bounds = resolveRangeBounds(dateRange);
  const hasBounds = bounds.gte !== undefined || bounds.lte !== undefined;

  const anchors = await prisma.workflowTransition.findMany({
    where: { ...(hasBounds ? { createdAt: bounds } : {}), toStatus: COMPLETED_STATUS },
    select: { taskId: true },
    distinct: ['taskId'],
  });
  const taskIds = anchors.map((a) => a.taskId);
  if (taskIds.length === 0) return countFirstPassCompletions([], bounds);

  // Two-stage fetch: both the repair that disqualifies a task and the earlier
  // completion that decides which window it belongs to routinely predate the
  // window, so the second query takes those tasks' FULL history.
  const rows = await prisma.workflowTransition.findMany({
    where: { taskId: { in: taskIds } },
    select: { taskId: true, toStatus: true, cause: true, createdAt: true },
  });
  return countFirstPassCompletions(rows, bounds);
}
