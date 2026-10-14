/**
 * auto-run-hold-check
 *
 * Says whether a task is held out of auto-run, in one place, so the RESUME
 * path can ask the same question the selection path already asks.
 *
 * Why this exists. `eligibleTopLevelTodoWhere` / `selectNextTask` respect
 * `autoRunExcluded`, `workflowDisabled` and `haltReason`, but
 * auto-run-resolve-outcome's "currentTaskId is in-progress with no queue item,
 * so resume it" branch re-enqueued unconditionally. Measured 2026-10-13:
 * setting `autoRunExcluded` on #1214 was followed within seconds by queue item
 * #4246 and a $8.86 execution; cancelling that item produced #4247 for the same
 * task. The only thing that actually stopped it was changing `status` to
 * `blocked` — a different state with different meaning. An operator who parks a
 * task must not keep paying for it.
 *
 * NOT responsible for deciding what to do about a hold — the caller releases
 * the theme's current task and moves on.
 */

import type { PrismaClient } from '../../../generated/prisma-postgres';

/** Why a task is held, or null when it is runnable. */
export type AutoRunHoldReason = 'auto_run_excluded' | 'workflow_disabled' | 'halted';

/** Whether a task is held out of auto-run, and why. */
export interface AutoRunHold {
  held: boolean;
  reason: AutoRunHoldReason | null;
}

/** The hold-bearing fields, as read from a Task row. */
export interface HoldFields {
  autoRunExcluded?: boolean | null;
  workflowDisabled?: boolean | null;
  haltReason?: string | null;
}

const RUNNABLE: AutoRunHold = { held: false, reason: null };

/**
 * Classify a task's hold state.
 *
 * `autoRunExcluded` is reported first because it is the operator's explicit
 * choice, and that is the most useful thing to name in a log line when several
 * holds apply at once.
 *
 * A missing row is NOT a hold: treating an unreadable task as held would let a
 * transient DB failure stop resumption, which is the opposite of the safe
 * default here (the selection side fails open the same way).
 *
 * @param task - Task row fields, or null when unreadable / タスク行、読めなければ null
 * @returns Whether it is held, and why / 保留かどうかと理由
 */
export function classifyAutoRunHold(task: HoldFields | null | undefined): AutoRunHold {
  if (!task) return RUNNABLE;
  if (task.autoRunExcluded) return { held: true, reason: 'auto_run_excluded' };
  if (task.workflowDisabled) return { held: true, reason: 'workflow_disabled' };
  // NOTE: re-injecting a halted task amplifies the halt (K-10720), and
  // eligibleTopLevelTodoWhere already requires haltReason: null.
  if (task.haltReason?.trim()) return { held: true, reason: 'halted' };
  return RUNNABLE;
}

/**
 * Read a task's hold state from the database.
 *
 * Fails open (`held: false`) on a read error for the reason above.
 *
 * @param prisma - Prisma client / Prisma クライアント
 * @param taskId - Task to check / 対象タスク
 * @returns Whether it is held, and why / 保留かどうかと理由
 */
export async function readAutoRunHold(prisma: PrismaClient, taskId: number): Promise<AutoRunHold> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { autoRunExcluded: true, workflowDisabled: true, haltReason: true },
    })
    .catch(() => null);
  return classifyAutoRunHold(task);
}
