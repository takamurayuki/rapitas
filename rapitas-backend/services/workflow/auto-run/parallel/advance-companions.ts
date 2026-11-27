/**
 * advance-companions
 *
 * The companion half of a scheduler tick (task 1552): advance each companion
 * task with the same per-task decision the head uses (completion, failure,
 * question / approval waits, hang backstop), then fill a free per-theme slot.
 * Split out of theme-auto-run-scheduler.ts for the
 * file-size limit. Not responsible for the head task.
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { createLogger } from '../../../../config/logger';
import { resolveTaskWorkflowState } from '../../../task/task-resolver';
import { advanceActiveTask } from '../auto-run-advance-active';
import { loadThemeActiveSet, parseCompanions, releaseThemeSlot } from './theme-active-set';
import { delegateToCompanionSelection } from './companion-entry';
import { promoteHeadless } from './theme-active-set-cleanup';

const log = createLogger('theme-auto-run-scheduler');

/** Options for {@link advanceCompanions}. */
export interface AdvanceCompanionsOptions {
  /** The scheduler's iteration-budget halt for one task; true = halted. */
  haltIfExceeded?: (taskId: number) => Promise<boolean>;
  /** Fill a free per-theme slot afterwards (false while the theme is paused). */
  select: boolean;
}

/**
 * Advance every companion of a theme by one step, then optionally add one.
 * Nothing is read when the theme state carries no companions.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param companionTasksJson - Companions from the tick's state row / tick で読んだ同伴タスク
 * @param order - Selection order / 選定順
 * @param globalActive - Global active count / グローバルアクティブ数
 * @param barrierHoldSince - Merge-barrier hold starts / マージバリア保留開始時刻
 * @param opts - Halt hook and whether to select / 停止判定と選定の有無
 */
export async function advanceCompanions(
  prisma: PrismaClient,
  themeId: number,
  companionTasksJson: string | null | undefined,
  order: 'priority' | 'created',
  globalActive: number,
  barrierHoldSince: Map<number, number>,
  opts: AdvanceCompanionsOptions,
): Promise<void> {
  if (parseCompanions(companionTasksJson).length > 0) {
    // The head may have been released outside the scheduler (PATCH /tasks).
    await promoteHeadless(prisma, themeId).catch(() => false);
    const set = await loadThemeActiveSet(prisma, themeId);
    for (const c of set.companions) {
      try {
        if (opts.haltIfExceeded && (await opts.haltIfExceeded(c.taskId))) continue;
        // Same lookup the head's resolution uses; null = the row is gone.
        if (!(await resolveTaskWorkflowState(c.taskId))) {
          // A deleted task must not hold its slot forever.
          await releaseThemeSlot(prisma, themeId, c.taskId, 'released');
          continue;
        }
        await advanceActiveTask(
          prisma,
          themeId,
          c.taskId,
          order,
          globalActive,
          new Date(c.since).toISOString(),
          barrierHoldSince,
        );
      } catch (err) {
        log.error(
          { err, themeId, taskId: c.taskId },
          '[ThemeAutoRunScheduler] companion advance failed',
        );
      }
    }
  }
  if (opts.select) await delegateToCompanionSelection(prisma, themeId, order);
}
