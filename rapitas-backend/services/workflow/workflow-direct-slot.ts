/**
 * workflow-direct-slot
 *
 * Gives a direct (non-queue) advance of a paused theme's task a real global slot: a
 * WorkflowQueueItem set to `running` for the duration of the advance, taken under the same
 * Serializable transaction and `running` count that dequeue uses. Not responsible for
 * auto-run selection or for the runner's own phase loop.
 */
// NOTE: prisma comes from the '../../config' barrel, like the other runner-side guards.
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { WorkflowQueueService } from './workflow-queue';

const log = createLogger('workflow-direct-slot');

/** Result of trying to take a slot for a direct advance. */
export type DirectSlotResult =
  | { status: 'acquired'; itemId: number }
  | { status: 'slot_unavailable'; reason: 'full' | 'already_running' | 'error' };

const OPEN_STATUSES = ['queued', 'running', 'waiting_approval'];

type TaskRef = { themeId: number | null; workflowStatus: string | null } | null;

/** Row shape shared by the running reservation and the queued waiting item. */
function itemData(taskId: number, task: TaskRef, status: 'queued' | 'running') {
  return {
    taskId,
    themeId: task?.themeId ?? null,
    orchestraSessionId: null,
    status,
    currentPhase: task?.workflowStatus ?? 'draft',
    dependencies: '[]',
    ...(status === 'running' ? { startedAt: new Date() } : {}),
  };
}

/**
 * Take a global slot for a direct advance of `taskId`.
 *
 * Counts `running` items (the same criterion as dequeue) inside a Serializable transaction.
 * An existing `queued` item of the task is reused (never duplicated). A task that already has
 * a `running` / `waiting_approval` item is refused (`already_running`): between a reservation
 * and the AgentExecution row appearing nothing proves that run is gone, so reusing it would
 * allow a double start. A genuinely orphaned row is reclaimed by the reconciler's stale-running
 * sweep (40 min, workflow-reconciler-queue-stall) and can then be acquired again. When the
 * slots are full, the `queued` item the task waits on is created in the SAME transaction.
 * A failing transaction counts as unavailable (fail-closed) and tries to leave a queued item.
 *
 * @param taskId - Task about to be advanced directly. / 直接 advance するタスクID
 * @param maxConcurrency - Limit to enforce; defaults to the queue's current limit. / 上限
 * @returns acquired with the owning item id, or slot_unavailable with a reason. / 取得結果
 */
export async function acquireDirectSlot(
  taskId: number,
  maxConcurrency: number = WorkflowQueueService.getInstance().getMaxConcurrency(),
): Promise<DirectSlotResult> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<DirectSlotResult> => {
        const own = await tx.workflowQueueItem.findFirst({
          where: { taskId, orchestraSessionId: null, status: { in: OPEN_STATUSES } },
        });
        if (own && own.status !== 'queued') {
          return { status: 'slot_unavailable', reason: 'already_running' };
        }
        const running = await tx.workflowQueueItem.count({ where: { status: 'running' } });
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { themeId: true, workflowStatus: true },
        });
        if (running >= maxConcurrency) {
          if (!own) {
            await tx.workflowQueueItem.create({ data: itemData(taskId, task, 'queued') });
          }
          return { status: 'slot_unavailable', reason: 'full' };
        }
        if (own) {
          await tx.workflowQueueItem.update({
            where: { id: own.id },
            data: { status: 'running', startedAt: new Date() },
          });
          return { status: 'acquired', itemId: own.id };
        }
        const created = await tx.workflowQueueItem.create({
          data: itemData(taskId, task, 'running'),
        });
        return { status: 'acquired', itemId: created.id };
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (err) {
    log.warn({ taskId, err }, '[DirectSlot] Slot transaction failed — not starting directly');
    await requeueForLater(taskId);
    return { status: 'slot_unavailable', reason: 'error' };
  }
}

