/**
 * Repair Convergence Query
 *
 * Aggregates WorkflowTransition rows for the self-repair bounce mechanisms
 * (verify_repair, ci_repair — see verify-self-repair.ts / ci-self-repair.ts)
 * into a single "does the self-repair loop actually converge?" answer: how
 * many tasks ever entered a repair loop, how many eventually passed vs stayed
 * blocked, the average number of repair iterations needed to converge, and
 * the distribution of iteration counts. Read-only; does not mutate any rows.
 */

import { prisma } from '../../../config/database';

/** WorkflowTransition.cause values that mark a self-repair bounce. */
const REPAIR_CAUSES = ['verify_repair', 'ci_repair'] as const;

/** Task statuses treated as "converged" (the repaired task ultimately succeeded). */
const CONVERGED_STATUSES = new Set(['completed', 'done']);
/** Task statuses treated as "stayed blocked" (repair attempts exhausted). */
const BLOCKED_STATUSES = new Set(['blocked']);

export interface RepairTransitionRow {
  taskId: number;
  cause: string;
}

export interface TaskFinalState {
  taskId: number;
  status: string;
}

/** Count of tasks that needed exactly N repair iterations. */
export interface IterationBucket {
  iterations: number;
  taskCount: number;
}

/** Raw attempt volume per repair mechanism, independent of outcome. */
export interface RepairCauseBreakdown {
  cause: string;
  totalAttempts: number;
  tasksAffected: number;
}

export interface RepairConvergenceStats {
  /** Distinct tasks that had at least one repair bounce (verify or CI). */
  tasksEnteredRepairLoop: number;
  /** Of those, how many ultimately reached a completed/done status. */
  convergedCount: number;
  /** Of those, how many are currently blocked (repair budget exhausted). */
  blockedCount: number;
  /** Of those, how many are still in-progress / neither terminal state yet. */
  pendingCount: number;
  /** convergedCount / tasksEnteredRepairLoop (0 when no tasks entered the loop). */
  convergenceRate: number;
  /** Mean repair iterations for tasks that converged; null when none converged yet. */
  averageIterationsToConvergence: number | null;
  /** Histogram of iteration counts across ALL tasks that entered the loop. */
  iterationDistribution: IterationBucket[];
  /** Raw attempt counts split by repair mechanism (verify vs CI). */
  attemptsByCause: RepairCauseBreakdown[];
}

/**
 * Pure aggregation: given the repair-bounce transition rows and each
 * affected task's current status, compute convergence stats. Kept free of
 * Prisma so it can be unit-tested against fixture arrays.
 *
 * @param repairTransitions - One row per repair bounce (taskId + cause) / 修復バウンス行
 * @param taskStatuses - Current status per task that appears above / タスクの現在ステータス
 * @returns Aggregated convergence stats / 集計された収束統計
 */
export function computeRepairConvergenceStats(
  repairTransitions: RepairTransitionRow[],
  taskStatuses: TaskFinalState[],
): RepairConvergenceStats {
  const statusByTask = new Map(taskStatuses.map((t) => [t.taskId, t.status]));

  const iterationsByTask = new Map<number, number>();
  const causeStats = new Map<string, { totalAttempts: number; tasks: Set<number> }>();

  for (const row of repairTransitions) {
    iterationsByTask.set(row.taskId, (iterationsByTask.get(row.taskId) ?? 0) + 1);

    const bucket = causeStats.get(row.cause) ?? { totalAttempts: 0, tasks: new Set<number>() };
    bucket.totalAttempts++;
    bucket.tasks.add(row.taskId);
    causeStats.set(row.cause, bucket);
  }

  let convergedCount = 0;
  let blockedCount = 0;
  let pendingCount = 0;
  const convergedIterations: number[] = [];
  const distributionMap = new Map<number, number>();

  for (const [taskId, iterations] of iterationsByTask) {
    const status = statusByTask.get(taskId);
    if (status && CONVERGED_STATUSES.has(status)) {
      convergedCount++;
      convergedIterations.push(iterations);
    } else if (status && BLOCKED_STATUSES.has(status)) {
      blockedCount++;
    } else {
      pendingCount++;
    }
    distributionMap.set(iterations, (distributionMap.get(iterations) ?? 0) + 1);
  }

  const tasksEnteredRepairLoop = iterationsByTask.size;
  const averageIterationsToConvergence =
    convergedIterations.length > 0
      ? round2(convergedIterations.reduce((sum, n) => sum + n, 0) / convergedIterations.length)
      : null;

  const iterationDistribution: IterationBucket[] = Array.from(distributionMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([iterations, taskCount]) => ({ iterations, taskCount }));

  const attemptsByCause: RepairCauseBreakdown[] = REPAIR_CAUSES.map((cause) => {
    const bucket = causeStats.get(cause);
    return {
      cause,
      totalAttempts: bucket?.totalAttempts ?? 0,
      tasksAffected: bucket?.tasks.size ?? 0,
    };
  });

  return {
    tasksEnteredRepairLoop,
    convergedCount,
    blockedCount,
    pendingCount,
    convergenceRate:
      tasksEnteredRepairLoop > 0 ? round4(convergedCount / tasksEnteredRepairLoop) : 0,
    averageIterationsToConvergence,
    iterationDistribution,
    attemptsByCause,
  };
}

/**
 * Loads repair-bounce transitions and their tasks' current status, then
 * delegates to computeRepairConvergenceStats for the actual aggregation.
 * Read-only — two Prisma queries, no writes.
 *
 * @returns Aggregated convergence stats / 集計された収束統計
 */
export async function getRepairConvergenceStats(): Promise<RepairConvergenceStats> {
  const repairTransitions = await prisma.workflowTransition.findMany({
    where: { cause: { in: [...REPAIR_CAUSES] } },
    select: { taskId: true, cause: true },
  });

  if (repairTransitions.length === 0) {
    return computeRepairConvergenceStats([], []);
  }

  const taskIds = Array.from(new Set(repairTransitions.map((t) => t.taskId)));
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, status: true },
  });

  const taskStatuses: TaskFinalState[] = tasks.map((t) => ({ taskId: t.id, status: t.status }));
  return computeRepairConvergenceStats(repairTransitions, taskStatuses);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
