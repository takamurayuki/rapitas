/**
 * workflow-runner-stale-active
 *
 * Detects and clears `activeExecutions` entries whose queue item is no longer
 * running in the database, so the runner cannot be wedged at its concurrency
 * limit by bookkeeping that only one side cleaned up.
 *
 * Why this exists: `processQueue` only dequeues while
 * `activeExecutions.size < maxConcurrency`, and that map lives in memory. When
 * the periodic sweep cancels an item it dispatched but which never produced an
 * AgentExecution, the DB row becomes `cancelled` while the in-memory entry
 * stays — and with the default concurrency of 1, the runner then never dequeues
 * again. Measured twice on 2026-10-09 (filed as #1165): item 4168 and then item
 * 4172 each held the slot this way; the DB reported 0 running items while two
 * tasks sat `queued` for minutes, the runner answering "Already running" to
 * every kick.
 *
 * NOT responsible for aborting healthy work: an entry is dropped only when the
 * database says its item is finished AND the entry is older than a grace period,
 * so a normal completion that is mid-`finally` is never mistaken for a wedge.
 */

import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow-runner:stale-active');

/** Grace period before an entry may be judged stale. */
export const STALE_ACTIVE_GRACE_MS = 60_000;

/** The subset of an active-execution record this decision needs. */
export interface ActiveEntryLike {
  queueItemId: number;
  taskId: number;
  startedAt: Date;
}

/**
 * Which active entries are stale: their item is not among the running ids and
 * they have outlived the grace period.
 *
 * Pure, so the rule is testable without a database or a live runner.
 *
 * @param entries - Current in-memory entries / 現在のメモリ上のエントリ
 * @param runningItemIds - Queue item ids the DB still reports as running / DBが running と報告する item
 * @param now - Reference time / 基準時刻
 * @param graceMs - Minimum entry age / エントリの最小経過時間
 * @returns The stale entries, oldest first / 滞留しているエントリ（古い順）
 */
export function findStaleActiveEntries(
  entries: readonly ActiveEntryLike[],
  runningItemIds: readonly number[],
  now: number = Date.now(),
  graceMs: number = STALE_ACTIVE_GRACE_MS,
): ActiveEntryLike[] {
  const running = new Set(runningItemIds);
  return entries
    .filter((e) => !running.has(e.queueItemId) && now - e.startedAt.getTime() >= graceMs)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/** An active-execution record, including the handle used to stop it. */
export interface AbortableActiveEntry extends ActiveEntryLike {
  abortController: AbortController;
}

/**
 * Reconcile the runner's in-memory active map against the database, removing
 * entries whose queue item is no longer running.
 *
 * Aborts each dropped entry's controller: if anything is somehow still awaiting
 * on it, it must stop rather than keep running untracked. Fails OPEN — a DB
 * error here must never stop the queue, which is the very problem being fixed.
 *
 * @param active - The runner's activeExecutions map, mutated in place / ランナーのMap（破壊的に更新）
 * @returns Queue item ids dropped / 取り除いた item の ID
 */
export async function dropStaleActiveExecutions(
  active: Map<number, AbortableActiveEntry>,
): Promise<number[]> {
  if (active.size === 0) return [];
  const entries = [...active.values()];
  let runningIds: number[];
  try {
    const rows = await prisma.workflowQueueItem.findMany({
      where: { id: { in: entries.map((e) => e.queueItemId) }, status: 'running' },
      select: { id: true },
    });
    runningIds = rows.map((r) => r.id);
  } catch (err) {
    log.warn({ err }, '[staleActive] Could not check for stale active executions');
    return [];
  }

  const stale = findStaleActiveEntries(entries, runningIds);
  for (const entry of stale) {
    active.get(entry.queueItemId)?.abortController.abort();
    active.delete(entry.queueItemId);
  }
  if (stale.length > 0) {
    log.warn(
      {
        dropped: stale.map((e) => ({ itemId: e.queueItemId, taskId: e.taskId })),
        remaining: active.size,
      },
      '[staleActive] Dropped stale active executions whose queue items are no longer running — the queue was pinned at its concurrency limit',
    );
  }
  return stale.map((e) => e.queueItemId);
}
