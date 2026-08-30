/**
 * verify-self-repair-budget
 *
 * Handles verify-self-repair's repair-budget judgement (remaining attempts,
 * non-convergence cutoff). Not responsible for DB writes to Task/verify.md or
 * recording transitions — the caller (verify-self-repair.ts) mutates state
 * based on the verdicts returned here.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  parseAcceptanceCriteria,
  detectNonConvergence,
  identifyIndictedCriteria,
  type ConvergenceVerdict,
} from './verify-convergence';
import { DEFAULT_VERIFY_REPAIR_LIMIT } from './blocked-task-policy';

const log = createLogger('workflow:verify-self-repair');

/** WorkflowTransition.cause used to count + identify repair bounces. */
export const REPAIR_CAUSE = 'verify_repair';

/**
 * Resolve the max verify->implement repair cycles: UserSettings.verifyRepairLimit
 * when set (UI-configurable), else the env/default. Read via cast — the column is
 * pending Prisma client regen until the next restart.
 *
 * @returns Max repair cycles / 最大修復サイクル数
 */
export async function resolveMaxRepairs(): Promise<number> {
  const s = (await prisma.userSettings.findFirst().catch(() => null)) as {
    verifyRepairLimit?: number | null;
  } | null;
  const v = s?.verifyRepairLimit;
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_VERIFY_REPAIR_LIMIT;
}

/**
 * Start of the current repair window (most recent wipe): a manual retry, or
 * REPLACING acceptance criteria — old reasons cite criteria by number, and a
 * replacement repoints those numbers (task 672 tripped the cutoff on two
 * pre-correction reasons after criteria were corrected mid-flight).
 *
 * @param taskId - Task id / タスクID
 * @returns Window start, or null when never wiped. / 窓の起点、無ければ null
 */
async function resolveRepairWindowStart(taskId: number): Promise<Date | null> {
  const row = await prisma.activityLog
    .findFirst({
      where: { taskId, action: { in: ['task_retried', 'acceptance_criteria_changed'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    .catch(() => null);
  return row?.createdAt ?? null;
}

/**
 * Count how many verify→implement repair bounces this task has already had.
 * @param taskId - Task id / タスクID
 * @returns Prior repair count / これまでの修復回数
 */
export async function countPriorRepairs(taskId: number): Promise<number> {
  // Reset the budget on each manual retry: count only bounces SINCE the most
  // recent `task_retried`. Without this, a retried blocked task whose worktree
  // was cleaned re-verifies an empty tree, finds the OLD budget exhausted, and
  // re-blocks instead of bouncing — the implementation is never redone.
  const windowStart = await resolveRepairWindowStart(taskId);
  return prisma.workflowTransition
    .count({
      where: {
        taskId,
        cause: REPAIR_CAUSE,
        ...(windowStart ? { createdAt: { gt: windowStart } } : {}),
      },
    })
    .catch((err) => {
      // FAIL CLOSED: a count error must NOT read as "0 prior repairs" (that
      // would reset the budget and bounce forever). MAX_SAFE_INTEGER makes
      // `prior >= max` true for any configured max, so the caller blocks.
      log.warn(
        { err, taskId },
        '[verify-repair] Failed to count prior repairs — treating budget as exhausted',
      );
      return Number.MAX_SAFE_INTEGER;
    });
}

/**
 * Detect a non-converging repair loop (task 619): 2+ flags on one criterion
 * across current + prior reasons (same window as countPriorRepairs) = cutoff.
 * FAIL OPEN — unlike countPriorRepairs' fail-closed budget, an unidentifiable
 * reason / missing criteria / DB error must never stop a progressing task.
 *
 * @param taskId - Task id / タスクID
 * @param currentReason - The reason about to trigger this bounce / 今回の差し戻し理由
 * @returns Cutoff verdict / 収束判定
 */
export async function detectRepairNonConvergence(
  taskId: number,
  currentReason: string,
): Promise<ConvergenceVerdict> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { acceptanceCriteria: true },
    });
    const criteria = parseAcceptanceCriteria(task?.acceptanceCriteria ?? null);
    // Short-circuit BEFORE any transition query: no criteria → nothing to match.
    if (criteria.length === 0) return { cutoff: false };

    // A manual retry grants a fresh slate — and so does REPLACING the acceptance
    // criteria. Reasons recorded against the old criteria cite them by number,
    // and after a replacement those numbers point at different criteria: task
    // 672 had its criteria corrected mid-flight and the next single bounce
    // tripped the cutoff on two pre-correction reasons. Whichever boundary is
    // more recent wins.
    const boundary = await prisma.activityLog
      .findFirst({
        where: { taskId, action: { in: ['task_retried', 'acceptance_criteria_changed'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      .catch(() => null);
    const rows = await prisma.workflowTransition.findMany({
      where: {
        taskId,
        cause: REPAIR_CAUSE,
        ...(boundary ? { createdAt: { gt: boundary.createdAt } } : {}),
      },
      select: { metadata: true },
    });

    const priorReasons: string[] = [];
    for (const row of rows as { metadata: string | null }[]) {
      // Malformed metadata rows are skipped (retro-evidence pattern), never thrown.
      try {
        const meta = JSON.parse(row.metadata ?? '{}') as { reason?: unknown };
        if (typeof meta.reason === 'string' && meta.reason) priorReasons.push(meta.reason);
      } catch {}
    }
    const verdict = detectNonConvergence(currentReason, priorReasons, criteria);

    // Make the fail-open audible: a no-cutoff verdict looks the same whether
    // a task is genuinely converging or the detector simply can't read the
    // criteria — task 666 burned ten bounces in the latter state unnoticed.
    if (!verdict.cutoff && priorReasons.length >= 2) {
      const everIdentified = [...priorReasons, currentReason].some(
        (r) => identifyIndictedCriteria(r, criteria).length > 0,
      );
      if (!everIdentified) {
        log.warn(
          { taskId, bounces: priorReasons.length + 1, criteria: criteria.length },
          '[verify-repair] Non-convergence detector matched NOTHING across the whole repair window — the cutoff cannot fire for this task',
        );
      }
    }
    return verdict;
  } catch (err) {
    log.warn(
      { err, taskId },
      '[verify-repair] Non-convergence check failed — failing open (no cutoff)',
    );
    return { cutoff: false };
  }
}
