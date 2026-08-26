/**
 * No-Change Completion Query
 *
 * Aggregates confirmed no-change-needed completions (WorkflowTransition rows
 * with cause verify_no_change_confirmed / research_no_change_complete) and
 * splits them into "immediate" (zero verify_repair bounces occurred before
 * the completion) vs "after-repair" (one or more bounces occurred first).
 * The after-repair subset is higher review priority: a completion reached
 * only after repair back-and-forth is more likely to be a false no-change
 * verdict than one reached in a single pass. Does not aggregate ci_repair —
 * see plan.md #662 for why that mechanism is out of scope. Read-only; does
 * not mutate any rows.
 */

import { prisma } from '../../../../config/database';

/** WorkflowTransition.cause values that mark a confirmed no-change completion. */
const COMPLETION_CAUSES = ['verify_no_change_confirmed', 'research_no_change_complete'] as const;

/** WorkflowTransition.cause value that marks a verify-repair bounce. */
const REPAIR_CAUSE = 'verify_repair';

export type NoChangeCompletionCause = (typeof COMPLETION_CAUSES)[number];

export interface NoChangeCompletionRow {
  taskId: number;
  cause: string;
  createdAt: Date | string;
  id: number;
}

export interface RepairBounceRow {
  taskId: number;
  createdAt: Date | string;
  id: number;
}

/** Per-cause immediate/after-repair split. */
export interface NoChangeCompletionBucket {
  cause: string;
  immediateCount: number;
  afterRepairCount: number;
  totalCount: number;
}

export interface NoChangeCompletionStats {
  /** Total confirmed no-change completions across both causes. */
  totalConfirmedNoChange: number;
  /** Completions with zero verify_repair bounces before them. */
  immediateCount: number;
  /** Completions with one or more verify_repair bounces before them. */
  afterRepairCount: number;
  /** immediateCount / totalConfirmedNoChange (0 when there are no completions). */
  immediateRate: number;
  /** Per-cause breakdown of the same immediate/after-repair split. */
  byCause: NoChangeCompletionBucket[];
}

/**
 * Returns true when `repair` occurred strictly before `completion` in
 * transition order (createdAt ascending, id ascending as a tiebreak for
 * same-millisecond rows).
 *
 * @param repair - Candidate verify_repair row / 判定対象のverify_repair行
 * @param completion - Completion row to compare against / 比較対象の完了行
 * @returns Whether repair precedes completion / repairがcompletionより前かどうか
 */
function occursBefore(repair: RepairBounceRow, completion: NoChangeCompletionRow): boolean {
  const repairTime = new Date(repair.createdAt).getTime();
  const completionTime = new Date(completion.createdAt).getTime();
  if (repairTime !== completionTime) {
    return repairTime < completionTime;
  }
  return repair.id < completion.id;
}

/**
 * Pure aggregation: given confirmed no-change completion rows and
 * verify_repair bounce rows, classify each completion as immediate (no prior
 * bounce) or after-repair (one or more prior bounces). Kept free of Prisma so
 * it can be unit-tested against fixture arrays.
 *
 * @param completions - Confirmed no-change completion rows / 確認済み修正不要完了行
 * @param repairBounces - verify_repair transition rows / verify_repair遷移行
 * @returns Aggregated immediate/after-repair stats / 集計された即決/往復後統計
 */
export function computeNoChangeCompletionStats(
  completions: NoChangeCompletionRow[],
  repairBounces: RepairBounceRow[],
): NoChangeCompletionStats {
  const bouncesByTask = new Map<number, RepairBounceRow[]>();
  for (const bounce of repairBounces) {
    const list = bouncesByTask.get(bounce.taskId) ?? [];
    list.push(bounce);
    bouncesByTask.set(bounce.taskId, list);
  }

  let immediateCount = 0;
  let afterRepairCount = 0;
  const byCauseMap = new Map<string, { immediateCount: number; afterRepairCount: number }>();

  for (const completion of completions) {
    const candidateBounces = bouncesByTask.get(completion.taskId) ?? [];
    const priorBounceCount = candidateBounces.filter((bounce) =>
      occursBefore(bounce, completion),
    ).length;

    const bucket = byCauseMap.get(completion.cause) ?? { immediateCount: 0, afterRepairCount: 0 };
    if (priorBounceCount === 0) {
      immediateCount++;
      bucket.immediateCount++;
    } else {
      afterRepairCount++;
      bucket.afterRepairCount++;
    }
    byCauseMap.set(completion.cause, bucket);
  }

  const totalConfirmedNoChange = completions.length;
  const byCause: NoChangeCompletionBucket[] = COMPLETION_CAUSES.map((cause) => {
    const bucket = byCauseMap.get(cause) ?? { immediateCount: 0, afterRepairCount: 0 };
    return {
      cause,
      immediateCount: bucket.immediateCount,
      afterRepairCount: bucket.afterRepairCount,
      totalCount: bucket.immediateCount + bucket.afterRepairCount,
    };
  });

  return {
    totalConfirmedNoChange,
    immediateCount,
    afterRepairCount,
    immediateRate: totalConfirmedNoChange > 0 ? round4(immediateCount / totalConfirmedNoChange) : 0,
    byCause,
  };
}

/**
 * Loads confirmed no-change completion transitions and the verify_repair
 * bounces for the tasks involved, then delegates to
 * computeNoChangeCompletionStats for the actual aggregation. Read-only — up
 * to two Prisma queries, no writes.
 *
 * @returns Aggregated immediate/after-repair stats / 集計された即決/往復後統計
 */
export async function getNoChangeCompletionStats(): Promise<NoChangeCompletionStats> {
  const completions = await prisma.workflowTransition.findMany({
    where: { cause: { in: [...COMPLETION_CAUSES] } },
    select: { taskId: true, cause: true, createdAt: true, id: true },
  });

  if (completions.length === 0) {
    return computeNoChangeCompletionStats([], []);
  }

  const taskIds = Array.from(new Set(completions.map((c) => c.taskId)));
  const repairBounces = await prisma.workflowTransition.findMany({
    where: { taskId: { in: taskIds }, cause: REPAIR_CAUSE },
    select: { taskId: true, createdAt: true, id: true },
  });

  return computeNoChangeCompletionStats(completions, repairBounces);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
