/**
 * workflow-runner-stale-active
 *
 * Self-heal for WorkflowRunner.activeExecutions entries whose queue item is no
 * longer 'running' in the DB (task 1165). It does NOT start or stop work itself;
 * it only reconciles the in-memory Map with the DB.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import type { ActiveExecution } from './workflow-runner.types';

const log = createLogger('workflow-runner-stale-active');

/**
 * Pure: entries whose id is not in the DB-running set.
 *
 * @param entries - Current activeExecutions values. / 現在のメモリ上の実行
 * @param dbRunningIds - Queue item ids that are running in the DB. / DB上でrunningのitem id
 * @returns Stale entries, oldest first. / 古い順の滞留エントリ
 */
export function findStaleActiveEntries(
  entries: Iterable<ActiveExecution>,
  dbRunningIds: ReadonlySet<number>,
): ActiveExecution[] {
  return [...entries]
    .filter((e) => !dbRunningIds.has(e.queueItemId))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/**
 * Remove one activeExecutions entry (its item was cancelled/failed in the DB).
 * NOTE: deliberately does NOT abort the controller — an abort would make the still-attached
 * worker run its catch path, which can write queued/failed over the cancelled row.
 *
 * @param active - The runner's activeExecutions Map (mutated). / ランナーのMap
 * @param queueItemId - Queue item id to release. / 解放するキュー項目ID
 * @returns true if an entry was removed. / エントリを除去したら true
 */
export function releaseActiveExecution(
  active: Map<number, ActiveExecution>,
  queueItemId: number,
): boolean {
  const exec = active.get(queueItemId);
  if (!exec) return false;
  active.delete(queueItemId);
  log.warn(
    { queueItemId, taskId: exec.taskId },
    '[WorkflowRunner] Released activeExecutions entry after external cancel',
  );
  return true;
}

/**
 * Abort every not-yet-aborted in-flight execution of a task.
 *
 * @param active - The runner's activeExecutions Map. / ランナーのMap
 * @param taskId - Task whose executions are aborted. / 中断対象タスクID
 * @returns Number of executions aborted. / 中断した実行数
 */
export function abortTaskExecutions(active: Map<number, ActiveExecution>, taskId: number): number {
  let aborted = 0;
  for (const exec of active.values()) {
    if (exec.taskId === taskId && !exec.abortController.signal.aborted) {
      exec.abortController.abort();
      aborted++;
    }
  }
  if (aborted > 0) {
    log.info(`[WorkflowRunner] Aborted ${aborted} in-flight execution(s) for task ${taskId}`);
  }
  return aborted;
}

/**
 * Remove activeExecutions entries that the DB no longer lists as running. Entries with a
 * running DB row are kept (healthy work). Fail-open: a DB error leaves the Map untouched.
 * NOTE: no abort here either (see releaseActiveExecution); no age grace — a Map entry whose
 * row is not running holds a slot for nothing, so it is dropped on the first detection.
 *
 * @param active - The runner's activeExecutions Map (mutated). / ランナーのMap
 * @returns Number of entries dropped. / 落としたエントリ数
 */
export async function dropStaleActiveExecutions(
  active: Map<number, ActiveExecution>,
): Promise<number> {
  if (active.size === 0) return 0;
  let dbRunningIds: Set<number>;
  try {
    const rows = await prisma.workflowQueueItem.findMany({
      where: { id: { in: [...active.keys()] }, status: 'running' },
      select: { id: true },
    });
    dbRunningIds = new Set(rows.map((r: { id: number }) => r.id));
  } catch (error) {
    log.warn({ err: error }, '[WorkflowRunner] stale-active check failed; keeping entries');
    return 0;
  }
  const stale = findStaleActiveEntries(active.values(), dbRunningIds);
  for (const exec of stale) {
    log.warn(
      { queueItemId: exec.queueItemId, taskId: exec.taskId },
      '[WorkflowRunner] activeExecutions entry has no running DB item — dropping (self-heal)',
    );
    active.delete(exec.queueItemId);
  }
  return stale.length;
}
