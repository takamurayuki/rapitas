/**
 * queue-slot-release
 *
 * Frees the concurrency slot a task's WorkflowQueueItem holds, and NOTHING
 * else: no worktree removal, no session change, no task status change, no
 * agent kill. Those belong to reset-execution-state and stop-task-agents.
 *
 * Why this exists. The only API that cancelled a task's queue items was
 * reset-execution-state, which calls removeWorktree first
 * (routes/agents/execution/routes/reset-route.ts:132) — so the single way to
 * free a stuck slot also destroyed the uncommitted implementation. #1214's 193
 * tests existed only in that working tree, and the slot was freed by writing
 * to SQLite by hand instead. A paused theme's retained item starving every
 * theme at MAX_CONCURRENCY=1 is the same shape.
 *
 * The hazard in the other direction is what the in-flight check is for: a
 * `running` item whose agent is genuinely alive is not stranded, and releasing
 * its slot lets a second agent start on the same task and worktree.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow:queue-slot-release');

/**
 * Non-terminal queue statuses. Only `running` holds the concurrency slot (the
 * gate is `count({ status: 'running' })` in workflow-queue.ts's dequeue), but a
 * leftover `queued`/`waiting_approval` row for the same task would be
 * dispatched or awaited later, so releasing the slot without them leaves the
 * task half-released. Mirrors reset-route.ts's own set.
 */
export const RELEASABLE_QUEUE_STATUSES = ['queued', 'running', 'waiting_approval'] as const;

/** Execution statuses that mean an agent is still working on the task. */
const IN_FLIGHT_EXECUTION_STATUSES = ['running', 'pending', 'waiting_for_input'] as const;

/** Cause recorded for an audit trail of the release. */
export const QUEUE_SLOT_RELEASED_CAUSE = 'queue_slot_released';

/** Options for {@link releaseQueueSlot}. */
export interface ReleaseQueueSlotOptions {
  /** Who asked, for the audit record. / 依頼者ラベル */
  actorLabel: string;
  /** Release even while an agent is in flight. / 実行中でも解放する */
  force?: boolean;
}

/** Outcome of a release attempt. */
export type ReleaseQueueSlotResult =
  | { ok: true; taskId: number; released: number; itemIds: number[]; forced: boolean }
  | {
      ok: false;
      reason: 'no_items' | 'execution_in_flight' | 'read_failed' | 'write_failed';
      inFlightExecutionIds?: number[];
      itemIds?: number[];
    };

/**
 * Cancel a task's non-terminal queue items so its concurrency slot is free.
 *
 * Refuses (`execution_in_flight`) while any execution for the task is running,
 * pending or waiting for input, naming the executions so the caller can stop
 * them through the proper path first. `force` is for the case the operator has
 * already decided those executions are dead — it is not a retry of the same
 * call.
 *
 * Never reports success it did not achieve: a failed read or write returns
 * `read_failed` / `write_failed` rather than a zero count.
 *
 * @param taskId - Task whose slot to free. / 対象タスク
 * @param options - Actor label and the force flag. / 依頼者と強制指定
 * @returns What was released, or why nothing was. / 解放結果
 */
export async function releaseQueueSlot(
  taskId: number,
  options: ReleaseQueueSlotOptions,
): Promise<ReleaseQueueSlotResult> {
  const items = await prisma.workflowQueueItem
    .findMany({
      where: { taskId, status: { in: [...RELEASABLE_QUEUE_STATUSES] } },
      select: { id: true, status: true },
    })
    .catch((err: unknown) => {
      log.warn({ err, taskId }, '[queue-slot-release] queue item read failed');
      return null;
    });
  if (items === null) return { ok: false, reason: 'read_failed' };
  if (items.length === 0) return { ok: false, reason: 'no_items' };

  const inFlight = await prisma.agentExecution
    .findMany({
      where: {
        status: { in: [...IN_FLIGHT_EXECUTION_STATUSES] },
        session: { config: { taskId } },
      },
      select: { id: true },
    })
    .catch((err: unknown) => {
      log.warn({ err, taskId }, '[queue-slot-release] in-flight execution read failed');
      return null;
    });
  // Fails CLOSED on this read: not knowing whether an agent is alive must not
  // become permission to take its slot.
  if (inFlight === null) return { ok: false, reason: 'read_failed' };

  const itemIds = items.map((i) => i.id);
  if (inFlight.length > 0 && options.force !== true) {
    return {
      ok: false,
      reason: 'execution_in_flight',
      inFlightExecutionIds: inFlight.map((e) => e.id),
      itemIds,
    };
  }

  const updated = await prisma.workflowQueueItem
    .updateMany({
      where: { taskId, status: { in: [...RELEASABLE_QUEUE_STATUSES] } },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: `Queue slot released by ${options.actorLabel}`,
      },
    })
    .catch((err: unknown) => {
      log.error({ err, taskId }, '[queue-slot-release] failed to cancel the queue items');
      return null;
    });
  if (updated === null) return { ok: false, reason: 'write_failed' };

  log.info(
    { taskId, itemIds, released: updated.count, forced: options.force === true },
    '[queue-slot-release] queue slot released; worktree and task state untouched',
  );
  // Recorded after the write and not rolled back if it fails: a freed slot with
  // no audit line is recoverable, an audit line for a release that did not
  // happen is not.
  await recordTransition({
    taskId,
    fromStatus: null,
    toStatus: 'draft',
    actor: 'user',
    cause: QUEUE_SLOT_RELEASED_CAUSE,
    metadata: {
      itemIds,
      released: updated.count,
      forced: options.force === true,
      releasedBy: options.actorLabel,
      inFlightExecutionIds: inFlight.map((e) => e.id),
    },
  }).catch(() => {});

  return {
    ok: true,
    taskId,
    released: updated.count,
    itemIds,
    forced: options.force === true,
  };
}
