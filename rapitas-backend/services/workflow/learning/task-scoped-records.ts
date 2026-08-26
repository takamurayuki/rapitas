/**
 * task-scoped-records
 *
 * The single definition of "a learning record whose duration describes a whole
 * task". `WorkflowLearningRecord` holds two populations: one row per task from
 * recordWorkflowCompletion, and one row per execution from
 * recordWorkflowExecution. Their `actualDurationMinutes` mean different things,
 * and averaging them together answers neither question.
 */

/**
 * When `actualDurationMinutes` started meaning work time instead of lead time.
 *
 * Rows written before this measure filing-to-done, including however long the
 * task queued — 7 minutes to 8.5 days across the 60 rows sampled the day this
 * changed. They answer a different question and are excluded rather than
 * silently averaged in. The population starts near empty and refills.
 */
export const WORK_TIME_CUTOVER = new Date('2026-08-26T05:00:00Z');

/**
 * Prisma `where` fragment selecting only per-task rows.
 *
 * `estimatedDuration` is the marker: only the per-task writer has ever set it,
 * so a non-null value identifies that writer, historically and going forward.
 * `complexityFactors` is belt-and-suspenders — the per-execution writer leaves
 * it at its `{}` default.
 *
 * Measured 2026-08-26: task 667 was estimated at 1 minute and took 31 and 51.
 * The estimator was averaging 1-, 5- and 8-minute PHASES into a whole-task
 * figure, collapsing it toward the length of a single phase.
 *
 * @returns A fresh fragment, so callers can spread it without sharing state. / 呼び出しごとの新しい条件
 */
export function taskScopedRecordWhere(): Record<string, unknown> {
  return {
    estimatedDuration: { not: null },
    complexityFactors: { not: '{}' },
    createdAt: { gte: WORK_TIME_CUTOVER },
  };
}
