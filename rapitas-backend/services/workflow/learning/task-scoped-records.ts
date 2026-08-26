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
  };
}
