/**
 * task-work-time
 *
 * How long a task actually took to DO, as distinct from how long it sat around.
 *
 * `completedAt - createdAt` measures lead time — filing to done — and in an
 * autonomous system most of that is backlog queueing. Measured 2026-08-26 over
 * 60 task-scoped rows: 7 minutes at the low end, 12,292 (8.5 days) at the high
 * end, median 332. Estimators reading it were predicting how long a task would
 * WAIT, not how long it would run.
 */

import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';

const log = createLogger('task-work-time');

/**
 * Total agent execution time for a task, in minutes.
 *
 * Sums every execution belonging to the task rather than measuring wall clock,
 * so a task that waited two days in the backlog and ran for seven minutes
 * records seven.
 *
 * @param taskId - Task to measure. / 対象タスクID
 * @returns Minutes of execution time, or null when nothing ran. / 実行時間（分）、実行が無ければ null
 */
export async function sumTaskWorkMinutes(taskId: number): Promise<number | null> {
  try {
    const executions = await prisma.agentExecution.findMany({
      where: { session: { config: { taskId } } },
      select: { executionTimeMs: true },
    });
    const totalMs = executions.reduce((sum, e) => sum + (e.executionTimeMs ?? 0), 0);
    if (totalMs <= 0) return null;
    // Round UP so a sub-minute task records 1 rather than 0 — a zero would read
    // as "no data" to every consumer that null-checks the column.
    return Math.max(1, Math.round(totalMs / 60000));
  } catch (err) {
    log.warn({ err, taskId }, '[task-work-time] Failed to sum execution time');
    return null;
  }
}
