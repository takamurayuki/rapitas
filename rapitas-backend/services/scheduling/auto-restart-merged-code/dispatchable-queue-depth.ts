/**
 * DispatchableQueueDepth
 *
 * Counts the queued auto-run items that could actually be dispatched, for the
 * restart gates. A queued item of a paused/stopped theme never runs on its own
 * (queue-theme-guard), so counting it made "pause everything, then restart"
 * impossible (2026-11-26: item 4713 refused /deploy/now with queue-not-empty).
 * Not responsible for the raw `queueDepth`, which other readers still use.
 */
import { prisma } from '../../../config/database';
import { isRestartWaitActive } from './restart-wait';

type Db = Pick<typeof prisma, 'themeAutoRun' | 'workflowQueueItem'>;

/**
 * Count queued items that can run: those of a theme whose auto-run is
 * `enabled && running`, those with no theme, and those whose theme has no
 * ThemeAutoRun row — the same set queue-theme-guard lets through. Nothing is
 * deleted; a resumed theme still finds its items.
 *
 * While a restart wait is active no dequeue happens, so every queued item is
 * parked and the count is 0 — otherwise the items the wait itself requeued
 * would block the restart it is waiting for.
 * A verified repair of a stopped (idle, not enabled) theme also counts: the same
 * guard (`isQueueThemeRunning`, validatedRepair) lets it dispatch, so a restart
 * must wait for it like any other runnable item.
 *
 * @param db - Prisma client (injectable for tests) / Prismaクライアント
 * @param waitActive - Whether a restart wait is active / 再起動待ち中か
 * @returns Number of dispatchable queued items / 実行可能な待機項目数
 */
export async function countDispatchableQueued(
  db: Db = prisma,
  waitActive: boolean = isRestartWaitActive(),
): Promise<number> {
  if (waitActive) return 0;
  const halted = await db.themeAutoRun.findMany({
    where: { NOT: { enabled: true, status: 'running' } },
    select: { themeId: true, enabled: true, status: true },
  });
  const haltedIds = halted.map((r) => r.themeId);
  const repairable = halted.filter((r) => !r.enabled && r.status === 'idle').map((r) => r.themeId);
  const repairs = repairable.length > 0 ? await countValidatedRepairs(db, repairable) : 0;
  const base = await db.workflowQueueItem.count({
    where: {
      status: 'queued',
      // NOTE: notIn alone would drop themeId = NULL rows (SQL NULL semantics).
      ...(haltedIds.length > 0
        ? { OR: [{ themeId: null }, { themeId: { notIn: haltedIds } }] }
        : {}),
    },
  });
  return base + repairs;
}

/** Queued items of stopped themes that carry a valid repair receipt (dispatchable). */
async function countValidatedRepairs(db: Db, themeIds: number[]): Promise<number> {
  const rows = await db.workflowQueueItem.findMany({
    where: { status: 'queued', themeId: { in: themeIds }, result: { not: null } },
    select: { taskId: true, result: true },
  });
  if (rows.length === 0) return 0;
  // Lazy: the receipt checks live next to the queue's admission code.
  const { clearAcquiredRepairReceipt, canAcquireRepairQueue } =
    await import('../../workflow/repair-queue-acquire');
  let count = 0;
  for (const row of rows) {
    try {
      // Same two checks the dequeue makes before it lets a repair run on a stopped theme:
      // the item carries a repair receipt, and that receipt is still admissible.
      if (clearAcquiredRepairReceipt(row.result) !== null) continue;
      if (
        await canAcquireRepairQueue(
          db as unknown as Parameters<typeof canAcquireRepairQueue>[0],
          row,
        )
      )
        count += 1;
    } catch {
      // An unreadable receipt cannot dispatch, so it must not hold the restart.
    }
  }
  return count;
}
