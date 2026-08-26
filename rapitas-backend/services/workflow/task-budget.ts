/**
 * task-budget
 *
 * Per-task spend backstop for model routing. Answers "has this task already
 * spent enough that it must stop buying expensive phases?" from the costs
 * recorded on its own executions.
 *
 * Exists because nothing bounded a single task's spend: task 658 ran four
 * phases on a premium model for $50.04 and no part of the system noticed. The
 * floors all push the tier UP and the evidence cap only nudges it down by one
 * step, so a mis-set floor could repeat itself every phase. This is the one
 * signal that overrides every floor.
 *
 * Not responsible for stopping the task — a task must still be able to finish;
 * it only makes the remaining phases cheaper.
 */

import { prisma } from '../../config/database';

// boundary-tests: manual — this resolver always HAS an answer (a task with no
// spend is a valid state, not a missing row), so it returns a state object
// rather than null and the generated null-contract template does not apply.
// See task-budget.boundary.test.ts.
import { createLogger } from '../../config/logger';
import type { ModelTier } from '../ai/model-discovery';

const log = createLogger('task-budget');

/** Spend after which a task stops buying premium phases. 0 disables the cap. */
function budgetUsd(): number {
  const v = parseFloat(process.env.RAPITAS_TASK_BUDGET_USD ?? '');
  return Number.isFinite(v) && v >= 0 ? v : 25;
}

/**
 * Multiple of the budget past which the cap tightens again. A task this far
 * over is not merely expensive — something is looping.
 */
function hardMultiple(): number {
  const v = parseFloat(process.env.RAPITAS_TASK_BUDGET_HARD_MULTIPLE ?? '');
  return Number.isFinite(v) && v >= 1 ? v : 2;
}

/** A task's spend and the ceiling it implies. */
export interface TaskBudgetState {
  spentUsd: number;
  budgetUsd: number;
  /** Ceiling for the next phase, or undefined while the task is within budget. */
  capTier?: ModelTier;
  reason?: string;
}

/**
 * Coerce a recorded costUsd (Prisma Decimal | number | string) to a number.
 *
 * @param v - Raw column value. / 生のカラム値
 * @returns Finite non-negative number, 0 when unparseable. / 数値化した値
 */
function coerceCost(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  if (v === null || v === undefined) return 0;
  const n = Number.parseFloat(String(v).replace(/"/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Total USD already recorded against a task's executions.
 *
 * @param taskId - Task to total. / 対象タスクID
 * @returns Sum of costUsd, 0 on any read failure. / 合計コスト
 */
export async function getTaskSpendUsd(taskId: number): Promise<number> {
  // A failed lookup is NOT zero spend. Both read as 0 to the caller, which
  // silently removes the ceiling this backstop exists to impose — the same
  // shape of failure as a convergence detector that cannot read its criteria.
  // Fail open, because a DB blip must not throttle every task, but say so.
  const rows = await prisma.agentExecution
    .findMany({ where: { session: { config: { taskId } } }, select: { costUsd: true } })
    .catch((err: unknown) => {
      log.warn(
        { err, taskId },
        '[task-budget] spend lookup failed — treating as 0, so no ceiling applies this phase',
      );
      return [] as Array<{ costUsd: unknown }>;
    });
  return rows.reduce((a, r) => a + coerceCost(r.costUsd), 0);
}

/**
 * Resolve the spend ceiling for a task's NEXT phase.
 *
 * Deliberately graduated rather than a hard stop: over budget the task keeps
 * running on a standard model, and only a task that is running away (past the
 * hard multiple) drops to economy. A task must always be able to finish —
 * stranding it mid-workflow costs more than the phase it would have run.
 *
 * @param taskId - Task about to dispatch a phase. / これからフェーズを実行するタスク
 * @returns Spend state, including a capTier once the budget is exceeded. / 予算状態
 */
export async function resolveTaskBudgetCap(taskId: number): Promise<TaskBudgetState> {
  const budget = budgetUsd();
  const spentUsd = await getTaskSpendUsd(taskId);
  if (budget <= 0) return { spentUsd, budgetUsd: budget };

  if (spentUsd >= budget * hardMultiple()) {
    const state: TaskBudgetState = {
      spentUsd,
      budgetUsd: budget,
      capTier: 'economy',
      reason: `タスク予算の${hardMultiple()}倍超過($${spentUsd.toFixed(2)}/$${budget})`,
    };
    log.warn({ taskId, ...state }, '[task-budget] runaway spend — capping at economy');
    return state;
  }

  if (spentUsd >= budget) {
    const state: TaskBudgetState = {
      spentUsd,
      budgetUsd: budget,
      capTier: 'standard',
      reason: `タスク予算超過($${spentUsd.toFixed(2)}/$${budget})`,
    };
    log.info({ taskId, ...state }, '[task-budget] over budget — capping at standard');
    return state;
  }

  return { spentUsd, budgetUsd: budget };
}
