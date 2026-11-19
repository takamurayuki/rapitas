/**
 * DeliverableCompletion
 *
 * The completion record (TaskDeliverableCompletion) and the one entry point
 * of the deliverable automation, `onTaskCompleted(taskId, mode)` (design §3.3
 * 「完了モードごとの対象経路」).
 *
 * The rule every entry follows: the completion write (status → done) and the
 * record write happen in the SAME transaction, with one completion time that
 * is written to both the task's `updatedAt` and the record's `completedAt`.
 * If the record cannot be written, neither is the completion, so a path with
 * an entry always leaves its `mode` behind. Only a client without
 * `$transaction` (some tests, a stand-in) writes the record after the
 * completion; if that fails the hourly check picks the completion up.
 *
 * The entry writes "create if absent; otherwise set mode + completedAt to
 * this completion and state back to pending". The note itself is created
 * afterwards and asynchronously (deliverable-create), never holding up the
 * completion.
 *
 * Inside a transaction only findFirst / create / updateMany / deleteMany are
 * used — the workspace extension runs upsert and unique reads outside it.
 */
import { createLogger } from '../../../config/logger';
import type { PrismaInstance } from '../note-record';

const logger = createLogger('deliverable-completion');

/** How a completion was reached. */
export const COMPLETION_MODES = [
  'manual',
  'workflow_verify',
  'ci_merge',
  'recovery',
  'reconciler_restore',
  'unknown',
  'baseline',
] as const;
export type CompletionMode = (typeof COMPLETION_MODES)[number];

/** Where a record stands. */
export type CompletionState = 'baseline' | 'pending' | 'created' | 'not_eligible' | 'failed';

/**
 * Write the record inside an interactive transaction.
 *
 * @param tx - The transaction client / トランザクションのクライアント
 * @param taskId - The completed task / 完了したタスク
 * @param mode - How it completed / 完了の経路
 * @param completedAt - The completion time, also the task's updatedAt / 完了時刻
 */
export async function recordTaskCompletionTx(
  tx: PrismaInstance,
  taskId: number,
  mode: CompletionMode,
  completedAt: Date,
): Promise<void> {
  const task = (await tx.task.findFirst({
    where: { id: taskId },
    select: { workspaceId: true },
  })) as { workspaceId: number | null } | null;
  if (!task) throw new Error(`task ${taskId} vanished before its completion record`);
  const existing = await tx.taskDeliverableCompletion.findFirst({
    where: { taskId },
    select: { taskId: true },
  });
  if (!existing) {
    await tx.taskDeliverableCompletion.create({
      data: { taskId, workspaceId: task.workspaceId ?? null, mode, completedAt, state: 'pending' },
    });
    return;
  }
  await tx.taskDeliverableCompletion.updateMany({
    where: { taskId },
    data: { mode, completedAt, state: 'pending' },
  });
}

/**
 * The record write as batch-transaction operations, for a completion that is
 * written with `$transaction([...])` (the manual completion in
 * task-mutations). Delete-then-create gives the entry's "set mode and
 * completedAt, back to pending" in a form a batch can carry; the counters
 * start over, which only matters for the failed-retry spacing and a fresh
 * completion is attempted at once anyway.
 *
 * @param db - The client the batch runs on / バッチを実行するクライアント
 * @param taskId - The completed task / 完了したタスク
 * @param workspaceId - The task's workspace / タスクの所属
 * @param mode - How it completed / 完了の経路
 * @param completedAt - The completion time, also the task's updatedAt / 完了時刻
 * @returns The two lazy operations to append to the batch / バッチに足す2操作
 */
export function completionRecordBatchOps(
  db: PrismaInstance,
  taskId: number,
  workspaceId: number | null,
  mode: CompletionMode,
  completedAt: Date,
): unknown[] {
  return [
    db.taskDeliverableCompletion.deleteMany({ where: { taskId } }),
    db.taskDeliverableCompletion.create({
      data: { taskId, workspaceId, mode, completedAt, state: 'pending' },
    }),
  ];
}

/**
 * Write a completion and its record together. `write` performs the
 * completion (status → done, `updatedAt` = the given time) and returns how
 * many rows it changed; the record is written only when that is 1+.
 *
 * @param db - Client / クライアント
 * @param taskId - The task / タスク
 * @param mode - How it completed / 完了の経路
 * @param write - The completion write / 完了の書き込み
 * @returns true when the completion was written / 完了を書けたら true
 */
export async function completeWithRecord(
  db: PrismaInstance,
  taskId: number,
  mode: CompletionMode,
  write: (client: PrismaInstance, completedAt: Date) => Promise<{ count: number }>,
): Promise<boolean> {
  const completedAt = new Date();
  if (typeof (db as { $transaction?: unknown }).$transaction === 'function') {
    const written = (await db.$transaction(async (tx: PrismaInstance) => {
      const result = await write(tx, completedAt);
      if (result.count > 0) await recordTaskCompletionTx(tx, taskId, mode, completedAt);
      return result.count > 0;
    })) as boolean;
    if (written) onTaskCompleted(taskId, mode, { recorded: true, db });
    return written;
  }
  const result = await write(db, completedAt);
  if (result.count === 0) return false;
  onTaskCompleted(taskId, mode, { recorded: false, completedAt, db });
  return true;
}

/**
 * The entry point, called once a completion was actually written. With
 * `recorded: true` the record is already in the completion's transaction;
 * otherwise it is written now, after the fact. Then the note is attempted in
 * the background. Never throws.
 *
 * @param taskId - The completed task / 完了したタスク
 * @param mode - How it completed / 完了の経路
 * @param opts - Whether the record is already written, and its time / 記録済みかどうか
 */
export function onTaskCompleted(
  taskId: number,
  mode: CompletionMode,
  opts: { recorded: boolean; completedAt?: Date; db?: PrismaInstance } = { recorded: true },
): void {
  void (async () => {
    // Loaded lazily so a caller that passes its own client never pulls in
    // the database module (and the generated client) just by importing this.
    const db =
      opts.db ?? ((await import('../../../config/database')).prisma as unknown as PrismaInstance);
    if (!opts.recorded) {
      const at = opts.completedAt ?? new Date();
      await recordTaskCompletionTx(db, taskId, mode, at);
    }
    const { createDeliverableForTask } = await import('./deliverable-create');
    await createDeliverableForTask(db, taskId);
  })().catch((err) => {
    // The hourly check finds an unrecorded completion (`unknown`) or a
    // pending record, so a failure here delays the note, never loses it.
    logger.warn({ err, taskId, mode }, 'deliverable entry failed; left to the hourly check');
  });
}
