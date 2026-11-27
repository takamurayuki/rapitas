/**
 * awaiting-ci-release-txn
 *
 * The atomic step of handing a CI-waiting task's queue items back (task 1568): ONE transaction
 * that first writes the task row under the CI-wait condition and, only when that write matched,
 * marks the items `completed` + `awaiting_ci`. Not responsible for releasing the theme slot or
 * choosing the next task — see auto-run-release-awaiting-ci.ts.
 *
 * NOTE: ci-self-repair changes the task row FIRST and checks for an existing queue item AFTER
 * (ci-self-repair.ts, `prisma.task.update` before `enqueue`). This transaction relies on that
 * order: its task-row write takes the row lock (PostgreSQL) / the write lock (SQLite), so a repair
 * that starts meanwhile waits for the commit and then sees the item already `completed` and
 * queues its own. If that order is ever reversed, a repair could skip queueing because it saw the
 * still-running item that this transaction then completes.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { AWAITING_CI_PHASE, CI_WAIT_PHASE } from '../awaiting-ci';

/** Outcome of {@link handBackAwaitingCiItems}. */
export type HandBackResult =
  | { result: 'released'; count: number }
  | { result: 'lost' }
  | { result: 'failed'; error: unknown };

/**
 * Hand the given items back in one transaction.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - The CI-waiting task / CI待ちのタスクID
 * @param itemIds - Active items read before the transaction; only these are touched / 事前に読んだ項目ID
 * @returns `released` (items updated), `lost` (the task is no longer CI-waiting: nothing written),
 *   or `failed` (the transaction threw: nothing written) / 結果
 */
export async function handBackAwaitingCiItems(
  prisma: PrismaClient,
  taskId: number,
  itemIds: number[],
): Promise<HandBackResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<HandBackResult> => {
      // Writes only updatedAt: the condition is the point (a count of 0 = a repair changed the
      // task first), and the write is what serialises this against ci-self-repair.
      const held = await tx.task.updateMany({
        where: {
          id: taskId,
          status: 'in-progress',
          workflowStatus: 'verify_done',
          haltReason: null,
        },
        data: { updatedAt: new Date() },
      });
      if (held.count === 0) return { result: 'lost' };
      const updated = await tx.workflowQueueItem.updateMany({
        // Only a running item still in the CI-wait phase: a runner that claimed it has moved it out.
        where: { id: { in: itemIds }, taskId, status: 'running', currentPhase: CI_WAIT_PHASE },
        data: {
          status: 'completed',
          currentPhase: AWAITING_CI_PHASE,
          completedAt: new Date(),
          result: JSON.stringify({ handedBackAt: new Date().toISOString(), reason: 'awaiting_ci' }),
        },
      });
      // Nothing left in the CI-wait phase: a runner claimed the item first, so it is not handed back.
      if (itemIds.length > 0 && updated.count === 0) return { result: 'lost' };
      return { result: 'released', count: updated.count };
    });
  } catch (error) {
    return { result: 'failed', error };
  }
}
