/**
 * auto-run-global-active-count
 *
 * Counts the auto-run queue items that occupy the global concurrency slot.
 * It does not decide selection; that stays in auto-run-selection.ts.
 * Paused/stopping themes stop holding a slot once their agent has finished.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';

/** Theme statuses that will not dispatch a next phase on their own (pause family and stopping). */
function isHaltedThemeStatus(status: string): boolean {
  return status.startsWith('paused') || status === 'stopping';
}

/**
 * Count `running` items of paused/stopping themes that no longer have a live agent.
 *
 * Such an item is only the runner's bookkeeping between phases; the runner parks it
 * before the next phase (workflow-runner-theme-pause-guard), so it must not hold the
 * slot. Liveness mirrors hasLiveExecution (running + heartbeat within
 * HANG_BACKSTOP_HEARTBEAT_MS) but in one query to avoid N+1.
 *
 * @param prisma - Prisma client instance
 * @param haltedThemeIds - Themes that are paused or stopping / 停止中テーマID
 * @returns number of idle running items, 0 when nothing can be proven / 生きた実行の無い running 件数
 * @throws When a lookup fails; the caller falls back to counting everything. / 照会失敗時
 */
async function countIdleRunningItems(
  prisma: PrismaClient,
  haltedThemeIds: number[],
): Promise<number> {
  const held = await prisma.workflowQueueItem.findMany({
    where: { status: 'running', themeId: { in: haltedThemeIds } },
    select: { taskId: true },
  });
  if (held.length === 0) return 0;
  // NOTE: lazy import — auto-run-selection re-exports this module, a static import would be circular.
  const { HANG_BACKSTOP_HEARTBEAT_MS } = await import('./auto-run-selection');
  const fresh = new Date(Date.now() - HANG_BACKSTOP_HEARTBEAT_MS);
  const live = await prisma.agentExecution.findMany({
    where: {
      session: { config: { taskId: { in: held.map((h) => h.taskId) } } },
      status: 'running',
      heartbeatAt: { gte: fresh },
    },
    select: { session: { select: { config: { select: { taskId: true } } } } },
  });
  const liveTaskIds = new Set(live.map((e) => e.session?.config?.taskId));
  return held.filter((h) => !liveTaskIds.has(h.taskId)).length;
}

/**
 * Return the number of auto-run queue items currently occupying a global slot.
 *
 * A `queued` item whose theme is not `running` (paused, idle or stopping) can never be
 * dispatched (queue-theme-guard), so counting it would let it hold the only slot
 * (AUTO_RUN_GLOBAL_MAX_CONCURRENCY) and starve every other theme. A `running` item of a
 * paused/stopping theme is likewise not counted once no live agent execution backs it
 * (task 1535); an idle theme's `running` item is still counted because a verified
 * repair can legitimately run there. `waiting_approval` is always counted. Lookup
 * failures count everything, so the limit is never under-reported.
 * Themes without a ThemeAutoRun row are counted as before.
 *
 * @param prisma - Prisma client instance
 * @returns count of active auto-run items / アクティブな自動実行キューアイテム数
 */
export async function getGlobalAutoRunActiveCount(prisma: PrismaClient): Promise<number> {
  const inactive = await prisma.themeAutoRun.findMany({
    where: { status: { not: 'running' } },
    select: { themeId: true, status: true },
  });
  const inactiveThemeIds = inactive.map((r) => r.themeId);
  const total = await prisma.workflowQueueItem.count({
    where: {
      themeId: { not: null },
      OR: [
        { status: { in: ['running', 'waiting_approval'] } },
        // NOTE: notIn is skipped when empty so the query matches the legacy shape.
        inactiveThemeIds.length > 0
          ? { status: 'queued', themeId: { notIn: inactiveThemeIds } }
          : { status: 'queued' },
      ],
    },
  });
  const haltedThemeIds = inactive
    .filter((r) => isHaltedThemeStatus(r.status))
    .map((r) => r.themeId);
  if (haltedThemeIds.length === 0) return total;
  try {
    return Math.max(0, total - (await countIdleRunningItems(prisma, haltedThemeIds)));
  } catch {
    return total;
  }
}
