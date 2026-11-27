/**
 * workflow-runner-item-claim
 *
 * Makes every write a WorkflowRunner does on its queue item, and every phase it advances, conditional
 * on a database claim (task 1568). The claim is ONE transaction: write the task row (`updatedAt`
 * only — the row lock that serialises it against the scheduler's hand-back and ci-self-repair),
 * then move the runner's `running` item out of the CI-wait phase. The hand-back only completes a
 * `running` item that is still in that phase, so exactly one of the two wins; a lost claim means
 * the item is no longer ours and the runner withdraws without touching task or item.
 * Not responsible for deciding what the loop does next.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import type { QueueItem, WorkflowQueueService } from './workflow-queue';
import type { WorkflowAdvanceResult } from './workflow-types';
import { ADVANCING_PHASE, CI_WAIT_PHASE, isCiWaitTask } from './awaiting-ci';
import { AWAITING_REQUIRED_MERGE_CAUSE } from './required-merge-hold';

const log = createLogger('workflow-runner');

/** Whether the configured client can run transactions (always true for a real Prisma client). */
function hasTransactions(): boolean {
  return typeof (prisma as { $transaction?: unknown }).$transaction === 'function';
}

/** Whether the task is parked for its required merge: held shape and the hold as latest cause. */
async function taskParkedForCi(tx: ClaimTx, taskId: number): Promise<boolean> {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: { status: true, workflowStatus: true, haltReason: true },
  });
  if (!isCiWaitTask(task) || task?.haltReason) return false;
  const last = await tx.workflowTransition.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    select: { cause: true },
  });
  return last?.cause === AWAITING_REQUIRED_MERGE_CAUSE;
}

/** Outcome of {@link claimQueueItem}. */
export type ClaimResult = 'claimed' | 'lost' | 'keep';

/** advanceの成功・失敗にかかわらず、CI待ちなら所有中の項目を引き渡して撤退する。 */
export async function handOffAfterAdvance(itemId: number, taskId: number): Promise<boolean> {
  if (!hasTransactions()) return false;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({ where: { id: taskId }, data: { updatedAt: new Date() } });
      const claimed = await tx.workflowQueueItem.updateMany({
        where: { id: itemId, status: 'running' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) return true;
      if (!(await taskParkedForCi(tx, taskId))) return false;
      await tx.workflowQueueItem.updateMany({
        where: { id: itemId, status: 'running' },
        data: { currentPhase: CI_WAIT_PHASE },
      });
      return true;
    });
  } catch (err) {
    log.warn({ err, itemId, taskId }, 'CI待ち引渡しの照会に失敗したためrunnerは撤退します');
    return true;
  }
}

/** Transaction client handed to the write that runs inside the claim. */
type ClaimTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Claim the runner's item before acting on it, optionally performing a short write in the SAME
 * transaction so nothing (a re-hold, a hand-back) can slip in between the claim and the write.
 *
 * @param itemId - The runner's queue item / 実行役のキュー項目ID
 * @param taskId - Its task (row-locked by the claim) / 項目のタスクID
 * @param phase - Phase to leave the item in, or null to leave the phase untouched / 残すフェーズ
 * @param keepCiWait - A progress write must not leave a CI wait: answer `keep` instead / 進捗書き込み用
 * @param write - Short write run inside the transaction after a successful claim / 同一トランザクションの書き込み
 * @returns `claimed`, `lost` (not running any more: handed back, completed, cancelled, requeued,
 *   or no such row) or `keep` (progress write while the item is in the CI-wait phase) / 結果
 * @throws When the transaction fails (database unreachable, write rejected): nothing was written / 失敗時
 */
export async function claimQueueItem(
  itemId: number,
  taskId: number,
  phase: string | null,
  keepCiWait = false,
  write?: (tx: ClaimTx) => Promise<unknown>,
): Promise<ClaimResult> {
  return prisma.$transaction(async (tx): Promise<ClaimResult> => {
    await tx.task.updateMany({ where: { id: taskId }, data: { updatedAt: new Date() } });
    if (keepCiWait) {
      const row = await tx.workflowQueueItem.findUnique({
        where: { id: itemId },
        select: { status: true, currentPhase: true },
      });
      if (!row || row.status !== 'running') return 'lost';
      if (row.currentPhase === CI_WAIT_PHASE) return 'keep';
    }
    const moved = await tx.workflowQueueItem.updateMany({
      where: { id: itemId, status: 'running' },
      data:
        phase === null ? { updatedAt: new Date() } : { currentPhase: phase, updatedAt: new Date() },
    });
    if (moved.count !== 1) return 'lost';
    if (write) await write(tx);
    return 'claimed';
  });
}

/**
 * Run `op` only after a successful claim. Fail-closed: when the claim cannot be made (the
 * transaction threw) the item is treated as not ours and `op` never runs.
 *
 * @param itemId - The runner's queue item / 実行役のキュー項目ID
 * @param taskId - Its task / タスクID
 * @param phase - Phase to leave the item in / 残すフェーズ
 * @param op - The operation (a long advance, or nothing when `write` did the job) / 実行する操作
 * @param keepCiWait - See {@link claimQueueItem} / 進捗書き込み用
 * @param write - See {@link claimQueueItem} / 同一トランザクションの書き込み
 * @returns `{ ran: true, value }`, or `{ ran: false }` when the item is no longer ours / 実行結果
 */
