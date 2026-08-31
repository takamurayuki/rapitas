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

import { prisma } from '../../../../../config/database';
import {
  parseAcceptanceCriteria,
  identifyIndictedCriteria,
} from '../../../../../services/workflow/verify-convergence';

/** WorkflowTransition.cause values that mark a self-repair bounce. */
const REPAIR_CAUSES = ['verify_repair', 'ci_repair'] as const;

/** Task statuses treated as "converged" (the repaired task ultimately succeeded). */
const CONVERGED_STATUSES = new Set(['completed', 'done']);
/** Task statuses treated as "stayed blocked" (repair attempts exhausted). */
const BLOCKED_STATUSES = new Set(['blocked']);

export interface RepairTransitionRow {
  taskId: number;
  cause: string;
  /** Raw WorkflowTransition.metadata JSON string, when available (task 798: `verify_repair` rows carry `{reason}`, read-only reuse of data verify-self-repair.ts already records — not written by this module). */
  metadata?: string | null;
}

export interface TaskFinalState {
  taskId: number;
  status: string;
  /** Raw Task.acceptanceCriteria column value (task 798: classifies verify_repair reasons as identified/unidentified via the same matcher the repair loop itself uses). */
  acceptanceCriteria?: unknown;
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
  /**
   * Of verify_repair bounces whose task has acceptance criteria AND whose
   * recorded reason could be classified (task 798), how many could NOT be
   * mapped to any criterion by identifyIndictedCriteria — the same matcher
   * verify-self-repair's non-convergence cutoff uses, applied here read-only
   * against data it already records (`metadata.reason` + Task.acceptanceCriteria)
   * to measure feedback precision without touching the protected repair-loop
   * module. ci_repair rows carry no acceptance-criteria reasoning and are
   * excluded from both counts, as are rows whose task has no criteria or whose
   * metadata lacks a `reason` string (no signal either way, not counted as 0).
   */
  verifyRepairIdentifiedCount: number;
  /** See {@link verifyRepairIdentifiedCount}. */
  verifyRepairUnidentifiedCount: number;
  /** verifyRepairUnidentifiedCount / (identified + unidentified); 0 when no row could be classified yet. */
  verifyRepairUnidentifiedRate: number;
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

  const criteriaByTask = new Map(
    taskStatuses.map((t) => [t.taskId, parseAcceptanceCriteria(t.acceptanceCriteria ?? null)]),
  );
  let verifyRepairIdentifiedCount = 0;
  let verifyRepairUnidentifiedCount = 0;
  for (const row of repairTransitions) {
    if (row.cause !== 'verify_repair') continue;
    const criteria = criteriaByTask.get(row.taskId);
    // No criteria to match against → no signal either way (excluded, not "unidentified").
    if (!criteria || criteria.length === 0) continue;
    const reason = parseReason(row.metadata);
    if (reason === null) continue;
    if (identifyIndictedCriteria(reason, criteria).length > 0) verifyRepairIdentifiedCount++;
    else verifyRepairUnidentifiedCount++;
  }
  const verifyRepairIdentifiedTotal = verifyRepairIdentifiedCount + verifyRepairUnidentifiedCount;

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
    verifyRepairIdentifiedCount,
    verifyRepairUnidentifiedCount,
    verifyRepairUnidentifiedRate:
      verifyRepairIdentifiedTotal > 0
        ? round4(verifyRepairUnidentifiedCount / verifyRepairIdentifiedTotal)
        : 0,
  };
}

/**
 * Extract the `reason` string verify-self-repair.ts already records on every
 * verify_repair WorkflowTransition. Returns null (not '') when the row has no
 * usable reason — callers must treat that as "no signal" rather than counting
 * it toward either identified/unidentified bucket.
 *
 * @param metadata - Raw metadata column value. / 生の metadata 列値
 * @returns The reason text, or null when absent/unparseable. / 理由文字列、無ければ null
 */
function parseReason(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { reason?: unknown };
    return typeof parsed.reason === 'string' && parsed.reason ? parsed.reason : null;
  } catch {
    return null;
  }
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
    select: { taskId: true, cause: true, metadata: true },
  });

  if (repairTransitions.length === 0) {
    return computeRepairConvergenceStats([], []);
  }

  const taskIds = Array.from(new Set(repairTransitions.map((t) => t.taskId)));
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, status: true, acceptanceCriteria: true },
  });

  const taskStatuses: TaskFinalState[] = tasks.map((t) => ({
    taskId: t.id,
    status: t.status,
    acceptanceCriteria: t.acceptanceCriteria,
  }));
  return computeRepairConvergenceStats(repairTransitions, taskStatuses);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
