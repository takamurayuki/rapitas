/**
 * repair-stagnation
 *
 * Converts raw `WorkflowTransition` rows into the repair-iteration count used
 * by the stagnation-risk banner in the task-detail workflow section. MVP scope
 * only (iteration count + threshold warning) — change-set size, test-pass-rate
 * delta and 30-day comparison are out of scope until structured metrics exist
 * for those dimensions. NOT responsible for fetching or rendering — pure data
 * transformation only.
 */

/** Shape of one row from GET /workflow/tasks/:taskId/transitions. */
export interface RawRepairTransition {
  id?: number | string | null;
  cause?: string | null;
  createdAt?: string | null;
}

const REPAIR_CAUSES = ['verify_repair', 'ci_repair'] as const;

/** The two WorkflowTransition causes that represent a repair-loop bounce. */
export type RepairCause = (typeof REPAIR_CAUSES)[number];

/** One repair-loop iteration, ready for counting/display (chronological order). */
export interface RepairIterationEntry {
  id: string;
  cause: RepairCause;
  createdAt: string | null;
}

function isRepairCause(cause: string | null | undefined): cause is RepairCause {
  return (REPAIR_CAUSES as readonly string[]).includes(cause ?? '');
}

/**
 * Number of combined verify_repair + ci_repair iterations that must
 * accumulate before the stagnation-risk banner appears. Reachable under the
 * default per-cause repair caps (verify_repair max 2 + ci_repair max 2 = up
 * to 4 combined bounces before the task blocks) — see
 * DEFAULT_MAX_VERIFY_REPAIRS / DEFAULT_MAX_CI_REPAIRS.
 */
export const STAGNATION_ITERATION_THRESHOLD = 3;

/**
 * Filters a task's transition log down to repair-loop iterations
 * (verify_repair / ci_repair bounces), combined and in the input's
 * chronological order.
 *
 * @param transitions - Rows from GET /workflow/tasks/:taskId/transitions, createdAt asc / 遷移ログの行
 * @returns Repair iteration entries in chronological order / 修復反復エントリ
 */
export function deriveRepairIterations(transitions: RawRepairTransition[]): RepairIterationEntry[] {
  const entries: RepairIterationEntry[] = [];
  transitions.forEach((row, index) => {
    if (!isRepairCause(row.cause)) return;
    entries.push({
      id: `repair-${row.id ?? index}`,
      cause: row.cause,
      createdAt: row.createdAt ?? null,
    });
  });
  return entries;
}

/**
 * Whether the accumulated repair-iteration count has reached the
 * stagnation-risk threshold. Purely a count comparison — MVP does not compute
 * learning velocity (change-set size / test-pass-rate slope), so callers must
 * present this as neutral data ("N回の反復が記録されている"), never as an
 * instruction to stop.
 *
 * @param iterationCount - Combined verify_repair + ci_repair iteration count / 修復反復回数
 * @returns True once iterationCount reaches STAGNATION_ITERATION_THRESHOLD / 閾値到達
 */
export function hasReachedStagnationThreshold(iterationCount: number): boolean {
  return iterationCount >= STAGNATION_ITERATION_THRESHOLD;
}