export async function runIfOwned<T>(
  itemId: number,
  taskId: number,
  phase: string | null,
  op: () => Promise<T>,
  keepCiWait = false,
  write?: (tx: ClaimTx) => Promise<unknown>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  // NOTE: Unit tests of the runner stub `prisma` without transactions; a real Prisma client always
  // has them, so this only skips the claim for doubles. A database ERROR below still fails closed.
  if (!hasTransactions()) return { ran: true, value: await op() };
  let claim: ClaimResult;
  try {
    claim = await claimQueueItem(itemId, taskId, phase, keepCiWait, write);
  } catch (err) {
    log.warn(
      { err, itemId, taskId },
      '[WorkflowRunner] Claim failed — treating the item as not ours',
    );
    return { ran: false };
  }
  if (claim !== 'claimed') return { ran: false };
  return { ran: true, value: await op() };
}

/**
 * Column values {@link WorkflowQueueService.updateStatus} writes for a status change.
 * NOTE: Mirrors that method (workflow-queue.ts) so the write can run inside the claim's
 * transaction; keep the two in step.
 */
function statusData(
  status: string,
  extra?: { currentPhase?: string; errorMessage?: string; result?: string },
): Record<string, unknown> {
  const data: Record<string, unknown> = { status };
  if (extra?.currentPhase) data.currentPhase = extra.currentPhase;
  if (extra?.errorMessage) data.errorMessage = extra.errorMessage;
  if (extra?.result) data.result = extra.result;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    data.completedAt = new Date();
  }
  return data;
}

/** Queue writes the item loop uses, each skipped once the item is no longer ours. */
export type GuardedQueue = Pick<WorkflowQueueService, 'updateStatus' | 'retryIfPossible'>;

/**
 * Wrap the queue so item writes are skipped after a hand-back.
 *
 * @param queue - The real queue service / キューサービス
 * @param itemId - The runner's item / 項目ID
 * @param taskId - Its task / タスクID
 * @param currentPhase - Phase the loop is on, used when a write names none / 現在のフェーズ
 * @returns A guarded writer. A skipped write resolves with null (callers ignore the row). / ガード付き
 */
export function guardQueueWrites(
  queue: WorkflowQueueService,
  itemId: number,
  taskId: number,
  currentPhase: () => string,
): GuardedQueue {
  return {
    updateStatus: async (id, status, extra) => {
      if (!hasTransactions()) return queue.updateStatus(id, status, extra);
      const progress = status === 'running';
      const r = await runIfOwned(
        itemId,
        taskId,
        progress ? null : (extra?.currentPhase ?? currentPhase()),
        async () => null,
        progress,
        async (tx) => {
          await tx.workflowQueueItem.update({
            where: { id },
            data: statusData(status, extra) as never,
          });
          // The advance that just ended may have parked the task for CI while the item was held
          // as `advancing` (the hold could not move it): the runner hands it over itself, in this
          // same transaction, so the scheduler can release it.
          if (progress && (await taskParkedForCi(tx, taskId))) {
            await tx.workflowQueueItem.update({
              where: { id },
              data: { currentPhase: CI_WAIT_PHASE },
            });
          }
        },
      );
      return (r.ran ? r.value : null) as unknown as QueueItem; // callers ignore the row
    },
    retryIfPossible: async (id, reason) => {
      const r = await runIfOwned(itemId, taskId, currentPhase(), () =>
        queue.retryIfPossible(id, reason),
      );
      return r.ran ? r.value : false;
    },
  };
}

/**
 * Wrap the orchestrator so a phase is only started for an item that is still ours.
 *
 * @param orchestrator - Real orchestrator / オーケストレーター
 * @param itemId - The runner's item / 項目ID
 * @param currentStatus - Phase the loop is on, left on the item and reported when skipped / 現在のフェーズ
 * @returns An orchestrator whose advance reports a skip when the item was handed back / ラッパー
 */
export function guardAdvance(
  orchestrator: { advanceWorkflow(taskId: number): Promise<WorkflowAdvanceResult> },
  itemId: number,
  currentStatus: string,
): { advanceWorkflow(taskId: number): Promise<WorkflowAdvanceResult> } {
  return {
    advanceWorkflow: async (taskId) => {
      const r = await runIfOwned(itemId, taskId, ADVANCING_PHASE, () =>
        orchestrator.advanceWorkflow(taskId),
      );
      if (r.ran) return r.value;
      // Handed back: report "someone else owns it" — the loop's skip branch then only re-queues
      // through the guarded writer, which is a no-op for a handed-back item.
      return {
        success: true,
        skipped: true,
        role: 'implementer',
        status: currentStatus as WorkflowAdvanceResult['status'],
      };
    },
  };
}