/** After a failed transaction, leave a `queued` item (if none is open) so dequeue can run the task. */
async function requeueForLater(taskId: number): Promise<void> {
  try {
    // 復帰同士や dequeue と競合しても、確認と作成を同じ排他区間で行う。
    await prisma.$transaction(
      async (tx) => {
        const open = await tx.workflowQueueItem.findFirst({
          where: { taskId, orchestraSessionId: null, status: { in: OPEN_STATUSES } },
        });
        if (open) return;
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { themeId: true, workflowStatus: true },
        });
        await tx.workflowQueueItem.create({ data: itemData(taskId, task, 'queued') });
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (err) {
    log.warn({ taskId, err }, '[DirectSlot] Could not leave a queued item — answer stays saved');
  }
}

/**
 * Release a slot taken by {@link acquireDirectSlot}.
 *
 * CAS on `running` so a stop/reconcile that already finished the item is not overwritten. A
 * failed write leaves the item `running`; the reconciler's stale-running sweep reclaims it.
 *
 * @param itemId - Item returned by acquireDirectSlot. / 取得した項目ID
 * @param outcome - Terminal status to record. / 記録する終端状態
 * @param errorMessage - Failure reason, if any. / 失敗理由
 */
export async function releaseDirectSlot(
  itemId: number,
  outcome: 'completed' | 'failed' = 'completed',
  errorMessage?: string,
): Promise<void> {
  try {
    await prisma.workflowQueueItem.updateMany({
      where: { id: itemId, status: 'running' },
      data: { status: outcome, completedAt: new Date(), errorMessage: errorMessage ?? null },
    });
  } catch (err) {
    log.warn({ itemId, err }, '[DirectSlot] Release failed — stale-running sweep will reclaim');
  }
}

/** Outcome of {@link startWithDirectSlotIfPaused}. */
export type DirectStartResult<T> = { status: 'started'; done: Promise<T> } | { status: 'deferred' };

/**
 * 一時停止テーマの枠を予約して `fn` を開始する。状態を読めない場合は待機する。
 *
 * The slot is acquired before this resolves, so the caller knows whether the advance was
 * deferred (`deferred`: `fn` never ran, the task waits `queued`). `done` settles when `fn`
 * does; the slot is released in a `finally`-equivalent on success, failure and throw. Running,
 * idle and auto-run-less themes advance through the queue or manually and are not gated.
 *
 * @param taskId - Task to advance directly. / 対象タスクID
 * @param fn - The advance to run. / 実行する advance
 * @returns started (with the completion promise) or deferred. / 開始したか見送ったか
 */
export async function startWithDirectSlotIfPaused<T extends { success?: boolean }>(
  taskId: number,
  fn: () => Promise<T>,
): Promise<DirectStartResult<T>> {
  const gate = await themeGate(taskId);
  if (gate === 'open') return { status: 'started', done: fn() };
  if (gate === 'unreadable') {
    await requeueForLater(taskId);
    return { status: 'deferred' };
  }
  const slot = await acquireDirectSlot(taskId);
  if (slot.status !== 'acquired') return { status: 'deferred' };
  const done = (async () => {
    try {
      const value = await fn();
      await releaseDirectSlot(slot.itemId, value?.success === false ? 'failed' : 'completed');
      return value;
    } catch (err) {
      await releaseDirectSlot(
        slot.itemId,
        'failed',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  })();
  return { status: 'started', done };
}

/**
 * Run `fn` holding a global slot when the task's theme is paused/stopping, and wait for it.
 *
 * @param taskId - Task to advance directly. / 対象タスクID
 * @param fn - The advance to run. / 実行する advance
 * @returns ran (with fn's value) or deferred. / 実行したか見送ったか
 */
export async function runWithDirectSlotIfPaused<T extends { success?: boolean }>(
  taskId: number,
  fn: () => Promise<T>,
): Promise<{ status: 'ran'; value: T } | { status: 'deferred' }> {
  const started = await startWithDirectSlotIfPaused(taskId, fn);
  if (started.status === 'deferred') return started;
  return { status: 'ran', value: await started.done };
}

/**
 * 稼働中・idle・未設定は open、一時停止は gated、読取失敗は unreadable。
 * unreadable は空き枠の有無にかかわらず直接実行を見送る。
 */
async function themeGate(taskId: number): Promise<'open' | 'gated' | 'unreadable'> {
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { themeId: true } });
    if (task?.themeId == null) return 'open';
    const run = await prisma.themeAutoRun.findFirst({
      where: { themeId: task.themeId },
      select: { status: true },
    });
    const status = run?.status ?? '';
    return status.startsWith('paused') || status === 'stopping' ? 'gated' : 'open';
  } catch (err) {
    log.warn({ taskId, err }, '[DirectSlot] テーマ状態を読めないため直接実行を待機');
    return 'unreadable';
  }
}
