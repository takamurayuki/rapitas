/**
 * theme-active-set-cleanup
 *
 * Out-of-band repairs of a theme's running set (task 1552): promote a companion
 * when the head was released elsewhere, clear companions on a theme stop, and
 * drop a terminal task from every theme's companions. Split out of
 * theme-active-set.ts for the file-size limit. Not responsible for the
 * scheduler's own releases (see releaseThemeSlot).
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { createLogger } from '../../../../config/logger';
import {
  MAX_CAS_ATTEMPTS,
  casUpdate,
  loadThemeActiveSet,
  model,
  serializeCompanions,
} from './theme-active-set';

const log = createLogger('theme-active-set');

/**
 * Promote the oldest companion when the head was released elsewhere (e.g. the
 * PATCH /tasks terminal release nulls currentTaskId only).
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @returns Whether a promotion happened / 繰り上げたか
 */
export async function promoteHeadless(prisma: PrismaClient, themeId: number): Promise<boolean> {
  const set = await loadThemeActiveSet(prisma, themeId);
  if (set.headTaskId != null || set.companions.length === 0) return false;
  const [next, ...rest] = set.companions;
  return casUpdate(
    prisma,
    { themeId, currentTaskId: null, companionTasksJson: set.raw },
    {
      currentTaskId: next!.taskId,
      lastRunAt: new Date(next!.since),
      companionTasksJson: serializeCompanions(rest),
    },
  ).catch(() => false);
}

/**
 * Drop every companion (theme stop). Separate write so a failure on an old
 * client never takes the stop down with it.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 */
export async function clearCompanions(prisma: PrismaClient, themeId: number): Promise<void> {
  try {
    // Read first: a theme without companions (every theme at limit 1) gets no write.
    if ((await loadThemeActiveSet(prisma, themeId)).raw === null) return;
    await casUpdate(prisma, { themeId }, { companionTasksJson: null });
  } catch (err) {
    log.warn({ err, themeId }, 'companion clear failed');
  }
}

/**
 * Remove a task that reached a terminal state from every theme's companions
 * (the companion counterpart of releaseCurrentTaskIfMatches). Never throws.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Terminal task / 終端化したタスク
 * @returns Themes updated / 更新したテーマ数
 */
export async function releaseCompanionEverywhere(
  prisma: PrismaClient,
  taskId: number,
): Promise<number> {
  const m = model(prisma);
  if (typeof m.findMany !== 'function') return 0;
  try {
    const rows = (await m.findMany({
      where: { companionTasksJson: { contains: `"taskId":${taskId},` } },
    })) as Array<{ themeId?: unknown }> | undefined;
    let released = 0;
    for (const row of rows ?? []) {
      if (typeof row.themeId !== 'number') continue;
      // NOT releaseThemeSlot: with the companion already gone its legacy branch
      // would null the theme's head, which is a different task.
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
        const set = await loadThemeActiveSet(prisma, row.themeId);
        if (!set.companions.some((c) => c.taskId === taskId)) break;
        const rest = set.companions.filter((c) => c.taskId !== taskId);
        const where = { themeId: row.themeId, companionTasksJson: set.raw };
        if (await casUpdate(prisma, where, { companionTasksJson: serializeCompanions(rest) })) {
          released++;
          break;
        }
      }
    }
    return released;
  } catch (err) {
    log.warn({ err, taskId }, 'companion terminal release failed (scheduler will retry)');
    return 0;
  }
}
