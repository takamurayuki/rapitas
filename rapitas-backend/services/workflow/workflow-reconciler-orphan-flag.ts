/**
 * workflow-reconciler-orphan-flag
 *
 * The reconciler's notify-only pass: surface in-progress tasks that have no live
 * execution, once each. Extracted from workflow-reconciler.ts (file-size split);
 * heals nothing and changes no task state — {@link shouldFlagOrphanTask} owns
 * which tasks qualify.
 */
import { prisma } from '../../config/database';
import { createNotification } from '../communication/notification-service';
import { ACTIVE_EXEC, STALE_TASK_MS } from './workflow-reconciler-requeue';
import { shouldFlagOrphanTask } from './orphan-flag-policy';

/** Re-notify window: the same task is surfaced at most once per this period. */
const RENOTIFY_WINDOW_MS = 6 * 60 * 60 * 1000;

const STALL_TITLE = 'タスクが停滞しています';

/**
 * Surface (notify once) in-progress tasks that have no live execution.
 *
 * @param nowMs - Current time (ms), injected for testability. / 現在時刻
 * @returns Number of tasks newly surfaced. / 新たに通知した件数
 */
export async function flagOrphanTasks(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - STALE_TASK_MS);
  const tasks = await prisma.task
    .findMany({
      where: { status: 'in-progress', parentId: null, updatedAt: { lt: cutoff } },
      select: { id: true, title: true, workflowStatus: true },
    })
    .catch(() => []);

  let flagged = 0;
  const { isAwaitingRequiredMerge } = await import('./verify-settle-artifact-recovery');
  for (const t of tasks) {
    // Fail-closed on the merge lookup: unreadable must not read as "not awaiting".
    const awaitingMerge =
      t.workflowStatus === 'verify_done'
        ? await isAwaitingRequiredMerge(t.id).catch(() => true)
        : false;
    if (!shouldFlagOrphanTask(t.workflowStatus, awaitingMerge)) continue;

    const liveExec = await prisma.agentExecution
      .findFirst({
        where: { session: { config: { taskId: t.id } }, status: { in: ACTIVE_EXEC } },
        select: { id: true },
      })
      .catch(() => null);
    if (liveExec) continue;

    // Dedup: skip if we already surfaced this task recently.
    const recent = await prisma.notification
      .findFirst({
        where: {
          link: `/tasks?taskId=${t.id}`,
          title: STALL_TITLE,
          createdAt: { gt: new Date(nowMs - RENOTIFY_WINDOW_MS) },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (recent) continue;

    await createNotification({
      type: 'system',
      title: STALL_TITLE,
      message: `#${t.id}「${t.title}」が長時間「進行中」のまま実行が見当たりません。再実行をご検討ください。`,
      link: `/tasks?taskId=${t.id}`,
      metadata: { taskId: t.id, reason: 'reconciler_orphan' },
    }).catch(() => {});
    flagged++;
  }
  return flagged;
}
