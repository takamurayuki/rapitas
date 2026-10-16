/**
 * workflow-reconciler-undispatchable
 *
 * Heals todo tasks whose status/workflowStatus desync makes them undispatchable,
 * plus the live-execution probe shared with workflow-reconciler-requeue.
 * NOT responsible for orphan / blocked requeue (see workflow-reconciler-requeue).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow-reconciler');

/** Execution statuses that represent a still-alive agent. */
export const ACTIVE_EXEC = ['running', 'pending', 'waiting_for_input'];

/**
 * A todo task must sit in an undispatchable workflowStatus this long before a
 * reset — no legitimate in-flight completion could still be settling by then.
 */
const UNDISPATCHABLE_SETTLE_MS = 24 * 60 * 60 * 1000;

/**
 * True when the task still has a live agent execution.
 *
 * @param taskId - Task id. / タスクID
 * @returns Whether an active execution exists. / 実行中の実行があるか
 */
export async function hasLiveExecution(taskId: number): Promise<boolean> {
  const live = await prisma.agentExecution.findFirst({
    where: { session: { config: { taskId } }, status: { in: ACTIVE_EXEC } },
    select: { id: true },
  });
  return !!live;
}

/**
 * Heal undispatchable status/workflowStatus desyncs on todo tasks.
 *
 * Class 1 — todo × verify_done: `verify_done` has NO entry in the transition
 * table, so such a task can never be dispatched — every auto-run selection
 * fails and repeats forever (observed: tasks 5/8/11 parked since May). Reset
 * workflowStatus to 'draft' (artifacts are reused via isReusableArtifact, so
 * the re-run is cheap and completes properly this time).
 *
 * Class 2 — todo × completed: the workflow finished but the task row's status
 * was never finalized — finalize to done so it stops being re-selected.
 *
 * Both classes require 24h staleness and no live execution. Class 1 is
 * additionally bounded to one reset per task.
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of tasks healed. / 修復数
 */
export async function healUndispatchableTodo(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - UNDISPATCHABLE_SETTLE_MS);
  let healed = 0;

  const stranded = await prisma.task
    .findMany({
      where: {
        status: 'todo',
        workflowStatus: 'verify_done',
        parentId: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    })
    .catch(() => [] as { id: number }[]);
  for (const t of stranded) {
    if (await hasLiveExecution(t.id)) continue;
    const attempts = await prisma.workflowTransition
      .count({ where: { taskId: t.id, cause: 'reconciler_reset_undispatchable' } })
      .catch(() => 0);
    if (attempts >= 1) continue; // one reset per task — a re-strand needs a human look
    await prisma.task
      .update({
        where: { id: t.id },
        data: { workflowStatus: 'draft', updatedAt: new Date() },
      })
      .catch(() => {});
    await recordTransition({
      taskId: t.id,
      fromStatus: 'verify_done',
      toStatus: 'draft',
      actor: 'system',
      cause: 'reconciler_reset_undispatchable',
      metadata: { reason: 'todo_verify_done_has_no_transition' },
    }).catch(() => {});
    healed++;
    log.info(
      { taskId: t.id },
      '[reconciler] Reset undispatchable todo×verify_done task -> draft (artifacts reused on re-run)',
    );
  }

  const finished = await prisma.task
    .findMany({
      where: {
        status: 'todo',
        workflowStatus: 'completed',
        parentId: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, completedAt: true },
    })
    .catch(() => [] as { id: number; completedAt: Date | null }[]);
  for (const t of finished) {
    if (await hasLiveExecution(t.id)) continue;
    await prisma.task
      .update({
        where: { id: t.id },
        data: { status: 'done', completedAt: t.completedAt ?? new Date() },
      })
      .catch(() => {});
    healed++;
    log.info(
      { taskId: t.id },
      '[reconciler] Healed completion desync (todo + wf=completed) -> done',
    );
  }

  return healed;
}
