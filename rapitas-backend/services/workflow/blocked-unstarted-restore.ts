/**
 * blocked-unstarted-restore
 *
 * Decides, for a task the reconciler is about to auto-retry from `blocked`,
 * whether the block came from the hang backstop firing on a task that never
 * executed (a slot-starved queue wait) and, if so, restores `status=todo`
 * WITHOUT the draft reset. It does NOT decide when the backstop fires.
 *
 * Why: the draft reset rewinds workflowStatus (in_progress -> draft) while the
 * research/plan/verify artifacts and the worktree stay, so a task that was
 * only ever waiting for a slot lost its place for nothing (task 1153, #1166).
 */
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import {
  HANG_BACKSTOP_CAUSE,
  NEVER_EXECUTED_SINCE_CURRENT_KEY,
} from './auto-run/auto-run-hang-backstop-transition';

const log = createLogger('workflow:blocked-unstarted-restore');

/** Transition cause written when a never-executed backstop block is restored. */
export const BLOCKED_UNSTARTED_RESTORE_CAUSE = 'blocked_unstarted_restore';

/** Restores allowed per task before it is left blocked for an operator. */
export const MAX_UNSTARTED_RESTORES = 3;

/** Minimal Prisma surface used here (the real client satisfies it structurally). */
export interface BlockedRestorePrisma {
  workflowTransition: {
    findFirst(args: unknown): Promise<{ cause: string; metadata: string } | null>;
    count(args: unknown): Promise<number>;
  };
  task: {
    update(args: unknown): Promise<unknown>;
  };
}

export type BlockedRestoreOutcome = 'restored' | 'capped' | 'not_applicable';

/**
 * Restore a blocked task that the backstop blocked without it ever executing.
 *
 * 'capped' means the caller must NOT reset to draft either (cap reached,
 * halted, or the cap/update step failed — leaving it blocked is the safe side;
 * a failed block classification stays 'not_applicable' = pre-existing behaviour).
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param task - Blocked task row. / ブロック中のタスク
 * @returns restored / capped (leave as is) / not_applicable (continue the normal retry). / 復元結果
 */
export async function restoreBlockedUnstartedTask(
  prisma: BlockedRestorePrisma,
  task: { id: number; workflowStatus: string | null; haltReason?: string | null },
): Promise<BlockedRestoreOutcome> {
  let latest: { cause: string; metadata: string } | null;
  try {
    latest = await prisma.workflowTransition.findFirst({
      where: { taskId: task.id, toStatus: 'blocked' },
      orderBy: { createdAt: 'desc' },
      select: { cause: true, metadata: true },
    });
  } catch {
    // Cannot classify the block: keep the pre-existing retry behaviour rather than guess.
    return 'not_applicable';
  }
  try {
    if (!latest || latest.cause !== HANG_BACKSTOP_CAUSE) return 'not_applicable';

    let flagged = false;
    try {
      flagged = JSON.parse(latest.metadata)?.[NEVER_EXECUTED_SINCE_CURRENT_KEY] === true;
    } catch {
      flagged = false; // legacy / malformed metadata keeps the old behaviour
    }
    if (!flagged) return 'not_applicable';

    if (task.haltReason) return 'not_applicable';

    const restores = await prisma.workflowTransition.count({
      where: { taskId: task.id, cause: BLOCKED_UNSTARTED_RESTORE_CAUSE },
    });
    if (restores >= MAX_UNSTARTED_RESTORES) {
      log.info(
        { taskId: task.id, restores },
        '[blocked-unstarted-restore] cap reached — leaving blocked',
      );
      return 'capped';
    }

    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'todo', updatedAt: new Date() },
    });
    await recordTransition({
      taskId: task.id,
      fromStatus: task.workflowStatus,
      toStatus: task.workflowStatus ?? 'todo',
      actor: 'system',
      cause: BLOCKED_UNSTARTED_RESTORE_CAUSE,
      metadata: { reason: 'backstop_blocked_never_executed', attempt: restores + 1 },
    });
    return 'restored';
  } catch (err) {
    log.warn(
      { err, taskId: task.id },
      '[blocked-unstarted-restore] cap/update failed — leaving blocked (no draft reset)',
    );
    return 'capped';
  }
}
