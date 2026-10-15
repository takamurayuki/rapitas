/**
 * auto-run-global-active-count
 *
 * Counts the auto-run queue items that occupy the global concurrency slot.
 * It does not decide selection; that stays in auto-run-selection.ts.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';

/**
 * Return the number of auto-run queue items currently occupying a global slot.
 *
 * A `queued` item whose theme is not `running` (paused, idle or stopping) can never be
 * dispatched (queue-theme-guard), so counting it would let it hold the only slot
 * (AUTO_RUN_GLOBAL_MAX_CONCURRENCY=1) and starve every other theme. `running` and
 * `waiting_approval` items are always counted: a real agent / pending approval exists.
 * Themes without a ThemeAutoRun row are counted as before.
 *
 * @param prisma - Prisma client instance
 * @returns count of active auto-run items / アクティブな自動実行キューアイテム数
 */
export async function getGlobalAutoRunActiveCount(prisma: PrismaClient): Promise<number> {
  const inactive = await prisma.themeAutoRun.findMany({
    where: { status: { not: 'running' } },
    select: { themeId: true },
  });
  const inactiveThemeIds = inactive.map((r) => r.themeId);
  return prisma.workflowQueueItem.count({
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
}
