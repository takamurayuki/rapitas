/**
 * task-status-write
 *
 * The status write of updateTask: one batch transaction for a terminal status
 * (the task update, the theme's currentTaskId release and — for a completion —
 * the deliverable completion record of notes stage 1), or the plain update
 * when the client has no `$transaction`.
 *
 * Not responsible for deciding the update's fields — task-mutations builds them.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { releaseCurrentArgs, releaseThemeCurrentOnTerminal } from './task-terminal-current-release';
import {
  completionRecordBatchOps,
  onTaskCompleted,
} from '../notes/deliverables/deliverable-completion';

type PrismaInstance = InstanceType<typeof PrismaClient>;

/** A manual completion this update performs, if any. */
export interface ManualCompletion {
  /** true when the task moves to done from another status. */
  completing: boolean;
  /** The one time written to completedAt, updatedAt and the record. */
  completionAt: Date;
  workspaceId: number | null;
}

/**
 * Write the task update, atomically with the release and the completion record.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task being updated / 更新するタスクID
 * @param updateArgs - The task.update arguments / task.update の引数
 * @param status - The new status, if changed / 新しい status
 * @param completion - The manual completion, if this is one / 手動完了の情報
 */
export async function writeTaskStatusUpdate(
  prisma: PrismaInstance,
  taskId: number,
  updateArgs: Parameters<PrismaInstance['task']['update']>[0],
  status: string | undefined,
  completion: ManualCompletion,
): Promise<void> {
  const { completing, completionAt, workspaceId } = completion;
  // NOTE: atomic by design (acceptance 1) — a failed release also fails the status update.
  // Terminal status: release the theme's currentTaskId in the SAME transaction (task 1009).
  if ((status === 'done' || status === 'cancelled') && typeof prisma.$transaction === 'function') {
    // Notes stage 1: a client without the record delegate (a stand-in) gets no
    // record ops and falls back to the after-the-fact write below.
    const recordOps =
      completing && prisma.taskDeliverableCompletion
        ? completionRecordBatchOps(prisma, taskId, workspaceId, 'manual', completionAt)
        : [];
    // Batch form: PrismaPromises are lazy, so nothing runs until $transaction executes them.
    await prisma.$transaction([
      prisma.task.update(updateArgs),
      prisma.themeAutoRun.updateMany(releaseCurrentArgs(taskId)),
      ...recordOps,
    ]);
    if (completing) {
      onTaskCompleted(taskId, 'manual', {
        recorded: recordOps.length > 0,
        completedAt: completionAt,
        db: prisma,
      });
    }
    return;
  }
  await prisma.task.update(updateArgs);
  await releaseThemeCurrentOnTerminal(prisma, taskId, status);
  if (completing) {
    onTaskCompleted(taskId, 'manual', { recorded: false, completedAt: completionAt, db: prisma });
  }
}
